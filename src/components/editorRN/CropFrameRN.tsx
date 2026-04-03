// src/components/editorRN/CropFrameRN.tsx
import React, { useEffect, useMemo, forwardRef, useImperativeHandle } from "react";
import { View, StyleSheet, Text, Platform } from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withTiming,
    runOnJS,
    cancelAnimation,
    interpolateColor,
    interpolate,
    Extrapolate,
} from "react-native-reanimated";

// ✅ DropShadow Import 및 Animated 컴포넌트 생성
import DropShadow from "react-native-drop-shadow";
const AnimatedDropShadow = Animated.createAnimatedComponent(DropShadow);

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

    // ✅ 터치 상태 추적 (0 = 대기/손뗌, 1 = 터치 중/편집 중)
    const isInteracting = useSharedValue(0);

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
    const panGesture = Gesture.Pan()
        .averageTouches(true)
        .activeOffsetX([-5, 5])
        .activeOffsetY([-5, 5])
        .onStart(() => {
            cancelAnimation(tx); cancelAnimation(ty);
            isInteracting.value = withTiming(1, { duration: 150 });
        })
        .onChange((e) => {
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
        })
        .onFinalize(() => {
            isInteracting.value = withTiming(0, { duration: 250 });
        });

    // 2. 줌 (Pinch)
    const pinchGesture = Gesture.Pinch()
        .onStart(() => {
            cancelAnimation(sc); cancelAnimation(tx); cancelAnimation(ty);
            savedSc.value = sc.value;
            isInteracting.value = withTiming(1, { duration: 150 });
        })
        .onChange((e) => {
            const minScale = getMinScale(base.w, base.h, CROP_SIZE);
            const ZOOM_SPEED = 0.6;
            const dampenedScale = 1 + (e.scale - 1) * ZOOM_SPEED;
            const targetScale = savedSc.value * dampenedScale;

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
        })
        .onFinalize(() => {
            isInteracting.value = withTiming(0, { duration: 250 });
        });

    const gesture = Gesture.Simultaneous(panGesture, pinchGesture);

    const animatedImageStyle = useAnimatedStyle(() => ({
        width: base.w, height: base.h,
        transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: sc.value }]
    }));

    // ✅ 마스크(dim) 배경색 애니메이션
    const animatedMaskStyle = useAnimatedStyle(() => {
        const bgColor = interpolateColor(
            isInteracting.value,
            [0, 1],
            ["#F7F7F8", "rgba(0,0,0,0.6)"]
        );
        return { backgroundColor: bgColor };
    });

    // ✅ 2. 타일 입체감(고급스러운 soft shadow) 애니메이션
    const animatedShadowStyle = useAnimatedStyle(() => {
        // 손을 뗐을 때(0)는 soft하고 두꺼운 그림자, 눌렀을 때(1)는 얇은 그림자
        const shadowOp = interpolate(isInteracting.value, [0, 1], [0.22, 0.06], Extrapolate.CLAMP);
        const shadowRadius = interpolate(isInteracting.value, [0, 1], [18, 4], Extrapolate.CLAMP);
        const shadowHeight = interpolate(isInteracting.value, [0, 1], [10, 2], Extrapolate.CLAMP);

        return {
            shadowColor: "#000",
            shadowOpacity: shadowOp,
            shadowRadius: shadowRadius,
            shadowOffset: { width: 0, height: shadowHeight },
        };
    });

    if (!imageSrc) return null;

    return (
        <View style={styles.container}>
            <GestureDetector gesture={gesture}>
                <View style={[styles.previewWrap, { width: PREVIEW_W, height: PREVIEW_H }]}>

                    {/* ✅ 3-1. 그림자 레이어 [AnimatedDropShadow] - Z-index를 위해 이미지 뒤로 배치 */}
                    <AnimatedDropShadow
                        style={[
                            styles.tileDropShadowWrap,
                            { width: CROP_SIZE, height: CROP_SIZE, left: MARGIN_X, top: MARGIN_Y },
                            animatedShadowStyle
                        ]}
                    >
                        {/* 이 뷰가 그림자를 Cast하는 엘리먼트입니다. 하얀색 배경으로 물리적인 질감을 표현합니다. */}
                        <Animated.View style={styles.dropShadowElement} />
                    </AnimatedDropShadow>

                    {/* ✅ 3-2. 이미지 레이어 [Image, GestureDetector] */}
                    <Animated.View style={[styles.imageAnchor, animatedImageStyle]}>
                        <FilteredImageSkia uri={imageSrc} width={base.w} height={base.h} matrix={matrix}
                            overlayColor={props.overlayColor} overlayOpacity={props.overlayOpacity} />
                    </Animated.View>

                    {/* ✅ 3-3. 마스크 레이어 및 타일 윤곽선 */}
                    <View style={StyleSheet.absoluteFill} pointerEvents="none">
                        {/* 캔버스 마스크 (터치 시 반투명) */}
                        <Animated.View style={[styles.maskBase, { top: 0, left: 0, right: 0, height: MARGIN_Y }, animatedMaskStyle]} />
                        <Animated.View style={[styles.maskBase, { bottom: 0, left: 0, right: 0, height: MARGIN_Y }, animatedMaskStyle]} />
                        <Animated.View style={[styles.maskBase, { top: MARGIN_Y, bottom: MARGIN_Y, left: 0, width: MARGIN_X }, animatedMaskStyle]} />
                        <Animated.View style={[styles.maskBase, { top: MARGIN_Y, bottom: MARGIN_Y, right: 0, width: MARGIN_X }, animatedMaskStyle]} />

                        {/* ✅ 타일 테두리 (Shadow 없이 미세한 윤곽선만 표시) */}
                        <Animated.View style={[
                            styles.tileBorderFrame,
                            { width: CROP_SIZE, height: CROP_SIZE, left: MARGIN_X, top: MARGIN_Y }
                        ]} />
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
    maskBase: { position: "absolute" },

    // ✅ 타일 그림자 감싸는 Wrap 스타일
    tileDropShadowWrap: {
        position: "absolute",
    },
    // ✅ 그림자를 Cast하는 엘리먼트 (물리적인 흰색 질감 표현)
    dropShadowElement: {
        flex: 1,
        backgroundColor: 'white',
        // 안드로이드의 경우, 아주 미세한 윤곽선을 추가하여 elevation 렌더링을 보완합니다.
        borderWidth: Platform.OS === 'android' ? 0.5 : 0,
        borderColor: "rgba(0,0,0,0.025)",
    },

    // ✅ 타일 테두리 스타일 설정 (Shadow 제거, Border만 표시)
    tileBorderFrame: {
        position: "absolute",
        // 미세한 테두리만 남겨 타일의 형태를 명확히 합니다.
        borderWidth: 0.5,
        borderColor: "rgba(0,0,0,0.06)",
        backgroundColor: 'transparent',
    },

    labelArea: { marginTop: 16, height: 24, justifyContent: 'center' },
    labelText: { color: "rgba(0,0,0,0.45)", fontSize: 13, fontWeight: "700", letterSpacing: 0.5 },
});