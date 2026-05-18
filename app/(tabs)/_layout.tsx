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

    // 🚀 [강제 업데이트] 나중을 위해 기능은 살려두고 주석 처리(무력화)만 했습니다!
    /*
    useEffect(() => {
        const checkAppVersion = async () => {
            try {
                const CURRENT_VERSION = Constants.expoConfig?.version || "1.0.0";
                // 🚨 나중에 실제 백엔드 API 주소로 변경하세요!
                const response = await fetch('https://your-api.com/app-version');
                const data = await response.json();

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
                        { cancelable: false }
                    );
                }
            } catch (error) {
                console.error("버전 체크 실패:", error);
            }
        };

        checkAppVersion();
    }, []);
    */

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
                console.log("✅ 앱 실행: 푸시 알림 배지 초기화 완료");
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