// src/components/photobook/PhotobookCropEditor.tsx
//
// 공용 크롭 에디터 — 표지·내지 사진 공통. react-native-gesture-handler(Pinch+Pan) + reanimated.
// 타일 에디터와 같은 transform(중앙기준 translate+scale) 렌더로 부드럽게. 좌표는 정규화 {fx,fy,zoom}만 저장.
// fx/fy는 "프레임 중앙에 올 사진 지점(0~1)". 커버가 유지되는 유효범위로 clamp → 줌이 어긋나지 않음.
import React, { useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from "react-native-reanimated";

const AImage = Animated.createAnimatedComponent(ExpoImage);
const MAX_ZOOM = 5;

export interface CropValue { fx: number; fy: number; zoom: number; }

// 커버 유지 유효범위로 초점 clamp (frameDim/표시크기 기반). dim>=frameDim → lo<=0.5<=hi.
function clampFocus(v: number, frameDim: number, dim: number): number {
    "worklet";
    const lo = frameDim / (2 * dim);
    const hi = 1 - lo;
    return Math.min(hi, Math.max(lo, v));
}

interface Props {
    uri?: string;
    frameW: number;
    frameH: number;
    aspect: number;              // 이미지 가로/세로
    value: CropValue;
    onChange: (v: CropValue) => void;
    grid?: boolean;
    bg?: string;
}

export function PhotobookCropEditor({ uri, frameW, frameH, aspect, value, onChange, grid, bg }: Props) {
    const fx = useSharedValue(value.fx);
    const fy = useSharedValue(value.fy);
    const zoom = useSharedValue(value.zoom);
    const savedZoom = useSharedValue(value.zoom);

    useEffect(() => {
        fx.value = value.fx; fy.value = value.fy; zoom.value = value.zoom;
    }, [value.fx, value.fy, value.zoom]);

    // 넘어온 aspect(썸네일)와 실제 로드된 이미지 비율이 다를 수 있음(회전/EXIF) → onLoad로 실제 비율 사용.
    const [imgA, setImgA] = useState(aspect > 0 ? aspect : 1);
    useEffect(() => { if (aspect > 0) setImgA(aspect); }, [aspect]);
    const a = imgA > 0 ? imgA : 1;
    // 프레임을 cover하는 기본 크기 (baseW,baseH >= frame). 이미지는 이 크기 고정, transform만 변함.
    const baseW = a > frameW / frameH ? frameH * a : frameW;
    const baseH = a > frameW / frameH ? frameH : frameW / a;

    const pan = Gesture.Pan()
        .averageTouches(true)
        .onChange((e) => {
            "worklet";
            const dW = baseW * zoom.value, dH = baseH * zoom.value;
            fx.value = clampFocus(fx.value - e.changeX / dW, frameW, dW);
            fy.value = clampFocus(fy.value - e.changeY / dH, frameH, dH);
        })
        .onEnd(() => { "worklet"; runOnJS(onChange)({ fx: fx.value, fy: fy.value, zoom: zoom.value }); });

    const pinch = Gesture.Pinch()
        .onStart(() => { "worklet"; savedZoom.value = zoom.value; })
        .onChange((e) => {
            "worklet";
            const oldZ = zoom.value;
            let nz = savedZoom.value * e.scale;
            nz = Math.min(MAX_ZOOM, Math.max(1, nz));
            const dWo = baseW * oldZ, dWn = baseW * nz, dHo = baseH * oldZ, dHn = baseH * nz;
            // 손가락 중심(focal) 아래 지점이 고정되도록 초점 보정 → 당기는 곳으로 줌
            fx.value = clampFocus(fx.value + (e.focalX - frameW / 2) * (1 / dWo - 1 / dWn), frameW, dWn);
            fy.value = clampFocus(fy.value + (e.focalY - frameH / 2) * (1 / dHo - 1 / dHn), frameH, dHn);
            zoom.value = nz;
        })
        .onEnd(() => { "worklet"; runOnJS(onChange)({ fx: fx.value, fy: fy.value, zoom: zoom.value }); });

    const gesture = Gesture.Simultaneous(pan, pinch);

    // 중앙기준 transform: content점 fx가 프레임 중앙에 오도록 tx = -(fx-0.5)*dW
    const imgStyle = useAnimatedStyle(() => {
        const dW = baseW * zoom.value, dH = baseH * zoom.value;
        // 초기 초점(얼굴중심)이 유효범위를 벗어나도 항상 프레임을 덮도록 tx/ty 클램프 → 쏠림/배경(검정) 방지
        const maxX = Math.max(0, (dW - frameW) / 2), maxY = Math.max(0, (dH - frameH) / 2);
        let tx = -(fx.value - 0.5) * dW;
        let ty = -(fy.value - 0.5) * dH;
        tx = Math.min(maxX, Math.max(-maxX, tx));
        ty = Math.min(maxY, Math.max(-maxY, ty));
        return { transform: [{ translateX: tx }, { translateY: ty }, { scale: zoom.value }] };
    });

    return (
        <GestureDetector gesture={gesture}>
            <View style={{ width: frameW, height: frameH, overflow: "hidden", backgroundColor: bg ?? "#222", alignItems: "center", justifyContent: "center" }}>
                {uri ? <AImage source={{ uri }} style={[{ width: baseW, height: baseH }, imgStyle]} contentFit="cover" cachePolicy="memory-disk" transition={180} onLoad={(e) => { const w = e?.source?.width, h = e?.source?.height; if (w && h) setImgA(w / h); }} /> : null}
                {grid ? (
                    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                        <View style={[styles.v, { left: "33.33%" }]} />
                        <View style={[styles.v, { left: "66.66%" }]} />
                        <View style={[styles.h, { top: "33.33%" }]} />
                        <View style={[styles.h, { top: "66.66%" }]} />
                    </View>
                ) : null}
            </View>
        </GestureDetector>
    );
}

const styles = StyleSheet.create({
    v: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "rgba(255,255,255,0.25)" },
    h: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: "rgba(255,255,255,0.25)" },
});
