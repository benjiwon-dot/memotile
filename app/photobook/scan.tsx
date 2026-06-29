// app/photobook/scan.tsx
//
// STEP 4: 카메라롤 온디바이스 얼굴 스캔.
// 권한 → 스캔(증분) → 진행바 → "N장 중 얼굴 M장" → 검출 썸네일 그리드.
// 원본 업로드 없음(썸네일+bbox만 로컬 캐시). 기존 타일/결제/orders/admin 무관.
import React, { useEffect, useState } from "react";
import {
    View,
    Text,
    StyleSheet,
    Pressable,
    FlatList,
    Alert,
    Linking,
    ActivityIndicator,
    Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image as ExpoImage } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { colors } from "../../src/theme/colors";
import { useLanguage } from "../../src/context/LanguageContext";
import { usePhotobookEnabled } from "../../src/config/featureFlags";
import {
    scanLibrary,
    getCachedItems,
    requestLibraryPermission,
} from "../../src/services/faceScan";
import { ScanItem, ScanProgress } from "../../src/types/scan";

const SCREEN_W = Dimensions.get("window").width;
const H_PAD = 20;
const GAP = 6;
const COLS = 3;
const CELL = Math.floor((SCREEN_W - H_PAD * 2 - GAP * (COLS - 1)) / COLS);

export default function PhotobookScan() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { t } = useLanguage();
    const enabled = usePhotobookEnabled();

    const [scanning, setScanning] = useState(false);
    const [progress, setProgress] = useState<ScanProgress | null>(null);
    const [items, setItems] = useState<ScanItem[]>([]);
    const [limited, setLimited] = useState(false);

    useEffect(() => {
        // 이전 스캔 결과(캐시) 미리 로드
        getCachedItems().then((cached) => {
            setItems(cached.filter((i) => i.faces.length > 0));
        });
    }, []);

    if (!enabled) return null;

    const faceItems = items; // 이미 얼굴 있는 것만 보관

    async function onScan() {
        const perm = await requestLibraryPermission();
        if (!perm.granted) {
            Alert.alert(t.permissionDeniedTitle, t.permissionDeniedBody, [
                { text: t.cancel, style: "cancel" },
                { text: t.openSettings, onPress: () => Linking.openSettings() },
            ]);
            return;
        }
        setLimited(perm.accessPrivileges === "limited");

        setScanning(true);
        setProgress({ scanned: 0, total: 0, withFaces: 0 });
        try {
            const { items: all } = await scanLibrary((p) => setProgress(p));
            setItems(all.filter((i) => i.faces.length > 0));
        } catch (e: any) {
            Alert.alert("Error", String(e?.message || e));
        } finally {
            setScanning(false);
        }
    }

    const pct = progress && progress.total > 0 ? Math.min(1, progress.scanned / progress.total) : 0;
    const hasResults = faceItems.length > 0;

    return (
        <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
            <View style={styles.header}>
                <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
                    <Feather name="arrow-left" size={24} color={colors.ink} />
                </Pressable>
                <Text style={styles.headerTitle}>{t.pbScanTitle}</Text>
                <View style={styles.backBtn} />
            </View>

            <Text style={styles.intro}>{t.pbScanIntro}</Text>

            {/* 진행/요약 카드 */}
            <View style={styles.statusCard}>
                {scanning ? (
                    <>
                        <View style={styles.statusRow}>
                            <ActivityIndicator color={colors.ink} />
                            <Text style={styles.statusText}>
                                {t.pbScanning} {progress?.scanned ?? 0}
                                {progress && progress.total > 0 ? ` / ${progress.total}` : ""}
                            </Text>
                        </View>
                        <View style={styles.barTrack}>
                            <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` }]} />
                        </View>
                        <Text style={styles.statusSub}>
                            {t.pbScanWithFaces}: {progress?.withFaces ?? 0}
                        </Text>
                    </>
                ) : (
                    <>
                        <Text style={styles.summaryBig}>
                            {faceItems.length}{" "}
                            <Text style={styles.summaryBigLabel}>{t.pbScanWithFaces}</Text>
                        </Text>
                        {limited && <Text style={styles.limitedNote}>{t.pbScanLimited}</Text>}
                        <Pressable style={styles.scanBtn} onPress={onScan}>
                            <Feather name="search" size={18} color="#fff" style={{ marginRight: 8 }} />
                            <Text style={styles.scanBtnText}>
                                {hasResults ? t.pbScanRescan : t.pbScanStart}
                            </Text>
                        </Pressable>
                    </>
                )}
            </View>

            {/* 검출 썸네일 그리드 */}
            {hasResults ? (
                <FlatList
                    data={faceItems}
                    keyExtractor={(it) => it.assetId}
                    numColumns={COLS}
                    columnWrapperStyle={{ gap: GAP }}
                    contentContainerStyle={{ paddingHorizontal: H_PAD, paddingBottom: insets.bottom + 24, gap: GAP }}
                    renderItem={({ item }) => (
                        <View style={styles.cell}>
                            <ExpoImage source={{ uri: item.thumbUri }} style={styles.cellImg} contentFit="cover" />
                            {item.faces.length > 1 && (
                                <View style={styles.faceBadge}>
                                    <Feather name="users" size={11} color="#fff" />
                                    <Text style={styles.faceBadgeText}>{item.faces.length}</Text>
                                </View>
                            )}
                        </View>
                    )}
                />
            ) : (
                !scanning && (
                    <View style={styles.empty}>
                        <Feather name="image" size={40} color={colors.textSecondary} />
                        <Text style={styles.emptyText}>{t.pbScanNoResults}</Text>
                    </View>
                )
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: H_PAD, paddingBottom: 8 },
    backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 18, fontWeight: "800", color: colors.ink },
    intro: { fontSize: 13, color: colors.textMuted, lineHeight: 19, paddingHorizontal: H_PAD, marginBottom: 14 },

    statusCard: {
        marginHorizontal: H_PAD, marginBottom: 16, padding: 16,
        backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
    },
    statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    statusText: { fontSize: 15, fontWeight: "700", color: colors.ink },
    statusSub: { fontSize: 13, color: colors.textMuted, marginTop: 8 },
    barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.fill, marginTop: 12, overflow: "hidden" },
    barFill: { height: 8, borderRadius: 4, backgroundColor: colors.ink },

    summaryBig: { fontSize: 28, fontWeight: "900", color: colors.ink },
    summaryBigLabel: { fontSize: 15, fontWeight: "600", color: colors.textMuted },
    limitedNote: { fontSize: 12.5, color: colors.textMuted, lineHeight: 18, marginTop: 8 },

    scanBtn: {
        flexDirection: "row", alignItems: "center", justifyContent: "center",
        height: 50, borderRadius: 14, backgroundColor: colors.ink, marginTop: 14,
    },
    scanBtnText: { fontSize: 16, fontWeight: "800", color: "#fff" },

    cell: { width: CELL, height: CELL, borderRadius: 10, overflow: "hidden", backgroundColor: colors.fill },
    cellImg: { width: "100%", height: "100%" },
    faceBadge: {
        position: "absolute", top: 4, right: 4, flexDirection: "row", alignItems: "center", gap: 3,
        paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.6)",
    },
    faceBadgeText: { fontSize: 11, fontWeight: "700", color: "#fff" },

    empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, marginTop: -40 },
    emptyText: { fontSize: 14, color: colors.textSecondary },
});
