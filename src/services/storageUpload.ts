// src/utils/storageUpload.ts
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../lib/firebase";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

import * as FileSystem from "expo-file-system";
import { Platform } from "react-native";

function guessExt(uri: string) {
    const m = uri.split("?")[0].match(/\.([a-zA-Z0-9]+)$/);
    return (m?.[1] || "").toLowerCase();
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

function normalizeFileUri(uri: string) {
    if (!uri) return uri;

    if (uri.startsWith("ph://") || uri.startsWith("assets-library://")) return uri;
    if (uri.startsWith("content://")) return uri;
    if (uri.startsWith("file://")) return uri;

    if (uri.startsWith("/") || uri.startsWith("var/") || uri.includes("/")) {
        return `file://${uri}`;
    }

    return uri;
}

async function waitForFileStable(fileUri: string, timeoutMs = 6000) {
    const start = Date.now();
    let lastSize = -1;
    let stableCount = 0;

    while (Date.now() - start < timeoutMs) {
        try {
            const info = await FileSystem.getInfoAsync(fileUri);
            const size = (info as any)?.size ?? 0;

            if (!info.exists || !size || size <= 0) {
                stableCount = 0;
                lastSize = size;
                await sleep(120);
                continue;
            }

            if (size === lastSize) stableCount += 1;
            else stableCount = 0;

            lastSize = size;

            if (stableCount >= 2) return true;
            await sleep(120);
        } catch (e) {
            console.warn("[upload] getInfoAsync failed (continue):", { fileUri }, e);
            return true;
        }
    }

    console.warn("[upload] file not stable before upload:", fileUri);
    return false;
}

async function fetchBlobWithRetry(uri: string, tries = 6) {
    let lastErr: any = null;

    for (let i = 0; i < tries; i++) {
        try {
            const res = await fetch(uri);
            const blob = await res.blob();

            // @ts-ignore
            const size = (blob as any)?.size ?? 0;
            if (size && size > 0) return blob;

            console.warn("[upload] fetched blob size=0, retry:", { uri, attempt: i + 1 });
            await sleep(180);
            continue;
        } catch (e) {
            lastErr = e;
            console.warn("[upload] fetch blob failed, retry:", { uri, attempt: i + 1 }, e);
            await sleep(180);
        }
    }

    throw lastErr || new Error("Failed to fetch non-empty blob");
}

export async function uploadFileUriToStorage(path: string, fileUri: string) {
    console.log("🟦 [upload] enter", { path, fileUri });

    if (Platform.OS === 'web') {
        try {
            console.log("🟦 [upload-web] fetching blob directly");
            const res = await fetch(fileUri);
            const blob = await res.blob();

            const storageRef = ref(storage, path);
            await uploadBytes(storageRef, blob, {
                cacheControl: "public,max-age=31536000",
                contentType: "image/jpeg",
            });

            const downloadUrl = await getDownloadURL(storageRef);
            console.log("✅ [upload-web] done", { path });
            return { path, downloadUrl };
        } catch (e) {
            console.error("❌ [upload-web] error:", e);
            throw e;
        }
    }

    let uploadUri = normalizeFileUri(fileUri);

    const ext = guessExt(fileUri);
    const likelyNotJpeg = ext && !["jpg", "jpeg"].includes(ext);

    try {
        if (
            likelyNotJpeg ||
            fileUri.startsWith("ph://") ||
            fileUri.startsWith("assets-library://")
        ) {
            console.log("🟦 [upload] converting to JPEG", {
                path,
                ext,
                uriPrefix: fileUri.slice(0, 20),
                platform: Platform.OS,
            });

            const converted = await manipulateAsync(
                fileUri,
                [],
                // ⭐️ 변경포인트: 변환 시에도 고화질 인쇄를 위해 품질을 0.98로 상향
                { compress: 0.98, format: SaveFormat.JPEG }
            );

            uploadUri = normalizeFileUri(converted.uri);

            console.log("🟩 [upload] converted", { path });
        }
    } catch (e) {
        console.warn("[upload] manipulateAsync failed (continue):", { path }, e);
        uploadUri = normalizeFileUri(fileUri);
    }

    console.log("🟦 [upload] before waitForFileStable", { path });
    await waitForFileStable(uploadUri);
    console.log("🟩 [upload] after waitForFileStable", { path });

    console.log("🟦 [upload] before fetchBlobWithRetry", { path });
    const blob = await fetchBlobWithRetry(uploadUri, 6);
    // @ts-ignore
    console.log("🟩 [upload] blob ok", { path, size: (blob as any)?.size ?? null });

    const storageRef = ref(storage, path);

    console.log("📦 [upload] Before uploadBytes", { path });
    await uploadBytes(storageRef, blob, {
        cacheControl: "public,max-age=31536000",
        contentType: "image/jpeg",
    });
    console.log("✅ [upload] After uploadBytes", { path });

    const downloadUrl = await getDownloadURL(storageRef);
    console.log("✅ [upload] done", { path });

    return { path, downloadUrl };
}