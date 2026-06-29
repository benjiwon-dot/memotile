// app/photobook/register.tsx
//
// STEP 3: 아이 프로필 등록 — 이름/생년월일/성별 + 대표사진 + 연령구간별 기준사진.
// PhotoKit 권한(expo-image-picker) → Storage 업로드 → Firestore aiSubjects 저장.
// 기존 타일 흐름/결제/주문 로직과 완전히 분리. 피처 플래그 뒤에서만 동작.
import React, { useState } from "react";
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TextInput,
    Pressable,
    Alert,
    Linking,
    Platform,
    ActivityIndicator,
    Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image as ExpoImage } from "expo-image";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";

import { colors } from "../../src/theme/colors";
import { useLanguage } from "../../src/context/LanguageContext";
import { usePhotobookEnabled } from "../../src/config/featureFlags";
import {
    AGE_BUCKETS,
    AgeBucketId,
    SubjectGender,
} from "../../src/types/aiSubject";
import {
    createSubject,
    SubjectPhotoInput,
    SubjectDraft,
    CreateProgress,
} from "../../src/services/aiSubjects";

const SCREEN_W = Dimensions.get("window").width;
const H_PAD = 20;
const GAP = 10;
const SLOT = Math.floor((SCREEN_W - H_PAD * 2 - GAP * 2) / 3);

const pad2 = (s: string) => (s.length === 1 ? `0${s}` : s);
const onlyDigits = (s: string) => s.replace(/[^0-9]/g, "");

