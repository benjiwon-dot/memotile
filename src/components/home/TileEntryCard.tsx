// src/components/home/TileEntryCard.tsx
//
// 홈: 타일 진입 카드. AI 카드와 같은 톤/같은 그라데이션 버튼(한 세트).
// 썸네일 오른쪽·아래에 두께감을 줘서 "벽에 붙는 2cm 입체 타일"로 직관적으로 보이게.
// onPress = handleStart (타일 진입 로직/이후 흐름 무변경).
import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Image as ExpoImage, type ImageSource } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { useLanguage } from "../../context/LanguageContext";
import { usePhotobookTheme, pbRadius } from "../../config/photobookTheme";
import { PhotobookGradient } from "../photobook/PhotobookGradient";

const tileImg = require("../../assets/hero_new_1.jpg") as ImageSource;

export function TileEntryCard({ onPress }: { onPress: () => void }) {
    const { t } = useLanguage();
    const c = usePhotobookTheme();

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.card,
                { backgroundColor: c.surfaceAlt, borderColor: c.peach, shadowColor: c.shadow },
                pressed && { transform: [{ scale: 0.99 }], opacity: 0.96 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t.ctaStart}
        >
            <View style={styles.row}>
                {/* 입체 타일 썸네일 */}
                <View style={styles.tileWrap}>
                    <View style={[styles.tileDepth, { backgroundColor: c.peach }]} />
                    <View style={[styles.tileFace, { borderColor: c.surface, shadowColor: c.shadow }]}>
                        <ExpoImage source={tileImg} style={styles.tileImg} contentFit="cover" />
                    </View>
                </View>

                <View style={{ flex: 1 }}>
                    <Text style={[styles.title, { color: c.ink }]}>{t.ctaStart}</Text>
                    <Text style={[styles.hint, { color: c.textMuted }]}>{t.ctaHint}</Text>
                </View>
            </View>

            <PhotobookGradient colors={c.gradient} radius={pbRadius.pill} style={styles.pill}>
                <Text style={[styles.pillText, { color: c.onGradient }]}>{t.aiCardCta}</Text>
                <Feather name={"arrow-right" as any} size={16} color={c.onGradient} style={{ marginLeft: 6 }} />
            </PhotobookGradient>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        width: "100%", borderRadius: 22, borderWidth: 1.5, padding: 18,
        shadowOffset: { width: 0, height: 8 }, shadowOpacity: 1, shadowRadius: 18, elevation: 3,
    },
    row: { flexDirection: "row", alignItems: "center", gap: 14 },
    tileWrap: { width: 84, height: 84, justifyContent: "center", alignItems: "center" },
    // 오른쪽·아래로 살짝 빠져나온 두께면
    tileDepth: {
        position: "absolute", left: 10, top: 10, width: 70, height: 70, borderRadius: 12,
    },
    tileFace: {
        position: "absolute", left: 2, top: 2, width: 70, height: 70, borderRadius: 12,
        borderWidth: 3, overflow: "hidden",
        shadowOffset: { width: 2, height: 3 }, shadowOpacity: 1, shadowRadius: 6, elevation: 3,
    },
    tileImg: { width: "100%", height: "100%" },
    title: { fontSize: 17, fontWeight: "700" },
    hint: { fontSize: 13, fontWeight: "500", marginTop: 3 },
    pill: {
        height: 46, marginTop: 14, flexDirection: "row", alignItems: "center", justifyContent: "center",
    },
    pillText: { fontSize: 15, fontWeight: "700" },
});
