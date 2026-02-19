import React, { useEffect, useMemo, forwardRef, useImperativeHandle } from "react";
import { View, StyleSheet, Text } from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    runOnJS,
    cancelAnimation,
} from "react-native-reanimated";

import FilteredImageSkia from "./FilteredImageSkia";
import { ColorMatrix } from "../../utils/colorMatrix";
import { useLanguage } from "../../context/LanguageContext";
import { clampTransform, getMaxTranslate, rubberBand, getMinScale } from "../../utils/cropMath";

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

    const base = useMemo(() => {
        if (!imageWidth || !imageHeight) return { w: 0, h: 0 };
        const cover = Math.max(CROP_SIZE / imageWidth, CROP_SIZE / imageHeight);
        return { w: imageWidth * cover, h: imageHeight * cover };
    }, [imageWidth, imageHeight, CROP_SIZE]);

    const tx = useSharedValue(crop?.x ?? 0);
    const ty = useSharedValue(crop?.y ?? 0);
    const sc = useSharedValue(crop?.scale ?? 1);

    const savedTx = useSharedValue(0);
    const savedTy = useSharedValue(0);
    const savedSc = useSharedValue(1);

    useImperativeHandle(ref, () => ({
        getLatestCrop: () => {
            const valid = clampTransform(tx.value, ty.value, sc.value, base.w, base.h, CROP_SIZE, 5.0);
            return { x: valid.tx, y: valid.ty, scale: valid.scale };
        },
        getFrameRect: () => ({ x: MARGIN_X, y: MARGIN_Y, width: CROP_SIZE, height: CROP_SIZE }),
    }));

    useEffect(() => {
        tx.value = crop.x;
        ty.value = crop.y;
        sc.value = crop.scale;
    }, [crop]);

    const SPRING_CONFIG = {
        mass: 0.5,
        damping: 15,
        stiffness: 120,
        overshootClamping: false,
    };

    // 1. 드래그 (Pan)
    // ✅ activeOffsetX를 작게 설정하여 손가락이 조금만 움직여도 즉시 드래그로 인식하게 함 (핵심)
    const panGesture = Gesture.Pan()
        .averageTouches(true) // 2손가락일 때 중심점 이동 처리
        .activeOffsetX([-5, 5])
        .activeOffsetY([-5, 5])
        .onStart(() => {
            cancelAnimation(tx); cancelAnimation(ty);
        })
        .onChange((e) => {
            // Pan은 오직 "이동(Translation)"만 담당합니다.
            // 줌 중에도 손가락이 움직이면 changeX/Y가 발생하여 자연스럽게 위치가 이동됩니다.
            const nextX = tx.value + e.changeX;
            const nextY = ty.value + e.changeY;

            const { maxX, maxY } = getMaxTranslate(base.w, base.h, CROP_SIZE, sc.value);

            if (Number.isFinite(nextX) && Number.isFinite(nextY)) {
                tx.value = rubberBand(nextX, -maxX, maxX, PREVIEW_W);
                ty.value = rubberBand(nextY, -maxY, maxY, PREVIEW_H);
            }
        })
        .onEnd(() => {
            const t0 = clampTransform(tx.value, ty.value, sc.value, base.w, base.h, CROP_SIZE, 5.0);
            tx.value = withSpring(t0.tx, SPRING_CONFIG);
            ty.value = withSpring(t0.ty, SPRING_CONFIG);
            runOnJS(onChange)({ x: t0.tx, y: t0.ty, scale: t0.scale });
        });

    // 2. 줌 (Pinch)
    // 2. 줌 (Pinch)
    const pinchGesture = Gesture.Pinch()
        .onStart(() => {
            cancelAnimation(sc); cancelAnimation(tx); cancelAnimation(ty);
            savedSc.value = sc.value;
        })
        .onChange((e) => {
            const minScale = getMinScale(base.w, base.h, CROP_SIZE);

            // 🔥 [수정 포인트] 줌 속도 조절
            // e.scale은 1부터 시작합니다. (e.scale - 1)은 변화량입니다.
            // 여기에 0.6을 곱하면 속도가 60%로 줄어듭니다.
            // 더 느리게 하려면 0.4, 조금 더 빠르게 하려면 0.8로 변경하세요.
            const ZOOM_SPEED = 0.6;
            const dampenedScale = 1 + (e.scale - 1) * ZOOM_SPEED;
            const targetScale = savedSc.value * dampenedScale;

            // 기존 코드: const targetScale = savedSc.value * e.scale; (이건 100% 속도)

            const elasticScale = rubberBand(targetScale, minScale, 5.0, PREVIEW_W);

            if (sc.value < 0.01 || elasticScale < 0.01) return;

            const scaleRatio = elasticScale / sc.value;

            const fx = e.focalX - PREVIEW_W / 2;
            const fy = e.focalY - PREVIEW_H / 2;

            const adjustX = (fx - tx.value) * (1 - scaleRatio);
            const adjustY = (fy - ty.value) * (1 - scaleRatio);

            const { maxX, maxY } = getMaxTranslate(base.w, base.h, CROP_SIZE, elasticScale);

            if (Number.isFinite(elasticScale)) {
                sc.value = elasticScale;
                tx.value = rubberBand(tx.value + adjustX, -maxX, maxX, PREVIEW_W);
                ty.value = rubberBand(ty.value + adjustY, -maxY, maxY, PREVIEW_H);
            }
        })
        .onEnd(() => {
            const t0 = clampTransform(tx.value, ty.value, sc.value, base.w, base.h, CROP_SIZE, 5.0);

            sc.value = withSpring(t0.scale, SPRING_CONFIG);
            tx.value = withSpring(t0.tx, SPRING_CONFIG);
            ty.value = withSpring(t0.ty, SPRING_CONFIG);

            savedSc.value = t0.scale;
            runOnJS(onChange)({ x: t0.tx, y: t0.ty, scale: t0.scale });
        });
    // Pan과 Pinch가 동시에 실행되도록 설정
    const gesture = Gesture.Simultaneous(panGesture, pinchGesture);

    const animatedImageStyle = useAnimatedStyle(() => ({
        width: base.w, height: base.h,
        transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: sc.value }]
    }));

    if (!imageSrc) return null;

    return (
        <View style={styles.container}>
            <GestureDetector gesture={gesture}>
                <View style={[styles.previewWrap, { width: PREVIEW_W, height: PREVIEW_H }]}>
                    <Animated.View style={[styles.imageAnchor, animatedImageStyle]}>
                        <FilteredImageSkia uri={imageSrc} width={base.w} height={base.h} matrix={matrix}
                            overlayColor={props.overlayColor} overlayOpacity={props.overlayOpacity} />
                    </Animated.View>

                    <View style={StyleSheet.absoluteFill} pointerEvents="none">
                        <View style={[styles.dim, { top: 0, left: 0, right: 0, height: MARGIN_Y }]} />
                        <View style={[styles.dim, { bottom: 0, left: 0, right: 0, height: MARGIN_Y }]} />
                        <View style={[styles.dim, { top: MARGIN_Y, bottom: MARGIN_Y, left: 0, width: MARGIN_X }]} />
                        <View style={[styles.dim, { top: MARGIN_Y, bottom: MARGIN_Y, right: 0, width: MARGIN_X }]} />
                        <View style={[styles.embossedFrame, { width: CROP_SIZE, height: CROP_SIZE, left: MARGIN_X, top: MARGIN_Y }]} />
                    </View>
                </View>
            </GestureDetector>
            <View style={styles.labelArea} pointerEvents="none">
                <Text style={styles.labelText}>{t["printArea"] || "Print area (20×20cm)"}</Text>
            </View>
        </View>
    );
});

export default CropFrameRN;

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#F7F7F8", alignItems: "center", justifyContent: "center" },
    previewWrap: { overflow: "hidden", justifyContent: 'center', alignItems: 'center' },
    imageAnchor: { position: "absolute" },
    dim: { position: "absolute", backgroundColor: "rgba(0,0,0,0.5)" },
    embossedFrame: {
        position: "absolute", borderWidth: 1.5, borderColor: "#FFFFFF", borderRadius: 0,
        shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 15, elevation: 12,
    },
    labelArea: { marginTop: 16, height: 24, justifyContent: 'center' },
    labelText: { color: "rgba(0,0,0,0.45)", fontSize: 13, fontWeight: "700", letterSpacing: 0.5 },
});