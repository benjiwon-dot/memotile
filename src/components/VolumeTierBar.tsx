// src/components/VolumeTierBar.tsx  (v5)
//
//  full  : 원가(취소선) → 할인가 + 절약액 + "지금%→다음%" 게이지(넉넉하게 채움)
//  compact : 한 줄 넛지
//  수치는 pricing.ts(computePricing) 단일 소스.

import React, { useMemo } from "react";
import { View, Text, StyleSheet, ViewStyle } from "react-native";
import {
    computePricing,
    formatPrice,
    type VolumeTier,
    type ShippingTier,
    type PromoInput,
} from "../utils/pricing";

type Props = {
    count: number;
    pricePerTile: number;
    volumeDiscounts?: VolumeTier[];
    shippingTiers?: ShippingTier[];
    freeShipThreshold?: number;
    shippingFee?: number;
    promo?: PromoInput;
    locale?: string;
    variant?: "full" | "compact";
    style?: ViewStyle;
};

const C = {
    activeBg: "#F0FBF6",
    activeBorder: "#BBEBD7",
    activeText: "#047857",
    green: "#10B981",
    greenDeep: "#059669",
    idleBg: "#F8FAFC",
    idleBorder: "#E7EBF0",
    idleText: "#64748B",
    track: "#E5E7EB",
    ink: "#0F172A",
    strike: "#94A3B8",
};

