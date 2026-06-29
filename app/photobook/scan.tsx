// app/photobook/scan.tsx
//
// STEP 5: "Find {name}'s photos" 파이프라인.
//  검출(전체 라이브러리) → 매칭(이 subject 얼굴만) → 미리보기 그리드(체크 선택).
//  진행: "검출 N → 매칭 M". 강제 업로드 절대 X — 후보를 보여주고 부모가 체크 선택.
import React, { useEffect, useRef, useState } from "react";
import {
    View, Text, StyleSheet, Pressable, FlatList, Alert, Linking, Animated, Dimensions,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image as ExpoImage } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { useLanguage } from "../../src/context/LanguageContext";
import { usePhotobookEnabled } from "../../src/config/featureFlags";
import { usePhotobookTheme, pbRadius } from "../../src/config/photobookTheme";
import { PhotobookGradient } from "../../src/components/photobook/PhotobookGradient";
import { scanLibrary, requestLibraryPermission } from "../../src/services/faceScan";
import { getSubject } from "../../src/services/aiSubjects";
import { buildAnchorSet, matchSubject, MatchedItem } from "../../src/services/faceMatch";
import { AiSubject } from "../../src/types/aiSubject";
import { ScanProgress } from "../../src/types/scan";

const SCREEN_W = Dimensions.get("window").width;
const H_PAD = 20;
const GAP = 6;
const COLS = 3;
const CELL = Math.floor((SCREEN_W - H_PAD * 2 - GAP * (COLS - 1)) / COLS);

type Phase = "idle" | "scanning" | "matching" | "done";

