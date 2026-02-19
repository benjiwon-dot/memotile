// src/utils/cropMath.ts
import { clamp } from "./clamp";

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Transform = { scale: number; translateX: number; translateY: number };

// ✅ 안전한 숫자 변환 (NaN 방지)
const safe = (v: number, def: number = 0) => {
    "worklet";
    return Number.isFinite(v) ? v : def;
};

// ✅ iOS 스타일 탄성 효과 (Rubber Banding)
export const rubberBand = (val: number, min: number, max: number, dim: number) => {
    "worklet";
    if (val >= min && val <= max) return val;

    const c = 0.55; // 저항 계수
    if (val < min) {
        const dist = min - val;
        return min - (dist * c);
    }
    if (val > max) {
        const dist = val - max;
        return max + (dist * c);
    }
    return val;
};

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

// ✅ 저장 시 좌표 강제 고정용 (안전장치 추가)
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

    if (baseW <= 0 || baseH <= 0) return { tx: 0, ty: 0, scale: 1 };

    const minScale = getMinScale(baseW, baseH, cropSize);
    // scale이 NaN이면 minScale로 복구
    const nextScale = clamp(safe(scale, minScale), minScale, maxScale);

    const { maxX, maxY } = getMaxTranslate(baseW, baseH, cropSize, nextScale);

    // tx, ty가 NaN이면 0으로 복구
    const nextTx = clamp(safe(tx, 0), -maxX, maxX);
    const nextTy = clamp(safe(ty, 0), -maxY, maxY);

    return { tx: nextTx, ty: nextTy, scale: nextScale };
};

// ✅ 기존 유지 (Checkout 계산용)
export const mapToOriginalCropRect = (params: {
    originalW: number;
    originalH: number;
    containerW: number;
    containerH: number;
    frameRect: Rect;
    transform: { scale: number; translateX: number; translateY: number };
}) => {
    const { originalW, originalH, containerW, containerH, frameRect, transform } = params;

    if (originalW <= 1 || originalH <= 1) return { x: 0, y: 0, width: 1, height: 1 };

    const baseScale = Math.max(frameRect.width / originalW, frameRect.height / originalH);
    const currentScale = transform.scale * baseScale;

    const renderedW = originalW * currentScale;
    const renderedH = originalH * currentScale;

    const imageLeft = (containerW - renderedW) / 2 + transform.translateX;
    const imageTop = (containerH - renderedH) / 2 + transform.translateY;

    const cropX_on_Rendered = frameRect.x - imageLeft;
    const cropY_on_Rendered = frameRect.y - imageTop;

    let sx = cropX_on_Rendered / currentScale;
    let sy = cropY_on_Rendered / currentScale;
    let sSize = frameRect.width / currentScale;

    sx = Math.floor(sx);
    sy = Math.floor(sy);
    sSize = Math.floor(sSize);

    sx = Math.max(0, Math.min(sx, originalW - 1));
    sy = Math.max(0, Math.min(sy, originalH - 1));

    sSize = Math.min(sSize, originalW - sx, originalH - sy);
    sSize = Math.max(1, sSize);

    return { x: sx, y: sy, width: sSize, height: sSize };
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
        rect.height > 0;

    return { ...rect, isValid };
};

export const defaultCenterCrop = () => {
    return { x: 0, y: 0, scale: 1 };
};