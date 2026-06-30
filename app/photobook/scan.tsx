// app/photobook/scan.tsx
//
// STEP 5 (점진적): "Find {name}'s photos".
//  최근 사진부터 200장씩 배치 → 검출 → 후보만 임베딩·매칭 → 매칭분 즉시 그리드 추가.
//  "Find more"로 다음 배치. 전체 완료 안 기다림. 강제 업로드 X.
import React, { useEffect, useRef, useState } from "react";
import {
    View, Text, StyleSheet, Pressable, FlatList, Alert, Linking, Animated, ActivityIndicator, Dimensions,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image as ExpoImage } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { useLanguage } from "../../src/context/LanguageContext";
import { usePhotobookEnabled } from "../../src/config/featureFlags";
import { usePhotobookTheme, pbRadius } from "../../src/config/photobookTheme";
import { PhotobookGradient } from "../../src/components/photobook/PhotobookGradient";
import { scanBatch, getLibraryCounts, requestLibraryPermission } from "../../src/services/faceScan";
import { getSubject } from "../../src/services/aiSubjects";
import { buildAnchorSet, matchItemsBatch, AnchorSet, MatchedItem } from "../../src/services/faceMatch";

const SCREEN_W = Dimensions.get("window").width;
const H_PAD = 20;
const GAP = 6;
const COLS = 3;
const CELL = Math.floor((SCREEN_W - H_PAD * 2 - GAP * (COLS - 1)) / COLS);
const BATCH = 200;

function useCountUp(target: number, ms = 700): number {
    const [val, setVal] = useState(0);
    useEffect(() => {
        if (target <= 0) { setVal(0); return; }
        const start = Date.now();
        const id = setInterval(() => {
            const p = Math.min(1, (Date.now() - start) / ms);
            setVal(Math.round(target * p));
            if (p >= 1) clearInterval(id);
        }, 16);
        return () => clearInterval(id);
    }, [target, ms]);
    return val;
}

