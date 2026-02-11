// app/myorder/[id].tsx
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
    View,
    Text,
    StyleSheet,
    Image,
    FlatList,
    ActivityIndicator,
    Dimensions,
    TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { doc, onSnapshot, getDocs, collection } from "firebase/firestore";
import { db } from "../../src/lib/firebase";
import { OrderDoc } from "../../src/types/order";
import { useLanguage } from "../../src/context/LanguageContext";
import StatusBadgeRN from "../../src/components/orders/StatusBadgeRN";
import PreviewModalRN from "../../src/components/orders/PreviewModalRN";
import { formatDate } from "../../src/utils/date";

const { width } = Dimensions.get("window");
const GRID_SPACING = 12;
const ITEM_WIDTH = (width - 40 - GRID_SPACING * 2) / 3;

// ✅ 주문 생성 직후 “아직 없음” 상태를 기다려주는 시간
const NOT_FOUND_GRACE_MS = 12000;

/**
 * ✅ CUSTOMER APP RULE:
 * - 고객(앱) 화면에서는 "2000대(2048/2000) 프리뷰"만 사용
 * - 절대 print(5000) URL을 사용하지 않음
 */
function pickCustomerPreviewUri(it: any): string | null {
    // ✅ 1순위: previewUrl (서버에서 만든 "앱 프리뷰용")
    // ✅ 2순위: legacy previewUrl/previewUri
    // ✅ 3순위: viewUrl (앱에서 만든 view 파일) - 마지막 fallback
    const uri =
        it?.assets?.previewUrl ||
        it?.previewUrl ||
        it?.previewUri ||
        it?.assets?.viewUrl ||
        it?.assets?.viewUri ||
        it?.output?.previewUri ||
        it?.output?.viewUri ||
        null;

    // ✅ 안전장치: 어떤 필드에든 printUrl이 섞였으면 강제로 배제
    if (typeof uri === "string" && /print/i.test(uri)) {
        return (
            it?.assets?.previewUrl ||
            it?.previewUrl ||
            it?.previewUri ||
            it?.assets?.viewUrl ||
            it?.assets?.viewUri ||
            it?.output?.previewUri ||
            it?.output?.viewUri ||
            null
        );
    }

    return typeof uri === "string" && uri.length > 0 ? uri : null;
}