export default function VolumeTierBar({
    count,
    pricePerTile,
    volumeDiscounts = [],
    shippingTiers,
    freeShipThreshold,
    shippingFee = 0,
    promo,
    locale,
    variant = "full",
    style,
}: Props) {
    const isTh = (locale || "").toUpperCase() === "TH";

    const pricing = useMemo(
        () => computePricing({ count, pricePerTile, volumeDiscounts, shippingTiers, freeShipThreshold, shippingFee, promo }),
        [count, pricePerTile, volumeDiscounts, shippingTiers, freeShipThreshold, shippingFee, promo]
    );

    const saved = pricing.volumeDiscountAmount;
    const savedStr = formatPrice(saved, locale);
    const curPct = pricing.volumeDiscountPercent;
    const isActive = saved > 0 || pricing.isFreeShipping;

    const origTotal = pricing.subtotal;
    const discTotal = Math.max(0, Number((pricing.subtotal - pricing.volumeDiscountAmount).toFixed(2)));

    // 넛지 문구
    const nudge = useMemo(() => {
        const first = pricing.tiers[0];
        if (count === 0) {
            if (!first) return isTh ? "เลือกรูปเพื่อเริ่ม" : "Pick photos to start";
            return isTh
                ? `ซื้อ ${first.minQty} ชิ้น รับส่วนลด ${first.discountPercent}%`
                : `Buy ${first.minQty} to get ${first.discountPercent}% off`;
        }
        if (pricing.nextTier) {
            const left = pricing.qtyToNextTier;
            const nextPct = pricing.nextTier.discountPercent;
            return isTh ? `เพิ่มอีก ${left} ชิ้น → ลด ${nextPct}%` : `Add ${left} more → ${nextPct}% off`;
        }
        if (pricing.isMaxTier) {
            return isTh ? `ส่วนลดสูงสุด ${curPct}% แล้ว` : `Max ${curPct}% off unlocked`;
        }
        return isTh ? `รับส่วนลด ${curPct}% แล้ว` : `${curPct}% off applied`;
    }, [pricing, count, curPct, isTh]);

    // 배송 안내: "N개 더" 대신 "9개부터 무료"로 고정 표기 (구간마다 헷갈리지 않게)
    const shipNote = useMemo(() => {
        if (pricing.freeShipQty == null) return null;
        if (pricing.isFreeShipping) return isTh ? "ส่งฟรีแล้ว" : "Free shipping";
        return isTh ? `ส่งฟรีเมื่อซื้อ ${pricing.freeShipQty} ชิ้น` : `Free shipping on ${pricing.freeShipQty}+`;
    }, [pricing.freeShipQty, pricing.isFreeShipping, isTh]);

    // ── compact ───────────────────────────────────────────────
    if (variant === "compact") {
        const compactText = saved > 0
            ? (isTh
                ? `ลดแล้ว ${savedStr} (${curPct}%)${pricing.nextTier ? ` · เพิ่ม ${pricing.qtyToNextTier} เป็น ${pricing.nextTier.discountPercent}%` : ""}`
                : `Saved ${savedStr} (${curPct}%)${pricing.nextTier ? ` · ${pricing.qtyToNextTier} more → ${pricing.nextTier.discountPercent}%` : ""}`)
            : nudge;
        return (
            <View style={[styles.capsule, { backgroundColor: isActive ? C.activeBg : C.idleBg, borderColor: isActive ? C.activeBorder : C.idleBorder }, style]}>
                {/* 1줄: 할인/다음 구간 */}
                <Text style={[styles.capsuleText, { color: isActive ? C.activeText : C.idleText, textAlign: "center", lineHeight: 17 }]} numberOfLines={2}>
                    {compactText}
                </Text>
                {/* 2줄: 무료배송 안내 */}
                {shipNote ? (
                    <Text style={[styles.capsuleShip, { color: isActive ? C.greenDeep : C.idleText }]} numberOfLines={1}>
                        {shipNote}
                    </Text>
                ) : null}
            </View>
        );
    }

    // ── full ─────────────────────────────────────────────────
    // 게이지: "남은 수량" 기준으로 넉넉하게 채움 (어중간한 50% 느낌 제거)
    // 게이지: 항상 다음 단계로 유도 + 넉넉하게(최소 70%) — 어중간/손해 느낌 제거
    const remaining = pricing.qtyToNextTier;
    let frac = 1;
    if (pricing.nextTier) {
        if (remaining <= 1) frac = 0.9;
        else if (remaining === 2) frac = 0.82;
        else if (remaining === 3) frac = 0.74;
        else frac = 0.7;
    }

    const leftLabel = curPct > 0 ? `${curPct}%` : (isTh ? "ปกติ" : "0%");
    const rightLabel = pricing.nextTier ? `${pricing.nextTier.discountPercent}%` : (isTh ? "สูงสุด" : "Max");

    return (
        <View style={[styles.card, { backgroundColor: isActive ? C.activeBg : C.idleBg, borderColor: isActive ? C.activeBorder : C.idleBorder }, style]}>
            <View style={styles.topRow}>
                <Text style={[styles.nudge, { color: isActive ? C.activeText : C.ink }]} numberOfLines={1}>{nudge}</Text>
                {shipNote ? (
                    <Text style={[styles.ship, { color: isActive ? C.greenDeep : C.idleText }]} numberOfLines={1}>
                        {pricing.isFreeShipping ? "✓ " : ""}{shipNote}
                    </Text>
                ) : null}
            </View>

            {/* 원가 → 할인가 → 절약액 */}
            {saved > 0 && count > 0 && (
                <View style={styles.priceRow}>
                    <Text style={styles.strikePrice}>{formatPrice(origTotal, locale)}</Text>
                    <Text style={styles.arrow}>→</Text>
                    <Text style={styles.discPrice}>{formatPrice(discTotal, locale)}</Text>
                    <View style={styles.savedPill}>
                        <Text style={styles.savedPillText}>{isTh ? "ประหยัด" : "save"} {savedStr}</Text>
                    </View>
                </View>
            )}

            <View style={styles.barRow}>
                <Text style={[styles.endLabel, curPct > 0 && { color: C.greenDeep, fontWeight: "800" }]}>{leftLabel}</Text>
                <View style={styles.track}>
                    <View style={[styles.fill, { width: `${Math.round(frac * 100)}%` }]} />
                </View>
                <Text style={styles.endLabel}>{rightLabel}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    capsule: { borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center" },
    capsuleText: { fontSize: 12.5, fontWeight: "700" },
    capsuleShip: { fontSize: 11, fontWeight: "600", marginTop: 3, textAlign: "center" },

    card: { borderWidth: 1, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 16 },
    topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
    nudge: { fontSize: 14, fontWeight: "800", flexShrink: 1 },
    ship: { fontSize: 11.5, fontWeight: "600", marginLeft: 10 },

    priceRow: { flexDirection: "row", alignItems: "center", marginBottom: 12, flexWrap: "wrap" },
    strikePrice: { fontSize: 14, fontWeight: "600", color: C.strike, textDecorationLine: "line-through" },
    arrow: { fontSize: 14, color: C.strike, marginHorizontal: 6 },
    discPrice: { fontSize: 20, fontWeight: "900", color: C.activeText },
    savedPill: { marginLeft: 8, backgroundColor: C.green, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    savedPillText: { fontSize: 11.5, fontWeight: "800", color: "#fff" },

    barRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    track: { flex: 1, height: 7, borderRadius: 4, backgroundColor: C.track, overflow: "hidden" },
    fill: { height: "100%", borderRadius: 4, backgroundColor: C.green },
    endLabel: { fontSize: 11.5, fontWeight: "700", color: "#94A3B8", minWidth: 38, textAlign: "center" },
});
