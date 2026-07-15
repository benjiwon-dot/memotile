// app/photobook/scan.tsx
//
// ② 디텍팅(최근 600장 빠른 스캔, 회전문구 애니메이션 + determinate 바) → ③ 결과(년/월 그룹).
//  결과: 기본 전체선택(지우기 중심) · 사진 탭=갤러리 미리보기 · sticky 하단바(Find more + 앨범 만들기).
//  Find more = 더 옛날 배치 이어 스캔(새 사진 코랄 테두리). 강제 업로드 X.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    View, Text, StyleSheet, Pressable, SectionList, Alert, Linking, Animated, Dimensions, Easing, ScrollView, LayoutAnimation, ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image as ExpoImage } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { useLanguage } from "../../src/context/LanguageContext";
import { usePhotobookEnabled } from "../../src/config/featureFlags";
import { usePhotobookTheme, pbRadius } from "../../src/config/photobookTheme";
import { PhotobookGradient } from "../../src/components/photobook/PhotobookGradient";
import { PhotoPreviewModal } from "../../src/components/photobook/PhotoPreviewModal";
import { ChronoRangeSlider } from "../../src/components/photobook/ChronoRangeSlider";
import { scanBatch, getLibraryCounts, requestLibraryPermission, flushScanCache } from "../../src/services/faceScan";
import { warmUpFace, scanAsset } from "../../modules/vision-face";
import { thumbPath } from "../../src/services/scanCache";
import { getSubject } from "../../src/services/aiSubjects";
import { AiSubject } from "../../src/types/aiSubject";
import { buildAnchorSet, matchItemsBatch, AnchorSet, MatchedItem } from "../../src/services/faceMatch";
import * as ImagePicker from "expo-image-picker";
import { setAlbumDraft } from "../../src/services/albumDraft";
import { groupByMonth, dedupeBursts } from "../../src/utils/photoGroups";
import { matchConfig } from "../../src/config/matchConfig";

const SCREEN_W = Dimensions.get("window").width;
const H_PAD = 20;
const GAP = 6;
const COLS = 3;
const CELL = Math.floor((SCREEN_W - H_PAD * 2 - GAP * (COLS - 1)) / COLS);
const BATCH = 100; // 배치 축소 → 카운트 갱신 촘촘 + 경계 멈칫 작게
const MIN_PHOTOS = 25; // 48p 책을 채우는 최소 사진 수(게이트). 나중에 조정 쉽게 여기서.

