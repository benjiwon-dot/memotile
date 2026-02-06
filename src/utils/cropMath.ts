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
    // Explicitly log as requested, but "worklet" might limit console usage.
    // We will log in the caller (React component).
    return Math.max(s, 1);
};

/**
 * Get max allowed translation based on normalized base dimensions.
 * baseW/baseH here are the dimensions of the image when scale=1 (fully covering CROP_SIZE).
 */
export const getMaxTranslate = (
    baseW: number,
    baseH: number,
    cropSize: number,
    scale: number
) => {
    "worklet";
    const renderedW = baseW * scale;
    const renderedH = baseH * scale;

    const maxX = Math.max(0, (renderedW - cropSize) / 2);
    const maxY = Math.max(0, (renderedH - cropSize) / 2);

    return { maxX, maxY };
};

/**
 * Unified clamp using baseW/baseH (already at cover scale).
 */
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
 * Maps UI transform back to original image pixels for export.
 * NOTE: This must account for the "cover" base scale.
 */
export const mapToOriginalCropRect = (params: {
    originalW: number;
    originalH: number;
    containerW: number;
    containerH: number;
    cropSize: number;
    transform: { scale: number; translateX: number; translateY: number };
}) => {
    const { originalW, originalH, containerW, containerH, cropSize, transform } = params;
    const { scale, translateX: tx, translateY: ty } = transform;

    // The UI now uses a "cover" base scale relative to CROP_SIZE
    const coverScale = Math.max(cropSize / originalW, cropSize / originalH);
    const rw = originalW * coverScale;
    const rh = originalH * coverScale;

    // Centered alignment offset
    const imgCenterX = containerW / 2 + tx;
    const imgCenterY = containerH / 2 + ty;

    const fx = (containerW - cropSize) / 2;
    const fy = (containerH - cropSize) / 2;

    const untransform = (screenX: number, screenY: number) => {
        const dx = screenX - imgCenterX;
        const dy = screenY - imgCenterY;
        const ux = dx / scale;
        const uy = dy / scale;
        const localX = ux + rw / 2;
        const localY = uy + rh / 2;
        return {
            nx: localX / rw,
            ny: localY / rh
        };
    };

    const tl = untransform(fx, fy);
    const br = untransform(fx + cropSize, fy + cropSize);

    let sx = Math.floor(tl.nx * originalW);
    let sy = Math.floor(tl.ny * originalH);
    let ex = Math.ceil(br.nx * originalW);
    let ey = Math.ceil(br.ny * originalH);

    sx = Math.max(0, Math.min(sx, originalW - 1));
    sy = Math.max(0, Math.min(sy, originalH - 1));
    let sw = ex - sx;
    let sh = ey - sy;
    const finalSize = Math.max(sw, sh);

    if (sx + finalSize > originalW) sx = originalW - finalSize;
    if (sy + finalSize > originalH) sy = originalH - finalSize;

    return {
        x: Math.max(0, sx),
        y: Math.max(0, sy),
        width: Math.min(finalSize, originalW),
        height: Math.min(finalSize, originalH)
    };
};

export const calculatePrecisionCrop = (params: {
    sourceSize: Size;
    containerSize: Size;
    frameRect: Rect;
    transform: Transform;
}) => {
    return {
        ...mapToOriginalCropRect({
            originalW: params.sourceSize.width,
            originalH: params.sourceSize.height,
            containerW: params.containerSize.width,
            containerH: params.containerSize.height,
            cropSize: params.frameRect.width,
            transform: params.transform
        }),
        isValid: true
    };
};

// Legacy/helper for EditorScreen initial state
export const defaultCenterCrop = () => {
    return { x: 0, y: 0, scale: 1 };
};
