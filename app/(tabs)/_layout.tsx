// app/_layout.tsx
import React, { useCallback, useEffect, useState } from "react";
import { Tabs, useRouter } from "expo-router"; // ✨ useRouter 추가
import { BlurView } from "expo-blur";
import { StyleSheet, View, Platform } from "react-native";
import { Home, Package, User } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";

// ✨ 푸시 알림 관련 라이브러리 추가
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

// ✨ Firebase 관련 라이브러리 추가
import { auth, db } from "../../src/lib/firebase";
import { doc, setDoc } from "firebase/firestore";

import { colors } from "../../src/theme/colors";
import { useLanguage } from "../../src/context/LanguageContext";

// ✨ 앱이 켜져 있을 때도 알림이 오도록 설정 (포그라운드 알림)
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
    }),
});

// ✨ 스플래시 강제 유지
SplashScreen.preventAutoHideAsync().catch(() => { });

// ✨ 푸시 토큰 발급 함수
async function registerForPushNotificationsAsync() {
    let token;

    if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF231F7C',
        });
    }

    if (Device.isDevice) {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
            const { status } = await Notifications.requestPermissionsAsync();
            finalStatus = status;
        }
        if (finalStatus !== 'granted') {
            console.log('Failed to get push token for push notification!');
            return;
        }
        // 토큰 발급
        token = (await Notifications.getExpoPushTokenAsync()).data;
        console.log("🔥 발급된 Expo Push Token:", token);
    } else {
        console.log('푸시 알림은 실제 기기(스마트폰)에서만 작동합니다.');
    }

    return token;
}

export default function TabLayout() {
    const { t } = useLanguage();
    const insets = useSafeAreaInsets();
    const router = useRouter(); // ✨ 네비게이션용

    const [appIsReady, setAppIsReady] = useState(false);

    // 💡 1. 스플래시 대기 로직
    useEffect(() => {
        async function prepare() {
            try {
                await new Promise(resolve => setTimeout(resolve, 1500));
            } catch (e) {
                console.warn(e);
            } finally {
                setAppIsReady(true);
            }
        }
        prepare();
    }, []);

    // 💡 2. 푸시 알림 세팅 & 알림 클릭 감지 로직
    useEffect(() => {
        // [A] 로그인 감지 및 토큰 저장
        const unsubscribeAuth = auth.onAuthStateChanged(async (user) => {
            if (user) {
                try {
                    const token = await registerForPushNotificationsAsync();
                    if (token) {
                        // 유저 문서에 pushToken 저장 (없으면 만들고 있으면 덮어씌움)
                        const userRef = doc(db, "users", user.uid);
                        await setDoc(userRef, { pushToken: token }, { merge: true });
                    }
                } catch (error) {
                    console.error("토큰 저장 실패:", error);
                }
            }
        });

        // [B] 알림 팝업 클릭 시 '마이 오더'로 이동하는 리스너
        const responseListener = Notifications.addNotificationResponseReceivedListener(response => {
            console.log("알림 클릭 감지됨! 마이 오더로 이동합니다.");
            router.push('/(tabs)/myorder');
        });

        // 화면 종료 시 리스너 해제
        return () => {
            unsubscribeAuth();
            Notifications.removeNotificationSubscription(responseListener);
        };
    }, []);

    const onLayoutRootView = useCallback(async () => {
        if (appIsReady) {
            await SplashScreen.hideAsync();
        }
    }, [appIsReady]);

    if (!appIsReady) {
        return null;
    }

    return (
        <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
            <Tabs
                screenOptions={{
                    headerShown: false,
                    tabBarStyle: {
                        position: "absolute",
                        borderTopWidth: 1,
                        borderTopColor: colors.border,
                        elevation: 0,
                        height: 60 + insets.bottom,
                        backgroundColor: "transparent",
                    },
                    tabBarBackground: () => (
                        <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
                    ),
                    tabBarLabelStyle: {
                        fontSize: 10,
                        fontWeight: "500",
                        marginBottom: 4,
                        marginTop: -4,
                    },
                    tabBarActiveTintColor: colors.primary,
                    tabBarInactiveTintColor: colors.textSecondary,
                }}
            >
                <Tabs.Screen
                    name="index"
                    options={{
                        title: t.home,
                        tabBarIcon: ({ color }) => (
                            <View pointerEvents="none">
                                <Home size={24} color={color} strokeWidth={2.5} />
                            </View>
                        ),
                    }}
                />
                <Tabs.Screen
                    name="myorder/index"
                    options={{
                        title: t.orders,
                        tabBarIcon: ({ color }) => (
                            <View pointerEvents="none">
                                <Package size={24} color={color} strokeWidth={2.5} />
                            </View>
                        ),
                    }}
                />
                <Tabs.Screen
                    name="profile"
                    options={{
                        title: t.profile,
                        tabBarIcon: ({ color }) => (
                            <View pointerEvents="none">
                                <User size={24} color={color} strokeWidth={2.5} />
                            </View>
                        ),
                    }}
                />
            </Tabs>
        </View>
    );
}