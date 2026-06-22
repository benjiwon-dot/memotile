// src/components/BundlePricingTable.tsx
//
// 홈 화면용 "묶음 할인 가격표". config/prices(volumeDiscounts/shippingTiers) 단일 소스에서 자동 생성.
// 정책 바꾸면(파이어베이스) 홈 표도 자동으로 바뀜. 태국어/영어.

import React, { useEffect, useState, useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { doc, getDoc, getFirestore } from "firebase/firestore";
import { colors } from "../theme/colors";
import { getCurrencySymbol, type VolumeTier, type ShippingTier } from "../utils/pricing";
import { useLanguage } from "../context/LanguageContext";

const DEFAULTS = {
    price_thb: 200,
    price_usd: 5.71,
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

type Row = { range: string; pct: number; perTile: number; free: boolean; popular: boolean };

export default function BundlePricingTable() {
    const { t, locale } = useLanguage();
    const isTh = (locale || "").toUpperCase() === "TH";
    const symbol = getCurrencySymbol(locale);

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
            } catch (e) { /* 기본값 사용 */ }
        })();
        return () => { alive = false; };
    }, [isTh]);

    const freeShipQty = useMemo(() => shipping.find((s) => s.fee === 0)?.minQty ?? null, [shipping]);

    const rows = useMemo<Row[]>(() => {
        const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
        const out: Row[] = [];

        // 1구간 (할인 전)
        const firstMin = sorted[0]?.minQty ?? 1;
        out.push({
            range: firstMin > 1 ? `1–${firstMin - 1}` : "1",
            pct: 0,
            perTile: price,
            free: freeShipQty != null ? 1 >= freeShipQty : false,
            popular: false,
        });

        sorted.forEach((tier, i) => {
            const next = sorted[i + 1];
            const range = next ? `${tier.minQty}–${next.minQty - 1}` : `${tier.minQty}+`;
            out.push({
                range,
                pct: tier.discountPercent,
                perTile: Number((price * (1 - tier.discountPercent / 100)).toFixed(2)),
                free: freeShipQty != null ? tier.minQty >= freeShipQty : false,
                popular: tier.minQty === 9, // '999฿ + 무료배송' 마법 구간
            });
        });
        return out;
    }, [tiers, price, freeShipQty]);

    return (
        <View style={styles.wrap}>
            <Text style={styles.title}>
                {isTh ? "ยิ่งซื้อเยอะ ยิ่งถูก" : "Buy more, save more"}
            </Text>
            <Text style={styles.sub}>
                {isTh ? "ส่วนลดอัตโนมัติตามจำนวน + ส่งฟรีเมื่อครบกำหนด" : "Automatic volume discounts + free shipping on bigger sets"}
            </Text>

            <View style={styles.card}>
                <View style={[styles.row, styles.headRow]}>
                    <Text style={[styles.cell, styles.colQty, styles.headText]}>{isTh ? "จำนวน" : "Tiles"}</Text>
                    <Text style={[styles.cell, styles.colPct, styles.headText]}>{isTh ? "ส่วนลด" : "Off"}</Text>
                    <Text style={[styles.cell, styles.colPer, styles.headText]}>{isTh ? "ต่อชิ้น" : "Per tile"}</Text>
                    <Text style={[styles.cell, styles.colShip, styles.headText]}>{isTh ? "ส่ง" : "Ship"}</Text>
                </View>

                {rows.map((r, i) => (
                    <View key={i} style={[styles.row, r.popular && styles.popularRow, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
                        <View style={[styles.cell, styles.colQty, { flexDirection: "row", alignItems: "center", gap: 6 }]}>
                            <Text style={[styles.qtyText, r.popular && styles.popularText]}>{r.range}</Text>
                            {r.popular && (
                                <View style={styles.badge}><Text style={styles.badgeText}>{isTh ? "ฮิต" : "Best"}</Text></View>
                            )}
                        </View>
                        <Text style={[styles.cell, styles.colPct, r.pct > 0 ? styles.pctOn : styles.pctOff]}>
                            {r.pct > 0 ? `${r.pct}%` : "—"}
                        </Text>
                        <Text style={[styles.cell, styles.colPer, styles.perText]}>
                            {symbol}{r.perTile.toFixed(isTh ? 0 : 2)}
                        </Text>
                        <Text style={[styles.cell, styles.colShip, r.free ? styles.freeText : styles.payText]}>
                            {r.free ? (isTh ? "ฟรี" : "Free") : (isTh ? "เสีย" : "Paid")}
                        </Text>
                    </View>
                ))}
            </View>

            <Text style={styles.note}>
                {isTh
                    ? `* ส่งฟรีเมื่อซื้อตั้งแต่ ${freeShipQty ?? "-"} ชิ้นขึ้นไป`
                    : `* Free shipping on ${freeShipQty ?? "-"}+ tiles`}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { paddingHorizontal: 24, paddingVertical: 8 },
    title: { fontSize: 22, fontWeight: "800", color: colors.ink, textAlign: "center", marginBottom: 6 },
    sub: { fontSize: 13, color: colors.textMuted || "#6B7280", textAlign: "center", marginBottom: 18 },

    card: { borderWidth: 1, borderColor: "#EEF0F3", borderRadius: 18, overflow: "hidden", backgroundColor: "#fff" },
    row: { flexDirection: "row", alignItems: "center", paddingVertical: 13, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: "#F1F3F6" },
    headRow: { backgroundColor: "#FAFBFC", paddingVertical: 10 },
    headText: { fontSize: 11.5, fontWeight: "700", color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.4 },
    popularRow: { backgroundColor: "#F0FBF6" },

    cell: { fontSize: 14 },
    colQty: { flex: 1.5 },
    colPct: { flex: 1, textAlign: "center" },
    colPer: { flex: 1.2, textAlign: "center" },
    colShip: { flex: 0.9, textAlign: "right" },

    qtyText: { fontSize: 14.5, fontWeight: "700", color: colors.ink },
    popularText: { color: "#047857" },
    badge: { backgroundColor: "#10B981", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
    badgeText: { color: "#fff", fontSize: 9.5, fontWeight: "800" },

    pctOn: { color: "#059669", fontWeight: "800" },
    pctOff: { color: "#B6BDC7", fontWeight: "600" },
    perText: { color: colors.ink, fontWeight: "700" },
    freeText: { color: "#059669", fontWeight: "800" },
    payText: { color: "#9CA3AF", fontWeight: "600" },

    note: { fontSize: 11.5, color: "#9CA3AF", textAlign: "center", marginTop: 12 },
});