export default function PhotobookRegister() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { t } = useLanguage();
    const enabled = usePhotobookEnabled();

    const [name, setName] = useState("");
    const [year, setYear] = useState("");
    const [month, setMonth] = useState("");
    const [day, setDay] = useState("");
    const [gender, setGender] = useState<SubjectGender>("unspecified");
    const [cover, setCover] = useState<SubjectPhotoInput | null>(null);
    const [anchors, setAnchors] = useState<Record<AgeBucketId, SubjectPhotoInput[]>>({
        "0-3m": [], "3-12m": [], "1-2y": [], "2-3y": [],
    });
    const [saving, setSaving] = useState(false);
    const [progress, setProgress] = useState<CreateProgress | null>(null);

    // 플래그 OFF면 진입(딥링크 포함) 차단
    if (!enabled) return null;

    const genderOptions: { id: SubjectGender; label: string }[] = [
        { id: "boy", label: t.pbGenderBoy },
        { id: "girl", label: t.pbGenderGirl },
        { id: "unspecified", label: t.pbGenderUnspecified },
    ];

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
            quality: 1,
            exif: false,
            base64: false,
        });
        if (result.canceled || !result.assets?.length) return [];
        return result.assets.map((a) => ({
            uri: a.uri,
            width: a.width,
            height: a.height,
            localId: (a as any).assetId ?? null,
        }));
    }

    async function onPickCover() {
        const picked = await pickPhotos(1);
        if (picked[0]) setCover(picked[0]);
    }

    async function onPickAnchor(bucket: AgeBucketId, maxSlots: number) {
        const remaining = maxSlots - anchors[bucket].length;
        if (remaining <= 0) return;
        const picked = await pickPhotos(remaining);
        if (picked.length) {
            setAnchors((prev) => ({ ...prev, [bucket]: [...prev[bucket], ...picked].slice(0, maxSlots) }));
        }
    }

    function removeAnchor(bucket: AgeBucketId, idx: number) {
        setAnchors((prev) => ({ ...prev, [bucket]: prev[bucket].filter((_, i) => i !== idx) }));
    }

    function buildBirthDate(): string | null {
        if (year.length === 4 && month && day) {
            const m = Math.min(12, Math.max(1, parseInt(month, 10) || 0));
            const d = Math.min(31, Math.max(1, parseInt(day, 10) || 0));
            return `${year}-${pad2(String(m))}-${pad2(String(d))}`;
        }
        return null;
    }

    async function onSave() {
        if (!name.trim()) {
            Alert.alert(t.pbErrName);
            return;
        }
        const totalPhotos =
            (cover ? 1 : 0) + AGE_BUCKETS.reduce((n, b) => n + anchors[b.id].length, 0);
        if (totalPhotos === 0) {
            Alert.alert(t.pbErrNoPhoto);
            return;
        }

        const draft: SubjectDraft = {
            name,
            birthDate: buildBirthDate(),
            gender,
            cover,
            anchors,
        };

        setSaving(true);
        setProgress({ done: 0, total: totalPhotos });
        try {
            await createSubject(draft, setProgress);
            Alert.alert(t.pbSaved, undefined, [{ text: "OK", onPress: () => router.back() }]);
        } catch (e: any) {
            Alert.alert("Error", String(e?.message || e));
        } finally {
            setSaving(false);
            setProgress(null);
        }
    }

    return (
        <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
            <View style={styles.header}>
                <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
                    <Feather name="arrow-left" size={24} color={colors.ink} />
                </Pressable>
                <Text style={styles.headerTitle}>{t.pbRegisterTitle}</Text>
                <View style={styles.backBtn} />
            </View>

            <ScrollView
                contentContainerStyle={{ paddingHorizontal: H_PAD, paddingBottom: insets.bottom + 120 }}
                keyboardShouldPersistTaps="handled"
            >
                <Text style={styles.subtitle}>{t.pbRegisterSubtitle}</Text>

                {/* 이름 */}
                <Text style={styles.label}>{t.pbChildNameLabel}</Text>
                <TextInput
                    style={styles.input}
                    value={name}
                    onChangeText={setName}
                    placeholder={t.pbChildNamePlaceholder}
                    placeholderTextColor={colors.textSecondary}
                    maxLength={40}
                />

                {/* 생년월일 (선택) */}
                <View style={styles.labelRow}>
                    <Text style={styles.label}>{t.pbBirthDateLabel}</Text>
                    <Text style={styles.optional}>{t.pbOptional}</Text>
                </View>
                <View style={styles.dateRow}>
                    <TextInput
                        style={[styles.input, styles.dateInput, { flex: 1.4 }]}
                        value={year}
                        onChangeText={(v) => setYear(onlyDigits(v).slice(0, 4))}
                        placeholder={t.pbDateYear}
                        placeholderTextColor={colors.textSecondary}
                        keyboardType="number-pad"
                    />
                    <TextInput
                        style={[styles.input, styles.dateInput, { flex: 1 }]}
                        value={month}
                        onChangeText={(v) => setMonth(onlyDigits(v).slice(0, 2))}
                        placeholder={t.pbDateMonth}
                        placeholderTextColor={colors.textSecondary}
                        keyboardType="number-pad"
                    />
                    <TextInput
                        style={[styles.input, styles.dateInput, { flex: 1 }]}
                        value={day}
                        onChangeText={(v) => setDay(onlyDigits(v).slice(0, 2))}
                        placeholder={t.pbDateDay}
                        placeholderTextColor={colors.textSecondary}
                        keyboardType="number-pad"
                    />
                </View>

                {/* 성별 */}
                <Text style={styles.label}>{t.pbGenderLabel}</Text>
                <View style={styles.genderRow}>
                    {genderOptions.map((g) => {
                        const active = gender === g.id;
                        return (
                            <Pressable
                                key={g.id}
                                style={[styles.genderBtn, active && styles.genderBtnActive]}
                                onPress={() => setGender(g.id)}
                            >
                                <Text style={[styles.genderText, active && styles.genderTextActive]}>{g.label}</Text>
                            </Pressable>
                        );
                    })}
                </View>

                {/* 대표 사진 */}
                <Text style={styles.label}>{t.pbCoverLabel}</Text>
                <Text style={styles.hint}>{t.pbCoverHint}</Text>
                <Pressable style={styles.coverSlot} onPress={onPickCover}>
                    {cover ? (
                        <>
                            <ExpoImage source={{ uri: cover.uri }} style={styles.slotImg} contentFit="cover" />
                            <Pressable style={styles.removeBadge} onPress={() => setCover(null)} hitSlop={8}>
                                <Feather name="x" size={14} color="#fff" />
                            </Pressable>
                        </>
                    ) : (
                        <View style={styles.slotEmpty}>
                            <Feather name="plus" size={26} color={colors.textSecondary} />
                            <Text style={styles.slotAdd}>{t.pbAddPhoto}</Text>
                        </View>
                    )}
                </Pressable>

                {/* 연령 구간별 기준 사진 */}
                <Text style={[styles.label, { marginTop: 24 }]}>{t.pbAnchorsTitle}</Text>
                <Text style={styles.hint}>{t.pbAnchorsHint}</Text>

                {AGE_BUCKETS.map((bucket) => {
                    const list = anchors[bucket.id];
                    return (
                        <View key={bucket.id} style={styles.bucketBlock}>
                            <Text style={styles.bucketLabel}>
                                {(t as any)[bucket.labelKey]}  <Text style={styles.bucketCount}>{list.length}/{bucket.maxSlots}</Text>
                            </Text>
                            <View style={styles.slotsRow}>
                                {Array.from({ length: bucket.maxSlots }).map((_, i) => {
                                    const photo = list[i];
                                    if (photo) {
                                        return (
                                            <View key={i} style={styles.anchorSlot}>
                                                <ExpoImage source={{ uri: photo.uri }} style={styles.slotImg} contentFit="cover" />
                                                <Pressable
                                                    style={styles.removeBadge}
                                                    onPress={() => removeAnchor(bucket.id, i)}
                                                    hitSlop={8}
                                                >
                                                    <Feather name="x" size={13} color="#fff" />
                                                </Pressable>
                                            </View>
                                        );
                                    }
                                    // 첫 번째 빈 슬롯만 누름 가능(나머지는 자리표시)
                                    const isFirstEmpty = i === list.length;
                                    return (
                                        <Pressable
                                            key={i}
                                            style={[styles.anchorSlot, styles.slotEmpty]}
                                            onPress={isFirstEmpty ? () => onPickAnchor(bucket.id, bucket.maxSlots) : undefined}
                                        >
                                            {isFirstEmpty && <Feather name="plus" size={22} color={colors.textSecondary} />}
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </View>
                    );
                })}

                <View style={styles.noteBox}>
                    <Feather name="info" size={15} color={colors.textMuted} style={{ marginTop: 1 }} />
                    <Text style={styles.noteText}>{t.pbNewbornNote}</Text>
                </View>
            </ScrollView>

            {/* 저장 버튼 */}
            <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
                <Pressable
                    style={[styles.saveBtn, saving && { opacity: 0.7 }]}
                    onPress={onSave}
                    disabled={saving}
                >
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
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: H_PAD, paddingBottom: 8 },
    backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 18, fontWeight: "800", color: colors.ink },

    subtitle: { fontSize: 14, color: colors.textMuted, lineHeight: 20, marginTop: 4, marginBottom: 18 },

    label: { fontSize: 15, fontWeight: "700", color: colors.ink, marginTop: 18, marginBottom: 8 },
    labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18, marginBottom: 8 },
    optional: { fontSize: 12, color: colors.textSecondary },
    hint: { fontSize: 13, color: colors.textMuted, marginTop: -2, marginBottom: 10 },

    input: {
        backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
        borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colors.text,
    },
    dateRow: { flexDirection: "row", gap: GAP },
    dateInput: { textAlign: "center" },

    genderRow: { flexDirection: "row", gap: GAP },
    genderBtn: {
        flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
        backgroundColor: colors.surface, alignItems: "center",
    },
    genderBtnActive: { backgroundColor: colors.ink, borderColor: colors.ink },
    genderText: { fontSize: 14, fontWeight: "600", color: colors.textMuted },
    genderTextActive: { color: "#fff" },

    coverSlot: {
        width: SLOT * 1.3, height: SLOT * 1.3, borderRadius: 16, overflow: "hidden",
        backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    },
    slotEmpty: { alignItems: "center", justifyContent: "center" },
    slotAdd: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
    slotImg: { width: "100%", height: "100%" },

    bucketBlock: { marginTop: 16 },
    bucketLabel: { fontSize: 14, fontWeight: "700", color: colors.ink, marginBottom: 8 },
    bucketCount: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
    slotsRow: { flexDirection: "row", gap: GAP },
    anchorSlot: {
        width: SLOT, height: SLOT, borderRadius: 12, overflow: "hidden",
        backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    },
    removeBadge: {
        position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11,
        backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center",
    },

    noteBox: {
        flexDirection: "row", gap: 8, marginTop: 24, padding: 12,
        backgroundColor: colors.fill, borderRadius: 12,
    },
    noteText: { flex: 1, fontSize: 12.5, color: colors.textMuted, lineHeight: 18 },

    footer: {
        position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: H_PAD, paddingTop: 12,
        backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border,
    },
    saveBtn: { height: 56, borderRadius: 16, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
    savingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    saveText: { fontSize: 17, fontWeight: "800", color: "#fff" },
});
