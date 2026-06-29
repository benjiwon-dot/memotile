// app/photobook/index.tsx
//
// AI 프로필 메인 (허브 제거). 프로필 0개면 등록으로 자동 이동, 1개+면 프로필 표시.
// 상단 원형사진+이름+나이, 여러 명이면 가로 전환+추가(+), 큰 버튼 "{이름} 사진 찾아내기" → 스캔.
import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image as ExpoImage } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { useLanguage } from "../../src/context/LanguageContext";
import { usePhotobookEnabled } from "../../src/config/featureFlags";
import { usePhotobookTheme, pbRadius } from "../../src/config/photobookTheme";
import { PhotobookGradient } from "../../src/components/photobook/PhotobookGradient";
import { listMySubjects } from "../../src/services/aiSubjects";
import { AiSubject } from "../../src/types/aiSubject";

function ageLabel(birth: string | null | undefined, yr: string, mo: string): string {
    if (!birth) return "";
    const b = new Date(birth);
    if (isNaN(b.getTime())) return "";
    const now = new Date();
    let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
    if (now.getDate() < b.getDate()) months--;
    if (months < 0) months = 0;
    const y = Math.floor(months / 12);
    const m = months % 12;
    if (y <= 0) return `${m}${mo}`;
    return m > 0 ? `${y}${yr} ${m}${mo}` : `${y}${yr}`;
}

