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
    Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { doc, onSnapshot, getDocs, collection } from "firebase/firestore";
import { ref, getDownloadURL } from "firebase/storage";
import { db, auth, storage } from "../../src/lib/firebase";
import { OrderDoc } from "../../src/types/order";
import { useLanguage } from "../../src/context/LanguageContext";
import StatusBadgeRN from "../../src/components/orders/StatusBadgeRN";
import PreviewModalRN from "../../src/components/orders/PreviewModalRN";
import { OrderPhotobookViewer } from "../../src/components/orders/OrderPhotobookViewer";

const { width } = Dimensions.get("window");
const GRID_SPACING = 12;
const ITEM_WIDTH = (width - 40 - GRID_SPACING * 2) / 3;

const NOT_FOUND_GRACE_MS = 12000;

function pickCustomerPreviewUri(it: any): string | null {
    const uri =
        it?.assets?.previewUrl ||
        it?.assets?.previewUri ||
        it?.output?.previewUri ||
        it?.previewUrl ||
        it?.previewUri ||
        it?.assets?.viewUrl ||
        it?.assets?.viewUri ||
        it?.output?.viewUri ||
        it?.assets?.sourceUrl ||
        it?.sourceUrl ||
        it?.downloadUrl ||
        it?.uri ||
        it?.originalUri ||
        null;

    if (typeof uri === "string" && /print/i.test(uri)) {
        return (
            it?.assets?.previewUrl ||
            it?.assets?.previewUri ||
            it?.output?.previewUri ||
            it?.previewUrl ||
            it?.previewUri ||
            it?.assets?.viewUrl ||
            it?.assets?.viewUri ||
            it?.output?.viewUri ||
            it?.assets?.sourceUrl ||
            it?.sourceUrl ||
            it?.uri ||
            null
        );
    }
    return typeof uri === "string" && uri.length > 0 ? uri : null;
}

