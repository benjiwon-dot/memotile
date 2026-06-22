// src/components/VolumeTierBar.tsx  (v4 — 세련/깔끔)
//
//  full  : "지금 구간 → 다음 구간"만 얇은 바 하나로 표현 (5개 마커 게이지 제거)
//  compact : 한 줄 넛지
//  문구: "몇% → 몇%" 직관형 + 무료배송 보조줄. 수치는 pricing.ts 단일 소스.

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
            if (saved > 0) {
                return isTh
                    ? `ลดแล้ว ${savedStr} · เพิ่ม ${left} ชิ้น เป็น ${nextPct}%`
                    : `Saved ${savedStr} · add ${left} for ${nextPct}%`;
            }
            return isTh ? `เพิ่มอีก ${left} ชิ้น ลด ${nextPct}%` : `Add ${left} more for ${nextPct}% off`;
        }
        if (pricing.isMaxTier) {
            return isTh ? `ส่วนลดสูงสุด ${curPct}% · ประหยัด ${savedStr}` : `Max ${curPct}% off · saved ${savedStr}`;
        }
        return isTh ? `ลดแล้ว ${savedStr} (${curPct}%)` : `Saved ${savedStr} (${curPct}%)`;
    }, [pricing, count, saved, savedStr, curPct, isTh]);

    const shipNote = useMemo(() => {
        if (pricing.freeShipQty == null) return null;
        if (pricing.isFreeShipping) return isTh ? "ส่งฟรีแล้ว" : "Free shipping unlocked";
        return isTh ? `อีก ${pricing.qtyToFreeShipping} ชิ้น ส่งฟรี` : `${pricing.qtyToFreeShipping} more for free shipping`;
    }, [pricing.freeShipQty, pricing.isFreeShipping, pricing.qtyToFreeShipping, isTh]);

    // ── compact ───────────────────────────────────────────────
    if (variant === "compact") {
        return (
            <View style={[styles.capsule, { backgroundColor: isActive ? C.activeBg : C.idleBg, borderColor: isActive ? C.activeBorder : C.idleBorder }, style]}>
                <Text style={[styles.capsuleText, { color: isActive ? C.activeText : C.idleText }]} numberOfLines={1}>
                    {nudge}{shipNote ? `  ·  ${shipNote}` : ""}
                </Text>
            </View>
        );
    }

    // ── full (지금 구간 → 다음 구간, 얇은 바 1개) ─────────────────
    // 게이지는 "남은 수량" 기준 동기부여 곡선 (구매욕 ↑): 적게 남을수록 거의 다 찬 느낌.
    //  남음 1개 → 75%, 2개 → 66%, 3개 → 55% ... 최소 32%
    const remaining = pricing.qtyToNextTier;
    let frac = 1;
    if (pricing.nextTier) {
        if (remaining <= 1) frac = 0.75;
        else if (remaining === 2) frac = 0.66;
        else if (remaining === 3) frac = 0.55;
        else if (remaining === 4) frac = 0.46;
        else if (remaining === 5) frac = 0.40;
        else frac = 0.32;
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
    capsuleText: { fontSize: 13, fontWeight: "700" },

    card: { borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16 },
    topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
    nudge: { fontSize: 14, fontWeight: "800", flexShrink: 1 },
    ship: { fontSize: 11.5, fontWeight: "600", marginLeft: 10 },

    barRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: C.track, overflow: "hidden" },
    fill: { height: "100%", borderRadius: 3, backgroundColor: C.green },
    endLabel: { fontSize: 11.5, fontWeight: "700", color: "#94A3B8", minWidth: 34, textAlign: "center" },
});
