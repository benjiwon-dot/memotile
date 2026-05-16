// app/_layout.tsx
import React, { useCallback, useEffect, useState } from "react";
import { Tabs, useRouter } from "expo-router";
import { BlurView } from "expo-blur";
import { StyleSheet, View, Platform, Alert, Linking } from "react-native"; // ✨ Alert, Linking 추가
import { Home, Package, User } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import Constants from "expo-constants"; // ✨ 앱 버전 가져오기용 추가

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

// ✨ [강제 업데이트 추가] 버전 비교 보조 함수
const isUpdateRequired = (current: string, min: string) => {
    const curParts = current.split('.').map(Number);
    const minParts = min.split('.').map(Number);
    for (let i = 0; i < Math.max(curParts.length, minParts.length); i++) {
        const curNum = curParts[i] || 0;
        const minNum = minParts[i] || 0;
        if (curNum < minNum) return true;
        if (curNum > minNum) return false;
    }
    return false;
};


export default function TabLayout() {
    const { t } = useLanguage();
    const insets = useSafeAreaInsets();
    const router = useRouter();

    const [appIsReady, setAppIsReady] = useState(false);

    // 🚀 [강제 업데이트 추가] 앱 실행 시 버전 체크
    useEffect(() => {
        const checkAppVersion = async () => {
            try {
                // 현재 앱 버전 (app.json에 적힌 version 값)
                const CURRENT_VERSION = Constants.expoConfig?.version || "1.0.0";

                // TODO: 실제 사용하시는 백엔드 API 주소나 Firebase 데이터 경로로 변경하세요!
                const response = await fetch('https://your-api.com/app-version');
                const data = await response.json();

                // 서버에서 내려주는 최소 요구 버전 및 스토어 주소 (예시)
                const { minVersion, appStoreUrl, playStoreUrl } = data;

                if (isUpdateRequired(CURRENT_VERSION, minVersion)) {
                    Alert.alert(
                        "업데이트 알림",
                        "원활한 서비스 이용을 위해 최신 버전으로 업데이트 해주세요.",
                        [
                            {
                                text: "업데이트 하러가기",
                                onPress: () => {
                                    const storeUrl = Platform.OS === 'ios' ? appStoreUrl : playStoreUrl;
                                    Linking.openURL(storeUrl);
                                }
                            }
                        ],
                        { cancelable: false } // 뒤로가기나 빈 화면 눌러서 닫기 방지
                    );
                }
            } catch (error) {
                console.error("버전 체크 실패:", error);
                // 서버 통신 실패 시 일단 앱은 켜지도록 둠 (사용자 경험 보호)
            }
        };

        checkAppVersion();
    }, []);

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

    // 🚀 [추가됨] 앱 실행 시 쌓여있던 아이폰 배지 숫자와 알림 센터를 즉시 청소!
    useEffect(() => {
        const resetBadge = async () => {
            try {
                await Notifications.dismissAllNotificationsAsync(); // 알림 센터 청소
                await Notifications.setBadgeCountAsync(0); // 빨간 숫자 0으로 초기화
                console.log("✅ 앱 실행: 푸시 알림 배지 초기화 완료");
            } catch (error) {
                console.error("배지 초기화 실패:", error);
            }
        };
        resetBadge();
    }, []);

    // 💡 2. 푸시 알림 세팅 & 알림 클릭 감지 로직
    useEffect(() => {
        // [A] 로그인 감지 및 토큰 저장
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

        // [B] 알림 팝업 클릭 시 '마이 오더'로 이동하는 리스너
        const responseListener = Notifications.addNotificationResponseReceivedListener(response => {
            console.log("알림 클릭 감지됨! 마이 오더로 이동합니다.");
            router.push('/(tabs)/myorder');
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
            {/* 기존 Tabs 코드 그대로 유지 */}
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