function fmtDate(iso: string | null): string {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${y}.${m}.${d}`;
}
function ageLabel(birth: string | null, mo: string, yr: string): string {
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

type Phase = "setup" | "detecting" | "ready" | "denied";
type PeriodMode = "year" | "recent6" | "custom";

function monthsAgo(n: number): number {
    const d = new Date();
    d.setMonth(d.getMonth() - n);
    return d.getTime();
}

export default function PhotobookScan() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { t, locale } = useLanguage();
    const c = usePhotobookTheme();
    const enabled = usePhotobookEnabled();
    const params = useLocalSearchParams<{ subjectId?: string; name?: string }>();
    const subjectId = typeof params.subjectId === "string" ? params.subjectId : "";
    const name = typeof params.name === "string" ? params.name : "";

    const [phase, setPhase] = useState<Phase>("setup");
    const [stage, setStage] = useState<"anchor" | "scan">("anchor"); // anchor=프로필 임베딩 중, scan=배치 검색 중
    // 스캔 전 기간 설정
    const [subjectInfo, setSubjectInfo] = useState<{ birthDate: string | null; coverUrl: string | null } | null>(null);
    const [prepared, setPrepared] = useState(false); // getSubject 완료 후에만 그려서 "비었다 채워지는" 깜빡임 방지
    const [periodMode, setPeriodMode] = useState<PeriodMode>("year");
    const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
    // 연대기 슬라이더(custom 범위) — ms
    const [sliderStartMs, setSliderStartMs] = useState<number>(monthsAgo(12));
    const [sliderEndMs, setSliderEndMs] = useState<number>(Date.now());
    const [counts, setCounts] = useState<{ total: number; narrowed: number; birthDate: string | null; coverUrl: string | null } | null>(null);
    const [scanned, setScanned] = useState(0);
    const [matched, setMatched] = useState<MatchedItem[]>([]);
    const [deselected, setDeselected] = useState<Set<string>>(new Set()); // 실제 제외된(앨범 빠짐)
    const [marked, setMarked] = useState<Set<string>>(new Set()); // 제거 대상으로 찍은 것(핑크 체크, 아직 제외 전)
    const [newIds, setNewIds] = useState<Set<string>>(new Set());
    const [hasMore, setHasMore] = useState(true);
    const [nearMissItems, setNearMissItems] = useState<MatchedItem[]>([]); // find more (b) 관대 패스 버킷
    const [manualItems, setManualItems] = useState<MatchedItem[]>([]); // 갤러리에서 직접 추가(얼굴매칭 건너뜀)
    const [rotIdx, setRotIdx] = useState(0);
    const [preview, setPreview] = useState<{ visible: boolean; index: number }>({ visible: false, index: 0 });
    const [displayCount, setDisplayCount] = useState(0); // 부드러운 카운트업 표시값(처리 장수)
    const [displayMatched, setDisplayMatched] = useState(0); // 부드러운 카운트업(찾은 사진 수)

    const anchorRef = useRef<AnchorSet | null>(null);
    const subjectRef = useRef<AiSubject | null>(null);
    const afterRef = useRef<string | undefined>(undefined);
    const sinceRef = useRef<number | undefined>(undefined);
    const untilRef = useRef<number | undefined>(undefined);
    const hasMoreRef = useRef(true);
    const loadingRef = useRef(false);
    const scanningRef = useRef(false); // startScan 재진입 방지(더블탭/Pressable 더블파이어 → 앵커 중복임베딩 방지)
    const seenRef = useRef<Set<string>>(new Set());
    const seenNearRef = useRef<Set<string>>(new Set()); // near-miss 중복 방지
    const scannedTotalRef = useRef(0); // perf 실측 누적
    const maxScanRef = useRef(0);  // 표시 카운터 단조(내려감 방지)
    const maxMatchRef = useRef(0); // 매칭 카운터 단조(dedup 병합으로 줄어들어도 안 내려가게)
    const narrowedRef = useRef(0);
    const scanStartRef = useRef(0); // 스캔 시작 시각(ETA 계산)

    const float = useRef(new Animated.Value(0)).current;
    const heart = useRef(new Animated.Value(0)).current;
    const rotAnim = useRef(new Animated.Value(1)).current;
    const countAnim = useRef(new Animated.Value(0)).current; // 처리 장수 카운트업
    const matchAnim = useRef(new Animated.Value(0)).current; // 찾은 사진 수 카운트업

    useEffect(() => {
        Animated.loop(Animated.sequence([
            Animated.timing(float, { toValue: 1, duration: 1400, useNativeDriver: true }),
            Animated.timing(float, { toValue: 0, duration: 1400, useNativeDriver: true }),
        ])).start();
        Animated.loop(Animated.sequence([
            Animated.timing(heart, { toValue: 1, duration: 600, useNativeDriver: true }),
            Animated.timing(heart, { toValue: 0, duration: 600, useNativeDriver: true }),
        ])).start();
    }, [float, heart]);

    // 회전 문구 (페이드+슬라이드 인)
    useEffect(() => {
        if (phase !== "detecting") return;
        const id = setInterval(() => {
            rotAnim.setValue(0);
            Animated.timing(rotAnim, { toValue: 1, duration: 450, useNativeDriver: true }).start();
            setRotIdx((i) => i + 1);
        }, 1900);
        return () => clearInterval(id);
    }, [phase, rotAnim]);

    // 카운트업: scanned가 청크로 오르면 표시 숫자는 스르륵 따라오름(툭툭 X).
    useEffect(() => {
        const id = countAnim.addListener(({ value }) => setDisplayCount(Math.round(value)));
        return () => countAnim.removeListener(id);
    }, [countAnim]);
    useEffect(() => {
        const tgt = counts?.narrowed ?? 0; // 전체 대상 장수 기준
        const capped = tgt > 0 ? Math.min(scanned, tgt) : scanned;
        const t = Math.max(maxScanRef.current, capped); maxScanRef.current = t; // 절대 안 내려가게
        Animated.timing(countAnim, {
            toValue: t,
            duration: 450, easing: Easing.out(Easing.quad),
            useNativeDriver: false,
        }).start();
    }, [scanned, counts, countAnim]);
    // 찾은 사진 수도 부드럽게
    useEffect(() => {
        const id = matchAnim.addListener(({ value }) => setDisplayMatched(Math.round(value)));
        return () => matchAnim.removeListener(id);
    }, [matchAnim]);
    // 표시 카운트는 dedupe(연속·동일컷 묶음) 후 수 → 앨범 장수와 일치("6 검출인데 5장" 혼란 제거)
    const dedupedCount = useMemo(() => dedupeBursts(matched, matchConfig.dedupeBurstWindowMs, matchConfig.dedupeBurstScoreEps).length, [matched]);
    useEffect(() => {
        const t = Math.max(maxMatchRef.current, dedupedCount); maxMatchRef.current = t; // dedup 병합으로 줄어도 안 내려가게
        Animated.timing(matchAnim, { toValue: t, duration: 450, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
    }, [dedupedCount, matchAnim]);

    // 마운트: 스캔 전 기간 설정용 프로필 정보만 로드(권한/스캔 X).
    useEffect(() => { prepare(); /* eslint-disable-next-line */ }, []);
    async function prepare() {
        try {
            const subject = subjectId ? await getSubject(subjectId) : null;
            subjectRef.current = subject;
            setSubjectInfo({ birthDate: subject?.birthDate ?? null, coverUrl: subject?.cover?.url ?? null });
            // 기본: 슬라이더 두 핸들을 생일~오늘 "양 끝"(풀)로. 상단 올해 버튼 선택(코랄), 슬라이더는 회색 대기.
            const birth = subject?.birthDate ? new Date(subject.birthDate).getTime() : monthsAgo(12);
            setPeriodMode("year");
            setSelectedYear(new Date().getFullYear());
            setSliderStartMs(birth);
            setSliderEndMs(Date.now());
        } finally {
            setPrepared(true); // 실패해도 로더에 갇히지 않게
        }
    }

    // 슬라이더가 항상 현재 선택 범위를 반영 → 스캔 범위 = 슬라이더 값.
    function computeRange(): { sinceMs?: number; untilMs?: number } {
        return { sinceMs: sliderStartMs, untilMs: sliderEndMs };
    }

    // 프리셋 선택 = 슬라이더를 그 범위로 이동(강조는 버튼에). 슬라이더 직접 드래그 = custom(강조 슬라이더).
    function birthMs() { return subjectInfo?.birthDate ? new Date(subjectInfo.birthDate).getTime() : monthsAgo(24); }
    function selectYear(y: number) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); // 슬라이더 구간 부드럽게 채워짐
        setPeriodMode("year"); setSelectedYear(y);
        const s = Math.max(birthMs(), new Date(y, 0, 1).getTime());
        const e = Math.min(Date.now(), new Date(y, 11, 31, 23, 59, 59, 999).getTime());
        setSliderStartMs(s); setSliderEndMs(e);
    }
    function selectRecent6() {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setPeriodMode("recent6");
        setSliderStartMs(Math.max(birthMs(), monthsAgo(6))); setSliderEndMs(Date.now());
    }

    async function startScan() {
        if (scanningRef.current) return; // 이미 스캔 중이면 중복 실행 차단(앵커 중복임베딩·자원경쟁 방지)
        scanningRef.current = true;
        try {
        const perm = await requestLibraryPermission();
        if (!perm.granted) {
            setPhase("denied");
            Alert.alert(t.permissionDeniedTitle, t.permissionDeniedBody, [
                { text: t.cancel, style: "cancel" },
                { text: t.openSettings, onPress: () => Linking.openSettings() },
            ]);
            return;
        }
        const { sinceMs, untilMs } = computeRange();
        sinceRef.current = sinceMs;
        untilRef.current = untilMs;
        setPhase("detecting");
        setStage("anchor");
        warmUpFace(); // SFace+Vision 미리 로드(앵커 캐시 히트 시 특히 중요) — await 안 함(병렬)

        const subject = subjectRef.current;
        const { total, narrowed } = await getLibraryCounts(sinceMs, untilMs);
        setCounts({ total, narrowed, birthDate: subject?.birthDate ?? null, coverUrl: subject?.cover?.url ?? null });
        scannedTotalRef.current = 0; narrowedRef.current = narrowed; maxScanRef.current = 0; maxMatchRef.current = 0; // perf 기준 + 카운터 단조 리셋
        console.log(`[perf] ▶ 스캔 시작: 대상 ${narrowed}장 (전체 라이브러리 ${total}장, 기간=${periodMode})`);
        const tAnchor = Date.now();
        if (subject) anchorRef.current = await buildAnchorSet(subject);
        console.log(`[perf] 앵커 빌드: ${Date.now() - tAnchor}ms`);
        setStage("scan"); // 프로필 학습 끝 → 검색 단계 문구로 전환

        // 로딩 페이지에서 대상 전체를 끝까지 스캔 → 완료되면 결과로 한 번에 진입.
        scanStartRef.current = Date.now();
        while (hasMoreRef.current) {
            const delta = await loadBatch(false);
            if (delta === 0) break; // 안전장치(빈 페이지 무한루프 방지)
        }
        await flushScanCache(); // 남은 캐시 저장
        setPhase("ready");
        } finally {
            scanningRef.current = false;
        }
    }

    async function loadBatch(markNew: boolean): Promise<number> {
        if (loadingRef.current) return 0;
        loadingRef.current = true;
        try {
            const t0 = Date.now();
            const res = await scanBatch({
                after: afterRef.current, sinceMs: sinceRef.current, untilMs: untilRef.current, batchSize: BATCH,
                onProgress: (d) => setScanned((prev) => prev + d), // 청크마다 증분 → 부드러운 카운트업
            });
            const tDetect = Date.now() - t0; // 검출(썸네일+Vision) wall
            afterRef.current = res.nextAfter;
            hasMoreRef.current = res.hasMore;
            setHasMore(res.hasMore);
            let m: MatchedItem[] = [];
            let near: MatchedItem[] = [];
            const tm0 = Date.now();
            if (anchorRef.current && anchorRef.current.embeddings.length > 0) {
                const r = await matchItemsBatch(res.items, anchorRef.current);
                m = r.matched; near = r.nearMiss;
            }
            const tEmbed = Date.now() - tm0; // 임베딩(SFace CoreML) wall

            // ── perf 실측: 장/초 · 병목(검출 vs 임베딩) · ETA ──
            scannedTotalRef.current += res.scannedDelta;
            const batchMs = tDetect + tEmbed;
            const perSec = batchMs > 0 ? res.scannedDelta / (batchMs / 1000) : 0;
            const remaining = Math.max(0, narrowedRef.current - scannedTotalRef.current);
            const etaMin = perSec > 0 ? remaining / perSec / 60 : 0;
            console.log(
                `[perf] batch ${res.scannedDelta}장 in ${batchMs}ms = ${perSec.toFixed(1)}장/s ` +
                `| detect=${tDetect}ms embed=${tEmbed}ms(얼굴있는사진=${res.items.length}) ` +
                `| 진행 ${scannedTotalRef.current}/${narrowedRef.current} · 남은시간 ~${etaMin.toFixed(1)}분`
            );
            const fresh = m.filter((it) => !seenRef.current.has(it.assetId));
            fresh.forEach((it) => seenRef.current.add(it.assetId));
            if (fresh.length) {
                setMatched((prev) => [...prev, ...fresh]);
                if (markNew) setNewIds((prev) => new Set([...prev, ...fresh.map((f) => f.assetId)]));
            }
            // near-miss 누적(이미 matched된/본 것 제외) — (b) 관대 패스에서 꺼내 씀
            const freshNear = near.filter((it) => !seenRef.current.has(it.assetId) && !seenNearRef.current.has(it.assetId));
            freshNear.forEach((it) => seenNearRef.current.add(it.assetId));
            if (freshNear.length) setNearMissItems((prev) => [...prev, ...freshNear]);
            return res.scannedDelta; // scanned는 onProgress로 이미 증분됨
        } catch (e) {
            console.warn("[scan] batch error:", e);
            hasMoreRef.current = false;
            return 0;
        } finally {
            loadingRef.current = false;
        }
    }

    function onFindMore() {
        // near-miss(0.43~0.45) 관대 패스: 버킷을 결과로 승격(코랄 "새로 추가" 표시).
        if (nearMissItems.length > 0) promoteNearMiss();
    }

    function promoteNearMiss() {
        const fresh = nearMissItems.filter((it) => !seenRef.current.has(it.assetId));
        fresh.forEach((it) => seenRef.current.add(it.assetId));
        if (fresh.length) {
            setMatched((prev) => [...prev, ...fresh]);
            setNewIds((prev) => new Set([...prev, ...fresh.map((f) => f.assetId)]));
        }
        setNearMissItems([]); // 버킷 비움(한 번 승격)
    }

    // 연속 촬영/거의 동일 사진은 대표 1장만 (시간창 + 점수차 둘 다 만족 시 묶음)
    const visibleMatched = useMemo(
        () => dedupeBursts(matched, matchConfig.dedupeBurstWindowMs, matchConfig.dedupeBurstScoreEps),
        [matched]
    );
    // 제외된 것 뺀 "앨범 포함" 목록 + 갤러리 수동 추가(중복 assetId 제거)
    const includedItems = useMemo(() => {
        const base = visibleMatched.filter((m) => !deselected.has(m.assetId));
        const ids = new Set(base.map((b) => b.assetId));
        const extra = manualItems.filter((m) => !ids.has(m.assetId) && !deselected.has(m.assetId));
        return [...base, ...extra];
    }, [visibleMatched, deselected, manualItems]);
    const { sections, ordered } = useMemo(
        () => groupByMonth(includedItems, counts?.birthDate ?? null, COLS),
        [includedItems, counts]
    );
    const includedCount = includedItems.length;
    const markedCount = marked.size;

    // 탭 = 제거 대상 찍기/해제(핑크 체크). deselected(실제 제외)와 별개.
    function toggleMark(id: string) {
        setMarked((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    }
    const isMarked = (id: string) => marked.has(id);

    // "Remove N" → 찍힌 것 일괄 제외
    function removeMarked() {
        setDeselected((prev) => new Set([...prev, ...marked]));
        setMarked(new Set());
    }

    // 미리보기 안 Remove/Restore용(즉시 제외/복구)
    function toggle(id: string) {
        setDeselected((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
        setMarked((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
    const isOn = (id: string) => !deselected.has(id); // 미리보기 isSelected용

    function openPreviewFor(id: string) {
        const idx = ordered.findIndex((x) => x.assetId === id);
        if (idx >= 0) setPreview({ visible: true, index: idx });
    }

    // (b) 갤러리에서 직접 추가 — 얼굴매칭 건너뛰고 앨범 포함. assetId 필수(주문 시 원본 resolve).
    async function addFromGallery() {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
            Alert.alert(t.permissionDeniedTitle, t.permissionDeniedBody, [
                { text: t.cancel, style: "cancel" },
                { text: t.openSettings, onPress: () => Linking.openSettings() },
            ]);
            return;
        }
        const res = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsMultipleSelection: true,
            quality: 1,
            exif: false,
        });
        if (res.canceled || !res.assets?.length) return;

        // 안드로이드 ImagePicker는 assetId=null(포토피커 프라이버시) → uri를 식별자로. iOS는 assetId 유지.
        const picked = res.assets
            .map((a) => ({ a, id: (a.assetId as string) || a.uri }))
            .filter((x) => !!x.id);
        if (picked.length === 0) return;

        // 1) 낙관적 추가: 얼굴검출을 기다리지 않고 즉시 보기열에 표시 → 체감 대기 0(3초 멈춤·이탈 제거).
        const initial: MatchedItem[] = picked.map(({ a, id }) => ({
            assetId: id, thumbUri: a.uri, width: a.width || 0, height: a.height || 0,
            faces: [], creationTime: (a as any).creationTime ?? Date.now(), processedAt: Date.now(),
            manual: true, score: 1, ageMonths: null,
        }));
        setManualItems((prev) => {
            const ids = new Set(prev.map((x) => x.assetId));
            return [...prev, ...initial.filter((x) => !ids.has(x.assetId))];
        });
        setDeselected((prev) => { const n = new Set(prev); initial.forEach((x) => n.delete(x.assetId)); return n; }); // 다시 넣으면 제외 해제

        // 2) 얼굴검출은 백그라운드 병렬(동시 4)로 → 완료되는 대로 해당 항목 faces/크기 갱신(크롭 센터링용).
        //    이미 화면엔 떠 있으므로 사용자는 기다리지 않음.
        (async () => {
            const CONC = 4;
            for (let i = 0; i < picked.length; i += CONC) {
                await Promise.all(picked.slice(i, i + CONC).map(async ({ id }) => {
                    try {
                        const r: any = await scanAsset(id, 256, thumbPath(id));
                        if (r && !r.unavailable) {
                            setManualItems((prev) => prev.map((x) =>
                                x.assetId === id ? { ...x, faces: r.faces || [], width: r.width || x.width, height: r.height || x.height } : x
                            ));
                        }
                    } catch { /* 검출 실패 → 얼굴 없이 유지 */ }
                }));
            }
        })();
    }

    // (c) 제외한 사진 전부 되돌리기
    function restoreDeselected() { setDeselected(new Set()); }

    function makeAlbum() {
        setAlbumDraft(includedItems, name);
        router.push("/photobook/album");
    }

    if (!enabled) return null;

    const floatY = float.interpolate({ inputRange: [0, 1], outputRange: [-7, 7] });
    const heartScale = heart.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
    const rotY = rotAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
    const target = counts?.narrowed ?? 0; // 전체 대상 장수 기준
    const barPct = target > 0 ? Math.min(100, (displayCount / target) * 100) : 0; // 카운트업과 동기
    const age = counts ? ageLabel(counts.birthDate, t.ageMo, t.ageYr) : "";
    const setupAge = subjectInfo ? ageLabel(subjectInfo.birthDate, t.ageMo, t.ageYr) : "";
    const years = useMemo(() => {
        const cur = new Date().getFullYear();
        const by = subjectInfo?.birthDate ? new Date(subjectInfo.birthDate).getFullYear() : cur;
        const arr: number[] = [];
        for (let y = cur; y >= by; y--) arr.push(y);
        return arr;
    }, [subjectInfo]);
    const birthMsForSlider = subjectInfo?.birthDate ? new Date(subjectInfo.birthDate).getTime() : monthsAgo(24);

    // 예상 남은 시간 (처리 속도 기반). 속도 개선 전엔 큰 값이 뜰 수 있음(로직만).
    const etaText = (() => {
        if (stage !== "scan" || !scanStartRef.current || scanned < 20) return "";
        const elapsed = (Date.now() - scanStartRef.current) / 1000;
        const rate = elapsed > 0 ? scanned / elapsed : 0; // 장/초
        if (rate <= 0) return "";
        const remain = Math.max(0, target - scanned);
        const sec = remain / rate;
        if (sec < 60) return t.pbEtaSec.replace("{n}", String(Math.max(1, Math.ceil(sec / 10) * 10)));
        return t.pbEtaMin.replace("{n}", String(Math.ceil(sec / 60)));
    })();

    // 앵커 임베딩(첫 ~7초) 동안엔 "프로필 분석 중" → 끝나면 검색 단계 회전 문구(+ETA).
    const rotMsgs: string[] = stage === "anchor"
        ? [t.pbAnalyzingProfile]
        : counts ? [
            `${t.pbAllPhotos} ${counts.total.toLocaleString()}`,
            counts.narrowed < counts.total ? `${t.pbSinceBirth} ${counts.narrowed.toLocaleString()}` : `${counts.narrowed.toLocaleString()}`,
            ...(etaText ? [etaText] : []),
            t.pbSearchingPhotos,
        ] : [t.pbSearchingPhotos];

    return (
        <View style={[styles.container, { backgroundColor: c.bg, paddingTop: insets.top + 8 }]}>
            <View style={styles.header}>
                <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconBtn}>
                    <Feather name="arrow-left" size={24} color={c.ink} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: c.ink }]} numberOfLines={1}>{name || t.pbScanTitle}</Text>
                <View style={styles.iconBtn} />
            </View>

            {phase === "setup" ? (
                <View style={styles.setup}>
                    {!prepared ? (
                        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator size="large" color={c.coral} /></View>
                    ) : (
                    <ScrollView style={{ flex: 1, width: "100%" }} contentContainerStyle={styles.setupScroll} showsVerticalScrollIndicator={false}>
                        {/* 상단 프로필 복구 */}
                        <View style={[styles.setupPhotoRing, { borderColor: c.peach }]}>
                            {subjectInfo?.coverUrl ? (
                                <ExpoImage source={{ uri: subjectInfo.coverUrl }} style={styles.setupPhotoImg} contentFit="cover" />
                            ) : (
                                <Feather name="user" size={34} color={c.coral} />
                            )}
                        </View>
                        {!!name && <Text style={[styles.setupName, { color: c.ink }]}>{name}{setupAge ? ` · ${setupAge}` : ""}</Text>}

                        <Text style={[styles.setupTitle, { color: c.ink }]}>{t.pbPeriodTitle}</Text>
                        <Text style={[styles.setupSub, { color: c.textSecondary }]}>{t.pbPeriodSub}</Text>

                        {/* 빠른 프리셋: 년도 + 최근 6개월 (작게) */}
                        <View style={styles.presetRow}>
                            {years.map((y) => {
                                const sel = periodMode === "year" && selectedYear === y;
                                return (
                                    <Pressable key={y} onPress={() => selectYear(y)}
                                        style={[styles.presetChip, { borderColor: sel ? c.coral : c.border, backgroundColor: sel ? c.coral : c.surface }]}>
                                        <Text style={{ color: sel ? "#fff" : c.textSecondary, fontWeight: "800", fontSize: 14 }}>{y}</Text>
                                    </Pressable>
                                );
                            })}
                            <Pressable onPress={selectRecent6}
                                style={[styles.presetChip, { borderColor: periodMode === "recent6" ? c.coral : c.border, backgroundColor: periodMode === "recent6" ? c.coral : c.surface }]}>
                                <Text style={{ color: periodMode === "recent6" ? "#fff" : c.textSecondary, fontWeight: "800", fontSize: 13 }}>{t.pbPeriodRecent6}</Text>
                            </Pressable>
                        </View>

                        {/* 메인: 연대기 슬라이더 */}
                        {subjectInfo && (
                            <View style={styles.sliderBlock}>
                                <Text style={[styles.sliderHint, { color: c.textMuted }]}>{t.pbPeriodDragHint}</Text>
                                <ChronoRangeSlider
                                    birthMs={birthMsForSlider} nowMs={Date.now()}
                                    startMs={sliderStartMs} endMs={sliderEndMs}
                                    active={periodMode === "custom"}
                                    onChange={(s, e) => { setPeriodMode("custom"); setSliderStartMs(s); setSliderEndMs(e); }}
                                    theme={c}
                                />
                            </View>
                        )}
                    </ScrollView>
                    )}

                    {/* 하단: 살짝 띄운 Start */}
                    <View style={[styles.setupBottom, { borderTopColor: c.border, paddingBottom: insets.bottom + 18 }]}>
                        <Pressable onPress={startScan} style={{ width: "100%" }}>
                            <PhotobookGradient colors={c.gradient} radius={pbRadius.lg} style={styles.startBtn}>
                                <Text style={styles.startText}>{t.pbScanStartBtn}</Text>
                            </PhotobookGradient>
                        </Pressable>
                    </View>
                </View>
            ) : phase !== "ready" ? (
                <View style={styles.loading}>
                    {/* 프로필 둥둥 + 하트 (이전 디자인) */}
                    <Animated.View style={{ transform: [{ translateY: floatY }] }}>
                        <View style={[styles.photoRing, { borderColor: c.peach }]}>
                            {counts?.coverUrl ? (
                                <ExpoImage source={{ uri: counts.coverUrl }} style={styles.photoImg} contentFit="cover" />
                            ) : (
                                <Feather name="user" size={40} color={c.coral} />
                            )}
                        </View>
                        <Animated.View style={[styles.heart, { transform: [{ scale: heartScale }] }]}>
                            <Feather name="heart" size={20} color={c.pink} />
                        </Animated.View>
                    </Animated.View>

                    {!!name && <Text style={[styles.nameAge, { color: c.ink }]}>{name}{age ? ` · ${age}` : ""}</Text>}

                    <Animated.Text style={[styles.rotMsg, { color: c.textSecondary, opacity: rotAnim, transform: [{ translateY: rotY }] }]} numberOfLines={1}>
                        {rotMsgs[rotIdx % rotMsgs.length]}
                    </Animated.Text>

                    {/* 메인: 큰 카운트 (0 → 전체 완료까지) */}
                    <Text style={styles.bigCount}>
                        <Text style={{ color: c.coral }}>{displayCount.toLocaleString()}</Text>
                        <Text style={{ color: c.textMuted }}> / {target.toLocaleString()}</Text>
                    </Text>
                    <Text style={[styles.matchLine, { color: c.textSecondary }]}>
                        {displayMatched.toLocaleString()} {t.pbMatched}
                    </Text>
                    {/* 게이지: 코랄로 진행률만큼 차오름 + % */}
                    <View style={[styles.barTrack, { backgroundColor: c.surfaceAlt }]}>
                        <View style={{ width: `${barPct}%`, height: "100%", backgroundColor: c.coral, borderRadius: 999 }} />
                    </View>
                    <Text style={[styles.pctText, { color: c.coral }]}>{Math.round(barPct)}%</Text>

                    {phase === "denied" && (
                        <Pressable onPress={() => { hasMoreRef.current = true; setPhase("setup"); }} style={[styles.retry, { borderColor: c.peach, backgroundColor: c.surfaceAlt }]}>
                            <Text style={{ color: c.coral, fontWeight: "700" }}>{t.pbScanStart}</Text>
                        </Pressable>
                    )}
                </View>
            ) : (
                <>
                    <SectionList
                        sections={sections}
                        keyExtractor={(row, i) => row.map((x) => x.assetId).join("_") + i}
                        stickySectionHeadersEnabled={false}
                        contentContainerStyle={{ paddingHorizontal: H_PAD, paddingBottom: insets.bottom + 96 }}
                        ListHeaderComponent={
                            <View style={styles.listHead}>
                                <Text style={[styles.listTitle, { color: c.ink }]}>{t.pbPreviewTitle}</Text>
                                <Text style={[styles.listSub, { color: c.textSecondary }]}>
                                    {includedCount} {t.pbInAlbum} · {t.pbRemoveHint}
                                </Text>
                            </View>
                        }
                        renderSectionHeader={({ section }) => (
                            <View style={[styles.secHead, { backgroundColor: c.bg }]}>
                                <Text style={[styles.secTitle, { color: c.ink }]}>{section.title}</Text>
                                {section.ageMonths != null && (
                                    <Text style={[styles.secAge, { color: c.textMuted }]}>{section.ageMonths}{t.ageMo}</Text>
                                )}
                            </View>
                        )}
                        renderItem={({ item: row }) => (
                            <View style={styles.row}>
                                {row.map((it) => {
                                    const mk = isMarked(it.assetId);
                                    const isNew = newIds.has(it.assetId);
                                    return (
                                        // 일괄제거: 기본 빈 원(전부 포함). 탭 = 제거 대상 찍기(핑크 체크). 롱프레스 = 미리보기.
                                        <Pressable key={it.assetId} style={[styles.cell, isNew && { borderWidth: 2, borderColor: c.coral }]}
                                            onPress={() => toggleMark(it.assetId)} onLongPress={() => openPreviewFor(it.assetId)} delayLongPress={280}>
                                            <ExpoImage source={{ uri: it.thumbUri }} style={styles.cellImg} contentFit="cover" />
                                            {mk && <View pointerEvents="none" style={styles.markDim} />}
                                            <View pointerEvents="none" style={[styles.markCircle, mk
                                                ? { backgroundColor: c.coral, borderColor: "#fff" }
                                                : { backgroundColor: "rgba(0,0,0,0.18)", borderColor: "rgba(255,255,255,0.85)" }]}>
                                                {mk && <Feather name="check" size={13} color="#fff" />}
                                            </View>
                                        </Pressable>
                                    );
                                })}
                                {row.length < COLS && Array.from({ length: COLS - row.length }).map((_, k) => <View key={k} style={{ width: CELL }} />)}
                            </View>
                        )}
                        ListEmptyComponent={
                            <View style={styles.empty}>
                                <Feather name="image" size={40} color={c.textMuted} />
                                <Text style={{ color: c.textSecondary, marginTop: 10 }}>{t.pbScanNoResults}</Text>
                            </View>
                        }
                    />

                    {/* sticky 하단바 — 25장 미만이면 "채우기 유도" 게이트, 이상이면 앨범 만들기 */}
                    {includedCount < MIN_PHOTOS ? (
                        <View style={[styles.bottomBar, { flexDirection: "column", alignItems: "stretch", gap: 8, paddingTop: 12, backgroundColor: c.bg, borderTopColor: c.border, paddingBottom: insets.bottom + 10 }]}>
                            {/* 안내 + 진행(N/25) */}
                            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                                <Text style={{ flex: 1, color: c.ink, fontSize: 13, fontWeight: "700", lineHeight: 18 }}>
                                    {locale === "TH"
                                        ? `โฟโต้บุ๊ก 48 หน้า ต้องมีรูปอย่างน้อย ${MIN_PHOTOS} รูป`
                                        : `A 48-page book needs at least ${MIN_PHOTOS} photos`}
                                </Text>
                                <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, backgroundColor: c.surfaceAlt }}>
                                    <Text style={{ color: c.coral, fontWeight: "900", fontSize: 13 }}>{includedCount} / {MIN_PHOTOS}</Text>
                                </View>
                            </View>
                            <Text style={{ color: c.textMuted, fontSize: 12, marginTop: -2 }}>
                                {locale === "TH" ? `เพิ่มอีก ${MIN_PHOTOS - includedCount} รูปเพื่อไปต่อ` : `Add ${MIN_PHOTOS - includedCount} more to continue`}
                            </Text>
                            {/* 채우기 버튼 — 세로 스택(잘림 없음, TH/EN 안전) */}
                            {nearMissItems.length > 0 && (
                                <Pressable onPress={onFindMore} style={[styles.fillBtn, { borderColor: c.peach, backgroundColor: c.surface }]}>
                                    <Feather name="plus-circle" size={16} color={c.coral} />
                                    <Text style={styles.fillTxt} numberOfLines={1}>{t.pbFindSimilar}</Text>
                                </Pressable>
                            )}
                            <Pressable onPress={addFromGallery} style={[styles.fillBtn, { borderColor: c.peach, backgroundColor: c.surface }]}>
                                <Feather name="image" size={16} color={c.coral} />
                                <Text style={styles.fillTxt} numberOfLines={1}>{locale === "TH" ? "เพิ่มจากคลังภาพ" : "Add from gallery"}</Text>
                            </Pressable>
                            {deselected.size > 0 && (
                                <Pressable onPress={restoreDeselected} style={[styles.fillBtn, { borderColor: c.peach, backgroundColor: c.surface }]}>
                                    <Feather name="rotate-ccw" size={16} color={c.coral} />
                                    <Text style={styles.fillTxt} numberOfLines={1}>{locale === "TH" ? `คืนรูปที่เอาออก (${deselected.size})` : `Restore removed (${deselected.size})`}</Text>
                                </Pressable>
                            )}
                        </View>
                    ) : (
                        <View style={[styles.bottomBar, { backgroundColor: c.bg, borderTopColor: c.border, paddingBottom: insets.bottom + 10 }]}>
                            {markedCount > 0 ? (
                                <Pressable onPress={removeMarked} style={[styles.findMore, { borderColor: c.coral, backgroundColor: c.surface }]}>
                                    <Feather name="trash-2" size={15} color={c.coral} />
                                    <Text style={{ color: c.coral, fontWeight: "800", fontSize: 13, marginLeft: 5 }}>{t.pbRemoveN.replace("{n}", String(markedCount))}</Text>
                                </Pressable>
                            ) : nearMissItems.length > 0 ? (
                                <Pressable onPress={onFindMore} style={[styles.findMore, { borderColor: c.peach }]}>
                                    <Feather name="plus-circle" size={15} color={c.coral} />
                                    <Text style={{ color: c.coral, fontWeight: "700", fontSize: 13, marginLeft: 5 }}>{t.pbFindSimilar}</Text>
                                </Pressable>
                            ) : null}
                            <Pressable onPress={makeAlbum} style={{ flex: 1 }} disabled={includedCount === 0}>
                                <PhotobookGradient colors={c.gradient} radius={pbRadius.lg} style={[styles.albumBtn, includedCount === 0 && { opacity: 0.5 }]}>
                                    <Text style={styles.albumText} numberOfLines={1}>{t.pbAlbumCta.replace("{n}", String(includedCount))}</Text>
                                </PhotobookGradient>
                            </Pressable>
                        </View>
                    )}
                </>
            )}

            <PhotoPreviewModal
                visible={preview.visible}
                items={ordered}
                index={preview.index}
                isSelected={isOn}
                onToggle={toggle}
                onClose={() => setPreview((p) => ({ ...p, visible: false }))}
                theme={c}
            />

        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: H_PAD, paddingBottom: 8 },
    iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 18, fontWeight: "800", flex: 1, textAlign: "center" },

    setup: { flex: 1 },
    setupScroll: { paddingHorizontal: 28, paddingTop: 60, paddingBottom: 20, alignItems: "center" }, // 전체 ~1.5cm 아래로
    setupPhotoRing: { width: 88, height: 88, borderRadius: 44, borderWidth: 3, overflow: "hidden", alignItems: "center", justifyContent: "center" },
    setupPhotoImg: { width: "100%", height: "100%", borderRadius: 44 },
    setupName: { fontSize: 18, fontWeight: "800", marginTop: 12 },
    setupTitle: { fontSize: 19, fontWeight: "800", marginTop: 22, textAlign: "center" },
    setupSub: { fontSize: 13, fontWeight: "500", marginTop: 5, marginBottom: 16, textAlign: "center", lineHeight: 18 },
    presetRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, width: "100%" },
    presetChip: { minWidth: 64, paddingHorizontal: 14, height: 38, borderRadius: 999, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
    sliderBlock: { width: "100%", marginTop: 30 },
    sliderHint: { fontSize: 12.5, fontWeight: "600", textAlign: "center", marginBottom: 16 },

    setupBottom: { paddingHorizontal: 28, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, alignItems: "center" },
    startBtn: { height: 54, alignItems: "center", justifyContent: "center" },
    startText: { color: "#fff", fontWeight: "800", fontSize: 16 },

    loading: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, marginTop: -70 },
    photoRing: { width: 104, height: 104, borderRadius: 52, borderWidth: 3, overflow: "hidden", alignItems: "center", justifyContent: "center" },
    photoImg: { width: "100%", height: "100%", borderRadius: 52 },
    heart: { position: "absolute", right: -6, bottom: -2 },
    nameAge: { fontSize: 18, fontWeight: "800", marginTop: 16 },
    rotMsg: { fontSize: 15, fontWeight: "600", marginTop: 10, marginBottom: 18, textAlign: "center" },
    bigCount: { fontSize: 40, fontWeight: "900", letterSpacing: 0.5, marginTop: 6 },
    matchLine: { fontSize: 14, fontWeight: "700", marginTop: 6, marginBottom: 18 },
    barTrack: { width: "72%", height: 8, borderRadius: 999, overflow: "hidden" },
    pctText: { fontSize: 13, fontWeight: "800", marginTop: 8 },
    retry: { marginTop: 20, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 14, borderWidth: 1.5 },

    listHead: { paddingVertical: 14 },
    listTitle: { fontSize: 22, fontWeight: "800" },
    listSub: { fontSize: 13.5, fontWeight: "600", marginTop: 3 },
    secHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 14, paddingBottom: 8 },
    secTitle: { fontSize: 15, fontWeight: "800" },
    secAge: { fontSize: 12, fontWeight: "600" },
    row: { flexDirection: "row", gap: GAP, marginBottom: GAP },
    cell: { width: CELL, height: CELL, borderRadius: 10, overflow: "hidden" },
    cellImg: { width: "100%", height: "100%" },
    // 일괄제거: 제거 대상 찍으면 핑크 체크 + 살짝 딤
    markDim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(255,140,124,0.22)" },
    markCircle: { position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },

    bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: H_PAD, paddingTop: 10, borderTopWidth: 1 },
    findMore: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, height: 48, borderRadius: 14, borderWidth: 1.5 },
    fillBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 12, height: 48, borderRadius: 12, borderWidth: 1.5 },
    fillTxt: { color: "#FF7E66", fontWeight: "800", fontSize: 14 },
    albumBtn: { height: 52, alignItems: "center", justifyContent: "center" },
    albumText: { color: "#fff", fontWeight: "800", fontSize: 16 },

    empty: { alignItems: "center", justifyContent: "center", paddingTop: 80 },
});
