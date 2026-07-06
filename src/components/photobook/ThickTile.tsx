// src/components/photobook/ThickTile.tsx
//
// CSS 가짜 3D — 2cm 두께 실물 타일 느낌. 빛이 위에서 오는 가정:
//  오른쪽(중간 어둡기) + 아래(가장 어둡게) 두께 면을 그리고, 그 위에 사진(face)을 얹는다.
// 새 네이티브 의존성 없음. 다크모드 톤은 photobookTheme(edgeSide/edgeBottom)에서 자동.
import React from "react";
import { View, StyleSheet, StyleProp, ViewStyle } from "react-native";
import { usePhotobookTheme } from "../../config/photobookTheme";

export function ThickTile({
    size,
    thickness = 7,
    radius = 3,
    borderColor,
    borderWidth = 0,
    style,
    children,
}: {
    size: number;
    thickness?: number;
    radius?: number;
    borderColor?: string;
    borderWidth?: number;
    style?: StyleProp<ViewStyle>;
    children?: React.ReactNode;
}) {
    const c = usePhotobookTheme();
    const t = thickness;

    return (
        <View style={[{ width: size + t, height: size + t }, style]}>
            {/* 오른쪽 두께 면 */}
            <View style={{ position: "absolute", left: size, top: t * 0.5, width: t, height: size, backgroundColor: c.edgeSide, borderTopRightRadius: radius, borderBottomRightRadius: radius }} />
            {/* 아래 두께 면 (가장 어둡게) */}
            <View style={{ position: "absolute", left: t * 0.5, top: size, width: size, height: t, backgroundColor: c.edgeBottom, borderBottomLeftRadius: radius, borderBottomRightRadius: radius }} />
            {/* 모서리 채움 */}
            <View style={{ position: "absolute", left: size - 1, top: size - 1, width: t + 1, height: t + 1, backgroundColor: c.edgeBottom, borderBottomRightRadius: radius }} />
            {/* 사진 face (위에 얹힘) */}
            <View style={{ position: "absolute", left: 0, top: 0, width: size, height: size, borderRadius: radius, overflow: "hidden", borderWidth, borderColor }}>
                {children}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({});
