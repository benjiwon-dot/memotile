// src/components/photobook/PhotobookGradient.tsx
//
// react-native-svg(이미 설치됨)로 그라데이션 배경을 그리는 래퍼. 새 네이티브 의존성 없음.
import React, { useRef } from "react";
import { View, StyleSheet, StyleProp, ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Rect } from "react-native-svg";

let _seq = 0;

export function PhotobookGradient({
    colors,
    style,
    radius = 0,
    children,
}: {
    colors: [string, string];
    style?: StyleProp<ViewStyle>;
    radius?: number;
    children?: React.ReactNode;
}) {
    const id = useRef(`pbgrad_${_seq++}`).current;
    return (
        <View style={[style, { overflow: "hidden", borderRadius: radius }]}>
            <Svg style={StyleSheet.absoluteFill}>
                <Defs>
                    <LinearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
                        <Stop offset="0%" stopColor={colors[0]} />
                        <Stop offset="100%" stopColor={colors[1]} />
                    </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
            </Svg>
            {children}
        </View>
    );
}
