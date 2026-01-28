import React, { useState, useEffect } from "react";
import { Stack } from "expo-router";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { LanguageProvider } from "../src/context/LanguageContext";
import SplashOverlay from "../src/components/SplashOverlay";
import { PhotoProvider } from "../src/context/PhotoContext";

export default function RootLayout() {
    const [showSplash, setShowSplash] = useState(true);

    useEffect(() => {
        // Safety timeout to ensure splash doesn't block forever
        const safetyTimer = setTimeout(() => {
            setShowSplash(false);
        }, 2200);

        return () => clearTimeout(safetyTimer);
    }, []);

    console.log("ROOT LAYOUT LOADED ✅ (LanguageProvider ON)");

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <LanguageProvider>
                <PhotoProvider>
                    <View style={{ flex: 1 }}>
                        <Stack screenOptions={{ headerShown: false }} />
                        {showSplash && (
                            <SplashOverlay onFinish={() => setShowSplash(false)} />
                        )}
                    </View>
                </PhotoProvider>
            </LanguageProvider>
        </GestureHandlerRootView>
    );
}
