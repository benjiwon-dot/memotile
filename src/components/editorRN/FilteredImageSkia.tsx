// src/components/editorRN/FilteredImageSkia.tsx
import React, { useMemo } from "react";
import { View, type ViewStyle } from "react-native";
import {
    Canvas,
    Image as SkiaImage,
    Rect,
    Skia,
    useImage,
    useCanvasRef,
    // ✨ [해결의 열쇠 1] 안드로이드 Skia 픽셀 깨짐을 막아주는 마법의 엔진
    FilterMode,
    MipmapMode
} from "@shopify/react-native-skia";
import { IDENTITY, type ColorMatrix as M } from "../../utils/colorMatrix";

type Props = {
    uri: string;
    width: number;
    height: number;
    matrix?: M;
    style?: ViewStyle;
    overlayColor?: string;
    overlayOpacity?: number;
};

export interface FilteredImageSkiaRef {
    snapshot: () => any;
}

const clamp01 = (v: any) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
};

const FilteredImageSkia = React.forwardRef<FilteredImageSkiaRef, Props>(
    ({ uri, width, height, matrix, style, overlayColor, overlayOpacity }, ref) => {
        const img = useImage(uri || "");
        const canvasRef = useCanvasRef();

        const W = Number(width) || 1;
        const H = Number(height) || 1;

        const safeMatrix = matrix && matrix.length === 20 ? matrix : IDENTITY;

        const imagePaint = useMemo(() => {
            const p = Skia.Paint();
            p.setAntiAlias(true);
            p.setColorFilter(Skia.ColorFilter.MakeMatrix(safeMatrix));
            return p;
        }, [safeMatrix]);

        const overlayPaint = useMemo(() => {
            const color = (overlayColor || "").trim();
            const a = clamp01(overlayOpacity);

            if (!color || a <= 0) return null;

            try {
                const p = Skia.Paint();
                p.setAntiAlias(true);
                p.setColor(Skia.Color(color));
                p.setAlphaf(a);
                return p;
            } catch {
                return null;
            }
        }, [overlayColor, overlayOpacity]);

        React.useImperativeHandle(ref, () => ({
            snapshot: () => {
                if (!img && uri) return null;

                try {
                    const surface = Skia.Surface.Make(W, H);

                    if (surface) {
                        const canvas = surface.getCanvas();

                        const imgW = img!.width();
                        const imgH = img!.height();
                        const scale = Math.max(W / imgW, H / imgH);

                        const coverW = W / scale;
                        const coverH = H / scale;

                        const srcRect = Skia.XYWHRect(
                            (imgW - coverW) / 2,
                            (imgH - coverH) / 2,
                            coverW,
                            coverH
                        );
                        const dstRect = Skia.XYWHRect(0, 0, W, H);

                        canvas.drawImageRect(img!, srcRect, dstRect, imagePaint);

                        if (overlayPaint) {
                            canvas.drawRect(dstRect, overlayPaint);
                        }

                        surface.flush();
                        return surface.makeImageSnapshot();
                    }

                    return canvasRef.current?.makeImageSnapshot() || null;
                } catch (e) {
                    console.warn("[FilteredImageSkia] Snapshot not ready yet, retrying...", e);
                    return null;
                }
            },
        }));

        return (
            <View style={[{ width: W, height: H }, style]} pointerEvents="none">
                <Canvas
                    ref={canvasRef}
                    style={{ flex: 1 }}
                >
                    {img ? (
                        <SkiaImage
                            image={img}
                            x={0}
                            y={0}
                            width={W}
                            height={H}
                            fit="cover"
                            paint={imagePaint}
                            // ✨ [해결의 열쇠 2] 강제로 "고화질 스무딩" 옵션을 먹여서 계단 현상(자글자글)을 없앱니다!
                            sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.Linear }}
                        />
                    ) : (
                        <Rect x={0} y={0} width={W} height={H} color="transparent" />
                    )}

                    {overlayPaint && (
                        <Rect x={0} y={0} width={W} height={H} paint={overlayPaint} />
                    )}
                </Canvas>
            </View>
        );
    }
);

export default FilteredImageSkia;