export default function PhotobookScan() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { t } = useLanguage();
    const c = usePhotobookTheme();
    const enabled = usePhotobookEnabled();
    const params = useLocalSearchParams<{ subjectId?: string; name?: string }>();
    const subjectId = typeof params.subjectId === "string" ? params.subjectId : "";
    const name = typeof params.name === "string" ? params.name : "";

    const [phase, setPhase] = useState<Phase>("idle");
    const [scanProg, setScanProg] = useState<ScanProgress | null>(null);
    const [matchProg, setMatchProg] = useState<{ done: number; total: number; matched: number } | null>(null);
    const [items, setItems] = useState<MatchedItem[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [denied, setDenied] = useState(false);

    const pulse = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
            Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
        ]));
        loop.start();
        return () => loop.stop();
    }, [pulse]);

    useEffect(() => {
        run();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function run() {
        const perm = await requestLibraryPermission();
        if (!perm.granted) {
            setDenied(true);
            Alert.alert(t.permissionDeniedTitle, t.permissionDeniedBody, [
                { text: t.cancel, style: "cancel" },
                { text: t.openSettings, onPress: () => Linking.openSettings() },
            ]);
            return;
        }
        setDenied(false);

        const subject: AiSubject | null = subjectId ? await getSubject(subjectId) : null;

        // 1) 검출
        setPhase("scanning");
        setScanProg({ scanned: 0, total: 0, withFaces: 0 });
        const { items: all } = await scanLibrary((p) => setScanProg(p));
        const faceItems = all.filter((i) => i.faces.length > 0);

        // 2) 매칭 (subject 있으면 그 얼굴만)
        if (subject) {
            setPhase("matching");
            setMatchProg({ done: 0, total: faceItems.length, matched: 0 });
            const anchorSet = await buildAnchorSet(subject);
            const matched = matchSubject(faceItems, anchorSet, (done, total, m) =>
                setMatchProg({ done, total, matched: m })
            );
            setItems(matched);
        } else {
            setItems(faceItems.map((i) => ({ ...i, score: 0, ageMonths: null })));
        }
        setPhase("done");
    }

    function toggle(id: string) {
        setSelected((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    }

    if (!enabled) return null;

    const scanning = phase === "scanning" || phase === "matching";
    const scanPct = scanProg && scanProg.total > 0 ? Math.min(1, scanProg.scanned / scanProg.total) : 0;
    const matchPct = matchProg && matchProg.total > 0 ? Math.min(1, matchProg.done / matchProg.total) : 0;
    const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });

    return (
        <View style={[styles.container, { backgroundColor: c.bg, paddingTop: insets.top + 8 }]}>
            <View style={styles.header}>
                <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconBtn}>
                    <Feather name="arrow-left" size={24} color={c.ink} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: c.ink }]} numberOfLines={1}>{name || t.pbScanTitle}</Text>
                <View style={styles.iconBtn} />
            </View>

            {scanning ? (
                <View style={styles.loading}>
                    <Animated.View style={{ transform: [{ scale }] }}>
                        <PhotobookGradient colors={c.gradient} radius={pbRadius.pill} style={styles.pulseCircle}>
                            <Feather name="aperture" size={42} color="#fff" />
                        </PhotobookGradient>
                    </Animated.View>

                    {phase === "scanning" ? (
                        <>
                            <Text style={[styles.loadingTitle, { color: c.ink }]}>{t.pbDetecting}</Text>
                            <View style={[styles.barTrack, { backgroundColor: c.surfaceAlt }]}>
                                <View style={{ width: `${Math.round(scanPct * 100)}%`, height: "100%" }}>
                                    <PhotobookGradient colors={c.gradient} radius={pbRadius.pill} style={{ flex: 1 }} />
                                </View>
                            </View>
                            <Text style={[styles.countMuted, { color: c.textMuted }]}>
                                {scanProg?.scanned ?? 0}{scanProg && scanProg.total > 0 ? ` / ${scanProg.total}` : ""}
                            </Text>
                            <Text style={[styles.facesFound, { color: c.coral }]}>
                                {scanProg?.withFaces ?? 0} {t.pbScanWithFaces}
                            </Text>
                        </>
                    ) : (
                        <>
                            <Text style={[styles.loadingTitle, { color: c.ink }]}>{t.pbMatching}</Text>
                            <View style={[styles.barTrack, { backgroundColor: c.surfaceAlt }]}>
                                <View style={{ width: `${Math.round(matchPct * 100)}%`, height: "100%" }}>
                                    <PhotobookGradient colors={c.gradient} radius={pbRadius.pill} style={{ flex: 1 }} />
                                </View>
                            </View>
                            <Text style={[styles.facesFound, { color: c.coral }]}>
                                {matchProg?.matched ?? 0} {t.pbMatched}
                            </Text>
                        </>
                    )}
                </View>
            ) : (
                <FlatList
                    data={items}
                    keyExtractor={(it) => it.assetId}
                    numColumns={COLS}
                    columnWrapperStyle={{ gap: GAP }}
                    ListHeaderComponent={
                        <View style={styles.previewHead}>
                            <Text style={[styles.previewTitle, { color: c.ink }]}>{t.pbPreviewTitle}</Text>
                            <Text style={[styles.previewSub, { color: c.textSecondary }]}>
                                {items.length} {t.pbMatched}
                                {selected.size > 0 ? ` · ${selected.size} ${t.pbSelected}` : ""}
                            </Text>
                        </View>
                    }
                    contentContainerStyle={{ paddingHorizontal: H_PAD, paddingBottom: insets.bottom + 24, gap: GAP }}
                    ListEmptyComponent={
                        denied ? (
                            <Pressable onPress={run} style={[styles.retry, { borderColor: c.peach, backgroundColor: c.surfaceAlt }]}>
                                <Text style={{ color: c.coral, fontWeight: "700" }}>{t.pbScanStart}</Text>
                            </Pressable>
                        ) : (
                            <View style={styles.empty}>
                                <Feather name="image" size={40} color={c.textMuted} />
                                <Text style={{ color: c.textSecondary, marginTop: 10 }}>{t.pbScanNoResults}</Text>
                            </View>
                        )
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

    loading: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, marginTop: -40 },
    pulseCircle: { width: 110, height: 110, alignItems: "center", justifyContent: "center", marginBottom: 28 },
    loadingTitle: { fontSize: 20, fontWeight: "800", marginBottom: 24 },
    barTrack: { width: "100%", height: 10, borderRadius: 999, overflow: "hidden" },
    countMuted: { fontSize: 14, fontWeight: "600", marginTop: 12 },
    facesFound: { fontSize: 16, fontWeight: "800", marginTop: 6 },

    previewHead: { paddingVertical: 16 },
    previewTitle: { fontSize: 22, fontWeight: "800" },
    previewSub: { fontSize: 14, fontWeight: "600", marginTop: 3 },

    cell: { width: CELL, height: CELL, borderRadius: 10, overflow: "hidden" },
    cellImg: { width: "100%", height: "100%" },
    check: {
        position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: 12, borderWidth: 2,
        alignItems: "center", justifyContent: "center",
    },
    selOverlay: { ...StyleSheet.absoluteFillObject, borderWidth: 3, borderRadius: 10 },

    empty: { alignItems: "center", justifyContent: "center", paddingTop: 80 },
    retry: { alignSelf: "center", marginTop: 80, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 14, borderWidth: 1.5 },
});
