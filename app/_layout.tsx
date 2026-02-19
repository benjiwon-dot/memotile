// app/_layout.tsx
import "react-native-gesture-handler";
import { Buffer } from "buffer";
(global as any).Buffer = Buffer;
import React, { useState, useEffect } from "react";
import { Stack } from "expo-router";
import { View, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { LanguageProvider } from "../src/context/LanguageContext";
import { PhotoProvider } from "../src/context/PhotoContext";
import SplashOverlay from "../src/components/SplashOverlay";

export default function RootLayout() {
    const [showSplash, setShowSplash] = useState(true);

    useEffect(() => {
        const safetyTimer = setTimeout(() => setShowSplash(false), 2200);
        return () => clearTimeout(safetyTimer);
    }, []);

    const isWeb = Platform.OS === 'web';

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
                        {showSplash && <SplashOverlay onFinish={() => setShowSplash(false)} />}
                    </View>
                </PhotoProvider>
            </LanguageProvider>
        </GestureHandlerRootView>
    );
}