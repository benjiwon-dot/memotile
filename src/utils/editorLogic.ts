import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import { Skia, ImageFormat } from "@shopify/react-native-skia";
import { Buffer } from "buffer";
import { IDENTITY, type ColorMatrix } from "./colorMatrix";

/**
 * Helper: timeout wrapper to prevent infinite hangs.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        p,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms}ms`)), ms)
        ),
    ]);
}

/**
 * Utility: returns the original URI.
 * Real baking now happens via Canvas snapshot in EditorScreen.
 */
export const applyFilterToUri = async (uri: string, matrix: ColorMatrix): Promise<string> => {
    return uri;
};

/**
 * Bakes a Skia image snapshot (from an on-screen Canvas) to a local file.
 * Stable on both iOS and Android.
 */
export const bakeFilterFromCanvasSnapshot = async (
    snapshot: any
): Promise<string> => {
    if (!snapshot) throw new Error("[Filter] No snapshot provided to bake.");

    try {
        // Ensure Buffer exists (Expo/RN safe)
        const g = globalThis as any;
        if (!g.Buffer) {
            g.Buffer = Buffer;
        }

        const data = snapshot.encodeToBytes(ImageFormat.JPEG, 95);
        const dest = `${FileSystem.cacheDirectory}baked_${Date.now()}.jpg`;

        const base64 = Buffer.from(data as any).toString("base64");

        // Safety Guard
        if (!base64 || base64.length < 32) {
            throw new Error("[Filter] Empty or corrupted base64 generated from snapshot.");
        }

        await FileSystem.writeAsStringAsync(dest, base64, {
            encoding: FileSystem.EncodingType.Base64,
        });

        if (__DEV__) console.log(`[Filter] Snapshot bake success: ${dest.slice(-30)}`);
        return dest;
    } catch (e) {
        console.error("[Filter] Snapshot bake failed:", e);
        throw e;
    }
};

/**
 * Generates a fast preview export (max 1000px).
 */
export const generatePreviewExport = async (
    uri: string,
    cropRect: { x: number; y: number; width: number; height: number }
) => {
    // ✅ 긴 변 512로 고정 (메모리 안전 + 썸네일 용도)
    const longSide = 512;
    const isLandscape = cropRect.width >= cropRect.height;
    const resizeObj = isLandscape ? { width: longSide } : { height: longSide };

    const result = await manipulateAsync(
        uri,
        [
            { crop: { originX: cropRect.x, originY: cropRect.y, width: cropRect.width, height: cropRect.height } },
            { resize: resizeObj }
        ],
        { compress: 0.8, format: SaveFormat.JPEG }
    );

    return { uri: result.uri, width: result.width, height: result.height };
};

/**
 * Generates a high-quality print export.
 */
export const generatePrintExport = async (
    uri: string,
    cropRect: { x: number; y: number; width: number; height: number },
    meta?: { srcW: number; srcH: number; viewW: number; viewH: number; viewCrop: any }
) => {
    const srcW = meta?.srcW || 0;
    const srcH = meta?.srcH || 0;

    // Safety Clamp
    const safeX = Math.max(0, Math.min(cropRect.x, srcW - 1));
    const safeY = Math.max(0, Math.min(cropRect.y, srcH - 1));
    const safeW = Math.max(1, Math.min(cropRect.width, srcW - safeX));
    const safeH = Math.max(1, Math.min(cropRect.height, srcH - safeY));

    const longest = Math.max(safeW, safeH);
    const targetW = 5000;

    const result = await manipulateAsync(
        uri,
        [
            { crop: { originX: safeX, originY: safeY, width: safeW, height: safeH } },
            { resize: { width: targetW, height: targetW } } // Force square for print if possible
        ],
        { compress: 0.95, format: SaveFormat.JPEG }
    );

    return { uri: result.uri, width: result.width, height: result.height };
};
