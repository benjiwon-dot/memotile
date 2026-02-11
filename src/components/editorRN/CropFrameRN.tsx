// src/components/editorRN/CropFrameRN.tsx
import React, { useEffect, useMemo, forwardRef, useImperativeHandle } from "react";
import { View, StyleSheet, Text } from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    runOnJS,
    cancelAnimation,
} from "react-native-reanimated";

import FilteredImageSkia from "./FilteredImageSkia";
import { ColorMatrix } from "../../utils/colorMatrix";
import { useLanguage } from "../../context/LanguageContext";
import { clampTransform } from "../../utils/cropMath";

export type Crop = { x: number; y: number; scale: number };

interface Props {
    imageSrc: string;
    imageWidth: number;
    imageHeight: number;
    containerWidth: number;
    containerHeight: number;
    crop: Crop;
    onChange: (crop: Crop) => void;
    matrix: ColorMatrix;
    photoIndex: number;
    overlayColor?: string;
    overlayOpacity?: number;
}

const CropFrameRN = forwardRef((props: Props, ref) => {
    const {
        imageSrc,
        imageWidth,
        imageHeight,
        containerWidth,
        containerHeight,
        crop,
        onChange,
        matrix,
    } = props;

    const { t } = useLanguage();

    const PREVIEW_W = containerWidth;
    const PREVIEW_H = containerHeight;

    const CROP_SIZE = Math.min(PREVIEW_W, PREVIEW_H) * 0.75;
    const MARGIN_X = (PREVIEW_W - CROP_SIZE) / 2;
    const MARGIN_Y = (PREVIEW_H - CROP_SIZE) / 2;

    // cover base size (scale=1일 때 cropSize를 커버)
    const base = useMemo(() => {
        if (!imageWidth || !imageHeight) return { w: 0, h: 0 };
        const cover = Math.max(CROP_SIZE / imageWidth, CROP_SIZE / imageHeight);
        return { w: imageWidth * cover, h: imageHeight * cover };
    }, [imageWidth, imageHeight, CROP_SIZE]);

    const tx = useSharedValue(crop?.x ?? 0);
    const ty = useSharedValue(crop?.y ?? 0);
    const sc = useSharedValue(crop?.scale ?? 1);

    // gesture 시작값(스냅샷)
    const savedTx = useSharedValue(0);
    const savedTy = useSharedValue(0);
    const savedSc = useSharedValue(1);

    // 상태
    const isPinching = useSharedValue(false);

    useImperativeHandle(ref, () => ({
        getLatestCrop: () => ({ x: tx.value, y: ty.value, scale: sc.value }),
        getFrameRect: () => ({ x: MARGIN_X, y: MARGIN_Y, width: CROP_SIZE, height: CROP_SIZE }),
    }));

    // props sync
    useEffect(() => {
        tx.value = crop.x;
        ty.value = crop.y;
        sc.value = crop.scale;

        savedTx.value = crop.x;
        savedTy.value = crop.y;
        savedSc.value = crop.scale;
    }, [crop]);

    const clampNow = (nx: number, ny: number, ns: number) => {
        "worklet";
        if (base.w <= 0 || base.h <= 0) return { tx: 0, ty: 0, scale: 1 };
        return clampTransform(nx, ny, ns, base.w, base.h, CROP_SIZE, 5.0);
    };

    // base 변경 시 clamp
    useEffect(() => {
        if (base.w <= 0 || base.h <= 0) return;
        const t0 = clampTransform(tx.value, ty.value, sc.value, base.w, base.h, CROP_SIZE, 5.0);
        tx.value = t0.tx;
        ty.value = t0.ty;
        sc.value = t0.scale;
    }, [base.w, base.h, CROP_SIZE]);

    // ✅ Gesture sensitivity (tune here only)
    const PAN_DAMP = 0.6;        // 평소 드래그 감도 (0.45~0.7)
    const PINCH_DAMP = 0.6;     // 줌 감도 (0.18~0.35)
    const PINCH_PAN_DAMP = 0.6;  // 줌 중 드래그 감도 (PAN_DAMP랑 동일 추천)

    // ✅ Pan (드래그 속도만 완만)
    const panGesture = Gesture.Pan()
        .onBegin(() => {
            if (isPinching.value) return;

            cancelAnimation(tx);
            cancelAnimation(ty);

            savedTx.value = tx.value;
            savedTy.value = ty.value;
        })
        .onUpdate((e) => {
            if (isPinching.value) return;


            const nx = savedTx.value + e.translationX * PAN_DAMP;
            const ny = savedTy.value + e.translationY * PAN_DAMP;

            const t0 = clampNow(nx, ny, sc.value);
            tx.value = t0.tx;
            ty.value = t0.ty;
            sc.value = t0.scale;
        })
        .onEnd(() => {
            runOnJS(onChange)({ x: tx.value, y: ty.value, scale: sc.value });
        });

    // ✅ Pinch (줌 속도 완만 + focal 안정: savedSc 기반)
    const pinchGesture = Gesture.Pinch()
        .onBegin(() => {
            isPinching.value = true;

            cancelAnimation(sc);
            cancelAnimation(tx);
            cancelAnimation(ty);

            savedSc.value = sc.value;
            savedTx.value = tx.value;
            savedTy.value = ty.value;
        })
        .onUpdate((e) => {
            // 🔥 줌 속도 완만
            const delta = (e.scale - 1) * PINCH_DAMP;
            const nextScale = Math.max(1, savedSc.value + delta);

            const fx = e.focalX - PREVIEW_W / 2;
            const fy = e.focalY - PREVIEW_H / 2;

            // ✅ ratio는 반드시 "제스처 시작 스케일(savedSc)" 기준
            const prevScale = savedSc.value > 0 ? savedSc.value : 1;
            const ratio = nextScale / prevScale;

            const nx = savedTx.value * ratio + fx * (1 - ratio) * PINCH_PAN_DAMP;
            const ny = savedTy.value * ratio + fy * (1 - ratio) * PINCH_PAN_DAMP;

            const t0 = clampNow(nx, ny, nextScale);
            sc.value = t0.scale;
            tx.value = t0.tx;
            ty.value = t0.ty;
        })
        .onEnd(() => {
            const t0 = clampNow(tx.value, ty.value, sc.value);

            sc.value = withTiming(t0.scale);
            tx.value = withTiming(t0.tx);
            ty.value = withTiming(t0.ty);

            runOnJS(onChange)({ x: t0.tx, y: t0.ty, scale: t0.scale });
            isPinching.value = false;
        });

    // ✅ Race 유지(지금 UX 기반) — 충돌 최소
    const gesture = Gesture.Race(panGesture, pinchGesture);

    const animatedImageStyle = useAnimatedStyle(() => {
        const w = base.w;
        const h = base.h;
        const s = sc.value <= 0 ? 1 : sc.value;

        return {
            width: w,
            height: h,
            transform: [
                { translateX: -w / 2 },
                { translateY: -h / 2 },
                { scale: s },
                { translateX: tx.value / s },
                { translateY: ty.value / s },
            ],
        };
    });

    if (!imageSrc) return null;

    return (
        <View style={[styles.container, { width: PREVIEW_W }]}>
            <GestureDetector gesture={gesture}>
                <View style={[styles.previewWrap, { width: PREVIEW_W, height: PREVIEW_H }]}>
                    <Animated.View
                        style={[
                            styles.centerAnchor,
                            { left: PREVIEW_W / 2, top: PREVIEW_H / 2 },
                            animatedImageStyle,
                        ]}
                    >
                        <FilteredImageSkia
                            uri={imageSrc}
                            width={base.w}
                            height={base.h}
                            matrix={matrix}
                            overlayColor={props.overlayColor}
                            overlayOpacity={props.overlayOpacity}
                            style={StyleSheet.absoluteFillObject as any}
                        />
                    </Animated.View>

                    <View style={[styles.overlayTop, { height: MARGIN_Y }]} pointerEvents="none" />
                    <View style={[styles.overlayBottom, { height: MARGIN_Y }]} pointerEvents="none" />
                    <View
                        style={[styles.overlayLeft, { top: MARGIN_Y, bottom: MARGIN_Y, width: MARGIN_X }]}
                        pointerEvents="none"
                    />
                    <View
                        style={[styles.overlayRight, { top: MARGIN_Y, bottom: MARGIN_Y, width: MARGIN_X }]}
                        pointerEvents="none"
                    />

                    <View
                        style={[
                            styles.cropWindow,
                            { width: CROP_SIZE, height: CROP_SIZE, left: MARGIN_X, top: MARGIN_Y },
                        ]}
                        pointerEvents="none"
                    />
                </View>
            </GestureDetector>

            <View style={styles.labelContainer} pointerEvents="none">
                <Text style={styles.label}>{t["printArea"] || "Print area (20×20cm)"}</Text>
            </View>
        </View>
    );
});

