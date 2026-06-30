// app/photobook/register.tsx
//
// AI 프로필 등록 (bebememo 스타일 + 웜톤). 순서: 프로필사진 → 이름 → 생년월일(휠) → 성별 → 기준사진(자유 그리드).
// 중립어(이름/프로필). baby 특화 문구는 kind==baby일 때만. 허브 거치지 않고 홈에서 바로 진입.
import React, { useEffect, useState } from "react";
import {
    View, Text, StyleSheet, ScrollView, TextInput, Pressable,
    Alert, Linking, Platform, ActivityIndicator, Dimensions,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useRef } from "react";
import { auth } from "../../src/lib/firebase";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image as ExpoImage } from "expo-image";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";

import { useLanguage } from "../../src/context/LanguageContext";
import { usePhotobookEnabled } from "../../src/config/featureFlags";
import { usePhotobookTheme, pbRadius } from "../../src/config/photobookTheme";
import { PhotobookGradient } from "../../src/components/photobook/PhotobookGradient";
import { WheelDatePicker } from "../../src/components/photobook/WheelDatePicker";
import { createSubject, updateSubject, getSubject, deleteSubject, SubjectPhotoInput, SubjectDraft, CreateProgress } from "../../src/services/aiSubjects";
import { SubjectGender, SubjectKind } from "../../src/types/aiSubject";

const SCREEN_W = Dimensions.get("window").width;
const H_PAD = 20;
const GAP = 10;
const CELL = Math.floor((SCREEN_W - H_PAD * 2 - GAP * 2) / 3);

const KIND: SubjectKind = "baby"; // Phase 1