export default function OrderDetailScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    // ✨ 불필요한 setLocale을 가져오지 않습니다. 오직 현재 설정된 언어만 읽어옵니다!
    const { t, locale } = useLanguage() as any;

    const [order, setOrder] = useState<OrderDoc | null>(null);
    const [loading, setLoading] = useState(true);

    const [isAuthLoading, setIsAuthLoading] = useState(true);
    const [user, setUser] = useState<any>(null);

    const [gaveUp, setGaveUp] = useState(false);
    const [previewItem, setPreviewItem] = useState<any | null>(null);
    const [pbViewerOpen, setPbViewerOpen] = useState(false);
    const [pbCoverUrl, setPbCoverUrl] = useState<string | null>(null);

    const aliveRef = useRef(true);

    useEffect(() => {
        aliveRef.current = true;
        const unsubAuth = auth.onAuthStateChanged((currentUser) => {
            if (!aliveRef.current) return;
            setUser(currentUser);
            setIsAuthLoading(false);
        });

        return () => {
            aliveRef.current = false;
            unsubAuth();
        };
    }, []);

    useEffect(() => {
        if (isAuthLoading || !user || !id) return;

        setLoading(true);
        setGaveUp(false);
        setOrder(null);

        let unsub: (() => void) | null = null;
        let timeout: any = null;

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

                    // 🚨 범인 검거 완료: 기존에 있던 setLocale(newOrder.locale) 코드를 완전히 삭제했습니다!
                    // 이제 상세페이지를 열어도 유저가 설정한 언어가 제멋대로 바뀌지 않습니다.

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
                }
            },
            (err) => {
                console.error("Order snapshot error", err);
            }
        );

        return () => {
            if (timeout) clearTimeout(timeout);
            if (unsub) unsub();
        };
    }, [id, user, isAuthLoading]);

    // 📕 포토북 표지 URL — 가벼운 캐시본 우선(빠른 로딩): 서버 렌더 크롭표지(600px) → 원본 썸네일 폴백. 큰 원본은 로드 안 함.
    useEffect(() => {
        const pb = (order as any)?.photobook;
        if (!pb) { setPbCoverUrl(null); return; }
        const primary = pb?.coverRenderPath || pb?.coverThumbPath;
        if (!primary) { setPbCoverUrl(null); return; }
        let alive = true;
        getDownloadURL(ref(storage, primary))
            .then((u) => { if (alive) setPbCoverUrl(u); })
            .catch(() => {
                if (!pb?.coverThumbPath || primary === pb.coverThumbPath) { if (alive) setPbCoverUrl(null); return; }
                getDownloadURL(ref(storage, pb.coverThumbPath)).then((u) => { if (alive) setPbCoverUrl(u); }).catch(() => { if (alive) setPbCoverUrl(null); });
            });
        return () => { alive = false; };
    }, [order]);

    // ✨ 날짜 포맷 함수 (다국어 지원)
    const getFormattedDate = (dateVal: any) => {
        if (!dateVal) return "";
        const dateObj = dateVal.toDate ? dateVal.toDate() : new Date(dateVal);
        return dateObj.toLocaleDateString(locale === 'TH' ? 'th-TH' : 'en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    const renderHeader = useCallback(
        () => (
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.replace("/(tabs)/myorder")} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color="#FF7E66" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>
                    {t.orderDetailTitle || (locale === 'TH' ? "รายละเอียดคำสั่งซื้อ" : "Order Details")}
                </Text>
                <View style={{ width: 44 }} />
            </View>
        ),
        [router, t, locale]
    );

    const renderPaymentText = () => {
        if (!order) return "";
        if (order.payment?.provider === "DEV_FREE" || order.payment?.provider === "PROMO_FREE") {
            return t.payFreeDev || (locale === 'TH' ? "ฟรี (ทดสอบระบบ)" : "Free (Dev Order)");
        }
        if (order.payment?.brand && order.payment?.last4) {
            const brand = order.payment.brand.toUpperCase();
            return `${brand} •••• ${order.payment.last4}`;
        }
        return (order as any).paymentMethod || t.paymentTitle || (locale === 'TH' ? "การชำระเงิน" : "Payment");
    };

    if (isAuthLoading) {
        return (
            <SafeAreaView style={styles.container}>
                {renderHeader()}
                <View style={styles.center}>
                    <ActivityIndicator size="large" color="#FF7E66" />
                </View>
            </SafeAreaView>
        );
    }

    if (!user) {
        return (
            <SafeAreaView style={styles.container}>
                {renderHeader()}
                <View style={styles.content}>
                    <Text style={styles.notFoundTitle}>{locale === 'TH' ? "กรุณาเข้าสู่ระบบ" : "Please Log In"}</Text>
                    <Text style={styles.notFoundDesc}>{locale === 'TH' ? "คุณต้องเข้าสู่ระบบเพื่อดูรายละเอียดคำสั่งซื้อ" : "You need to be logged in to view order details."}</Text>
                    <TouchableOpacity
                        style={{ marginTop: 16, alignSelf: "center", paddingVertical: 10, paddingHorizontal: 16 }}
                        onPress={() => router.replace("/auth/email")}
                    >
                        <Text style={{ color: "#3D2B26", fontWeight: "800" }}>{locale === 'TH' ? "ไปหน้าเข้าสู่ระบบ" : "Go to Login"}</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    if (loading && !order) {
        return (
            <SafeAreaView style={styles.container}>
                {renderHeader()}
                <View style={styles.center}>
                    <ActivityIndicator size="large" color="#FF7E66" />
                    <Text style={{ marginTop: 12, color: "#8C7B73", fontWeight: "600" }}>
                        {t.processingOrder || (locale === 'TH' ? "กำลังโหลดข้อมูล..." : "Processing your order...")}
                    </Text>
                </View>
            </SafeAreaView>
        );
    }

    if (!order && gaveUp) {
        return (
            <SafeAreaView style={styles.container}>
                {renderHeader()}
                <View style={styles.content}>
                    <Text style={styles.notFoundTitle}>{t.orderNotFound || (locale === 'TH' ? "ไม่พบคำสั่งซื้อ" : "Order Not Found")}</Text>
                    <Text style={styles.notFoundDesc}>
                        {t.orderNotFoundDesc || (locale === 'TH' ? "เรายังไม่พบคำสั่งซื้อนี้ โปรดลองอีกครั้ง" : "We couldn't find the order yet. Please try again in a moment.")}
                    </Text>
                    <TouchableOpacity
                        style={{ marginTop: 16, alignSelf: "center", paddingVertical: 10, paddingHorizontal: 16 }}
                        onPress={() => {
                            router.replace({ pathname: "/myorder/[id]" as any, params: { id: id as string } } as any);
                        }}
                    >
                        <Text style={{ color: "#3D2B26", fontWeight: "800" }}>{t.retry || (locale === 'TH' ? "ลองใหม่" : "Retry")}</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    if (!order) {
        return (
            <SafeAreaView style={styles.container}>
                {renderHeader()}
                <View style={styles.center}>
                    <ActivityIndicator size="large" color="#FF7E66" />
                </View>
            </SafeAreaView>
        );
    }

    const currencySymbol = (order as any).currency === "USD" ? "$" : "฿";
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
                        const status = (order as any).status;
                        const trackingNumber = (order as any).trackingNumber;
                        const isShipped = status === 'shipping' || status === 'delivered';

                        return (
                            <View style={styles.section}>
                                {isShipped && (
                                    <View style={styles.shippingBanner}>
                                        <Ionicons name="gift-outline" size={24} color="#fff" />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.shippingBannerTitle}>
                                                {t.packageSent || (locale === 'TH' ? "พัสดุของคุณถูกจัดส่งแล้ว!" : "Your package is on the way!")}
                                            </Text>
                                            {trackingNumber && (
                                                <Text style={styles.shippingBannerText}>
                                                    {t.trackingLabel || (locale === 'TH' ? "หมายเลขติดตาม" : "Tracking")}: {trackingNumber}
                                                </Text>
                                            )}
                                        </View>
                                    </View>
                                )}

                                <View style={styles.orderSummary}>
                                    <View style={styles.summaryRowTop}>
                                        <View style={styles.orderMeta}>
                                            <Text style={styles.orderMetaLabel}>{t.ordersId || (locale === 'TH' ? "เลขที่คำสั่งซื้อ" : "Order Code")}</Text>
                                            <Text style={styles.orderMetaValue}>
                                                #{(order as any).orderCode || (order.id as string).slice(-7).toUpperCase()}
                                            </Text>
                                        </View>
                                        <StatusBadgeRN status={order.status as any} />
                                    </View>

                                    <View style={styles.summaryRowBottom}>
                                        <Text style={styles.orderDate}>{getFormattedDate((order as any).createdAt)}</Text>
                                        <Text style={styles.orderTotal}>
                                            {currencySymbol}{Number((order as any).total || 0).toFixed(2)}
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        );
                    }

                    if (item.type === "items") {
                        // 📕 포토북: 사진 나열 대신 표지 1장 → 탭하면 펼침면 뷰어
                        if ((order as any).productType === "photobook") {
                            const frozen = (order as any)?.photobook?.frozen;
                            return (
                                <View style={styles.section}>
                                    <Text style={styles.sectionTitle}>{locale === 'TH' ? "สมุดภาพ" : (locale === 'EN' ? "Photobook" : "포토북")}</Text>
                                    <TouchableOpacity activeOpacity={0.85} disabled={!frozen} onPress={() => setPbViewerOpen(true)} style={styles.pbCoverCard}>
                                        {pbCoverUrl ? (
                                            <Image source={{ uri: pbCoverUrl }} style={styles.pbCoverImg} resizeMode="cover" />
                                        ) : (
                                            <View style={[styles.pbCoverImg, { backgroundColor: "#f0f0f0", alignItems: "center", justifyContent: "center" }]}>
                                                <Ionicons name="book-outline" size={30} color="#c9b8a8" />
                                            </View>
                                        )}
                                        <View style={styles.pbCoverOverlay}>
                                            <Ionicons name="albums" size={18} color="#fff" />
                                            <Text style={styles.pbCoverOverlayText}>
                                                {frozen ? (locale === 'TH' ? "แตะเพื่อดูตัวอย่าง" : (locale === 'EN' ? "Tap to preview" : "탭하여 미리보기")) : (locale === 'TH' ? "กำลังเตรียม..." : "준비 중...")}
                                            </Text>
                                        </View>
                                    </TouchableOpacity>
                                </View>
                            );
                        }
                        return (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>{t.itemsTitle || (locale === 'TH' ? "รายการสินค้า" : "Items")}</Text>
                                <View style={styles.itemGrid}>
                                    {(order.items || []).map((it: any, idx: number) => {
                                        const uri = pickCustomerPreviewUri(it);
                                        return (
                                            <TouchableOpacity key={String(it?.id || it?.index || idx)} style={styles.itemCard} onPress={() => setPreviewItem(it)}>
                                                {uri ? (
                                                    <Image source={{ uri }} style={styles.itemImg} />
                                                ) : (
                                                    <View style={[styles.itemImg, { backgroundColor: "#f0f0f0", alignItems: "center", justifyContent: "center" }]}>
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
                                <Text style={styles.sectionTitle}>{t.shippingAddressTitle || (locale === 'TH' ? "ที่อยู่จัดส่ง" : "Shipping Address")}</Text>
                                <View style={styles.detailsCard}>
                                    {(order as any).trackingNumber ? (
                                        <View style={styles.trackingRow}>
                                            <Text style={styles.trackingLabel}>
                                                📦 {t.trackingNumberLabel || (locale === 'TH' ? "หมายเลขติดตาม" : "TRACKING NUMBER")}
                                            </Text>
                                            <Text style={styles.trackingValue} selectable>
                                                {(order as any).trackingNumber}
                                            </Text>
                                        </View>
                                    ) : null}

                                    <DetailRow label={t.fullName || (locale === 'TH' ? "ชื่อเต็ม" : "Full Name")} value={(order as any).shipping?.fullName || ""} />
                                    <DetailRow
                                        label={t.addressLabel || t.address1 || (locale === 'TH' ? "ที่อยู่" : "Address")}
                                        value={(order as any).shipping?.address1 || ""}
                                    />
                                    {(order as any).shipping?.address2 ? (
                                        <DetailRow label={t.address2Label || (locale === 'TH' ? "ที่อยู่ 2" : "Address 2")} value={(order as any).shipping?.address2 || ""} />
                                    ) : null}
                                    <DetailRow
                                        label={`${t.city || (locale === 'TH' ? "เมือง" : "City")} / ${t.state || (locale === 'TH' ? "รัฐ/จังหวัด" : "State")}`}
                                        value={`${(order as any).shipping?.city || ""}, ${(order as any).shipping?.state || ""}`}
                                    />
                                    <DetailRow label={t.postalCode || (locale === 'TH' ? "รหัสไปรษณีย์" : "Zip")} value={(order as any).shipping?.postalCode || ""} />
                                    <DetailRow label={t.phoneLabel || (locale === 'TH' ? "โทรศัพท์" : "Phone")} value={(order as any).shipping?.phone || ""} />
                                </View>
                            </View>
                        );
                    }

                    if (item.type === "payment") {
                        return (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>{t.paymentTitle || (locale === 'TH' ? "การชำระเงิน" : "Payment")}</Text>
                                <View style={styles.detailsCard}>
                                    <Text style={styles.paymentText}>{renderPaymentText()}</Text>
                                    {(order as any).promo ? (
                                        <View style={styles.promoLabel}>
                                            <Ionicons name="pricetag-outline" size={12} color="#10B981" />
                                            <Text style={styles.promoText}>
                                                {" "}
                                                {(order as any).promo?.code} (-{currencySymbol}{Number((order as any).discount || 0).toFixed(2)})
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

            <OrderPhotobookViewer
                visible={pbViewerOpen}
                onClose={() => setPbViewerOpen(false)}
                frozen={(order as any)?.photobook?.frozen}
                // 뷰어는 미드해상도 preview 우선(빠름), 없으면 원본
                originalsBasePath={(order as any)?.photobook?.previewBasePath || (order as any)?.photobook?.originalsBasePath}
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
    container: { flex: 1, backgroundColor: "#FFF8F4" },
    content: { padding: 20 },
    header: { height: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#F2E5DC" },
    backBtn: { padding: 4, width: 44 },
    headerTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: "#3D2B26", textAlign: "center" },
    scrollContent: { padding: 20, paddingBottom: 60 },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    section: { marginBottom: 24 },
    sectionTitle: { fontSize: 13, fontWeight: "800", marginBottom: 12, color: "#B8A79E", textTransform: "uppercase" },
    orderSummary: { backgroundColor: "#fff", padding: 20, borderRadius: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 15, elevation: 2 },
    summaryRowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
    summaryRowBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
    orderMeta: { gap: 4 },
    orderMetaLabel: { fontSize: 11, textTransform: "uppercase", color: "#B8A79E", fontWeight: "800" },
    orderMetaValue: { fontSize: 14, fontFamily: "Courier", color: "#3D2B26", fontWeight: "700" },
    orderDate: { fontSize: 14, color: "#8C7B73", fontWeight: "600" },
    orderTotal: { fontSize: 22, fontWeight: "800", color: "#3D2B26" },
    itemGrid: { flexDirection: "row", flexWrap: "wrap", gap: GRID_SPACING },
    pbCoverCard: { width: "100%", aspectRatio: 27.9 / 21.5, borderRadius: 14, overflow: "hidden", backgroundColor: "#faf7f2", borderWidth: 1, borderColor: "#F2E5DC" },
    pbCoverImg: { width: "100%", height: "100%" },
    pbCoverOverlay: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, backgroundColor: "rgba(20,16,14,0.42)" },
    pbCoverOverlayText: { color: "#fff", fontWeight: "800", fontSize: 14 },
    itemCard: { width: ITEM_WIDTH, height: ITEM_WIDTH, borderRadius: 12, overflow: "hidden", backgroundColor: "#fff", borderWidth: 1, borderColor: "#F2E5DC" },
    itemImg: { width: "100%", height: "100%" },
    detailsCard: { backgroundColor: "#fff", padding: 16, borderRadius: 20, borderWidth: 1, borderColor: "#F2E5DC" },
    detailRow: { marginBottom: 12 },
    detailLabel: { fontSize: 11, fontWeight: "700", color: "#B8A79E", textTransform: "uppercase", marginBottom: 2 },
    detailValue: { fontSize: 15, color: "#3D2B26", fontWeight: "600" },
    paymentText: { fontSize: 16, fontWeight: "700", color: "#3D2B26" },
    promoLabel: { flexDirection: "row", alignItems: "center", marginTop: 8 },
    promoText: { color: "#10B981", fontWeight: "700", fontSize: 14 },
    notFoundTitle: { fontSize: 20, fontWeight: "800", marginBottom: 8, textAlign: "center", marginTop: 40 },
    notFoundDesc: { fontSize: 14, color: "#8C7B73", textAlign: "center" },
    shippingBanner: { backgroundColor: "#10B981", borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20, shadowColor: "#10B981", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
    shippingBannerTitle: { color: "#fff", fontSize: 16, fontWeight: "800", marginBottom: 2 },
    shippingBannerText: { color: "rgba(255,255,255,0.9)", fontSize: 13, fontWeight: "600", fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
    trackingRow: { borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 12, marginBottom: 12 },
    trackingLabel: { fontSize: 11, fontWeight: "700", color: '#10B981', textTransform: "uppercase", marginBottom: 2 },
    trackingValue: { fontSize: 18, color: '#10B981', fontWeight: "700" },
});