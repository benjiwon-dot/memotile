// app/_layout.tsx
import "react-native-gesture-handler";
import { Buffer } from "buffer";
(global as any).Buffer = Buffer;
import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { View, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as ScreenOrientation from "expo-screen-orientation";

import { LanguageProvider } from "../src/context/LanguageContext";
import { PhotoProvider } from "../src/context/PhotoContext";

export default function RootLayout() {
    const isWeb = Platform.OS === 'web';

    // 앱 전역 세로 고정. 프리뷰 화면만 진입 시 unlock, 나갈 때 다시 세로 → 타일·결제 등 다른 화면은 세로 유지.
    useEffect(() => {
        if (Platform.OS !== "web") {
            ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => { });
        }
    }, []);

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <LanguageProvider>
                <PhotoProvider>
                    <View style={{ flex: 1 }}>
                        <Stack
                            screenOptions={{
                                headerShown: false,
                                // ✅ [핵심 수정] 웹일 때만 Stack 컨테이너에 스크롤(overflow: auto)을 허용합니다.
                                // 이것이 없으면 자식 컴포넌트가 길어져도 스크롤바가 안 생깁니다.
                                contentStyle: {
                                    backgroundColor: 'white',
                                    overflow: isWeb ? 'auto' : undefined,
                                }
                            }}
                        />
                    </View>
                </PhotoProvider>
            </LanguageProvider>
        </GestureHandlerRootView>
    );
}