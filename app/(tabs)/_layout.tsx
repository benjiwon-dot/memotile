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
import { usePhotobookTheme } from "../../src/config/photobookTheme";

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        // SDK 53(expo-notifications 0.31+): shouldShowAlert는 deprecated.
        // 포그라운드 배너/목록 표시를 위해 banner/list를 명시한다.
        shouldShowBanner: true,
        shouldShowList: true,
        shouldShowAlert: true, // 구버전 호환용
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
            console.log('🔕 푸시 권한 거부됨 (status=' + finalStatus + ') — 토큰 미발급');
            return;
        }
        // EAS projectId를 명시적으로 전달해야 빌드/환경 무관하게 안정적으로 발급된다.
        const projectId =
            Constants?.expoConfig?.extra?.eas?.projectId ??
            (Constants as any)?.easConfig?.projectId;
        if (!projectId) console.warn('⚠️ EAS projectId를 찾지 못함 — 토큰 발급이 실패할 수 있음');
        token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
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
    const c = usePhotobookTheme();

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
                        // 서버는 expoPushToken || pushToken 순으로 읽으므로 양쪽에 동일 저장.
                        await setDoc(userRef, {
                            expoPushToken: token,
                            pushToken: token,
                            pushTokenUpdatedAt: new Date().toISOString(),
                        }, { merge: true });
                        console.log("✅ 푸시 토큰 저장 완료:", user.uid);
                    } else {
                        console.log("ℹ️ 푸시 토큰 없음 — 저장 건너뜀 (권한 거부/시뮬레이터/projectId 누락)");
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
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: c.border,
                        elevation: 0,
                        height: 52 + insets.bottom,   // 60→52로 살짝 낮춤 (홈 인디케이터 safe-area는 유지)
                        paddingTop: 6,
                        backgroundColor: c.surface,   // 솔리드 (뒤 비침 X)
                        // 은은한 상단 그림자
                        shadowColor: c.shadow, shadowOffset: { width: 0, height: -2 }, shadowOpacity: 1, shadowRadius: 8,
                    },
                    // ⬇️ 블러로 되돌리려면: 위 backgroundColor를 "transparent"로 바꾸고 아래 주석 해제
                    // tabBarBackground: () => (
                    //     <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
                    // ),
                    tabBarLabelStyle: {
                        fontSize: 10,
                        fontWeight: "500",
                        marginBottom: 4,
                        marginTop: -4,
                    },
                    tabBarActiveTintColor: c.coral,        // 파랑 → 브랜드 코랄
                    tabBarInactiveTintColor: c.textMuted,  // 비활성 차분한 그레이
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