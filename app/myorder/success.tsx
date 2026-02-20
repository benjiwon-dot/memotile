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

// ✅ [방어 코드] 웹 환경에서는 햅틱이나 디바이스 정보를 가져오지 않도록 차단
let Haptics: any = null;
let Device: any = null;
if (Platform.OS !== 'web') {
    try { Haptics = require("expo-haptics"); } catch { Haptics = null; }
    try { Device = require("expo-device"); } catch { Device = null; }
}

const PROCESSING_GRACE_MS = 12000;

export default function OrderSuccessScreen() {
    const params = useLocalSearchParams();
    const id = (params?.id as string | undefined) ?? undefined;

    const router = useRouter();
    const { t } = useLanguage();

    const [order, setOrder] = useState<OrderDoc | null>(null);
    const [processing, setProcessing] = useState(true);
    const [gaveUp, setGaveUp] = useState(false);

    const aliveRef = useRef(true);
    useEffect(() => {
        aliveRef.current = true;
        return () => { aliveRef.current = false; };
    }, []);

    const scale = useSharedValue(0);
    const opacity = useSharedValue(0);

    const startCelebration = async () => {
        scale.value = withSpring(1, { damping: 10, stiffness: 100 });
        opacity.value = withDelay(300, withSpring(1));

        if (Platform.OS !== 'web') {
            try {
                const isIos = Platform.OS === "ios";
                const isSimulator = isIos && Device && Device.isDevice === false;
                if (isSimulator) return;
                if (Haptics?.notificationAsync && Haptics?.NotificationFeedbackType?.Success) {
                    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
            } catch {
                // ignore
            }
        }
    };

    useEffect(() => {
        if (!id) {
            setProcessing(false);
            setGaveUp(true);
            return;
        }

        setOrder(null);
        setProcessing(true);
        setGaveUp(false);

        let unsub: any = null;
        let timeout: any = null;

        timeout = setTimeout(() => {
            if (!aliveRef.current) return;
            if (!order) {
                setProcessing(false);
                setGaveUp(true);
            }
        }, PROCESSING_GRACE_MS);

        unsub = subscribeOrder(id, (updated) => {
            if (!aliveRef.current) return;
            if (updated) {
                setOrder(updated);
                setProcessing(false);
                setGaveUp(false);
                if (timeout) clearTimeout(timeout);
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
                }
            } catch (e) {
                if (__DEV__) console.warn("[OrderSuccess] getOrder failed:", e);
            }
        })();

        return () => {
            if (timeout) clearTimeout(timeout);
            if (unsub) unsub();
        };
    }, [id]);

    const animatedIconStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    const animatedContentStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ translateY: (1 - opacity.value) * 30 }],
    }));

    if (!id || (processing && !order && !gaveUp)) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.center}>
                    <ActivityIndicator size="large" color="#111" />
                    <Text style={styles.processingTitle}>{(t as any).processingOrder || "Processing your order..."}</Text>
                    <Text style={styles.processingDesc}>
                        {(t as any).processingOrderDesc ||
                            "This can take a few seconds while we finalize your payment and create the order."}
                    </Text>

                    <View style={{ height: 18 }} />

                    <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace("/(tabs)/myorder")}>
                        <Text style={styles.secondaryBtnText}>{(t as any).goMyOrders || "Go to My Orders"}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.linkBtn} onPress={() => router.replace("/")}>
                        <Text style={styles.linkBtnText}>{(t as any).backHome || "Back to Home"}</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    if (!order && gaveUp) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.center}>
                    <Text style={styles.failTitle}>{(t as any).orderNotFound || "We couldn't load your order yet"}</Text>
                    <Text style={styles.failDesc}>
                        {(t as any).orderNotFoundDesc ||
                            "Your payment may have succeeded, but the order is still being created. Please try again."}
                    </Text>

                    <View style={{ height: 18 }} />

                    <TouchableOpacity
                        style={styles.primaryBtn}
                        onPress={() => router.replace({ pathname: "/myorder/success", params: { id } })}
                    >
                        <Text style={styles.primaryBtnText}>{(t as any).retry || "Retry"}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace("/(tabs)/myorder")}>
                        <Text style={styles.secondaryBtnText}>{(t as any).goMyOrders || "View My Orders"}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.linkBtn} onPress={() => router.replace("/")}>
                        <Text style={styles.linkBtnText}>{(t as any).backHome || "Back to Home"}</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    const email = order?.shipping?.email || "your email";

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                <View style={styles.content}>
                    <Animated.View style={[styles.iconWrapper, animatedIconStyle]}>
                        <CheckCircle size={100} color="#10B981" fill="#D1FAE5" strokeWidth={1} />
                    </Animated.View>

                    <Animated.View style={[styles.textCenter, animatedContentStyle]}>
                        <Text style={styles.title}>{(t as any).thankYou || "Thank You!"}</Text>
                        <Text style={styles.message}>
                            {(t as any).orderPlaced || "Your order has been placed successfully."}
                            {"\n"}
                            {(t as any).emailReceipt || "We've sent a receipt to"} {email}.
                        </Text>
                    </Animated.View>

                    {/* ✅ 웹에서는 사진 스트립 렌더링을 유연하게 처리 */}
                    {order?.items?.length ? (
                        <View style={styles.stripContainer}>
                            <OrderSuccessPreviewStripRN items={order.items} />
                        </View>
                    ) : null}

                    <Animated.View style={[styles.orderInfo, animatedContentStyle]}>
                        <View style={styles.infoRow}>
                            <Text style={styles.label}>{(t as any).orderNumberLabel || "ORDER NUMBER"}</Text>
                            <Text style={styles.value}>#{id}</Text>
                        </View>
                        <View style={styles.infoRow}>
                            <Text style={styles.estimate}>{(t as any).estimatedDelivery || "Estimated delivery: 5 days"}</Text>
                        </View>
                    </Animated.View>
                </View>
            </ScrollView>

            <View style={styles.actions}>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace("/(tabs)/myorder")}>
                    <Text style={styles.primaryBtnText}>{(t as any).goMyOrders || "View My Orders"}</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace("/")}>
                    <Text style={styles.secondaryBtnText}>{(t as any).backHome || "Back to Home"}</Text>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#fff" },
    scrollContent: { flexGrow: 1, justifyContent: "center" },
    content: { alignItems: "center", paddingHorizontal: 30, paddingVertical: 40 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30 },
    processingTitle: { marginTop: 14, fontSize: 18, fontWeight: "900", color: "#111", textAlign: "center" },
    processingDesc: { marginTop: 10, fontSize: 14, color: "#6B7280", textAlign: "center", lineHeight: 20, maxWidth: 320 },
    failTitle: { fontSize: 18, fontWeight: "900", color: "#111", textAlign: "center" },
    failDesc: { marginTop: 10, fontSize: 14, color: "#6B7280", textAlign: "center", lineHeight: 20, maxWidth: 340 },
    iconWrapper: { marginBottom: 32 },
    textCenter: { alignItems: "center" },
    title: { fontSize: 32, fontWeight: "900", marginBottom: 16, color: "#111", textAlign: "center" },
    message: { fontSize: 16, color: "#6B7280", marginBottom: 40, lineHeight: 24, textAlign: "center" },
    stripContainer: { width: "100%", marginBottom: 32 },
    orderInfo: { backgroundColor: "#F9FAFB", padding: 24, borderRadius: 24, borderWidth: 1, borderColor: "#F3F4F6", width: "100%" },
    infoRow: { alignItems: "center", marginBottom: 12 },
    label: { fontSize: 11, color: "#9CA3AF", textTransform: "uppercase", fontWeight: "800", letterSpacing: 1.5, marginBottom: 6 },
    value: { fontSize: 18, fontWeight: "700", fontFamily: "Courier", color: "#111" },
    estimate: { fontSize: 14, color: "#10B981", fontWeight: "700" },
    actions: { paddingHorizontal: 30, paddingBottom: 40, gap: 16 },
    primaryBtn: { backgroundColor: "#000", height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 10, elevation: 5, paddingHorizontal: 18 },
    primaryBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
    secondaryBtn: { height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, backgroundColor: "#F3F4F6" },
    secondaryBtnText: { color: "#111", fontSize: 15, fontWeight: "800" },
    linkBtn: { marginTop: 6, paddingVertical: 10, paddingHorizontal: 10 },
    linkBtnText: { color: "#6B7280", fontSize: 14, fontWeight: "700" },
});