// app/_layout.tsx
import React, { useCallback, useEffect, useState } from "react";
import { Tabs, useRouter } from "expo-router";
import { BlurView } from "expo-blur";
import { StyleSheet, View, Platform, Alert, Linking } from "react-native";
import { Home, Package, User } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import Constants from "expo-constants";

// ✨ 푸시 알림 관련 라이브러리 추가
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

// ✨ Firebase 관련 라이브러리 추가
import { auth, db } from "../../src/lib/firebase";
import { doc, setDoc } from "firebase/firestore";

import { colors } from "../../src/theme/colors";
import { useLanguage } from "../../src/context/LanguageContext";

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
    }),
});

SplashScreen.preventAutoHideAsync().catch(() => { });

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
    const router = useRouter();

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

    // 🚀 앱 실행 시 아이폰 배지 숫자/알림 센터 청소
    useEffect(() => {
        const resetBadge = async () => {
            try {
                await Notifications.dismissAllNotificationsAsync();
                await Notifications.setBadgeCountAsync(0);
            } catch (error) {
                console.error("배지 초기화 실패:", error);
            }
        };
        resetBadge();
    }, []);

    // 💡 2. 푸시 알림 세팅 & 알림 클릭 감지 로직
    useEffect(() => {
        const unsubscribeAuth = auth.onAuthStateChanged(async (user) => {
            if (user) {
                try {
                    const token = await registerForPushNotificationsAsync();
                    if (token) {
                        const userRef = doc(db, "users", user.uid);
                        await setDoc(userRef, { pushToken: token }, { merge: true });
                    }
                } catch (error) {
                    console.error("토큰 저장 실패:", error);
                }
            }
        });

        const responseListener = Notifications.addNotificationResponseReceivedListener(response => {
            // 🚨 [핵심 수술 부위: 구글 로그인 납치 버그 완벽 차단]
            // 안드로이드에서 구글 로그인 후 돌아오는 신호(Intent)를 알림 클릭으로 착각하지 못하도록 방어막을 쳤습니다.
            // "진짜로 사용자가 푸시 알림을 눌렀을 때(actionIdentifier가 있을 때)만 작동해라!"
            const isGenuineNotification = response?.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER;

            if (isGenuineNotification) {
                console.log("진짜 알림 클릭 감지됨! 마이 오더로 이동합니다.");
                router.push('/myorder');
            } else {
                console.log("구글 로그인 등 다른 딥링크 복귀 신호입니다. 무시합니다.");
            }
        });

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