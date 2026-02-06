import * as FileSystem from "expo-file-system/legacy";
import { ref, getDownloadURL, uploadBytes } from "firebase/storage";
import { doc, updateDoc } from "firebase/firestore";
import { storage, db, auth } from "../lib/firebase";
import { OrderItem } from "../types/order";
import { Buffer } from "buffer";
import { stripUndefined } from "../utils/firestore";

type UploadKind = "preview" | "print";

function inferContentType(uri: string): string {
    const u = uri.toLowerCase();
    if (u.endsWith(".png")) return "image/png";
    if (u.endsWith(".webp")) return "image/webp";
    if (u.endsWith(".jpeg") || u.endsWith(".jpg")) return "image/jpeg";
    if (u.endsWith(".heic") || u.endsWith(".heif")) return "image/heic";
    return "image/jpeg";
}

function yyyymmdd(d = new Date()): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
}

function getBucket(): string {
    // @ts-ignore
    const b1 = storage?.app?.options?.storageBucket as string | undefined;
    // optional env fallback
    const b2 = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET;
    return (b1 || b2 || "").trim();
}

function guessExtFromContentType(ct: string): string {
    if (ct === "image/png") return "png";
    if (ct === "image/webp") return "webp";
    if (ct === "image/heic") return "heic";
    return "jpg";
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>, opts?: { tries?: number; baseDelayMs?: number }) {
    const tries = opts?.tries ?? 3;
    const baseDelayMs = opts?.baseDelayMs ?? 350;

    let lastErr: any;
    for (let attempt = 1; attempt <= tries; attempt++) {
        try {
            return await fn();
        } catch (e: any) {
            lastErr = e;
            const code = e?.code || "";
            const retryable =
                code === "storage/unknown" ||
                code === "storage/retry-limit-exceeded" ||
                code === "storage/network-request-failed";

            if (!retryable || attempt === tries) break;

            const backoff = baseDelayMs * Math.pow(2, attempt - 1);
            await sleep(backoff);
        }
    }
    throw lastErr;
}

/**
 * Uploads a local URI to Firebase Storage (RN/Expo-safe)
 * - Avoids Blob/ArrayBufferView incompat by using Firebase Storage REST upload
 */
export async function uploadLocalUriToStorage(params: {
    localUri: string;
    uid: string;
    orderId: string;
    index: number;
    kind: UploadKind;
}): Promise<string> {
    const { localUri, uid, orderId, index, kind } = params;

    const contentType = inferContentType(localUri);
    const ext = guessExtFromContentType(contentType);

    // YYYYMMDD based path for better grouping
    const dateKey = yyyymmdd();
    const storagePath = `orders/${dateKey}/${orderId}/items/${index}_${kind}.${ext}`;

    if (__DEV__) {
        console.log(`[StorageUpload] uid=${uid}, orderId=${orderId}, path=${storagePath}`);
    }

    try {
        const result = await withRetry(async () => {
            // 0) ensure file exists
            const info = await FileSystem.getInfoAsync(localUri);
            if (!info.exists || (info.size ?? 0) === 0) {
                throw new Error(`File missing/empty: ${localUri}`);
            }

            // 1) Upload using Firebase SDK (works with Blob on iOS/Android)
            const storageRef = ref(storage, storagePath);

            // Standardize to JPEG for print/preview reliability
            const uploadContentType = contentType.includes("heic") ? "image/jpeg" : contentType;

            const response = await fetch(localUri);
            const blob = await response.blob();

            await uploadBytes(storageRef, blob, {
                contentType: uploadContentType,
                cacheControl: "public,max-age=31536000"
            });

            const downloadURL = await getDownloadURL(storageRef);

            if (__DEV__) {
                console.log(`[StorageUpload] Success! path=${storagePath}, url=${downloadURL.slice(0, 40)}...`);
            }

            return downloadURL;
        });

        return result;
    } catch (error: any) {
        console.error(`[StorageUpload] Failed for ${localUri}: ${error?.code || error?.message}`);
        throw error;
    }
}

/**
 * Background task to upload all images for an order
 */
export async function uploadOrderImages(params: { orderId: string; uid: string; items: OrderItem[] }) {
    const { orderId, uid, items } = params;
    const orderRef = doc(db, "orders", orderId);

    const updatedItems = [...items];
    let hasChanges = false;

    for (let i = 0; i < updatedItems.length; i++) {
        const item = updatedItems[i];

        if (item.previewUri && !item.previewUrl) {
            try {
                const url = await uploadLocalUriToStorage({ localUri: item.previewUri, uid, orderId, index: i, kind: "preview" });
                updatedItems[i].previewUrl = url;
                // Save meta path for fallback/reconstruction
                const dateKey = yyyymmdd();
                updatedItems[i].storagePath = `orders/${dateKey}/${orderId}/items/${i}_preview.jpg`;
                hasChanges = true;
                console.log(`[StorageUpload] Preview ${i} uploaded`);
            } catch (e) {
                console.warn(`[StorageUpload] Failed preview ${i}`, e);
            }
        }

        if (item.printUri && !item.printUrl) {
            try {
                const url = await uploadLocalUriToStorage({ localUri: item.printUri, uid, orderId, index: i, kind: "print" });
                updatedItems[i].printUrl = url;
                const dateKey = yyyymmdd();
                updatedItems[i].printStoragePath = `orders/${dateKey}/${orderId}/items/${i}_print.jpg`;
                hasChanges = true;
                console.log(`[StorageUpload] Print ${i} uploaded`);
            } catch (e) {
                console.warn(`[StorageUpload] Failed print ${i}`, e);
            }
        }
    }

    if (hasChanges) {
        const dateKey = yyyymmdd();
        await updateDoc(orderRef, stripUndefined({
            items: updatedItems,
            storageBasePath: `orders/${dateKey}/${orderId}`
        }));
        console.log(`[StorageUpload] Firestore doc ${orderId} updated with downloadUrls and storagePaths`);
    }
}
