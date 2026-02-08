// src/utils/cropMath.ts
import { clamp } from "./clamp";

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Transform = { scale: number; translateX: number; translateY: number };

/**
 * Normalization: Base scale is already "cover".
 * So minScale is strictly 1.
 */
export const getMinScale = (baseW: number, baseH: number, cropSize: number) => {
    "worklet";
    if (baseW === 0 || baseH === 0) return 1;
    const s = Math.max(cropSize / baseW, cropSize / baseH);
    return Math.max(s, 1);
};

export const getMaxTranslate = (baseW: number, baseH: number, cropSize: number, scale: number) => {
    "worklet";
    const renderedW = baseW * scale;
    const renderedH = baseH * scale;

    const maxX = Math.max(0, (renderedW - cropSize) / 2);
    const maxY = Math.max(0, (renderedH - cropSize) / 2);

    return { maxX, maxY };
};

export const clampTransform = (
    tx: number,
    ty: number,
    scale: number,
    baseW: number,
    baseH: number,
    cropSize: number,
    maxScale: number
) => {
    "worklet";

    if (baseW <= 0 || baseH <= 0) return { tx, ty, scale: 1 };

    const minScale = getMinScale(baseW, baseH, cropSize);
    const nextScale = clamp(scale, minScale, maxScale);

    const { maxX, maxY } = getMaxTranslate(baseW, baseH, cropSize, nextScale);

    const nextTx = clamp(tx, -maxX, maxX);
    const nextTy = clamp(ty, -maxY, maxY);

    return { tx: nextTx, ty: nextTy, scale: nextScale };
};

/**
 * UI base cover size (scale=1) matching CropFrameRN:
 * coverScale = max(cropSquare / originalW, cropSquare / originalH)
 * baseW = originalW * coverScale, baseH = originalH * coverScale
 */
export const computeBaseCoverSize = (originalW: number, originalH: number, cropSquare: number) => {
    if (originalW <= 0 || originalH <= 0 || cropSquare <= 0) {
        return { baseW: cropSquare || 1, baseH: cropSquare || 1 };
    }
    const cover = Math.max(cropSquare / originalW, cropSquare / originalH);
    return { baseW: originalW * cover, baseH: originalH * cover };
};

/**
 * Maps UI transform back to original image pixels for export.
 * - Uses actual frameRect.x/y/width/height (no centered assumption)
 * - Uses UI-consistent cover model
 * - Hard clamps to ALWAYS return a valid crop inside image bounds
 */
export const mapToOriginalCropRect = (params: {
    originalW: number;
    originalH: number;
    containerW: number;
    containerH: number;
    frameRect: Rect;
    transform: { scale: number; translateX: number; translateY: number };
}) => {
    const { originalW, originalH, containerW, containerH, frameRect, transform } = params;

    if (originalW <= 1 || originalH <= 1 || containerW <= 1 || containerH <= 1) {
        return { x: 0, y: 0, width: 1, height: 1 };
    }

    const fw = Math.max(1, Math.round(frameRect.width));
    const fh = Math.max(1, Math.round(frameRect.height));
    const fx = Number.isFinite(frameRect.x) ? frameRect.x : 0;
    const fy = Number.isFinite(frameRect.y) ? frameRect.y : 0;

    // square crop
    const cropSize = Math.max(1, Math.round(Math.min(fw, fh)));

    const { baseW, baseH } = computeBaseCoverSize(originalW, originalH, cropSize);

    const sc = Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : 1;
    const tx = Number.isFinite(transform.translateX) ? transform.translateX : 0;
    const ty = Number.isFinite(transform.translateY) ? transform.translateY : 0;

    // Image center in container coords
    const imgCenterX = containerW / 2 + tx;
    const imgCenterY = containerH / 2 + ty;

    // Inverse mapping: local = (screen - center - t) / s
    const untransform = (screenX: number, screenY: number) => {
        const dx = screenX - imgCenterX;
        const dy = screenY - imgCenterY;

        const ux = dx / sc;
        const uy = dy / sc;

        const localX = ux + baseW / 2;
        const localY = uy + baseH / 2;

        return {
            nx: localX / baseW,
            ny: localY / baseH,
        };
    };

    const tl = untransform(fx, fy);
    const br = untransform(fx + cropSize, fy + cropSize);

    // normalized -> original px (can go outside, clamp later)
    let sx = Math.floor(Math.min(tl.nx, br.nx) * originalW);
    let sy = Math.floor(Math.min(tl.ny, br.ny) * originalH);
    let ex = Math.ceil(Math.max(tl.nx, br.nx) * originalW);
    let ey = Math.ceil(Math.max(tl.ny, br.ny) * originalH);

    // hard clamp endpoints
    sx = Math.max(0, Math.min(sx, originalW - 1));
    sy = Math.max(0, Math.min(sy, originalH - 1));
    ex = Math.max(1, Math.min(ex, originalW));
    ey = Math.max(1, Math.min(ey, originalH));

    let sw = Math.max(1, ex - sx);
    let sh = Math.max(1, ey - sy);

    // enforce square by taking max and re-centering
    let size = Math.max(sw, sh);
    size = Math.min(size, originalW, originalH);

    const cx = sx + sw / 2;
    const cy = sy + sh / 2;

    let nx = Math.round(cx - size / 2);
    let ny = Math.round(cy - size / 2);

    // final clamp so always inside
    nx = Math.max(0, Math.min(nx, originalW - size));
    ny = Math.max(0, Math.min(ny, originalH - size));

    // FINAL SAFETY: shrink-by-1 if edge-case rounding still trips manipulator
    // (manipulator is extremely strict)
    if (nx + size > originalW) size = Math.max(1, originalW - nx);
    if (ny + size > originalH) size = Math.max(1, originalH - ny);

    // still square – ensure within min dimension
    size = Math.min(size, originalW - nx, originalH - ny);
    size = Math.max(1, Math.floor(size));

    return { x: nx, y: ny, width: size, height: size };
};

export const calculatePrecisionCrop = (params: {
    sourceSize: Size;
    containerSize: Size;
    frameRect: Rect;
    transform: Transform;
}) => {
    const rect = mapToOriginalCropRect({
        originalW: params.sourceSize.width,
        originalH: params.sourceSize.height,
        containerW: params.containerSize.width,
        containerH: params.containerSize.height,
        frameRect: params.frameRect,
        transform: params.transform,
    });

    const isValid =
        Number.isFinite(rect.x) &&
        Number.isFinite(rect.y) &&
        Number.isFinite(rect.width) &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.width <= params.sourceSize.width &&
        rect.y + rect.height <= params.sourceSize.height;

    return { ...rect, isValid };
};

export const defaultCenterCrop = () => {
    return { x: 0, y: 0, scale: 1 };
};
