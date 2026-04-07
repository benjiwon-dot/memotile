// src/utils/storageUpload.ts
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../lib/firebase";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

// ✅ SDK54: getInfoAsync deprecation/throw 이슈 회피 (legacy 유지)
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

function guessExt(uri: string) {
    const m = uri.split("?")[0].match(/\.([a-zA-Z0-9]+)$/);
    return (m?.[1] || "").toLowerCase();
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

// ✅ iOS에서 간헐적으로 file:// 스킴이 빠진 uri가 들어올 수 있어 fetch/blob 0바이트를 유발
function normalizeFileUri(uri: string) {
    if (!uri) return uri;

    // ph:// / assets-library:// 는 그대로
    if (uri.startsWith("ph://") || uri.startsWith("assets-library://")) return uri;

    // Android content:// 그대로
    if (uri.startsWith("content://")) return uri;

    // 이미 file://면 그대로
    if (uri.startsWith("file://")) return uri;

    // iOS/Android 로컬 경로로 보이면 file:// 붙임
    if (uri.startsWith("/") || uri.startsWith("var/") || uri.includes("/")) {
        return `file://${uri}`;
    }

    return uri;
}

// ✅ 파일이 0바이트/작성중이면 조금 기다렸다가 업로드 (크랍/필터 로직 불변)
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

            if (stableCount >= 2) return true; // ~240ms 안정
            await sleep(120);
        } catch (e) {
            // getInfoAsync 자체가 실패해도 업로드를 막지는 않음 (안전)
            console.warn("[upload] getInfoAsync failed (continue):", { fileUri }, e);
            return true;
        }
    }

    console.warn("[upload] file not stable before upload:", fileUri);
    return false;
}

// ✅ fetch(blob) 결과가 0바이트면 재시도 (iOS에서 간헐적 검정/빈파일 방지)
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

    // ✨ [핵심 해결] 웹(Vercel) 환경에서는 모바일용 파일 시스템 검사를 완전히 무시하고 즉시 업로드합니다.
    if (Platform.OS === 'web') {
        try {
            console.log("🟦 [upload-web] fetching blob directly");
            // 웹은 메모리에 이미 blob이 있으므로 안정화 대기가 필요 없습니다.
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
            throw e; // 에러가 나면 멈추도록 던짐
        }
    }

    // ---------------------------------------------------------
    // 👇 아래부터는 기존과 100% 동일한 모바일(앱) 전용 로직입니다.
    // ---------------------------------------------------------

    let uploadUri = normalizeFileUri(fileUri);

    // ✅ HEIC/PNG/etc → JPEG로 강제 변환 (특히 source에 강추)
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
                [], // 원본 유지
                { compress: 0.92, format: SaveFormat.JPEG }
            );

            uploadUri = normalizeFileUri(converted.uri);

            console.log("🟩 [upload] converted", { path });
        }
    } catch (e) {
        // 변환 실패해도 업로드 시도는 계속 (검정/0바이트 방지 로직이 핵심)
        console.warn("[upload] manipulateAsync failed (continue):", { path }, e);
        uploadUri = normalizeFileUri(fileUri);
    }

    // ✅ 업로드 직전 안정화 가드 (크랍/필터/좌표 로직 건드리지 않음)
    console.log("🟦 [upload] before waitForFileStable", { path });
    await waitForFileStable(uploadUri);
    console.log("🟩 [upload] after waitForFileStable", { path });

    console.log("🟦 [upload] before fetchBlobWithRetry", { path });
    const blob = await fetchBlobWithRetry(uploadUri, 6);
    // @ts-ignore
    console.log("🟩 [upload] blob ok", { path, size: (blob as any)?.size ?? null });

    const storageRef = ref(storage, path);

    // ✅ 진짜 uploadBytes 직전 로그
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