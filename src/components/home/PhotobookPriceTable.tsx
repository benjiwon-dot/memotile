// src/components/home/PhotobookPriceTable.tsx
//
// 홈: AI 포토북 가격표. 사이즈별 "최소가부터"(소프트 48p) — photobookPricing의 실제 값 참조.
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLanguage } from "../../context/LanguageContext";
import { usePhotobookTheme } from "../../config/photobookTheme";
import { albumMinPrice, AlbumSize } from "../../config/photobookPricing";
import { usePhotobookPricing } from "../../services/photobookPriceConfig";

type Row = { size: AlbumSize; th: string; en: string; popular?: boolean };
const ROWS: Row[] = [
    { size: "A5", th: "เล่มเล็ก พกพาง่าย", en: "Compact · handy" },
    { size: "A4", th: "ยอดนิยม", en: "Most popular", popular: true },
    { size: "A3", th: "เล่มใหญ่ · เป็นของขวัญ", en: "Large · gift" },
];

export function PhotobookPriceTable() {
    const { locale } = useLanguage();
    const c = usePhotobookTheme();
    usePhotobookPricing(); // 원격 가격이 늦게 도착해도 표가 최신가로 갱신되도록 구독

    const isTH = locale === "TH";
    const fromLabel = (price: number) => {
        const p = `฿${price.toLocaleString()}`;
        return isTH ? `เริ่มต้น ${p}` : `from ${p}`;
    };
    const desc = (r: Row) => (isTH ? r.th : r.en);
    const popularLabel = isTH ? "ยอดนิยม" : "POPULAR";
    const footer = isTH
        ? "ปกอ่อน 48 หน้าขึ้นไป · ปกแข็งเพิ่มเงิน"
        : "Softcover, 48p base · Hardcover extra";

    return (
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            {ROWS.map((r, i) => (
                <View
                    key={r.size}
                    style={[
                        styles.row,
                        i < ROWS.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.border },
                        r.popular && { backgroundColor: c.surfaceAlt },
                    ]}
                >
                    <View style={styles.left}>
                        <View style={styles.sizeRow}>
                            <Text style={[styles.size, { color: c.ink }]}>{r.size}</Text>
                            {r.popular && (
                                <View style={[styles.badge, { backgroundColor: c.coral }]}>
                                    <Text style={styles.badgeText}>{popularLabel}</Text>
                                </View>
                            )}
                        </View>
                        <Text style={[styles.desc, { color: c.textMuted }]}>{desc(r)}</Text>
                    </View>
                    <Text style={[styles.price, { color: c.coral }]}>{fromLabel(albumMinPrice(r.size))}</Text>
                </View>
            ))}
            <View style={[styles.footer, { borderTopColor: c.border }]}>
                <Text style={[styles.footerText, { color: c.textMuted }]}>{footer}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 16 },
    left: { flex: 1 },
    sizeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    size: { fontSize: 17, fontWeight: "800", letterSpacing: 0.2 },
    badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
    badgeText: { fontSize: 10, fontWeight: "900", color: "#fff", letterSpacing: 0.5 },
    desc: { fontSize: 12, fontWeight: "500", marginTop: 2 },
    price: { fontSize: 16, fontWeight: "800" },
    footer: { paddingVertical: 10, paddingHorizontal: 16, borderTopWidth: 1 },
    footerText: { fontSize: 11, fontWeight: "500", textAlign: "center" },
});