export default CropFrameRN;

const styles = StyleSheet.create({
    container: { backgroundColor: "#F7F7F8", alignItems: "center", justifyContent: "center" },
    previewWrap: { overflow: "hidden" },

    centerAnchor: { position: "absolute" },
    baseImage: { width: "100%", height: "100%" },

    cropWindow: {
        position: "absolute",
        borderWidth: 2,
        borderColor: "rgba(0,0,0,0.75)",
        borderRadius: 2,
        zIndex: 10,
    },

    overlayTop: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        backgroundColor: "#BEBEBE",
        opacity: 0.3,
        zIndex: 5,
    },
    overlayBottom: {
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: "#BEBEBE",
        opacity: 0.3,
        zIndex: 5,
    },
    overlayLeft: {
        position: "absolute",
        left: 0,
        backgroundColor: "#BEBEBE",
        opacity: 0.3,
        zIndex: 5,
    },
    overlayRight: {
        position: "absolute",
        right: 0,
        backgroundColor: "#BEBEBE",
        opacity: 0.3,
        zIndex: 5,
    },

    labelContainer: { marginTop: 12, height: 20, justifyContent: "center", alignItems: "center" },
    label: { color: "rgba(0,0,0,0.35)", fontSize: 13, fontWeight: "500", textAlign: "center" },
});
