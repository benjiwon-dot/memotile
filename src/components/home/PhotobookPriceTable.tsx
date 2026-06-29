// src/components/home/PhotobookPriceTable.tsx
//
// 홈(플래그 ON): AI 포토북 가격표. 구간만 표시, 가격은 "Coming soon"(미정).
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLanguage } from "../../context/LanguageContext";
import { usePhotobookTheme } from "../../config/photobookTheme";

const TIERS = ["10–30", "30–50", "50–80", "80–120"];

export function PhotobookPriceTable() {
    const { t } = useLanguage();
    const c = usePhotobookTheme();

    return (
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            {TIERS.map((tier, i) => (
                <View
                    key={tier}
                    style={[styles.row, i < TIERS.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.border }]}
                >
                    <Text style={[styles.tier, { color: c.ink }]}>
                        {tier} <Text style={[styles.unit, { color: c.textMuted }]}>{t.priceUnit}</Text>
                    </Text>
                    <View style={[styles.soon, { backgroundColor: c.surfaceAlt }]}>
                        <Text style={[styles.soonText, { color: c.coral }]}>{t.priceComingSoon}</Text>
                    </View>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    card: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 16 },
    tier: { fontSize: 16, fontWeight: "700" },
    unit: { fontSize: 13, fontWeight: "500" },
    soon: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
    soonText: { fontSize: 12, fontWeight: "700" },
});
