import React, { useEffect, useMemo, useState } from "react";
import { View, StyleSheet, Dimensions, Image as RNImage } from "react-native";
import { GestureDetector, Gesture, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    runOnJS,
} from "react-native-reanimated";
import { Image } from "expo-image";
import type { FilterType } from "./filters";

const SCREEN_WIDTH = Dimensions.get("window").width;
const PREVIEW_SIZE = SCREEN_WIDTH;        // square preview
const CROP_SIZE = SCREEN_WIDTH * 0.75;    // inner crop window

export type Crop = { x: number; y: number; scale: number };

type Props = {
    imageSrc: string;
    crop: Crop;
    onChange: (newCrop: Crop) => void;
    currentFilter: FilterType;
};

export default function CropFrameRN({ imageSrc, crop, onChange, currentFilter }: Props) {
    const [imgSize, setImgSize] = useState({ w: 1, h: 1 });

    // Shared values
    const translateX = useSharedValue(crop?.x ?? 0);
    const translateY = useSharedValue(crop?.y ?? 0);
    const scale = useSharedValue(crop?.scale ?? 1);

    const savedTranslateX = useSharedValue(crop?.x ?? 0);
    const savedTranslateY = useSharedValue(crop?.y ?? 0);
    const savedScale = useSharedValue(crop?.scale ?? 1);

    // Load image natural size
    useEffect(() => {
        if (!imageSrc) return;

        RNImage.getSize(
            imageSrc,
            (w: number, h: number) => setImgSize({ w, h }),
            (err: any) => console.error("RNImage.getSize failed:", err)
        );
    }, [imageSrc]);

    // Sync from prop crop -> shared values
    useEffect(() => {
        translateX.value = crop?.x ?? 0;
        translateY.value = crop?.y ?? 0;
        scale.value = crop?.scale ?? 1;

        savedTranslateX.value = crop?.x ?? 0;
        savedTranslateY.value = crop?.y ?? 0;
        savedScale.value = crop?.scale ?? 1;
    }, [crop?.x, crop?.y, crop?.scale]);

    // Compute scales
    const { baseScale, minScale } = useMemo(() => {
        const bs = Math.max(PREVIEW_SIZE / imgSize.w, PREVIEW_SIZE / imgSize.h);

        const sContain = Math.min(
            CROP_SIZE / (imgSize.w * bs),
            CROP_SIZE / (imgSize.h * bs)
        );

        const HARD_FLOOR = 0.65;
        const ms = Math.min(1, Math.max(HARD_FLOOR, sContain));

        return { baseScale: bs, minScale: ms };
    }, [imgSize.w, imgSize.h]);

    const clampValues = (tx: number, ty: number, sc: number) => {
        "worklet";

        const s = Math.max(minScale, Math.min(sc, 3.0));

        const currentW = imgSize.w * baseScale * s;
        const currentH = imgSize.h * baseScale * s;

        const maxDx = Math.max(0, (currentW - CROP_SIZE) / 2);
        const maxDy = Math.max(0, (currentH - CROP_SIZE) / 2);

        return {
            x: Math.max(-maxDx, Math.min(maxDx, tx)),
            y: Math.max(-maxDy, Math.min(maxDy, ty)),
            scale: s,
        };
    };

    // Gestures
    const panGesture = Gesture.Pan()
        .onUpdate((e) => {
            translateX.value = savedTranslateX.value + e.translationX;
            translateY.value = savedTranslateY.value + e.translationY;
        })
        .onEnd(() => {
            const clamped = clampValues(translateX.value, translateY.value, scale.value);

            translateX.value = withTiming(clamped.x);
            translateY.value = withTiming(clamped.y);

            savedTranslateX.value = clamped.x;
            savedTranslateY.value = clamped.y;

            runOnJS(onChange)({ x: clamped.x, y: clamped.y, scale: clamped.scale });
        });

    const pinchGesture = Gesture.Pinch()
        .onUpdate((e) => {
            scale.value = savedScale.value * e.scale;
        })
        .onEnd(() => {
            const clamped = clampValues(translateX.value, translateY.value, scale.value);

            scale.value = withTiming(clamped.scale);

            const reClampedPos = clampValues(translateX.value, translateY.value, clamped.scale);
            translateX.value = withTiming(reClampedPos.x);
            translateY.value = withTiming(reClampedPos.y);

            savedScale.value = clamped.scale;
            savedTranslateX.value = reClampedPos.x;
            savedTranslateY.value = reClampedPos.y;

            runOnJS(onChange)({ x: reClampedPos.x, y: reClampedPos.y, scale: clamped.scale });
        });

    const composedGesture = Gesture.Simultaneous(panGesture, pinchGesture);

    // Animated image style (centered at 50%/50%)
    const animatedImageStyle = useAnimatedStyle(() => {
        const w = imgSize.w * baseScale;
        const h = imgSize.h * baseScale;

        return {
            width: w,
            height: h,
            transform: [
                { translateX: -w / 2 },
                { translateY: -h / 2 },
                { translateX: translateX.value },
                { translateY: translateY.value },
                { scale: scale.value },
            ],
        };
    });

    const centeredImageStyle = {
        position: "absolute" as const,
        left: "50%",
        top: "50%",
    };

    return (
        <GestureHandlerRootView style={styles.container}>
            <GestureDetector gesture={composedGesture}>
                <View style={styles.previewWrap}>
                    {/* Background dim */}
                    <Animated.View style={[centeredImageStyle, animatedImageStyle, { opacity: 0.5 }]}>
                        <Image source={{ uri: imageSrc }} style={styles.imageContent} contentFit="cover" />
                        {currentFilter?.overlayColor ? (
                            <View
                                pointerEvents="none"
                                style={[
                                    styles.filterOverlay,
                                    { backgroundColor: currentFilter.overlayColor, opacity: currentFilter.overlayOpacity ?? 0 },
                                ]}
                            />
                        ) : null}
                    </Animated.View>

                    {/* Crop window */}
                    <View style={styles.cropWindow}>
                        <Animated.View style={[centeredImageStyle, animatedImageStyle]}>
                            <Image source={{ uri: imageSrc }} style={styles.imageContent} contentFit="cover" />
                            {currentFilter?.overlayColor ? (
                                <View
                                    pointerEvents="none"
                                    style={[
                                        styles.filterOverlay,
                                        { backgroundColor: currentFilter.overlayColor, opacity: currentFilter.overlayOpacity ?? 0 },
                                    ]}
                                />
                            ) : null}
                        </Animated.View>
                    </View>

                    {/* Frame decoration */}
                    <View style={styles.frameDecoration} pointerEvents="none">
                        <View style={[styles.corner, styles.cornerTL]} />
                        <View style={[styles.corner, styles.cornerTR]} />
                        <View style={[styles.corner, styles.cornerBL]} />
                        <View style={[styles.corner, styles.cornerBR]} />
                    </View>
                </View>
            </GestureDetector>
        </GestureHandlerRootView>
    );
}