export default function PhotobookProfile() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { t } = useLanguage();
    const c = usePhotobookTheme();
    const enabled = usePhotobookEnabled();

    const [subjects, setSubjects] = useState<AiSubject[] | null>(null);
    const [sel, setSel] = useState(0);

    useFocusEffect(
        useCallback(() => {
            let active = true;
            (async () => {
                try {
                    const s = await listMySubjects();
                    if (!active) return;
                    setSubjects(s);
                    setSel((prev) => Math.min(prev, Math.max(0, s.length - 1)));
                    if (s.length === 0) router.replace("/photobook/register");
                } catch (e) {
                    console.warn("[PhotobookProfile] listMySubjects failed (composite index needed?):", e);
                    if (active) setSubjects([]);
                }
            })();
            return () => { active = false; };
        }, [router])
    );

    if (!enabled) return null;

    if (subjects === null || subjects.length === 0) {
        return (
            <View style={[styles.container, styles.center, { backgroundColor: c.bg }]}>
                <ActivityIndicator color={c.coral} />
            </View>
        );
    }

    const current = subjects[Math.min(sel, subjects.length - 1)];
    const findLabel = t.pbFindPhotos.replace("{name}", current.name);

    return (
        <View style={[styles.container, { backgroundColor: c.bg, paddingTop: insets.top + 8 }]}>
            <View style={styles.header}>
                <Pressable onPress={() => router.replace("/(tabs)")} hitSlop={12} style={styles.iconBtn}>
                    <Feather name="arrow-left" size={24} color={c.ink} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: c.ink }]}>{t.pbProfiles}</Text>
                <View style={styles.iconBtn} />
            </View>

            <ScrollView contentContainerStyle={{ alignItems: "center", paddingBottom: insets.bottom + 40 }}>
                {/* 선택된 프로필 (탭 → 수정) */}
                <Pressable onPress={() => router.push({ pathname: "/photobook/register", params: { subjectId: current.id || "" } })}>
                    <PhotobookGradient colors={c.gradient} radius={74} style={styles.bigRing}>
                        <View style={[styles.bigInner, { backgroundColor: c.surface }]}>
                            {current.cover?.url ? (
                                <ExpoImage source={{ uri: current.cover.url }} style={styles.bigImg} contentFit="cover" />
                            ) : (
                                <Feather name="smile" size={56} color={c.coral} />
                            )}
                        </View>
                    </PhotobookGradient>
                </Pressable>
                <Text style={[styles.name, { color: c.ink }]}>{current.name}</Text>
                {!!current.birthDate && (
                    <Text style={[styles.age, { color: c.textSecondary }]}>{ageLabel(current.birthDate, t.ageYr, t.ageMo)}</Text>
                )}
                <Pressable
                    onPress={() => router.push({ pathname: "/photobook/register", params: { subjectId: current.id || "" } })}
                    style={[styles.editBtn, { borderColor: c.border, backgroundColor: c.surface }]}
                >
                    <Feather name="edit-2" size={13} color={c.textSecondary} style={{ marginRight: 6 }} />
                    <Text style={[styles.editText, { color: c.textSecondary }]}>{t.pbEditProfile}</Text>
                </Pressable>

                {/* 전환 + 추가 */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.switchRow}>
                    {subjects.map((s, i) => {
                        const active = i === sel;
                        return (
                            <Pressable key={s.id} onPress={() => setSel(i)} style={styles.switchItem}>
                                <View style={[styles.switchAvatar, { borderColor: active ? c.coral : c.border, backgroundColor: c.surface }]}>
                                    {s.cover?.url ? (
                                        <ExpoImage source={{ uri: s.cover.url }} style={styles.switchImg} contentFit="cover" />
                                    ) : (
                                        <Feather name="smile" size={22} color={c.coral} />
                                    )}
                                </View>
                                <Text style={[styles.switchName, { color: active ? c.ink : c.textMuted }]} numberOfLines={1}>{s.name}</Text>
                            </Pressable>
                        );
                    })}
                    <Pressable onPress={() => router.push("/photobook/register")} style={styles.switchItem}>
                        <View style={[styles.addAvatar, { borderColor: c.peach }]}>
                            <Feather name="plus" size={22} color={c.coral} />
                        </View>
                        <Text style={[styles.switchName, { color: c.textMuted }]}>{t.aiCardAdd}</Text>
                    </Pressable>
                </ScrollView>
            </ScrollView>

            {/* 사진 찾기 */}
            <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
                <Pressable
                    onPress={() => router.push({ pathname: "/photobook/scan", params: { subjectId: current.id || "", name: current.name } })}
                >
                    <PhotobookGradient colors={c.gradient} radius={pbRadius.lg} style={styles.findBtn}>
                        <Feather name="star" size={18} color="#fff" style={{ marginRight: 8 }} />
                        <Text style={styles.findText}>{findLabel}</Text>
                    </PhotobookGradient>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    center: { alignItems: "center", justifyContent: "center" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 8 },
    iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 18, fontWeight: "800" },

    bigRing: { width: 148, height: 148, padding: 5, marginTop: 24, borderRadius: 74, overflow: "hidden" },
    bigInner: { flex: 1, borderRadius: 69, overflow: "hidden", alignItems: "center", justifyContent: "center" },
    bigImg: { width: "100%", height: "100%", borderRadius: 69 },
    name: { fontSize: 26, fontWeight: "800", marginTop: 16 },
    age: { fontSize: 16, fontWeight: "600", marginTop: 4 },
    editBtn: { flexDirection: "row", alignItems: "center", marginTop: 12, paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1 },
    editText: { fontSize: 13, fontWeight: "600" },

    switchRow: { gap: 16, paddingHorizontal: 20, paddingVertical: 28, alignItems: "flex-start" },
    switchItem: { alignItems: "center", width: 60 },
    switchAvatar: { width: 56, height: 56, borderRadius: 999, borderWidth: 2, overflow: "hidden", alignItems: "center", justifyContent: "center" },
    switchImg: { width: "100%", height: "100%", borderRadius: 999 },
    addAvatar: { width: 56, height: 56, borderRadius: 999, borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
    switchName: { fontSize: 12, fontWeight: "600", marginTop: 5 },

    footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 8 },
    findBtn: { height: 58, flexDirection: "row", alignItems: "center", justifyContent: "center" },
    findText: { fontSize: 17, fontWeight: "800", color: "#fff" },
});
