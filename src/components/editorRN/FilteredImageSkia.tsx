// src/components/editorRN/FilteredImageSkia.tsx
import React, { useMemo } from "react";
import { Image as RNImage, View, type ViewStyle } from "react-native";
import {
    Canvas,
    Image as SkiaImage,
    Rect,
    Skia,
    useImage,
    useCanvasRef,
} from "@shopify/react-native-skia";
import { IDENTITY, type ColorMatrix as M } from "../../utils/colorMatrix";

type Props = {
    uri: string;
    width: number;
    height: number;
    matrix?: M;
    style?: ViewStyle;

    // ✅ ADD: overlay filter support (baked into snapshot)
    overlayColor?: string;      // e.g. "#FFAA00" or "rgba(0,0,0,1)"
    overlayOpacity?: number;    // 0..1 (recommended) - we'll clamp
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
        const img = useImage(uri);
        const canvasRef = useCanvasRef();

        // ✅ Hard-guard: Skia는 number만 허용
        const W = Number(width) || 0;
        const H = Number(height) || 0;

        // Safety: ensure matrix is valid 20-length array
        const safeMatrix = matrix && matrix.length === 20 ? matrix : IDENTITY;

        const imagePaint = useMemo(() => {
            const p = Skia.Paint();
            p.setAntiAlias(true);
            p.setColorFilter(Skia.ColorFilter.MakeMatrix(safeMatrix));
            return p;
        }, [safeMatrix]);

        // ✅ overlay paint (color + alpha)
        const overlayPaint = useMemo(() => {
            const color = (overlayColor || "").trim();
            const a = clamp01(overlayOpacity);

            if (!color || a <= 0) return null;

            try {
                const p = Skia.Paint();
                p.setAntiAlias(true);

                // Skia.Color accepts hex / rgba strings in most cases.
                // We set alpha via setAlphaf to ensure opacity is applied.
                p.setColor(Skia.Color(color));
                p.setAlphaf(a);

                return p;
            } catch {
                // invalid color string -> no overlay
                return null;
            }
        }, [overlayColor, overlayOpacity]);

        React.useImperativeHandle(ref, () => ({
            snapshot: () => canvasRef.current?.makeImageSnapshot(),
        }));

        return (
            <View style={[{ width: W, height: H }, style]} pointerEvents="none">
                {/* ✅ fallback: 로딩 중에는 RNImage를 보여줌 */}
                {!img && (
                    <RNImage
                        source={{ uri }}
                        style={{ width: "100%", height: "100%" }}
                        resizeMode="cover"
                    />
                )}

                {/* ✅ Canvas는 항상 존재해야 snapshot이 안정적 */}
                <Canvas
                    ref={canvasRef}
                    style={[
                        { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 },
                        { opacity: img ? 1 : 0 },
                    ]}
                >
                    {img && W > 0 && H > 0 && (
                        <>
                            {/* base image + matrix */}
                            <SkiaImage
                                image={img}
                                x={0}
                                y={0}
                                width={W}
                                height={H}
                                fit="cover"
                                paint={imagePaint}
                            />

                            {/* ✅ overlay layer baked into snapshot */}
                            {overlayPaint && (
                                <Rect x={0} y={0} width={W} height={H} paint={overlayPaint} />
                            )}
                        </>
                    )}
                </Canvas>
            </View>
        );
    }
);

export default FilteredImageSkia;