function formatDate(iso: string | null): string {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${y}. ${m}. ${d}`;
}

export default function PhotobookRegister() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { t } = useLanguage();
    const c = usePhotobookTheme();
    const enabled = usePhotobookEnabled();
    const params = useLocalSearchParams<{ subjectId?: string }>();
    const subjectId = typeof params.subjectId === "string" && params.subjectId ? params.subjectId : null;
    const editing = !!subjectId;

    const [name, setName] = useState("");
    const [birthDate, setBirthDate] = useState<string | null>(null);
    const [gender, setGender] = useState<SubjectGender>("unspecified");
    const [cover, setCover] = useState<SubjectPhotoInput | null>(null);
    const [anchors, setAnchors] = useState<SubjectPhotoInput[]>([]);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [progress, setProgress] = useState<CreateProgress | null>(null);
    const pendingSaveRef = useRef(false);
    const doSaveRef = useRef<() => void>(() => {});

    // 편집 모드: 기존 프로필 불러와 prefill
    useEffect(() => {
        if (!subjectId) return;
        (async () => {
            const s = await getSubject(subjectId);
            if (!s) return;
            setName(s.name);
            setBirthDate(s.birthDate ?? null);
            setGender(s.gender);
            setCover(s.cover ? { uri: s.cover.url, keepRef: s.cover } : null);
            // 구버전 문서(앵커가 객체였던 경우)는 배열만 안전하게 사용
            const anchorArr = Array.isArray(s.anchors) ? s.anchors : [];
            setAnchors(anchorArr.map((a) => ({ uri: a.url, keepRef: a })));
        })();
    }, [subjectId]);

    // 로그인 성공 시(비로그인→로그인) 보류된 저장 재개
    useEffect(() => {
        const unsub = auth.onAuthStateChanged((u) => {
            if (u && pendingSaveRef.current) {
                pendingSaveRef.current = false;
                doSaveRef.current();
            }
        });
        return unsub;
    }, []);

    if (!enabled) return null;

    // baby 중심: Boy/Girl 2개. (pet/couple은 추후 kind별 분기 — 메모 참조)
    const genderOptions: { id: SubjectGender; label: string }[] = [
        { id: "boy", label: t.pbGenderBoy },
        { id: "girl", label: t.pbGenderGirl },
    ];

    const canSave = !!cover && anchors.length >= 2; // 프로필 1 + 앵커 2 필수

    async function requestPermission(): Promise<boolean> {
        if (Platform.OS === "web") return true;
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== ImagePicker.PermissionStatus.GRANTED) {
            Alert.alert(t.permissionDeniedTitle, t.permissionDeniedBody, [
                { text: t.cancel, style: "cancel" },
                { text: t.openSettings, onPress: () => Linking.openSettings() },
            ]);
            return false;
        }
        return true;
    }

    async function pickPhotos(limit: number): Promise<SubjectPhotoInput[]> {
        if (!(await requestPermission())) return [];
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsMultipleSelection: limit > 1,
            selectionLimit: limit,
            quality: 1, exif: false, base64: false,
        });
        if (result.canceled || !result.assets?.length) return [];
        return result.assets.map((a) => ({
            uri: a.uri, width: a.width, height: a.height, localId: (a as any).assetId ?? null,
        }));
    }

    async function onPickCover() {
        const p = await pickPhotos(1);
        if (p[0]) setCover(p[0]);
    }
    async function onAddAnchors() {
        const remaining = 4 - anchors.length; // 앵커 최대 4장(프로필 포함 최대 5)
        if (remaining <= 0) return;
        const p = await pickPhotos(remaining);
        if (p.length) setAnchors((prev) => [...prev, ...p].slice(0, 4));
    }

    async function doSave() {
        const draft: SubjectDraft = { name, birthDate, gender, kind: KIND, cover, anchors };
        const total = (cover ? 1 : 0) + anchors.length;
        setSaving(true);
        setProgress({ done: 0, total });
        try {
            if (editing && subjectId) await updateSubject(subjectId, draft, setProgress);
            else await createSubject(draft, setProgress);
            router.replace("/photobook");
        } catch (e: any) {
            Alert.alert("Error", String(e?.message || e));
            setSaving(false);
            setProgress(null);
        }
    }
    doSaveRef.current = doSave;

    function onDelete() {
        if (!subjectId) return;
        Alert.alert(t.pbDeleteTitle, t.pbDeleteBody, [
            { text: t.cancel, style: "cancel" },
            {
                text: t.pbDeleteOk, style: "destructive", onPress: async () => {
                    try {
                        await deleteSubject(subjectId);
                        router.replace("/photobook");
                    } catch (e: any) {
                        Alert.alert("Error", String(e?.message || e));
                    }
                },
            },
        ]);
    }

    function onSave() {
        if (!name.trim()) { Alert.alert(t.pbErrName); return; }
        if (!birthDate) { Alert.alert(t.pbErrBirthDate); return; }
        if (!cover) { Alert.alert(t.pbErrCover); return; }            // 프로필 사진 필수
        if (anchors.length < 2) { Alert.alert(t.pbErrAnchors); return; } // 앵커 최소 2장 필수
        // 비로그인 → 기존 로그인 화면, 성공하면 저장 재개
        if (!auth.currentUser) {
            pendingSaveRef.current = true;
            router.push("/auth/email");
            return;
        }
        doSave();
    }

    return (
        <View style={[styles.container, { backgroundColor: c.bg, paddingTop: insets.top + 8 }]}>
            <View style={styles.header}>
                <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconBtn}>
                    <Feather name="arrow-left" size={24} color={c.ink} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: c.ink }]}>{editing ? t.pbEditProfile : t.pbNewProfile}</Text>
                <View style={styles.iconBtn} />
            </View>

            <ScrollView
                contentContainerStyle={{ paddingHorizontal: H_PAD, paddingBottom: insets.bottom + 120 }}
                keyboardShouldPersistTaps="handled"
            >
                <Text style={[styles.subtitle, { color: c.textMuted }]}>{t.pbNewProfileSub}</Text>

                {/* 프로필 사진 (원형, 상단 중앙) */}
                <View style={styles.coverWrap}>
                    <Pressable onPress={onPickCover}>
                        <View style={styles.coverOuter}>
                            <PhotobookGradient colors={c.gradient} radius={56} style={StyleSheet.absoluteFill} />
                            <View style={[styles.coverImgWrap, { backgroundColor: c.surface }]}>
                                {cover ? (
                                    <ExpoImage source={{ uri: cover.uri }} style={styles.coverImg} contentFit="cover" />
                                ) : (
                                    <Feather name="camera" size={30} color={c.coral} />
                                )}
                            </View>
                        </View>
                        <View style={[styles.coverEdit, { backgroundColor: c.coral, borderColor: c.bg }]}>
                            <Feather name="plus" size={16} color="#fff" />
                        </View>
                    </Pressable>
                    <Text style={[styles.coverLabel, { color: c.textSecondary }]}>{t.pbProfilePhoto}</Text>
                </View>

                {/* 이름 */}
                <Text style={[styles.label, { color: c.ink }]}>{t.pbChildNameLabel}</Text>
                <TextInput
                    style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.ink }]}
                    value={name}
                    onChangeText={setName}
                    placeholder={t.pbChildNamePlaceholder}
                    placeholderTextColor={c.textMuted}
                    maxLength={40}
                />

                {/* 생년월일 (휠 피커) */}
                <Text style={[styles.label, { color: c.ink }]}>{t.pbBirthDateLabel}</Text>
                <Pressable
                    style={[styles.input, styles.dateField, { backgroundColor: c.surface, borderColor: c.border }]}
                    onPress={() => setPickerOpen(true)}
                >
                    <Text style={{ fontSize: 16, color: birthDate ? c.ink : c.textMuted }}>
                        {birthDate ? formatDate(birthDate) : t.pbPickDate}
                    </Text>
                    <Feather name="chevron-down" size={18} color={c.textSecondary} />
                </Pressable>

                {/* 성별 */}
                <Text style={[styles.label, { color: c.ink }]}>{t.pbGenderLabel}</Text>
                <View style={styles.genderRow}>
                    {genderOptions.map((g) => {
                        const active = gender === g.id;
                        return (
                            <Pressable
                                key={g.id}
                                onPress={() => setGender(g.id)}
                                style={[
                                    styles.genderBtn,
                                    { backgroundColor: active ? c.coral : c.surface, borderColor: active ? c.coral : c.border },
                                ]}
                            >
                                <Text style={{ fontSize: 14, fontWeight: "600", color: active ? "#fff" : c.textSecondary }}>{g.label}</Text>
                            </Pressable>
                        );
                    })}
                </View>

                {/* 기준 사진 (자유 그리드) */}
                <Text style={[styles.label, { color: c.ink, marginTop: 26 }]}>{t.pbPhotosTitle}</Text>
                <View style={[styles.callout, { backgroundColor: c.surfaceAlt, borderColor: c.peach }]}>
                    <Feather name="info" size={15} color={c.coral} style={{ marginTop: 1 }} />
                    <Text style={[styles.calloutText, { color: c.textSecondary }]}>
                        {t.pbPhotosHint}{KIND === "baby" ? ` ${t.pbPhotosHintBaby}` : ""}
                    </Text>
                </View>
                <Text style={[styles.countLine, { color: anchors.length < 2 ? c.coral : c.textMuted }]}>
                    {anchors.length} {t.priceUnit} · {t.pbAnchorsNeed}
                </Text>
                <View style={styles.grid}>
                    {anchors.map((p, i) => (
                        <View key={i} style={[styles.cell, { backgroundColor: c.surface, borderColor: c.border }]}>
                            <ExpoImage source={{ uri: p.uri }} style={styles.cellImg} contentFit="cover" />
                            <Pressable
                                style={styles.removeBadge}
                                hitSlop={8}
                                onPress={() => setAnchors((prev) => prev.filter((_, idx) => idx !== i))}
                            >
                                <Feather name="x" size={13} color="#fff" />
                            </Pressable>
                        </View>
                    ))}
                    {anchors.length < 4 && (
                        <Pressable style={[styles.cell, styles.addCell, { borderColor: c.peach, backgroundColor: c.surfaceAlt }]} onPress={onAddAnchors}>
                            <Feather name="plus" size={26} color={c.coral} />
                        </Pressable>
                    )}
                </View>

                {editing && (
                    <Pressable style={styles.deleteBtn} onPress={onDelete}>
                        <Feather name="trash-2" size={16} color="#E5484D" style={{ marginRight: 6 }} />
                        <Text style={styles.deleteText}>{t.pbDelete}</Text>
                    </Pressable>
                )}
            </ScrollView>

            {/* 저장 */}
            <View style={[styles.footer, { backgroundColor: c.bg, borderTopColor: c.border, paddingBottom: insets.bottom + 12 }]}>
                <Pressable onPress={onSave} disabled={saving}>
                    <PhotobookGradient colors={c.gradient} radius={pbRadius.lg} style={[styles.saveBtn, (saving || !canSave) && { opacity: 0.5 }]}>
                        {saving ? (
                            <View style={styles.savingRow}>
                                <ActivityIndicator color="#fff" />
                                <Text style={styles.saveText}>
                                    {progress ? `${t.pbUploading} ${progress.done}/${progress.total}` : t.pbSaving}
                                </Text>
                            </View>
                        ) : (
                            <Text style={styles.saveText}>{t.pbSave}</Text>
                        )}
                    </PhotobookGradient>
                </Pressable>
            </View>

            <WheelDatePicker
                visible={pickerOpen}
                value={birthDate}
                theme={c}
                confirmLabel={t.continue}
                cancelLabel={t.cancel}
                onCancel={() => setPickerOpen(false)}
                onConfirm={(iso) => { setBirthDate(iso); setPickerOpen(false); }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: H_PAD, paddingBottom: 8 },
    iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 18, fontWeight: "800" },
    subtitle: { fontSize: 14, lineHeight: 20, marginTop: 4, marginBottom: 20, textAlign: "center" },

    coverWrap: { alignItems: "center", marginBottom: 8 },
    coverOuter: { width: 112, height: 112, borderRadius: 56, overflow: "hidden", alignItems: "center", justifyContent: "center" },
    coverImgWrap: { width: 104, height: 104, borderRadius: 52, overflow: "hidden", alignItems: "center", justifyContent: "center" },
    coverImg: { width: "100%", height: "100%" },
    coverEdit: { position: "absolute", right: 4, bottom: 4, width: 30, height: 30, borderRadius: 15, borderWidth: 3, alignItems: "center", justifyContent: "center" },
    coverLabel: { fontSize: 13, fontWeight: "600", marginTop: 10 },

    label: { fontSize: 15, fontWeight: "700", marginTop: 20, marginBottom: 8 },
    labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20, marginBottom: 8 },
    optional: { fontSize: 12 },
    hint: { fontSize: 13, lineHeight: 19, marginTop: -2, marginBottom: 12 },

    input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16 },
    dateField: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

    genderRow: { flexDirection: "row", gap: GAP },
    genderBtn: { flex: 1, paddingVertical: 13, borderRadius: 14, borderWidth: 1, alignItems: "center" },

    grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
    cell: { width: CELL, height: CELL, borderRadius: 14, borderWidth: 1, overflow: "hidden" },
    addCell: { alignItems: "center", justifyContent: "center", borderStyle: "dashed", borderWidth: 1.5 },
    cellImg: { width: "100%", height: "100%" },
    removeBadge: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
    callout: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
    calloutText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: "500" },
    countLine: { fontSize: 13, fontWeight: "700", marginBottom: 12 },
    deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 32, paddingVertical: 12 },
    deleteText: { fontSize: 15, fontWeight: "700", color: "#E5484D" },

    footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: H_PAD, paddingTop: 12, borderTopWidth: 1 },
    saveBtn: { height: 56, alignItems: "center", justifyContent: "center" },
    savingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    saveText: { fontSize: 17, fontWeight: "800", color: "#fff" },
});
