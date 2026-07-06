// app/photobook/manage.tsx
//
// 우리 아이 정보 관리 (정식 위치). 등록된 subject 목록 → 탭하면 수정, 삭제(휴지통+햅틱).
// 홈과 동일한 listMySubjects / deleteSubject 재사용. 웜톤.
import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image as ExpoImage } from "expo-image";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useLanguage } from "../../src/context/LanguageContext";
import { usePhotobookEnabled } from "../../src/config/featureFlags";
import { usePhotobookTheme } from "../../src/config/photobookTheme";
import { listMySubjects, deleteSubject } from "../../src/services/aiSubjects";
import { AiSubject } from "../../src/types/aiSubject";

function ageLabel(birth: string | null | undefined, mo: string, yr: string): string {
    if (!birth) return "";
    const b = new Date(birth), now = new Date();
    if (isNaN(b.getTime())) return "";
    let m = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
    if (now.getDate() < b.getDate()) m--;
    if (m < 0) m = 0;
    const y = Math.floor(m / 12), mm = m % 12;
    if (y <= 0) return `${mm}${mo}`;
    return mm > 0 ? `${y}${yr} ${mm}${mo}` : `${y}${yr}`;
}

export default function PhotobookManage() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { t } = useLanguage();
    const c = usePhotobookTheme();
    const enabled = usePhotobookEnabled();
    const [subjects, setSubjects] = useState<AiSubject[] | null>(null);

    const fetch = useCallback(async () => {
        try { setSubjects(await listMySubjects()); }
        catch (e) { console.warn("[manage] listMySubjects failed:", e); setSubjects([]); }
    }, []);
    useFocusEffect(useCallback(() => { fetch(); }, [fetch]));

    function confirmDelete(s: AiSubject) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Alert.alert(t.pbDeleteTitle, t.pbDeleteBody, [
            { text: t.cancel, style: "cancel" },
            {
                text: t.pbDeleteOk, style: "destructive", onPress: async () => {
                    try { await deleteSubject(s.id!); await fetch(); }
                    catch (e: any) { Alert.alert("Error", String(e?.message || e)); }
                },
            },
        ]);
    }

    if (!enabled) return null;

    return (
        <View style={[styles.container, { backgroundColor: c.bg, paddingTop: insets.top + 8 }]}>
            <View style={styles.header}>
                <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconBtn}>
                    <Feather name="arrow-left" size={24} color={c.ink} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: c.ink }]}>{t.pbManageProfiles}</Text>
                <View style={styles.iconBtn} />
            </View>

            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
                {subjects === null ? (
                    <ActivityIndicator color={c.coral} style={{ marginTop: 40 }} />
                ) : subjects.length === 0 ? (
                    <Text style={{ color: c.textSecondary, textAlign: "center", marginTop: 40 }}>{t.pbManageEmpty}</Text>
                ) : (
                    subjects.map((s) => (
                        <View key={s.id} style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}>
                            <Pressable
                                style={styles.rowMain}
                                onPress={() => router.push({ pathname: "/photobook/register", params: { subjectId: s.id || "" } })}
                            >
                                <View style={[styles.avatar, { borderColor: c.peach }]}>
                                    {s.cover?.url ? (
                                        <ExpoImage source={{ uri: s.cover.url }} style={styles.avatarImg} contentFit="cover" />
                                    ) : (
                                        <Feather name="smile" size={22} color={c.coral} />
                                    )}
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.name, { color: c.ink }]} numberOfLines={1}>{s.name}</Text>
                                    {!!s.birthDate && (
                                        <Text style={[styles.age, { color: c.textMuted }]}>{ageLabel(s.birthDate, t.ageMo, t.ageYr)}</Text>
                                    )}
                                </View>
                                <Feather name="edit-2" size={16} color={c.textSecondary} />
                            </Pressable>
                            <Pressable style={styles.delBtn} onPress={() => confirmDelete(s)} hitSlop={8}>
                                <Feather name="trash-2" size={18} color="#E5484D" />
                            </Pressable>
                        </View>
                    ))
                )}

                {/* 추가 */}
                <Pressable
                    style={[styles.addRow, { borderColor: c.peach, backgroundColor: c.surfaceAlt }]}
                    onPress={() => router.push("/photobook/register")}
                >
                    <Feather name="plus" size={20} color={c.coral} style={{ marginRight: 8 }} />
                    <Text style={{ color: c.coral, fontWeight: "700" }}>{t.aiCardAdd}</Text>
                </Pressable>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 8 },
    iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 18, fontWeight: "800" },
    row: { flexDirection: "row", alignItems: "center", borderRadius: 16, borderWidth: 1, marginBottom: 10, paddingRight: 8 },
    rowMain: { flex: 1, flexDirection: "row", alignItems: "center", padding: 12, gap: 12 },
    avatar: { width: 48, height: 48, borderRadius: 999, borderWidth: 2, overflow: "hidden", alignItems: "center", justifyContent: "center" },
    avatarImg: { width: "100%", height: "100%", borderRadius: 999 },
    name: { fontSize: 16, fontWeight: "700" },
    age: { fontSize: 13, fontWeight: "500", marginTop: 2 },
    delBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    addRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", height: 50, borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed", marginTop: 6 },
});
