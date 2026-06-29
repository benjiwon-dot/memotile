// src/components/home/PhotobookWhyHow.tsx
//
// 홈(플래그 ON): "Why MemoTile" 3대 서비스 + "How it works" 2갈래. 웜톤, 조밀.
// 텍스트는 전부 t.키 (하드코딩 0).
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLanguage } from "../../context/LanguageContext";
import { usePhotobookTheme } from "../../config/photobookTheme";

export function PhotobookWhyHow() {
    const { t } = useLanguage();
    const c = usePhotobookTheme();

    const services: { icon: any; title: string; desc: string }[] = [
        { icon: "aperture", title: t.svcAiTitle, desc: t.svcAiDesc },
        { icon: "calendar", title: t.svcTimelineTitle, desc: t.svcTimelineDesc },
        { icon: "grid", title: t.svcTileTitle, desc: t.svcTileDesc },
    ];
    const tracks: { icon: any; title: string; desc: string }[] = [
        { icon: "star", title: t.howAiTitle, desc: t.howAiDesc },
        { icon: "image", title: t.howTileTitle, desc: t.howTileDesc },
    ];

    return (
        <View style={styles.wrap}>
            <Text style={[styles.sectionTitle, { color: c.ink }]}>{t.pbWhyTitle}</Text>
            {services.map((s, i) => (
                <View key={i} style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}>
                    <View style={[styles.iconCircle, { backgroundColor: c.surfaceAlt }]}>
                        <Feather name={s.icon} size={20} color={c.coral} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.rowTitle, { color: c.ink }]}>{s.title}</Text>
                        <Text style={[styles.rowDesc, { color: c.textSecondary }]}>{s.desc}</Text>
                    </View>
                </View>
            ))}

            <Text style={[styles.sectionTitle, { color: c.ink, marginTop: 22 }]}>{t.pbHowTitle}</Text>
            <View style={styles.tracks}>
                {tracks.map((tr, i) => (
                    <View key={i} style={[styles.track, { backgroundColor: c.surfaceAlt, borderColor: c.peach }]}>
                        <Feather name={tr.icon} size={22} color={c.coral} />
                        <Text style={[styles.trackTitle, { color: c.ink }]}>{tr.title}</Text>
                        <Text style={[styles.trackDesc, { color: c.textSecondary }]}>{tr.desc}</Text>
                    </View>
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 12 },
    sectionTitle: { fontSize: 18, fontWeight: "800", marginBottom: 12 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, borderWidth: 1, marginBottom: 8 },
    iconCircle: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    rowTitle: { fontSize: 15, fontWeight: "700" },
    rowDesc: { fontSize: 12.5, fontWeight: "500", marginTop: 2, lineHeight: 17 },
    tracks: { flexDirection: "row", gap: 10 },
    track: { flex: 1, padding: 14, borderRadius: 16, borderWidth: 1.5, alignItems: "flex-start" },
    trackTitle: { fontSize: 15, fontWeight: "800", marginTop: 10 },
    trackDesc: { fontSize: 12.5, fontWeight: "500", marginTop: 4, lineHeight: 17 },
});
