// src/components/BundlePricingTable.tsx
//
// 홈 "묶음 세트" 가격표. config/prices(volumeDiscounts/shippingTiers) 단일 소스에서 자동 생성.
// 1·3·6·9·12·15 세트를 한눈에 보이게, 6장 세트를 주력(가장 인기)으로 강조.

import React, { useEffect, useState, useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { doc, getDoc, getFirestore } from "firebase/firestore";
import { colors } from "../theme/colors";
import { computePricing, type VolumeTier, type ShippingTier } from "../utils/pricing";
import { useLanguage } from "../context/LanguageContext";

const DEFAULTS = {
    price_thb: 200,
    price_usd: 6.1,
    volumeDiscounts: [
        { minQty: 3, discountPercent: 25 },
        { minQty: 6, discountPercent: 37.5 },
        { minQty: 9, discountPercent: 44.5 },
        { minQty: 12, discountPercent: 50.5 },
        { minQty: 15, discountPercent: 60 },
    ] as VolumeTier[],
    shippingTiers: [
        { minQty: 1, fee: 38 },
        { minQty: 5, fee: 41 },
        { minQty: 9, fee: 0 },
    ] as ShippingTier[],
};

// 보여줄 묶음 세트 + 주력
const BUNDLES = [1, 3, 6, 9, 12, 15];
const POPULAR_QTY = 6;

export default function BundlePricingTable() {
    const { locale } = useLanguage();
    const isTh = (locale || "").toUpperCase() === "TH";

    const [price, setPrice] = useState<number>(isTh ? DEFAULTS.price_thb : DEFAULTS.price_usd);
    const [tiers, setTiers] = useState<VolumeTier[]>(DEFAULTS.volumeDiscounts);
    const [shipping, setShipping] = useState<ShippingTier[]>(DEFAULTS.shippingTiers);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const snap = await getDoc(doc(getFirestore(), "config", "prices"));
                if (snap.exists() && alive) {
                    const d = snap.data();
                    if (d?.price_thb != null || d?.price_usd != null) setPrice(isTh ? d.price_thb : d.price_usd);
                    if (Array.isArray(d?.volumeDiscounts)) setTiers([...d.volumeDiscounts].sort((a, b) => a.minQty - b.minQty));
                    if (Array.isArray(d?.shippingTiers)) setShipping([...d.shippingTiers].sort((a, b) => a.minQty - b.minQty));
                }
            } catch { /* 기본값 사용 */ }
        })();
        return () => { alive = false; };
    }, [isTh]);

    const fmt = (n: number) => (isTh ? `฿${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`);

    const rows = useMemo(() => {
        return BUNDLES.map((qty) => {
            const p = computePricing({ count: qty, pricePerTile: price, volumeDiscounts: tiers, shippingTiers: shipping });
            const bundlePrice = p.effectivePricePerTile * qty; // 상품가(배송 제외)
            return {
                qty,
                bundlePrice,
                perTile: p.effectivePricePerTile,
                pct: p.volumeDiscountPercent,
                free: p.isFreeShipping,
                popular: qty === POPULAR_QTY,
            };
        });
    }, [price, tiers, shipping]);

    const tilesWord = isTh ? "ชิ้น" : "tiles";

    return (
        <View style={styles.wrap}>
            <Text style={styles.title}>{isTh ? "ยิ่งซื้อเยอะ ยิ่งคุ้ม" : "Buy more, save more"}</Text>
            <Text style={styles.sub}>
                {isTh ? "ราคาต่อชิ้นถูกลงเรื่อยๆ + ส่งฟรีตั้งแต่ 9 ชิ้น" : "Lower price per tile as you add more · free shipping on 9+"}
            </Text>

            <View style={{ gap: 10 }}>
                {rows.map((r) => (
                    <View
                        key={r.qty}
                        style={[styles.card, r.popular && styles.cardPopular]}
                    >
                        {r.popular && (
                            <View style={styles.ribbon}>
                                <Feather name="star" size={11} color="#fff" />
                                <Text style={styles.ribbonText}>{isTh ? "ยอดนิยม" : "Most popular"}</Text>
                            </View>
                        )}

                        {/* 왼쪽: 수량 묶음 */}
                        <View style={styles.left}>
                            <Text style={[styles.qtyNum, r.popular && { color: "#047857" }]}>{r.qty}</Text>
                            <Text style={styles.qtyLabel}>{tilesWord}</Text>
                        </View>

                        {/* 가운데: 할인 + 장당 */}
                        <View style={styles.mid}>
                            {r.pct > 0 ? (
                                <View style={[styles.discBadge, r.popular && { backgroundColor: "#10B981" }]}>
                                    <Text style={[styles.discText, r.popular && { color: "#fff" }]}>
                                        {isTh ? "ลด " : ""}{r.pct}%{isTh ? "" : " OFF"}
                                    </Text>
                                </View>
                            ) : (
                                <Text style={styles.regularText}>{isTh ? "ราคาปกติ" : "Regular"}</Text>
                            )}
                            <Text style={styles.perTile}>{fmt(r.perTile)} / {isTh ? "ชิ้น" : "tile"}</Text>
                        </View>

                        {/* 오른쪽: 세트 가격 + 배송 */}
                        <View style={styles.right}>
                            <Text style={[styles.price, r.popular && { color: "#047857" }]}>{fmt(r.bundlePrice)}</Text>
                            <View style={styles.shipRow}>
                                {r.free ? (
                                    <>
                                        <Feather name="truck" size={11} color="#059669" />
                                        <Text style={styles.freeText}>{isTh ? "ส่งฟรี" : "Free ship"}</Text>
                                    </>
                                ) : (
                                    <Text style={styles.paidText}>{isTh ? "+ ค่าส่ง" : "+ shipping"}</Text>
                                )}
                            </View>
                        </View>
                    </View>
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { paddingHorizontal: 24, paddingVertical: 8 },
    title: { fontSize: 24, fontWeight: "800", color: colors.ink, textAlign: "center", marginBottom: 6 },
    sub: { fontSize: 13, color: colors.textMuted || "#6B7280", textAlign: "center", marginBottom: 20 },

    card: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#fff",
        borderRadius: 18,
        borderWidth: 1,
        borderColor: "#EEF0F3",
        paddingVertical: 16,
        paddingHorizontal: 18,
    },
    cardPopular: {
        borderColor: "#10B981",
        borderWidth: 2,
        backgroundColor: "#F0FBF6",
        paddingTop: 22, // 리본 자리
    },
    ribbon: {
        position: "absolute",
        top: -1,
        right: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        backgroundColor: "#10B981",
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderBottomLeftRadius: 10,
        borderBottomRightRadius: 10,
    },
    ribbonText: { color: "#fff", fontSize: 10, fontWeight: "800" },

    left: { width: 58, alignItems: "center", justifyContent: "center" },
    qtyNum: { fontSize: 30, fontWeight: "900", color: colors.ink, lineHeight: 32 },
    qtyLabel: { fontSize: 11, color: "#9CA3AF", fontWeight: "700", marginTop: 2 },

    mid: { flex: 1, paddingLeft: 16 },
    discBadge: { alignSelf: "flex-start", backgroundColor: "#FEF3C7", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginBottom: 6 },
    discText: { fontSize: 13, fontWeight: "800", color: "#b8860b" },
    regularText: { fontSize: 13, fontWeight: "700", color: "#9CA3AF", marginBottom: 6 },
    perTile: { fontSize: 12, color: "#6B7280", fontWeight: "600" },

    right: { alignItems: "flex-end", minWidth: 90 },
    price: { fontSize: 20, fontWeight: "900", color: colors.ink },
    shipRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
    freeText: { fontSize: 11.5, fontWeight: "800", color: "#059669" },
    paidText: { fontSize: 11.5, fontWeight: "600", color: "#9CA3AF" },
});
