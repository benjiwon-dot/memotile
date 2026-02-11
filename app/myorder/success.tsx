// app/myorder/success.tsx
import React, { useEffect, useState, useRef } from "react";
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Platform,
    ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CheckCircle } from "lucide-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withDelay,
} from "react-native-reanimated";

import { getOrder, subscribeOrder } from "../../src/services/orders";
import { OrderDoc } from "../../src/types/order";
import { useLanguage } from "../../src/context/LanguageContext";
import OrderSuccessPreviewStripRN from "../../src/components/orders/OrderSuccessPreviewStripRN";

// ---- Optional native modules (avoid crash if not installed / not in Expo Go) ----
let Haptics: any = null;
try {
    Haptics = require("expo-haptics");
} catch {
    Haptics = null;
}

let Device: any = null;
try {
    Device = require("expo-device");
} catch {
    Device = null;
}

// ✅ success screen에서도 “주문 생성 직후 아직 없음”을 기다려주는 시간
const PROCESSING_GRACE_MS = 12000;

export default function OrderSuccessScreen() {
    const params = useLocalSearchParams();
    const id = (params?.id as string | undefined) ?? undefined;

    const router = useRouter();
    const { t } = useLanguage();

    const [order, setOrder] = useState<OrderDoc | null>(null);

    // ✅ 3-state: 로딩(처리중) / 진짜 실패 / 성공(order 있음)
    const [processing, setProcessing] = useState(true);
    const [gaveUp, setGaveUp] = useState(false);

    const aliveRef = useRef(true);
    useEffect(() => {
        aliveRef.current = true;
        return () => {
            aliveRef.current = false;
        };
    }, []);

    // Celebration Animation
    const scale = useSharedValue(0);
    const opacity = useSharedValue(0);

    const startCelebration = async () => {
        // Trigger animation
        scale.value = withSpring(1, { damping: 10, stiffness: 100 });
        opacity.value = withDelay(300, withSpring(1));

        // Haptics: safe + simulator guard
        try {
            const isIos = Platform.OS === "ios";
            const isSimulator = isIos && Device && Device.isDevice === false;

            if (isSimulator) {
                if (__DEV__) console.log("[Haptics] Skipping on iOS Simulator.");
                return;
            }

            if (Haptics?.notificationAsync && Haptics?.NotificationFeedbackType?.Success) {
                await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
        } catch {
            // ignore
        }
    };

    useEffect(() => {
        if (!id) {
            // id 없으면 바로 실패 UI
            setProcessing(false);
            setGaveUp(true);
            return;
        }

        setOrder(null);
        setProcessing(true);
        setGaveUp(false);

        let unsub: any = null;
        let timeout: any = null;

        // ✅ grace time 지나도 order를 못 받으면 “진짜 실패” UI로 전환
        timeout = setTimeout(() => {
            if (!aliveRef.current) return;
            if (!order) {
                setProcessing(false);
                setGaveUp(true);
            }
        }, PROCESSING_GRACE_MS);

        // ✅ 구독 먼저: doc이 생성되는 즉시 들어온다
        unsub = subscribeOrder(id, (updated) => {
            if (!aliveRef.current) return;
            if (updated) {
                setOrder(updated);
                setProcessing(false);
                setGaveUp(false);
                if (timeout) clearTimeout(timeout);
                // ✅ 주문이 실제로 로드된 “그 순간”에만 축하 효과
                startCelebration();
            }
        });

        (async () => {
            try {
                const data = await getOrder(id);
                if (!aliveRef.current) return;

                if (data) {
                    setOrder(data);
                    setProcessing(false);
                    setGaveUp(false);
                    if (timeout) clearTimeout(timeout);
                    startCelebration();
                } else {
                    // ✅ null이면 processing 유지. 구독이 잡아주거나 timeout이 gaveUp 처리.
                }
            } catch (e) {
                if (__DEV__) console.warn("[OrderSuccess] getOrder failed:", e);
                // 에러도 즉시 실패로 보내지 말고 grace-time 정책 유지
            }
        })();

        return () => {
            if (timeout) clearTimeout(timeout);
            if (unsub) unsub();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const animatedIconStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    const animatedContentStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ translateY: (1 - opacity.value) * 30 }],
    }));

    // ✅ Processing UI (깔끔한 로딩 + 안내 + 자동 대기)
    if (!id || (processing && !order && !gaveUp)) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.center}>
                    <ActivityIndicator size="large" color="#111" />
                    <Text style={styles.processingTitle}>{t.processingOrder || "Processing your order..."}</Text>
                    <Text style={styles.processingDesc}>
                        {t.processingOrderDesc ||
                            "This can take a few seconds while we finalize your payment and create the order."}
                    </Text>

                    <View style={{ height: 18 }} />

                    <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace("/(tabs)/myorder")}>
                        <Text style={styles.secondaryBtnText}>{t.goMyOrders || "Go to My Orders"}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.linkBtn} onPress={() => router.replace("/")}>
                        <Text style={styles.linkBtnText}>{t.backHome || "Back to Home"}</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    // ✅ Grace-time 지나도 못 찾았을 때: "진짜 실패" UX (Retry 제공)
    if (!order && gaveUp) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.center}>
                    <Text style={styles.failTitle}>{t.orderNotFound || "We couldn't load your order yet"}</Text>
                    <Text style={styles.failDesc}>
                        {t.orderNotFoundDesc ||
                            "Your payment may have succeeded, but the order is still being created. Please try again."}
                    </Text>

                    <View style={{ height: 18 }} />

                    <TouchableOpacity
                        style={styles.primaryBtn}
                        onPress={() => router.replace({ pathname: "/myorder/success", params: { id } })}
                    >
                        <Text style={styles.primaryBtnText}>{t.retry || "Retry"}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace("/(tabs)/myorder")}>
                        <Text style={styles.secondaryBtnText}>{t.goMyOrders || "View My Orders"}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.linkBtn} onPress={() => router.replace("/")}>
                        <Text style={styles.linkBtnText}>{t.backHome || "Back to Home"}</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    // ✅ order loaded: Success UI
    const email = order?.shipping?.email || "your email";

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                <View style={styles.content}>
                    <Animated.View style={[styles.iconWrapper, animatedIconStyle]}>
                        <CheckCircle size={100} color="#10B981" fill="#D1FAE5" strokeWidth={1} />
                    </Animated.View>

                    <Animated.View style={[styles.textCenter, animatedContentStyle]}>
                        <Text style={styles.title}>{t.thankYou || "Thank You!"}</Text>
                        <Text style={styles.message}>
                            {t.orderPlaced || "Your order has been placed successfully."}
                            {"\n"}
                            {t.emailReceipt || "We've sent a receipt to"} {email}.
                        </Text>
                    </Animated.View>

                    {/* Horizontal item previews */}
                    {order?.items?.length ? (
                        <View style={styles.stripContainer}>
                            <OrderSuccessPreviewStripRN items={order.items} />
                        </View>
                    ) : null}

                    <Animated.View style={[styles.orderInfo, animatedContentStyle]}>
                        <View style={styles.infoRow}>
                            <Text style={styles.label}>{t.orderNumberLabel || "ORDER NUMBER"}</Text>
                            <Text style={styles.value}>#{id}</Text>
                        </View>
                        <View style={styles.infoRow}>
                            <Text style={styles.estimate}>{t.estimatedDelivery || "Estimated delivery: 5 days"}</Text>
                        </View>
                    </Animated.View>
                </View>
            </ScrollView>

            <View style={styles.actions}>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace("/(tabs)/myorder")}>
                    <Text style={styles.primaryBtnText}>{t.goMyOrders || "View My Orders"}</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace("/")}>
                    <Text style={styles.secondaryBtnText}>{t.backHome || "Back to Home"}</Text>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#fff" },
    scrollContent: { flexGrow: 1, justifyContent: "center" },
    content: { alignItems: "center", paddingHorizontal: 30, paddingVertical: 40 },

    // Processing / Fail
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30 },
    processingTitle: {
        marginTop: 14,
        fontSize: 18,
        fontWeight: "900",
        color: "#111",
        textAlign: "center",
    },
    processingDesc: {
        marginTop: 10,
        fontSize: 14,
        color: "#6B7280",
        textAlign: "center",
        lineHeight: 20,
        maxWidth: 320,
    },
    failTitle: {
        fontSize: 18,
        fontWeight: "900",
        color: "#111",
        textAlign: "center",
    },
    failDesc: {
        marginTop: 10,
        fontSize: 14,
        color: "#6B7280",
        textAlign: "center",
        lineHeight: 20,
        maxWidth: 340,
    },

    // Success
    iconWrapper: { marginBottom: 32 },
    textCenter: { alignItems: "center" },
    title: {
        fontSize: 32,
        fontWeight: "900",
        marginBottom: 16,
        color: "#111",
        textAlign: "center",
    },
    message: {
        fontSize: 16,
        color: "#6B7280",
        marginBottom: 40,
        lineHeight: 24,
        textAlign: "center",
    },
    stripContainer: { width: "100%", marginBottom: 32 },
    orderInfo: {
        backgroundColor: "#F9FAFB",
        padding: 24,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: "#F3F4F6",
        width: "100%",
    },
    infoRow: { alignItems: "center", marginBottom: 12 },
    label: {
        fontSize: 11,
        color: "#9CA3AF",
        textTransform: "uppercase",
        fontWeight: "800",
        letterSpacing: 1.5,
        marginBottom: 6,
    },
    value: { fontSize: 18, fontWeight: "700", fontFamily: "Courier", color: "#111" },
    estimate: { fontSize: 14, color: "#10B981", fontWeight: "700" },

    // Buttons
    actions: { paddingHorizontal: 30, paddingBottom: 40, gap: 16 },
    primaryBtn: {
        backgroundColor: "#000",
        height: 60,
        borderRadius: 30,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000",
        shadowOpacity: 0.1,
        shadowRadius: 10,
        elevation: 5,
        paddingHorizontal: 18,
    },
    primaryBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
    secondaryBtn: {
        height: 52,
        borderRadius: 26,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 18,
        backgroundColor: "#F3F4F6",
    },
    secondaryBtnText: { color: "#111", fontSize: 15, fontWeight: "800" },

    linkBtn: { marginTop: 6, paddingVertical: 10, paddingHorizontal: 10 },
    linkBtnText: { color: "#6B7280", fontSize: 14, fontWeight: "700" },
});