const styles = StyleSheet.create({
    container: {
        width: "100%",
        height: PREVIEW_SIZE,
        backgroundColor: "#F7F7F8",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
    },
    previewWrap: {
        width: PREVIEW_SIZE,
        height: PREVIEW_SIZE,
        alignItems: "center",
        justifyContent: "center",
    },
    imageContent: {
        width: "100%",
        height: "100%",
    },
    filterOverlay: {
        ...StyleSheet.absoluteFillObject,
    },
    cropWindow: {
        width: CROP_SIZE,
        height: CROP_SIZE,
        overflow: "hidden",
        zIndex: 10,
    },
    frameDecoration: {
        position: "absolute",
        width: CROP_SIZE,
        height: CROP_SIZE,
        zIndex: 20,
        shadowColor: "#000",
        shadowOpacity: 0.2,
        shadowRadius: 20,
        elevation: 10,
    },
    corner: {
        position: "absolute",
        width: 12,
        height: 12,
        borderColor: "#fff",
        borderWidth: 0,
    },
    cornerTL: { top: 8, left: 8, borderTopWidth: 1.5, borderLeftWidth: 1.5 },
    cornerTR: { top: 8, right: 8, borderTopWidth: 1.5, borderRightWidth: 1.5 },
    cornerBL: { bottom: 8, left: 8, borderBottomWidth: 1.5, borderLeftWidth: 1.5 },
    cornerBR: { bottom: 8, right: 8, borderBottomWidth: 1.5, borderRightWidth: 1.5 },
});
