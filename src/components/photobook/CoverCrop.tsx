// src/components/photobook/CoverCrop.tsx
//
// 표지 사진 크롭 렌더러 — focus(0~1, 프레임 중앙에 올 사진 지점) + zoom(≥1)으로
// 이동/확대 크롭을 결정적으로 그린다. 프레임을 항상 꽉 채우고(cover) 넘치는 부분만 잘린다.
import React from "react";
import { View } from "react-native";
import { Image as ExpoImage } from "expo-image";

export interface CoverCropProps {
    uri?: string;
    w: number;
    h: number;
    aspect: number;   // 사진 가로/세로
    focusX: number;   // 0~1
    focusY: number;   // 0~1
    zoom: number;     // ≥1
    bg?: string;
}

export function CoverCrop({ uri, w, h, aspect, focusX, focusY, zoom, bg }: CoverCropProps) {
    // 프레임을 cover하는 기본 크기
    const base = aspect > w / h ? { w: h * aspect, h } : { w, h: w / aspect };
    const dW = base.w * zoom;
    const dH = base.h * zoom;
    // focus 지점을 프레임 중앙에 두되, 항상 프레임을 덮도록 클램프
    const left = Math.min(0, Math.max(w - dW, w / 2 - focusX * dW));
    const top = Math.min(0, Math.max(h - dH, h / 2 - focusY * dH));
    return (
        <View style={{ width: w, height: h, overflow: "hidden", backgroundColor: bg }}>
            {uri ? (
                <ExpoImage
                    source={{ uri }}
                    style={{ position: "absolute", left, top, width: dW, height: dH }}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    recyclingKey={uri}
                />
            ) : null}
        </View>
    );
}
