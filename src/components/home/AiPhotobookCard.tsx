// src/components/home/AiPhotobookCard.tsx
//
// 홈 AI 카드.
//  - 프로필 0개: "✦ AI" + "Create your album" → 등록 화면
//  - 프로필 1개+: 아바타(메인 강조) + 버튼 "Find {name}'s photos"
//      · 아바타 탭 → 프로필 상세(Your profiles)
//      · 버튼 탭 → 사진 찾기(스캔) 실행
import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Image as ExpoImage } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { auth } from "../../lib/firebase";
import { useLanguage } from "../../context/LanguageContext";
import { usePhotobookTheme, pbRadius } from "../../config/photobookTheme";
import { PhotobookGradient } from "../photobook/PhotobookGradient";
import { listMySubjects } from "../../services/aiSubjects";
import { AiSubject } from "../../types/aiSubject";

export function AiPhotobookCard() {
    const router = useRouter();
    const { t } = useLanguage();
    const c = usePhotobookTheme();

    const [subjects, setSubjects] = useState<AiSubject[]>([]);

    const fetchSubjects = useCallback(async () => {
        if (!auth.currentUser) { setSubjects([]); return; }
        try {
            setSubjects(await listMySubjects());
        } catch (e) {
            console.warn("[AiPhotobookCard] listMySubjects failed:", e);
        }
    }, []);

    useFocusEffect(useCallback(() => { fetchSubjects(); }, [fetchSubjects]));

    // ── 진입구 (프로필 없음) ──
    if (subjects.length === 0) {
        return (
            <Pressable
                onPress={() => router.push("/photobook/register")}
                style={({ pressed }) => [
                    styles.card,
                    { backgroundColor: c.surfaceAlt, borderColor: c.peach, shadowColor: c.shadow },
                    pressed && { transform: [{ scale: 0.99 }], opacity: 0.96 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={t.aiCardCreate}
            >
                <View style={styles.row}>
                    <PhotobookGradient colors={c.gradient} radius={pbRadius.pill} style={styles.iconCircle}>
                        <Feather name={"aperture" as any} size={24} color={c.onGradient} />
                    </PhotobookGradient>
                    <View style={{ flex: 1 }}>
                        <View style={[styles.eyebrow, { backgroundColor: c.surface }]}>
                            <Feather name={"star" as any} size={11} color={c.coral} style={{ marginRight: 4 }} />
                            <Text style={[styles.eyebrowText, { color: c.coral }]}>AI</Text>
                        </View>
                        <Text style={[styles.title, { color: c.ink }]}>{t.aiCardTitle}</Text>
                        <Text style={[styles.desc, { color: c.textSecondary }]}>{t.aiCardDesc}</Text>
                    </View>
                </View>
                <PhotobookGradient colors={c.gradient} radius={pbRadius.pill} style={styles.pill}>
                    <Text style={[styles.pillText, { color: c.onGradient }]}>{t.aiCardCreate}</Text>
                    <Feather name={"arrow-right" as any} size={16} color={c.onGradient} style={{ marginLeft: 6 }} />
                </PhotobookGradient>
            </Pressable>
        );
    }

    // ── 프로필 있음 ──
    const main = subjects[0]; // 메인(가장 최근). 전환/편집은 Your profiles 화면에서.
    const findLabel = t.pbFindPhotos.replace("{name}", main.name);

    return (
        <View style={[styles.card, { backgroundColor: c.surfaceAlt, borderColor: c.peach, shadowColor: c.shadow }]}>
            <View style={styles.headerRow}>
                <Text style={[styles.kicker, { color: c.textSecondary }]}>{t.aiCardYourKids}</Text>
                <View style={[styles.eyebrow, { backgroundColor: c.surface }]}>
                    <Feather name={"star" as any} size={11} color={c.coral} style={{ marginRight: 4 }} />
                    <Text style={[styles.eyebrowText, { color: c.coral }]}>AI</Text>
                </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.avatarsRow}>
                {subjects.map((s, i) => {
                    const isMain = i === 0;
                    return (
                        <Pressable key={s.id} style={styles.avatarCol} onPress={() => router.push("/photobook")}>
                            <View style={[
                                styles.avatar,
                                { backgroundColor: c.surface, borderColor: isMain ? c.coral : c.border, borderWidth: isMain ? 2.5 : 1 },
                            ]}>
                                {s.cover?.url ? (
                                    <ExpoImage source={{ uri: s.cover.url }} style={styles.avatarImg} contentFit="cover" />
                                ) : (
                                    <Feather name={"smile" as any} size={24} color={c.coral} />
                                )}
                            </View>
                            <Text style={[styles.avatarName, { color: isMain ? c.ink : c.textMuted }]} numberOfLines={1}>{s.name}</Text>
                        </Pressable>
                    );
                })}
                <Pressable style={styles.avatarCol} onPress={() => router.push("/photobook/register")}>
                    <View style={[styles.addAvatar, { borderColor: c.peach }]}>
                        <Feather name={"plus" as any} size={22} color={c.coral} />
                    </View>
                    <Text style={[styles.avatarName, { color: c.textMuted }]}>{t.aiCardAdd}</Text>
                </Pressable>
            </ScrollView>

            {/* 버튼: 사진 찾기 실행(스캔) */}
            <Pressable
                onPress={() => router.push({ pathname: "/photobook/scan", params: { subjectId: main.id || "", name: main.name } })}
            >
                <PhotobookGradient colors={c.gradient} radius={pbRadius.pill} style={styles.pill}>
                    <Feather name={"star" as any} size={16} color={c.onGradient} style={{ marginRight: 8 }} />
                    <Text style={[styles.pillText, { color: c.onGradient }]}>{findLabel}</Text>
                </PhotobookGradient>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        width: "100%", borderRadius: 22, borderWidth: 1.5, padding: 18,
        shadowOffset: { width: 0, height: 8 }, shadowOpacity: 1, shadowRadius: 18, elevation: 3,
    },
    row: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 4 },
    iconCircle: { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
    eyebrow: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, marginBottom: 6 },
    eyebrowText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
    title: { fontSize: 18, fontWeight: "800" },
    desc: { fontSize: 13, fontWeight: "500", marginTop: 3, lineHeight: 18 },

    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
    kicker: { fontSize: 13, fontWeight: "600" },

    avatarsRow: { gap: 16, paddingRight: 4, paddingBottom: 4 },
    avatarCol: { alignItems: "center", width: 64 },
    avatar: { width: 60, height: 60, borderRadius: 999, overflow: "hidden", alignItems: "center", justifyContent: "center" },
    avatarImg: { width: "100%", height: "100%", borderRadius: 999 },
    avatarName: { fontSize: 12, fontWeight: "700", marginTop: 5 },
    addAvatar: { width: 60, height: 60, borderRadius: 999, borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },

    pill: { height: 48, marginTop: 16, flexDirection: "row", alignItems: "center", justifyContent: "center" },
    pillText: { fontSize: 15, fontWeight: "700" },
});
