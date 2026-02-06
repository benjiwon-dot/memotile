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

    // cover base size (scale=1일 때 cropSize를 "커버"하도록)
    const base = useMemo(() => {
        if (!imageWidth || !imageHeight) return { w: 0, h: 0 };
        const cover = Math.max(CROP_SIZE / imageWidth, CROP_SIZE / imageHeight);
        return { w: imageWidth * cover, h: imageHeight * cover };
    }, [imageWidth, imageHeight, CROP_SIZE]);

    /**
     * ✅ 좌표계 통일:
     * - tx/ty: "screen space(px)" 이동량 (줌에 상관없이 손가락 이동=화면 이동)
     * - sc: scale
     */
    const tx = useSharedValue(crop?.x ?? 0);
    const ty = useSharedValue(crop?.y ?? 0);
    const sc = useSharedValue(crop?.scale ?? 1);

    const savedTx = useSharedValue(0);
    const savedTy = useSharedValue(0);
    const savedSc = useSharedValue(1);

    useImperativeHandle(ref, () => ({
        getLatestCrop: () => ({ x: tx.value, y: ty.value, scale: sc.value }),
        getFrameRect: () => ({ x: MARGIN_X, y: MARGIN_Y, width: CROP_SIZE, height: CROP_SIZE }),
    }));

    // props sync (crop 변경 시 shared + saved 모두 동기화해서 "튕김" 방지)
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
        return clampTransform(nx, ny, ns, base.w, base.h, CROP_SIZE, 5.0);
    };

    // ✅ base(w/h) 변동(이미지 로드/리사이즈) 시 현재 값을 clamp 해서 밖으로 새거나 점프하는 것 방지
    useEffect(() => {
        if (base.w <= 0 || base.h <= 0) return;
        const t = clampTransform(tx.value, ty.value, sc.value, base.w, base.h, CROP_SIZE, 5.0);
        tx.value = t.tx;
        ty.value = t.ty;
        sc.value = t.scale;
    }, [base.w, base.h, CROP_SIZE]);

    // ✅ Pan: screen space 1:1 (줌 상태에서도 동일 속도)
    const panGesture = Gesture.Pan()
        // 아주 작은 움직임은 탭으로 남기기 (필터/버튼 터치 체감 개선)
        .activeOffsetX([-6, 6])
        .activeOffsetY([-6, 6])
        .onBegin(() => {
            cancelAnimation(tx);
            cancelAnimation(ty);
            cancelAnimation(sc);
            savedTx.value = tx.value;
            savedTy.value = ty.value;
            savedSc.value = sc.value;
        })
        .onUpdate((e) => {
            const nx = savedTx.value + e.translationX; // ✅ /scale 제거
            const ny = savedTy.value + e.translationY; // ✅ /scale 제거
            const t = clampNow(nx, ny, sc.value);
            tx.value = t.tx;
            ty.value = t.ty;
            sc.value = t.scale;
        })
        .onEnd(() => {
            const t = clampNow(tx.value, ty.value, sc.value);
            tx.value = withTiming(t.tx);
            ty.value = withTiming(t.ty);
            sc.value = withTiming(t.scale);
            runOnJS(onChange)({ x: t.tx, y: t.ty, scale: t.scale });
        });

    // ✅ Pinch: focal(손가락 중심) 유지 (screen space 버전)
    const pinchGesture = Gesture.Pinch()
        .onBegin(() => {
            cancelAnimation(sc);
            cancelAnimation(tx);
            cancelAnimation(ty);
            savedSc.value = sc.value;
            savedTx.value = tx.value;
            savedTy.value = ty.value;
        })
        .onUpdate((e) => {
            // damp(조금 부드럽게)
            const nextScale = savedSc.value * (1 + (e.scale - 1) * 0.9);

            // focal을 "컨테이너 센터" 기준으로 변환 (screen px)
            const fx = e.focalX - PREVIEW_W / 2;
            const fy = e.focalY - PREVIEW_H / 2;

            // ✅ screen space focal 유지:
            // nx = savedTx + fx - fx*(nextScale/savedSc)
            const nx = savedTx.value + fx - fx * (nextScale / savedSc.value);
            const ny = savedTy.value + fy - fy * (nextScale / savedSc.value);

            const t = clampNow(nx, ny, nextScale);
            sc.value = t.scale;
            tx.value = t.tx;
            ty.value = t.ty;
        })
        .onEnd(() => {
            const t = clampNow(tx.value, ty.value, sc.value);
            sc.value = withTiming(t.scale);
            tx.value = withTiming(t.tx);
            ty.value = withTiming(t.ty);
            runOnJS(onChange)({ x: t.tx, y: t.ty, scale: t.scale });
        });

    // Simultaneous로 자연스럽게
    const gesture = Gesture.Simultaneous(panGesture, pinchGesture);

    /**
     * ✅ 렌더 transform 핵심:
     * - scale 이후 translate를 넣으면 translate가 scale 영향 받음
     * - 그래서 translate를 tx/sc로 넣어서 "화면에서 tx만큼" 움직이도록 상쇄
     */
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

                // ✅ scale 영향 상쇄 → 드래그 속도/클램프/내보내기 좌표 일치
                { translateX: tx.value / s },
                { translateY: ty.value / s },
            ],
        };
    });

    if (!imageSrc) return null;

    return (
        <GestureDetector gesture={gesture}>
            <View style={[styles.container, { width: PREVIEW_W, height: PREVIEW_H }]}>
                <View style={[styles.previewWrap, { width: PREVIEW_W, height: PREVIEW_H }]}>
                    {/* ✅ 전체 사진 레이어 (중앙 정렬) */}
                    <Animated.View
                        style={[
                            styles.centerAnchor,
                            { left: PREVIEW_W / 2, top: PREVIEW_H / 2 },
                            animatedImageStyle,
                        ]}
                    >
                        <Animated.Image source={{ uri: imageSrc }} style={styles.baseImage} resizeMode="cover" />
                        <FilteredImageSkia
                            uri={imageSrc}
                            width={base.w}
                            height={base.h}
                            matrix={matrix}
                            style={StyleSheet.absoluteFillObject as any}
                        />
                    </Animated.View>

                    {/* ✅ 오버레이(연회색 마스킹) */}
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

                    {/* ✅ 크롭창 border만 */}
                    <View
                        style={[
                            styles.cropWindow,
                            { width: CROP_SIZE, height: CROP_SIZE, left: MARGIN_X, top: MARGIN_Y },
                        ]}
                        pointerEvents="none"
                    />
                </View>

                <View style={styles.labelContainer} pointerEvents="none">
                    <Text style={styles.label}>{t["printArea"] || "Print area (20×20cm)"}</Text>
                </View>
            </View>
        </GestureDetector>
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