function fmtDate(iso: string | null): string {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${y}.${m}.${d}`;
}

export default function PhotobookScan() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { t } = useLanguage();
    const c = usePhotobookTheme();
    const enabled = usePhotobookEnabled();
    const params = useLocalSearchParams<{ subjectId?: string; name?: string }>();
    const subjectId = typeof params.subjectId === "string" ? params.subjectId : "";
    const name = typeof params.name === "string" ? params.name : "";

    const [counts, setCounts] = useState<{ total: number; narrowed: number; birthDate: string | null } | null>(null);
    const [matched, setMatched] = useState<MatchedItem[]>([]);
    const [scanned, setScanned] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [started, setStarted] = useState(false);  // 첫 배치 완료 여부
    const [loadingMore, setLoadingMore] = useState(false);
    const [denied, setDenied] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const anchorRef = useRef<AnchorSet | null>(null);
    const afterRef = useRef<string | undefined>(undefined);
    const sinceRef = useRef<number | undefined>(undefined);
    const loadingRef = useRef(false);

    const float = useRef(new Animated.Value(0)).current;
    const op1 = useRef(new Animated.Value(0)).current;
    const op2 = useRef(new Animated.Value(0)).current;
    const totalUp = useCountUp(counts?.total ?? 0);
    const narrowedUp = useCountUp(counts?.narrowed ?? 0);

    useEffect(() => {
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(float, { toValue: 1, duration: 1400, useNativeDriver: true }),
            Animated.timing(float, { toValue: 0, duration: 1400, useNativeDriver: true }),
        ]));
        loop.start();
        return () => loop.stop();
    }, [float]);

    useEffect(() => {
        if (!counts) return;
        Animated.sequence([
            Animated.timing(op1, { toValue: 1, duration: 350, useNativeDriver: true }),
            Animated.timing(op2, { toValue: 1, duration: 350, delay: 250, useNativeDriver: true }),
        ]).start();
    }, [counts, op1, op2]);

    useEffect(() => {
        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function init() {
        const perm = await requestLibraryPermission();
        if (!perm.granted) {
            setDenied(true);
            Alert.alert(t.permissionDeniedTitle, t.permissionDeniedBody, [
                { text: t.cancel, style: "cancel" },
                { text: t.openSettings, onPress: () => Linking.openSettings() },
            ]);
            return;
        }
        const subject = subjectId ? await getSubject(subjectId) : null;
        sinceRef.current = subject?.birthDate ? new Date(subject.birthDate).getTime() : undefined;
        const { total, narrowed } = await getLibraryCounts(sinceRef.current);
        setCounts({ total, narrowed, birthDate: subject?.birthDate ?? null });
        if (subject) anchorRef.current = await buildAnchorSet(subject);
        await loadBatch(); // 첫 배치
    }

    async function loadBatch() {
        if (loadingRef.current || (!hasMore && started)) return;
        loadingRef.current = true;
        if (started) setLoadingMore(true);
        try {
            const res = await scanBatch({ after: afterRef.current, sinceMs: sinceRef.current, batchSize: BATCH });
            afterRef.current = res.nextAfter;
            const m = anchorRef.current
                ? await matchItemsBatch(res.items, anchorRef.current)
                : res.items.map((i) => ({ ...i, score: 0, ageMonths: null }));
            setMatched((prev) => [...prev, ...m]);
            setScanned((prev) => prev + res.scannedDelta);
            setHasMore(res.hasMore);
        } catch (e: any) {
            Alert.alert("Error", String(e?.message || e));
        } finally {
            setStarted(true);
            setLoadingMore(false);
            loadingRef.current = false;
        }
    }

    function toggle(id: string) {
        setSelected((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    }

    if (!enabled) return null;

    const floatY = float.interpolate({ inputRange: [0, 1], outputRange: [-8, 8] });
    const narrowedShown = !!counts && counts.narrowed < counts.total && !!counts.birthDate;

    return (
        <View style={[styles.container, { backgroundColor: c.bg, paddingTop: insets.top + 8 }]}>
            <View style={styles.header}>
                <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconBtn}>
                    <Feather name="arrow-left" size={24} color={c.ink} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: c.ink }]} numberOfLines={1}>{name || t.pbScanTitle}</Text>
                <View style={styles.iconBtn} />
            </View>

            {!started ? (
                // 첫 배치 로딩 (둥둥 + 단계 카운트업)
                <View style={styles.loading}>
                    <Animated.View style={{ transform: [{ translateY: floatY }] }}>
                        <PhotobookGradient colors={c.gradient} radius={pbRadius.pill} style={styles.pulseCircle}>
                            <Feather name="aperture" size={42} color="#fff" />
                        </PhotobookGradient>
                    </Animated.View>
                    {counts && (
                        <View style={[styles.stageCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                            <Animated.View style={[styles.stageRow, { opacity: op1 }]}>
                                <Text style={[styles.stageLabel, { color: c.textSecondary }]}>{t.pbAllPhotos}</Text>
                                <Text style={[styles.stageNum, { color: c.ink }]}>{totalUp.toLocaleString()}</Text>
                            </Animated.View>
                            {narrowedShown && (
                                <Animated.View style={{ opacity: op2 }}>
                                    <Text style={[styles.stageName, { color: c.coral }]} numberOfLines={1}>{name} · {fmtDate(counts!.birthDate)}</Text>
                                    <View style={[styles.stageRow, { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8, marginTop: 8 }]}>
                                        <Text style={[styles.stageLabel, { color: c.textSecondary }]}>{t.pbSinceBirth}</Text>
                                        <Text style={[styles.stageNum, { color: c.coral }]}>{narrowedUp.toLocaleString()}</Text>
                                    </View>
                                </Animated.View>
                            )}
                        </View>
                    )}
                    <Text style={[styles.loadingTitle, { color: c.ink }]}>{t.pbDetecting}</Text>
                    <ActivityIndicator color={c.coral} />
                    {denied && (
                        <Pressable onPress={() => loadBatch()} style={[styles.retry, { borderColor: c.peach, backgroundColor: c.surfaceAlt }]}>
                            <Text style={{ color: c.coral, fontWeight: "700" }}>{t.pbScanStart}</Text>
                        </Pressable>
                    )}
                </View>
            ) : (
                <FlatList
                    data={matched}
                    keyExtractor={(it) => it.assetId}
                    numColumns={COLS}
                    columnWrapperStyle={{ gap: GAP }}
                    ListHeaderComponent={
                        <View style={styles.previewHead}>
                            <Text style={[styles.previewTitle, { color: c.ink }]}>{t.pbPreviewTitle}</Text>
                            <Text style={[styles.previewSub, { color: c.textSecondary }]}>
                                {scanned.toLocaleString()} {t.pbScanned} · {matched.length} {t.pbMatched}
                                {selected.size > 0 ? ` · ${selected.size} ${t.pbSelected}` : ""}
                            </Text>
                        </View>
                    }
                    contentContainerStyle={{ paddingHorizontal: H_PAD, paddingBottom: insets.bottom + 32, gap: GAP }}
                    ListEmptyComponent={
                        <View style={styles.empty}>
                            <Feather name="image" size={40} color={c.textMuted} />
                            <Text style={{ color: c.textSecondary, marginTop: 10 }}>{t.pbScanNoResults}</Text>
                        </View>
                    }
                    ListFooterComponent={
                        <View style={{ paddingTop: 16 }}>
                            {hasMore ? (
                                <Pressable
                                    onPress={() => loadBatch()}
                                    disabled={loadingMore}
                                    style={[styles.loadMore, { backgroundColor: c.surfaceAlt, borderColor: c.peach }]}
                                >
                                    {loadingMore ? (
                                        <ActivityIndicator color={c.coral} />
                                    ) : (
                                        <Text style={{ color: c.coral, fontWeight: "800", fontSize: 15 }}>
                                            {t.pbLoadMore} · {scanned.toLocaleString()}/{counts?.narrowed?.toLocaleString() ?? "?"}
                                        </Text>
                                    )}
                                </Pressable>
                            ) : (
                                <Text style={[styles.allDone, { color: c.textMuted }]}>{t.pbAllDone}</Text>
                            )}
                        </View>
                    }
                    renderItem={({ item }) => {
                        const on = selected.has(item.assetId);
                        return (
                            <Pressable style={styles.cell} onPress={() => toggle(item.assetId)}>
                                <ExpoImage source={{ uri: item.thumbUri }} style={styles.cellImg} contentFit="cover" />
                                <View style={[styles.check, on
                                    ? { backgroundColor: c.coral, borderColor: c.coral }
                                    : { backgroundColor: "rgba(0,0,0,0.25)", borderColor: "#fff" }]}>
                                    {on && <Feather name="check" size={14} color="#fff" />}
                                </View>
                                {on && <View style={[styles.selOverlay, { borderColor: c.coral }]} />}
                            </Pressable>
                        );
                    }}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: H_PAD, paddingBottom: 8 },
    iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 18, fontWeight: "800", flex: 1, textAlign: "center" },

    loading: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, marginTop: -20 },
    pulseCircle: { width: 104, height: 104, alignItems: "center", justifyContent: "center", marginBottom: 20 },
    stageCard: { width: "100%", borderRadius: 16, borderWidth: 1, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 24 },
    stageRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    stageLabel: { fontSize: 14, fontWeight: "600", flex: 1, marginRight: 10 },
    stageNum: { fontSize: 20, fontWeight: "800" },
    stageName: { fontSize: 15, fontWeight: "800", marginTop: 10 },
    loadingTitle: { fontSize: 18, fontWeight: "800", marginBottom: 14 },

    previewHead: { paddingVertical: 16 },
    previewTitle: { fontSize: 22, fontWeight: "800" },
    previewSub: { fontSize: 14, fontWeight: "600", marginTop: 3 },

    cell: { width: CELL, height: CELL, borderRadius: 10, overflow: "hidden" },
    cellImg: { width: "100%", height: "100%" },
    check: { position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center" },
    selOverlay: { ...StyleSheet.absoluteFillObject, borderWidth: 3, borderRadius: 10 },

    loadMore: { height: 52, borderRadius: 16, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
    allDone: { textAlign: "center", fontSize: 13, fontWeight: "600", paddingVertical: 8 },
    empty: { alignItems: "center", justifyContent: "center", paddingTop: 80 },
    retry: { marginTop: 20, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 14, borderWidth: 1.5 },
});