export default function OrderDetailScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const { t } = useLanguage();

    const [order, setOrder] = useState<OrderDoc | null>(null);

    // ✅ 3-state: 로딩중 / 기다리는중 / 진짜없음
    const [loading, setLoading] = useState(true);
    const [gaveUp, setGaveUp] = useState(false);

    const [previewItem, setPreviewItem] = useState<any | null>(null);

    const aliveRef = useRef(true);

    useEffect(() => {
        aliveRef.current = true;
        return () => {
            aliveRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (!id) return;

        setLoading(true);
        setGaveUp(false);
        setOrder(null);

        let unsub: (() => void) | null = null;
        let timeout: any = null;

        // ✅ NotFound 즉시 표시 X -> grace time 이후에만 “진짜 없음”
        timeout = setTimeout(() => {
            if (!aliveRef.current) return;
            setGaveUp(true);
            setLoading(false);
        }, NOT_FOUND_GRACE_MS);

        const docRef = doc(db, "orders", id as string);

        unsub = onSnapshot(
            docRef,
            async (snap) => {
                if (!aliveRef.current) return;

                if (snap.exists()) {
                    const data = snap.data();
                    const newOrder = { id: snap.id, ...data } as OrderDoc;

                    // ✅ subcollection items 우선 로드
                    try {
                        const itemsSnap = await getDocs(collection(db, "orders", snap.id, "items"));
                        if (!itemsSnap.empty) {
                            newOrder.items = itemsSnap.docs
                                .map((d) => d.data() as any)
                                .sort((a: any, b: any) => (a?.index ?? 0) - (b?.index ?? 0));
                        }
                    } catch (e) {
                        console.warn("Failed to load subitems", e);
                    }

                    setOrder(newOrder);
                    setLoading(false);
                    setGaveUp(false);
                    if (timeout) clearTimeout(timeout);
                } else {
                    // doc 미생성/지연: timeout이 gaveUp 처리
                }
            },
            (err) => {
                console.error("Order snapshot error", err);
                // timeout이 gaveUp 처리
            }
        );

        return () => {
            if (timeout) clearTimeout(timeout);
            if (unsub) unsub();
        };
    }, [id]);

    const renderHeader = useCallback(
        () => (
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.replace("/(tabs)/myorder")} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color="#111" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{(t as any).orderDetailTitle || "Order Details"}</Text>
                <View style={{ width: 44 }} />
            </View>
        ),
        [router, t]
    );

    const renderPaymentText = () => {
        if (!order) return "";
        if (order.payment?.provider === "DEV_FREE" || order.payment?.provider === "PROMO_FREE") {
            return (t as any).payFreeDev || "Free (Dev Order)";
        }
        if (order.payment?.brand && order.payment?.last4) {
            const brand = order.payment.brand.toUpperCase();
            return `${brand} •••• ${order.payment.last4}`;
        }
        return (order as any).paymentMethod || (t as any).paymentTitle || "Payment";
    };

    // ✅ 로딩(또는 생성 대기)
    if (loading && !order) {
        return (
            <SafeAreaView style={styles.container}>
                {renderHeader()}
                <View style={styles.center}>
                    <ActivityIndicator size="large" color="#111" />
                    <Text style={{ marginTop: 12, color: "#666", fontWeight: "600" }}>
                        {(t as any).processingOrder || "Processing your order..."}
                    </Text>
                </View>
            </SafeAreaView>
        );
    }

    // ✅ grace time 이후에도 못 찾으면 Not Found
    if (!order && gaveUp) {
        return (
            <SafeAreaView style={styles.container}>
                {renderHeader()}
                <View style={styles.content}>
                    <Text style={styles.notFoundTitle}>{(t as any).orderNotFound || "Order Not Found"}</Text>
                    <Text style={styles.notFoundDesc}>
                        {(t as any).orderNotFoundDesc || "We couldn't find the order yet. Please try again in a moment."}
                    </Text>

                    <TouchableOpacity
                        style={{ marginTop: 16, alignSelf: "center", paddingVertical: 10, paddingHorizontal: 16 }}
                        onPress={() => {
                            router.replace({ pathname: "/myorder/[id]" as any, params: { id: id as string } } as any);
                        }}
                    >
                        <Text style={{ color: "#111", fontWeight: "800" }}>{(t as any).retry || "Retry"}</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    // ✅ 안전: order는 없는데 gaveUp 전이면 스피너
    if (!order) {
        return (
            <SafeAreaView style={styles.container}>
                {renderHeader()}
                <View style={styles.center}>
                    <ActivityIndicator size="large" color="#111" />
                </View>
            </SafeAreaView>
        );
    }

    const sections = [{ type: "summary" }, { type: "items" }, { type: "shipping" }, { type: "payment" }];

    return (
        <SafeAreaView style={styles.container}>
            {renderHeader()}

            <FlatList
                contentContainerStyle={styles.scrollContent}
                data={sections}
                keyExtractor={(item) => item.type}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => {
                    if (item.type === "summary") {
                        return (
                            <View style={styles.section}>
                                <View style={styles.orderSummary}>
                                    <View style={styles.summaryRowTop}>
                                        <View style={styles.orderMeta}>
                                            <Text style={styles.orderMetaLabel}>{(t as any).ordersId || "Order Code"}</Text>
                                            <Text style={styles.orderMetaValue}>
                                                #{(order as any).orderCode || (order.id as string).slice(-7).toUpperCase()}
                                            </Text>
                                        </View>
                                        <StatusBadgeRN status={order.status as any} />
                                    </View>

                                    <View style={styles.summaryRowBottom}>
                                        <Text style={styles.orderDate}>{formatDate((order as any).createdAt)}</Text>
                                        <Text style={styles.orderTotal}>฿{Number((order as any).total || 0).toFixed(2)}</Text>
                                    </View>
                                </View>
                            </View>
                        );
                    }

                    if (item.type === "items") {
                        return (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>{(t as any).itemsTitle || "Items"}</Text>

                                <View style={styles.itemGrid}>
                                    {(order.items || []).map((it: any, idx: number) => {
                                        const uri = pickCustomerPreviewUri(it);

                                        return (
                                            <TouchableOpacity key={String(it?.id || it?.index || idx)} style={styles.itemCard} onPress={() => setPreviewItem(it)}>
                                                {uri ? (
                                                    <Image source={{ uri }} style={styles.itemImg} />
                                                ) : (
                                                    <View
                                                        style={[
                                                            styles.itemImg,
                                                            { backgroundColor: "#f0f0f0", alignItems: "center", justifyContent: "center" },
                                                        ]}
                                                    >
                                                        <Ionicons name="image-outline" size={24} color="#ccc" />
                                                    </View>
                                                )}
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            </View>
                        );
                    }

                    if (item.type === "shipping") {
                        return (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>{(t as any).shippingAddressTitle || "Shipping Address"}</Text>
                                <View style={styles.detailsCard}>
                                    <DetailRow label={(t as any).fullName || "Full Name"} value={(order as any).shipping?.fullName || ""} />
                                    <DetailRow
                                        label={(t as any).addressLabel || (t as any).address1 || "Address"}
                                        value={(order as any).shipping?.address1 || ""}
                                    />
                                    {(order as any).shipping?.address2 ? (
                                        <DetailRow label={(t as any).address2Label || "Address 2"} value={(order as any).shipping?.address2 || ""} />
                                    ) : null}
                                    <DetailRow
                                        label={`${(t as any).city || "City"} / ${(t as any).state || "State"}`}
                                        value={`${(order as any).shipping?.city || ""}, ${(order as any).shipping?.state || ""}`}
                                    />
                                    <DetailRow label={(t as any).postalCode || "Zip"} value={(order as any).shipping?.postalCode || ""} />
                                    <DetailRow label={(t as any).phoneLabel || "Phone"} value={(order as any).shipping?.phone || ""} />
                                    <DetailRow label={(t as any).emailLabel || "Email"} value={(order as any).shipping?.email || ""} />
                                </View>
                            </View>
                        );
                    }

                    if (item.type === "payment") {
                        return (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>{(t as any).paymentTitle || "Payment"}</Text>
                                <View style={styles.detailsCard}>
                                    <Text style={styles.paymentText}>{renderPaymentText()}</Text>
                                    {(order as any).promo ? (
                                        <View style={styles.promoLabel}>
                                            <Ionicons name="pricetag-outline" size={12} color="#10B981" />
                                            <Text style={styles.promoText}>
                                                {" "}
                                                {(order as any).promo?.code} (-฿{Number((order as any).discount || 0).toFixed(2)})
                                            </Text>
                                        </View>
                                    ) : null}
                                </View>
                            </View>
                        );
                    }

                    return null;
                }}
            />

            <PreviewModalRN
                visible={!!previewItem}
                imageUri={previewItem ? pickCustomerPreviewUri(previewItem) : null}
                downloadUrl={null}
                onClose={() => setPreviewItem(null)}
            />
        </SafeAreaView>
    );
}

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{label}</Text>
            <Text style={styles.detailValue}>{value}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#F7F7F8" },
    content: { padding: 20 },
    header: {
        height: 52,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        backgroundColor: "#fff",
        borderBottomWidth: 1,
        borderBottomColor: "#f0f0f0",
    },
    backBtn: { padding: 4, width: 44 },
    headerTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: "#111", textAlign: "center" },
    scrollContent: { padding: 20, paddingBottom: 60 },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    section: { marginBottom: 24 },
    sectionTitle: { fontSize: 13, fontWeight: "800", marginBottom: 12, color: "#999", textTransform: "uppercase" },
    orderSummary: {
        backgroundColor: "#fff",
        padding: 20,
        borderRadius: 20,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 15,
        elevation: 2,
    },
    summaryRowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
    summaryRowBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
    orderMeta: { gap: 4 },
    orderMetaLabel: { fontSize: 11, textTransform: "uppercase", color: "#999", fontWeight: "800" },
    orderMetaValue: { fontSize: 14, fontFamily: "Courier", color: "#111", fontWeight: "700" },
    orderDate: { fontSize: 14, color: "#666", fontWeight: "600" },
    orderTotal: { fontSize: 22, fontWeight: "800", color: "#111" },
    itemGrid: { flexDirection: "row", flexWrap: "wrap", gap: GRID_SPACING },
    itemCard: {
        width: ITEM_WIDTH,
        height: ITEM_WIDTH,
        borderRadius: 12,
        overflow: "hidden",
        backgroundColor: "#fff",
        borderWidth: 1,
        borderColor: "#eee",
    },
    itemImg: { width: "100%", height: "100%" },
    detailsCard: { backgroundColor: "#fff", padding: 16, borderRadius: 20, borderWidth: 1, borderColor: "#eee" },
    detailRow: { marginBottom: 12 },
    detailLabel: { fontSize: 11, fontWeight: "700", color: "#999", textTransform: "uppercase", marginBottom: 2 },
    detailValue: { fontSize: 15, color: "#111", fontWeight: "600" },
    paymentText: { fontSize: 16, fontWeight: "700", color: "#111" },
    promoLabel: { flexDirection: "row", alignItems: "center", marginTop: 8 },
    promoText: { color: "#10B981", fontWeight: "700", fontSize: 14 },
    notFoundTitle: { fontSize: 20, fontWeight: "800", marginBottom: 8, textAlign: "center", marginTop: 40 },
    notFoundDesc: { fontSize: 14, color: "#666", textAlign: "center" },
});
