// app/photobook/preview.tsx
//
// 책 프리뷰: 가로로 "책장 넘기듯" 스와이프. 한 번에 펼침면(좌우 2페이지) 하나씩,
// 앞표지 → 내지 여러 펼침면 → 뒤표지. 선택 사진 전부가 자동 콜라주로 들어간다(24·48·100장…).
// 내지 배치는 photoLayout.buildPages — 사진 비율대로 저스티파이드(여백 최소, 크롭 최소).
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    View, Text, StyleSheet, Pressable, FlatList, Alert, Modal, useWindowDimensions, Animated, ScrollView, Linking,
    NativeSyntheticEvent, NativeScrollEvent, LayoutChangeEvent,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { scanAsset } from "../../modules/vision-face";
import { thumbPath } from "../../src/services/scanCache";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ScreenOrientation from "expo-screen-orientation";

import { useLanguage } from "../../src/context/LanguageContext";
import { usePhotobookEnabled } from "../../src/config/featureFlags";
import { usePhotobookTheme, pbRadius } from "../../src/config/photobookTheme";
import { PhotobookGradient } from "../../src/components/photobook/PhotobookGradient";
import { getAlbumDraft, getAlbumOptions, getAllCrops, PhotoCrop, replaceCrops, setAlbumItems, setAlbumOptions } from "../../src/services/albumDraft";
import { buildPages, LayoutPage, photoAspect, Density, PAGE_TOP_BAND, pageDateLabels } from "../../src/services/photoLayout";
import { useHiResCover } from "../../src/services/coverImage";
import { useMidResMap } from "../../src/services/midResImage";
import { CoverCrop } from "../../src/components/photobook/CoverCrop";
import { PhotobookCropEditor } from "../../src/components/photobook/PhotobookCropEditor";
import { GestureHandlerRootView, GestureDetector, Gesture } from "react-native-gesture-handler";
import Reanimated, { useSharedValue, useAnimatedStyle, useAnimatedReaction, withSpring, runOnJS, SharedValue } from "react-native-reanimated";
import { ScanItem } from "../../src/types/scan";

type Snapshot = { items: ScanItem[]; crops: Record<string, PhotoCrop> };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
function faceCenterOf(p?: { faces?: { x: number; y: number; width: number; height: number }[] }): { x: number; y: number } {
    const f = p?.faces?.length ? p.faces.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b)) : null;
    return f ? { x: clamp01(f.x + f.width / 2), y: clamp01(f.y + f.height / 2) } : { x: 0.5, y: 0.5 };
}

const OUTER = 14;

function ym(ms: number) { const d = new Date(ms); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}`; }
function dateRangeLabel(items: { creationTime?: number }[]): string {
    const ts = items.map((i) => i.creationTime).filter((x): x is number => !!x);
    if (!ts.length) return "";
    const a = ym(Math.min(...ts)), b = ym(Math.max(...ts));
    return a === b ? a : `${a} ~ ${b}`;
}
// 펼침면 촬영 년월: 한 달이면 "2025.06", 여러 달이면 "2025.05~06"(같은 해) / "2025.05~2026.02"(다른 해)
function monthRange(photos: { creationTime?: number }[]): string {
    const ts = photos.map((p) => p.creationTime).filter((x): x is number => !!x);
    if (!ts.length) return "";
    const mn = new Date(Math.min(...ts)), mx = new Date(Math.max(...ts));
    const y1 = mn.getFullYear(), m1 = mn.getMonth() + 1, y2 = mx.getFullYear(), m2 = mx.getMonth() + 1;
    const mm = (m: number) => String(m).padStart(2, "0");
    if (y1 === y2 && m1 === m2) return `${y1}.${mm(m1)}`;
    if (y1 === y2) return `${y1}.${mm(m1)}~${mm(m2)}`;
    return `${y1}.${mm(m1)}~${y2}.${mm(m2)}`;
}

type Row =
    | { kind: "cover" }
    | { kind: "back" }
    | { kind: "spread"; left: LayoutPage | null; right: LayoutPage | null; n: number };

interface DragCtx {
    active: SharedValue<number>;
    overIdx: SharedValue<number>;
    fromSpX: SharedValue<number>;
    fromSpY: SharedValue<number>;
    centers: SharedValue<{ id: string; cx: number; cy: number }[]>;
}
// 드래그 자리 교체 — 롱프레스 들어올림 → 드래그 중 대상 사진이 실시간으로 자리를 비켜줌(미리보기) → 놓으면 스왑. 짧게 탭=크롭.
function DragCell({ item, uri, x, y, spX, spY, w, h, crop, bg, drag, onTap, onLift, onDrop }: {
    item: ScanItem; uri?: string; x: number; y: number; spX: number; spY: number; w: number; h: number; crop: PhotoCrop; bg: string;
    drag: DragCtx; onTap: () => void; onLift: (id: string) => void; onDrop: (id: string, overIdx: number) => void;
}) {
    const tx = useSharedValue(0), ty = useSharedValue(0), sc = useSharedValue(1), lift = useSharedValue(0);
    const shX = useSharedValue(0), shY = useSharedValue(0); // 밀려나기 오프셋
    const reset = () => { "worklet"; tx.value = withSpring(0); ty.value = withSpring(0); sc.value = withSpring(1); lift.value = 0; };

    // 드래그 대상이 되면 → 들린 사진의 원래 자리로 부드럽게 비켜줌
    useAnimatedReaction(
        () => (drag.active.value === 1 && drag.overIdx.value >= 0 ? drag.centers.value[drag.overIdx.value]?.id : ""),
        (overId) => {
            const isOver = overId === item.assetId && lift.value !== 1;
            shX.value = withSpring(isOver ? drag.fromSpX.value - spX : 0, { damping: 18, stiffness: 180 });
            shY.value = withSpring(isOver ? drag.fromSpY.value - spY : 0, { damping: 18, stiffness: 180 });
        }
    );

    const tap = Gesture.Tap().maxDuration(250).onEnd((_e, ok) => { if (ok) runOnJS(onTap)(); });
    const pan = Gesture.Pan()
        .activateAfterLongPress(200)
        .onStart(() => { lift.value = 1; sc.value = withSpring(1.16); runOnJS(onLift)(item.assetId); })
        .onChange((e) => {
            tx.value = e.translationX; ty.value = e.translationY;
            // 들린 사진 중심과 가장 가까운 칸(자기 포함) 찾아 대상 인덱스 갱신 (자기가 가장 가까우면 -1 = 스왑 안 함)
            const mcx = spX + w / 2 + tx.value, mcy = spY + h / 2 + ty.value;
            const cs = drag.centers.value;
            let best = -1, bestD = 1e12;
            for (let k = 0; k < cs.length; k++) { const dx = cs[k].cx - mcx, dy = cs[k].cy - mcy; const d = dx * dx + dy * dy; if (d < bestD) { bestD = d; best = k; } }
            drag.overIdx.value = best >= 0 && cs[best].id === item.assetId ? -1 : best;
        })
        .onEnd(() => { runOnJS(onDrop)(item.assetId, drag.overIdx.value); reset(); drag.overIdx.value = -1; drag.active.value = 0; })
        .onFinalize(() => { reset(); });
    const gesture = Gesture.Exclusive(pan, tap);

    const aStyle = useAnimatedStyle(() => {
        if (lift.value === 1) {
            // iOS=shadow* / Android=elevation (둘 다 지정 → 양쪽에서 떠 있는 느낌)
            return { transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: sc.value }, { rotateZ: "2.5deg" }], zIndex: 1000, opacity: 0.95, shadowOpacity: 0.4, shadowRadius: 18, elevation: 16 };
        }
        return { transform: [{ translateX: shX.value }, { translateY: shY.value }, { scale: 1 }], zIndex: 1, opacity: 1, shadowOpacity: 0, shadowRadius: 0, elevation: 0 };
    });
    return (
        <GestureDetector gesture={gesture}>
            <Reanimated.View style={[{ position: "absolute", left: x, top: y, width: w, height: h, shadowColor: "#000", shadowOffset: { width: 0, height: 8 } }, aStyle]}>
                <View style={{ width: w, height: h, borderRadius: 2, overflow: "hidden", backgroundColor: bg }}>
                    <CoverCrop uri={uri ?? item.thumbUri} w={w} h={h} aspect={photoAspect(item)} focusX={crop.fx} focusY={crop.fy} zoom={crop.zoom} bg={bg} />
                </View>
            </Reanimated.View>
        </GestureDetector>
    );
}

export default function PhotobookPreview() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { t, locale } = useLanguage();
    const c = usePhotobookTheme();
    const enabled = usePhotobookEnabled();

    const draft0 = getAlbumDraft();
    const subjectName = draft0.subjectName;
    const opts = getAlbumOptions();
    const { width: WIN_W, height: WIN_H } = useWindowDimensions(); // 회전 반응형
    const landscape = WIN_W > WIN_H;

    const RATIO = opts.size === "A3" ? 38.6 / 29.7 : 27.9 / 21.5; // 가로형 w/h

    const [items, setItemsRaw] = useState<ScanItem[]>(() => [...draft0.items].sort((a, b) => (a.creationTime ?? 0) - (b.creationTime ?? 0)));
    // 초기 정렬(creationTime) 순서를 draft에 1회 고정 → 조작 없이 바로 주문해도 checkout/freeze가 프리뷰와 동일 순서로 렌더.
    useEffect(() => { setAlbumItems(items); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    const [dragging, setDragging] = useState(false);
    const dragActive = useSharedValue(0);
    const dragOverIdx = useSharedValue(-1);
    const dragFromSpX = useSharedValue(0);
    const dragFromSpY = useSharedValue(0);
    const dragCentersSV = useSharedValue<{ id: string; cx: number; cy: number }[]>([]);
    const dragCentersJS = useRef<{ id: string }[]>([]);
    const dragCtx = useMemo<DragCtx>(() => ({ active: dragActive, overIdx: dragOverIdx, fromSpX: dragFromSpX, fromSpY: dragFromSpY, centers: dragCentersSV }), []);
    const [cur, setCur] = useState(0);
    const [density, setDensityState] = useState<Density>((opts.density as Density) || "balanced");
    const [crops, setCrops] = useState<Record<string, PhotoCrop>>(getAllCrops());
    const [areaH, setAreaH] = useState(320); // 스와이프 영역 높이(실측)

    // 책을 사용가능 영역에 contain-fit → 세로·가로 모두 전체가 보이게(가로에선 높이 기준으로 줌아웃)
    const availW = WIN_W - OUTER * 2;
    const availH = Math.max(120, areaH - 20);
    const spreadAspect = 2 * RATIO;                                   // 펼침면(2페이지) 가로/세로
    const spreadW = availW / availH > spreadAspect ? availH * spreadAspect : availW;
    const pageW = spreadW / 2;
    const pageH = spreadW / spreadAspect;
    const coverBoxW = landscape ? availW : availW * 0.78;
    const coverW = coverBoxW / availH > RATIO ? availH * RATIO : coverBoxW; // 표지 단면도 fit
    const coverH = coverW / RATIO;
    const [editing, setEditing] = useState<null | { assetId: string; thumb?: string; imgAspect: number; cellAspect: number }>(null);
    const [draft, setDraft] = useState<PhotoCrop>({ fx: 0.5, fy: 0.5, zoom: 1 });
    const editUri = useHiResCover(editing?.assetId, editing?.thumb);
    const listRef = useRef<FlatList<Row>>(null);


    // ── undo/redo (사진 제거·크롭 변경) ──
    const past = useRef<Snapshot[]>([]);
    const future = useRef<Snapshot[]>([]);
    const [, bumpHist] = useState(0);
    const applySnap = (s: Snapshot) => { setItemsRaw(s.items); setCrops(s.crops); setAlbumItems(s.items); replaceCrops(s.crops); };
    const commit = (nextItems: ScanItem[], nextCrops: Record<string, PhotoCrop>) => {
        past.current.push({ items, crops }); if (past.current.length > 60) past.current.shift();
        future.current = [];
        applySnap({ items: nextItems, crops: nextCrops }); bumpHist((x) => x + 1);
    };
    const undo = () => { const p = past.current.pop(); if (!p) return; future.current.push({ items, crops }); applySnap(p); bumpHist((x) => x + 1); Haptics.selectionAsync(); };
    const redo = () => { const f = future.current.pop(); if (!f) return; past.current.push({ items, crops }); applySnap(f); bumpHist((x) => x + 1); Haptics.selectionAsync(); };
    const canUndo = past.current.length > 0, canRedo = future.current.length > 0;

    const setDensity = (d: Density) => { setDensityState(d); setAlbumOptions({ density: d }); setCur(0); listRef.current?.scrollToOffset({ offset: 0, animated: false }); };
    const cropFor = (p: { assetId: string; faces?: any[] }): PhotoCrop => {
        const stored = crops[p.assetId];
        if (stored) return stored;
        const fc = faceCenterOf(p);
        return { fx: fc.x, fy: fc.y, zoom: 1 };
    };

    const dateLabel = useMemo(() => dateRangeLabel(items), [items]);
    // 표지 사진/크롭은 프리뷰에서도 바꿀 수 있게 로컬 상태로 (변경 시 setAlbumOptions로 반영)
    const [coverPhotoId, setCoverPhotoId] = useState<string | null>(opts.coverPhotoId ?? null);
    const [coverCrop, setCoverCrop] = useState<PhotoCrop>(() => {
        // 명시 크롭 있으면 우선, 없으면 표지 사진 얼굴중심(중앙 0.5 아님) — PDF freeze와 동일 규칙
        if (opts.coverFocusX != null && opts.coverFocusY != null) return { fx: opts.coverFocusX, fy: opts.coverFocusY, zoom: opts.coverZoom ?? 1 };
        const cid = opts.coverPhotoId ?? draft0.items[0]?.assetId;
        const it = draft0.items.find((x) => x.assetId === cid);
        const fc = faceCenterOf(it as any);
        return { fx: fc.x, fy: fc.y, zoom: 1 };
    });
    const [coverEditOpen, setCoverEditOpen] = useState(false);
    const [coverDraft, setCoverDraft] = useState<PhotoCrop>(coverCrop);
    const [coverPickerOpen, setCoverPickerOpen] = useState(false);
    const coverAssetId = coverPhotoId ?? items[0]?.assetId;
    const coverThumb = useMemo(() => items.find((i) => i.assetId === coverAssetId)?.thumbUri, [coverAssetId, items]);
    const coverUri = useHiResCover(coverAssetId, coverThumb); // 표지 원본 고해상도
    const coverItem = items.find((i) => i.assetId === coverAssetId);
    const coverAspect = coverItem && coverItem.height ? coverItem.width / coverItem.height : 1;
    const cFocusX = coverCrop.fx, cFocusY = coverCrop.fy, cZoom = coverCrop.zoom;
    const styleFrameW = coverW - 28, styleFrameH = coverH - 64;
    const coverHasPhoto = opts.coverStyle === "photo" || opts.coverStyle === "style";

    const saveCoverCrop = () => {
        setCoverCrop(coverDraft);
        setAlbumOptions({ coverFocusX: coverDraft.fx, coverFocusY: coverDraft.fy, coverZoom: coverDraft.zoom });
        setCoverEditOpen(false);
    };
    const pickCover = (id: string) => {
        const it = items.find((x) => x.assetId === id);
        const fc = faceCenterOf(it as any);
        const nc = { fx: fc.x, fy: fc.y, zoom: 1 };
        setCoverPhotoId(id); setCoverCrop(nc); setCoverDraft(nc);
        setAlbumOptions({ coverPhotoId: id, coverFocusX: fc.x, coverFocusY: fc.y, coverZoom: 1 });
        setCoverPickerOpen(false);
    };

    const pages = useMemo(() => {
        // 표지 사진은 내지에서 제외(표지 다음 첫 장 중복 방지) — freeze와 동일 규칙
        const interior = coverAssetId ? items.filter((x) => x.assetId !== coverAssetId) : items;
        return buildPages(interior, RATIO, density);
    }, [items, RATIO, density, coverAssetId]);
    // 페이지별 날짜 라벨 — freeze/PDF와 같은 함수라 화면과 인쇄물이 일치
    const dateLabels = useMemo(() => pageDateLabels(pages), [pages]);

    const rows = useMemo<Row[]>(() => {
        const spreads: Row[] = [];
        for (let i = 0; i < pages.length; i += 2) {
            spreads.push({ kind: "spread", left: pages[i] ?? null, right: pages[i + 1] ?? null, n: i / 2 + 1 });
        }
        return [{ kind: "cover" }, ...spreads, { kind: "back" }];
    }, [pages]);

    // (C) 현재 펼침면 + 양옆만 중간해상도로 선명하게(나머지 셀은 썸네일). 보이는 윈도우만 로드.
    const windowAssetIds = useMemo(() => {
        const ids: string[] = [];
        for (let i = cur - 1; i <= cur + 1; i++) {
            const r = rows[i];
            if (r && r.kind === "spread") {
                r.left?.photos.forEach((p) => p && ids.push(p.assetId));
                r.right?.photos.forEach((p) => p && ids.push(p.assetId));
            }
        }
        return ids;
    }, [cur, rows]);
    const midMap = useMidResMap(windowAssetIds);

    // ── 드래그 재배치: 현재 펼침면 셀들의 "펼침면 좌표" 중심 목록 계산 (UI스레드 근접판정 + 밀려나기용) ──
    const buildSpreadCenters = () => {
        const row = rows[cur];
        const centers: { id: string; spX: number; spY: number; cx: number; cy: number }[] = [];
        if (row && row.kind === "spread") {
            const both = !!row.left && !!row.right;
            const add = (page: LayoutPage | null, offX: number) => {
                page?.photos.forEach((p, i) => {
                    const s = page.cells[i]; if (!p || !s) return;
                    const spx = offX + s.x * pageW, spy = s.y * pageH, w = s.w * pageW, h = s.h * pageH;
                    centers.push({ id: p.assetId, spX: spx, spY: spy, cx: spx + w / 2, cy: spy + h / 2 });
                });
            };
            add(row.left, 0);
            add(row.right, both ? pageW : 0);
        }
        return centers;
    };
    const onDragLift = (assetId: string) => {
        const centers = buildSpreadCenters();
        dragCentersJS.current = centers.map((c) => ({ id: c.id }));
        dragCentersSV.value = centers.map((c) => ({ id: c.id, cx: c.cx, cy: c.cy }));
        const from = centers.find((c) => c.id === assetId);
        if (from) { dragFromSpX.value = from.spX; dragFromSpY.value = from.spY; }
        dragActive.value = 1;
        setDragging(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    };
    const onDragDrop = (fromId: string, overIdx: number) => {
        setDragging(false);
        const targetId = overIdx >= 0 ? dragCentersJS.current[overIdx]?.id : undefined;
        if (targetId && targetId !== fromId) {
            const ia = items.findIndex((x) => x.assetId === fromId), ib = items.findIndex((x) => x.assetId === targetId);
            if (ia >= 0 && ib >= 0) { const next = [...items]; const tmp = next[ia]; next[ia] = next[ib]; next[ib] = tmp; commit(next, crops); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); return; }
        }
        Haptics.selectionAsync();
    };

    const openCrop = (p: { assetId: string; thumbUri: string; width: number; height: number; faces?: any[] }, s: LayoutPage["cells"][number]) => {
        setDraft(cropFor(p));
        setEditing({ assetId: p.assetId, thumb: p.thumbUri, imgAspect: photoAspect(p as any), cellAspect: (s.w * pageW) / (s.h * pageH) });
    };
    const saveCrop = () => {
        if (editing) commit(items, { ...crops, [editing.assetId]: draft });
        setEditing(null);
    };
    const removePhoto = () => {
        if (editing) { const id = editing.assetId; const nc = { ...crops }; delete nc[id]; commit(items.filter((x) => x.assetId !== id), nc); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
        setEditing(null);
    };

    // 갤러리에서 사진 추가 — assetId 보존(주문 시 원본 업로드), 끝에 추가. undo/가격/앨범 자동 동기화(commit).
    const [adding, setAdding] = useState(false);
    const addPhotos = async () => {
        if (adding) return;
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
            Alert.alert(t.permissionDeniedTitle, t.permissionDeniedBody, [
                { text: t.cancel, style: "cancel" },
                { text: t.openSettings, onPress: () => Linking.openSettings() },
            ]);
            return;
        }
        try {
            setAdding(true);
            const res = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsMultipleSelection: true,
                quality: 1,
                exif: false,
            });
            if (res.canceled || !res.assets?.length) return;
            const existing = new Set(items.map((x) => x.assetId));
            // 추가 사진도 얼굴검출 실행 → 하이라이트/배치를 스캔 사진과 동일하게 AI 판단(맞춤형)
            const add: ScanItem[] = [];
            for (const a of res.assets) {
                // 안드로이드 ImagePicker는 assetId=null(포토피커 프라이버시) → uri를 식별자로. iOS는 assetId 유지.
                const id = (a.assetId as string) || a.uri;
                if (!id || existing.has(id)) continue;
                let faces: any[] = [], w = a.width || 0, h = a.height || 0;
                try {
                    const r: any = await scanAsset(id, 256, thumbPath(id));
                    if (r && !r.unavailable) { faces = r.faces || []; w = r.width || w; h = r.height || h; }
                } catch { /* 검출 실패 → 얼굴 없이(manual로 유지) */ }
                add.push({ assetId: id, thumbUri: a.uri, width: w, height: h, faces, creationTime: (a as any).creationTime ?? Date.now(), processedAt: Date.now(), manual: true });
            }
            if (add.length === 0) return;
            commit([...items, ...add], crops); // 끝에 추가(드래그 순서 보존)
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } finally {
            setAdding(false);
        }
    };

    // 사진 제거로 페이지 수가 줄면 현재 위치 보정
    useEffect(() => { if (cur > rows.length - 1) setCur(Math.max(0, rows.length - 1)); }, [rows.length]);

    // 프리뷰 포커스 동안만 가로 허용 → 이탈/블러 시 세로 복귀. useFocusEffect가 "갑자기 세로로" 스냅백에 견고.
    useFocusEffect(
        React.useCallback(() => {
            ScreenOrientation.unlockAsync().catch(() => { /* 네이티브 미포함(재빌드 전) → 무시 */ });
            return () => { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => { }); };
        }, [])
    );

    // "가로로도 볼 수 있어요" 토스트 1회
    const hintOpacity = useRef(new Animated.Value(0)).current;
    const [hintShown, setHintShown] = useState(false);
    useEffect(() => {
        setHintShown(true);
        Animated.sequence([
            Animated.timing(hintOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
            Animated.delay(4900), // 꾹눌러 이동 안내까지 읽도록 1.5초 더
            Animated.timing(hintOpacity, { toValue: 0, duration: 420, useNativeDriver: true }),
        ]).start(() => setHintShown(false));
    }, []);

    if (!enabled) return null;

    const curRow = rows[cur];
    // 표지/뒷표지만 라벨(내지 spread 번호는 숨김 — 고객은 시작·끝만 이해)
    const curLabel =
        curRow?.kind === "cover" ? t.pbFrontCover :
        curRow?.kind === "back" ? t.pbBackCover : "";

    function onScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
        const i = Math.round(e.nativeEvent.contentOffset.x / WIN_W);
        if (i !== cur) setCur(i);
    }
    const go = (i: number) => {
        const n = Math.max(0, Math.min(rows.length - 1, i));
        listRef.current?.scrollToIndex({ index: n, animated: true });
        setCur(n);
    };

    // 템플릿 한 페이지 — 각 칸은 얼굴 자동중심 cover-crop(수동 크롭 저장 있으면 우선). 탭하면 크롭 편집.
    // ⚠️ 컴포넌트(<Page/>)가 아니라 함수 호출 → setCur 등 재렌더 시 remount 안 됨(깜빡임 방지).
    const renderPage = (page: LayoutPage | null, side: "l" | "r", pageOffX: number) => (
        <View style={{ width: pageW, height: pageH, backgroundColor: c.surface, borderRightWidth: side === "l" ? 1 : 0, borderRightColor: "rgba(0,0,0,0.06)" }}>
            {/* 상단 밴드에 실제 인쇄되는 년월 (화면 UI가 아니라 페이지의 일부).
                라벨 결정은 pageDateLabels 한 곳 — 단독사진 페이지 제외 + 직전과 같은 년월은 생략.
                작게, 사진 바로 위에 붙여서 인쇄물이 지저분해지지 않게. */}
            {page && (dateLabels[page.index] ?? "") ? (() => {
                const fs = Math.max(7, Math.min(10, Math.round(pageH * 0.038)));
                return (
                    <Text style={{ position: "absolute", top: Math.max(2, pageH * PAGE_TOP_BAND - fs * 1.5), left: pageW * 0.055, fontSize: fs, fontWeight: "700", letterSpacing: 0.3, color: c.coral, opacity: 0.85 }}>
                        {dateLabels[page.index]}
                    </Text>
                );
            })() : null}
            {page?.photos.map((p, i) => {
                const s = page.cells[i];
                if (!p || !s) return null;
                return (
                    <DragCell
                        key={p.assetId}
                        item={p}
                        uri={midMap[p.assetId] ?? p.thumbUri}
                        x={s.x * pageW} y={s.y * pageH}
                        spX={pageOffX + s.x * pageW} spY={s.y * pageH}
                        w={s.w * pageW} h={s.h * pageH}
                        crop={cropFor(p)}
                        bg={c.surfaceAlt}
                        drag={dragCtx}
                        onTap={() => openCrop(p, s)}
                        onLift={onDragLift}
                        onDrop={onDragDrop}
                    />
                );
            })}
        </View>
    );

    const coverBody = () => {
        if (opts.coverStyle === "logo") {
            return (
                <View style={styles.coverFill}>
                    <Text style={{ fontSize: 24, fontWeight: "900", color: c.ink, letterSpacing: -0.3 }}>memotile</Text>
                    <Text style={{ fontSize: 9, letterSpacing: 3, color: c.textMuted, marginTop: 3 }}>PHOTO BOOK</Text>
                    {!!opts.title && <Text style={{ fontSize: 15, color: c.textSecondary, marginTop: 12 }} numberOfLines={1}>{opts.title}</Text>}
                    {!!dateLabel && <Text style={{ fontSize: 11, color: c.textMuted, marginTop: 4 }}>{dateLabel}</Text>}
                </View>
            );
        }
        if (opts.coverStyle === "text") {
            return (
                <View style={{ flex: 1, backgroundColor: c.surface, alignItems: "flex-end", justifyContent: "flex-end", padding: 18 }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: c.ink, textAlign: "right" }} numberOfLines={1}>{opts.title || subjectName}</Text>
                    {!!dateLabel && <Text style={{ fontSize: 11, color: c.textMuted, textAlign: "right", marginTop: 3 }}>{dateLabel}</Text>}
                </View>
            );
        }
        if (opts.coverStyle === "style") {
            return (
                <View style={[styles.coverFill, { padding: 14 }]}>
                    <View style={{ borderRadius: 3, overflow: "hidden" }}>
                        <CoverCrop uri={coverUri} w={styleFrameW} h={styleFrameH} aspect={coverAspect} focusX={cFocusX} focusY={cFocusY} zoom={cZoom} bg={c.surfaceAlt} />
                    </View>
                    <Text style={{ fontSize: 18, fontWeight: "700", color: c.ink, marginTop: 9 }} numberOfLines={1}>{opts.title}</Text>
                    <Text style={{ fontSize: 9, letterSpacing: 2, color: c.textMuted }}>{dateLabel || "PHOTOBOOK"}</Text>
                </View>
            );
        }
        return (
            <View style={{ flex: 1, backgroundColor: c.surfaceAlt }}>
                <CoverCrop uri={coverUri} w={coverW} h={coverH} aspect={coverAspect} focusX={cFocusX} focusY={cFocusY} zoom={cZoom} bg={c.surfaceAlt} />
                <View style={styles.coverBand}>
                    <Text style={{ fontSize: 20, fontWeight: "800", color: "#fff" }} numberOfLines={1}>{opts.title}</Text>
                    <Text style={{ fontSize: 10, letterSpacing: 2, color: "rgba(255,255,255,0.85)" }}>{dateLabel || "PHOTOBOOK"}</Text>
                </View>
            </View>
        );
    };

    const renderRow = ({ item }: { item: Row }) => {
        let inner;
        if (item.kind === "cover") {
            inner = (
                // 표지 뒤 오른쪽에 종이 단면(page edges) 2겹 → "두께 있는 책" 느낌
                <View style={{ width: coverW + 8, height: coverH + 4 }}>
                    <View style={[styles.pageEdge, { width: coverW, height: coverH, left: 8, top: 4 }]} />
                    <View style={[styles.pageEdge, { width: coverW, height: coverH, left: 4, top: 2 }]} />
                    <Pressable disabled={!coverHasPhoto} onPress={() => { setCoverDraft(coverCrop); setCoverEditOpen(true); }} style={[styles.coverSheet, { width: coverW, height: coverH, borderColor: c.border, position: "absolute", left: 0, top: 0 }]}>
                        {coverBody()}
                        {coverHasPhoto && <View style={styles.coverEditChip}><Feather name="edit-2" size={11} color="#fff" /></View>}
                    </Pressable>
                </View>
            );
        } else if (item.kind === "back") {
            inner = (
                <View style={[styles.coverSheet, { width: coverW, height: coverH, borderColor: c.border, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" }]}>
                    <Text style={{ fontSize: 18, fontWeight: "900", color: c.ink, letterSpacing: -0.2 }}>memotile</Text>
                    <Text style={{ fontSize: 8, letterSpacing: 2, color: c.textMuted, marginTop: 3 }}>PHOTO BOOK</Text>
                </View>
            );
        } else {
            const both = !!item.left && !!item.right;
            inner = (
                <View style={[styles.spread, { width: both ? pageW * 2 : pageW, height: pageH, backgroundColor: c.surface, borderColor: c.border }]}>
                    {item.left && renderPage(item.left, both ? "l" : "r", 0)}
                    {item.right && renderPage(item.right, "r", both ? pageW : 0)}
                    {both && <View style={styles.gutter} pointerEvents="none" />}
                </View>
            );
        }
        return (
            <View style={{ width: WIN_W, height: areaH, alignItems: "center", justifyContent: "center" }}>{inner}</View>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: c.bg, paddingTop: insets.top + 8 }]}>
            {/* 가로일 땐 헤더·상단 요소 숨겨 책만 크게 (상하단 레이어 제거) */}
            {!landscape && (
                <View style={styles.header}>
                    <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconBtn}>
                        <Feather name="arrow-left" size={24} color={c.ink} />
                    </Pressable>
                    <Text style={[styles.headerTitle, { color: c.ink }]} numberOfLines={1}>{t.pbPreviewTitle}</Text>
                    <View style={styles.iconBtn} />
                </View>
            )}
            {!landscape && <Text style={[styles.note, { color: c.textMuted }]}>{t.pbPreviewNote}</Text>}

            {!landscape && (
                <View style={styles.densityRow}>
                    {(["relaxed", "balanced", "rich"] as Density[]).map((d) => {
                        const on = density === d;
                        const label = d === "relaxed" ? t.pbDensRelaxed : d === "balanced" ? t.pbDensBalanced : t.pbDensRich;
                        return (
                            <Pressable key={d} onPress={() => setDensity(d)} style={[styles.densityChip, { backgroundColor: on ? c.coral : c.surface, borderColor: on ? c.coral : c.border }]}>
                                <Text style={{ fontSize: 12, fontWeight: "700", color: on ? "#fff" : c.textSecondary }}>{label}</Text>
                            </Pressable>
                        );
                    })}
                </View>
            )}

            {/* 되돌리기 툴바 — 활성=연한 코랄, 비활성=흐림 */}
            {!landscape && (
                <View style={styles.undoBar}>
                    <Pressable onPress={undo} disabled={!canUndo} hitSlop={10} style={styles.undoBtn}>
                        <Feather name="rotate-ccw" size={19} color={canUndo ? c.coral : c.border} />
                    </Pressable>
                    <Pressable onPress={redo} disabled={!canRedo} hitSlop={10} style={styles.undoBtn}>
                        <Feather name="rotate-cw" size={19} color={canRedo ? c.coral : c.border} />
                    </Pressable>
                </View>
            )}

            <View style={{ flex: 1, justifyContent: "center", overflow: "hidden" }} onLayout={(e: LayoutChangeEvent) => setAreaH(e.nativeEvent.layout.height)}>
                <FlatList
                    ref={listRef}
                    key={landscape ? "land" : "port"} /* 회전 시 재마운트 → 새 방향에서 현재 펼침면 바로 렌더(스크롤 점프·지연 없음) */
                    initialScrollIndex={cur}
                    data={rows}
                    keyExtractor={(_, i) => String(i)}
                    renderItem={renderRow}
                    horizontal
                    pagingEnabled
                    scrollEnabled={!dragging}
                    showsHorizontalScrollIndicator={false}
                    onMomentumScrollEnd={onScrollEnd}
                    getItemLayout={(_, i) => ({ length: WIN_W, offset: WIN_W * i, index: i })}
                    initialNumToRender={2}
                    windowSize={3}
                    removeClippedSubviews={false}
                    extraData={crops}
                />

                {/* 좌우 넘김 화살표 */}
                {cur > 0 && (
                    <Pressable onPress={() => go(cur - 1)} style={[styles.arrow, { left: 6, backgroundColor: c.surface, borderColor: c.border }]} hitSlop={8}>
                        <Feather name="chevron-left" size={22} color={c.ink} />
                    </Pressable>
                )}
                {cur < rows.length - 1 && (
                    <Pressable onPress={() => go(cur + 1)} style={[styles.arrow, { right: 6, backgroundColor: c.surface, borderColor: c.border }]} hitSlop={8}>
                        <Feather name="chevron-right" size={22} color={c.ink} />
                    </Pressable>
                )}
            </View>

            {/* 표지 바로 밑 · 위치표시 위: 작은 사진추가 버튼 (구매 전환에 부담 안 주게) */}
            {!landscape && (
                <View style={{ alignItems: "center", marginTop: 6 }}>
                    <Pressable onPress={addPhotos} disabled={adding} style={[styles.addPill, { borderColor: c.coral, backgroundColor: c.surface }]}>
                        <Feather name="plus" size={15} color={c.coral} />
                        <Text style={{ color: c.coral, fontWeight: "800", fontSize: 13, marginLeft: 5 }}>{locale === "TH" ? "เพิ่มรูป" : "Add photos"}</Text>
                    </Pressable>
                </View>
            )}

            {/* 위치 표시(표지/뒷표지만 라벨) + 슬라이드 카운트 + 진행 바 (가로에선 숨김) */}
            {!landscape && (
                <View style={styles.pager}>
                    <Text style={[styles.pagerLabel, { color: c.ink }]}>{curLabel}</Text>
                    <Text style={[styles.pagerCount, { color: c.textMuted }]}>{cur + 1} / {rows.length}</Text>
                    <View style={[styles.progressTrack, { backgroundColor: c.border }]}>
                        <View style={{ width: `${((cur + 1) / rows.length) * 100}%`, height: "100%", borderRadius: 99, backgroundColor: c.coral }} />
                    </View>
                </View>
            )}

            {/* 프리뷰에선 가격/스펙 숨김(사진에만 집중) — 가격은 주문 화면에서 표시 */}
            {!landscape && (
                <View style={[styles.bottomBar, { backgroundColor: c.bg, borderTopColor: c.border, paddingBottom: Math.max(insets.bottom, 14) + 12 }]}>
                    <Pressable onPress={() => router.push({ pathname: "/create/checkout", params: { productType: "photobook" } })} style={{ width: "100%" }}>
                        <PhotobookGradient colors={c.gradient} radius={pbRadius.lg} style={styles.cta}>
                            <Text style={styles.ctaText}>{t.pbOrderCta}</Text>
                        </PhotobookGradient>
                    </Pressable>
                </View>
            )}

            {/* 가로: 떠 있는 최소 뒤로가기 + 페이지 카운터 (immersive) */}
            {landscape && (
                <>
                    <Pressable onPress={() => router.back()} hitSlop={10} style={[styles.floatBtn, { top: insets.top + 6, left: 12, backgroundColor: c.surface, borderColor: c.border }]}>
                        <Feather name="arrow-left" size={20} color={c.ink} />
                    </Pressable>
                    <View style={[styles.floatBtn, { top: insets.top + 6, right: 12, width: undefined, paddingHorizontal: 12, backgroundColor: c.surface, borderColor: c.border }]}>
                        <Text style={{ fontSize: 12, fontWeight: "800", color: c.ink }}>{cur + 1} / {rows.length}</Text>
                    </View>
                </>
            )}

            {/* 가로 보기 안내 토스트 (1회) */}
            {hintShown && (
                <Animated.View pointerEvents="none" style={[styles.hintToast, { top: insets.top + 120, opacity: hintOpacity }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Feather name="rotate-cw" size={13} color="#fff" />
                        <Text style={styles.hintToastTxt}>{t.pbLandscapeHint}</Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5 }}>
                        <Feather name="move" size={13} color="#fff" />
                        <Text style={styles.hintToastTxt}>{locale === "TH" ? "กดค้างที่รูปเพื่อย้ายตำแหน่ง" : "Long-press a photo to move it"}</Text>
                    </View>
                </Animated.View>
            )}

            {/* 사진 탭 → 크롭 편집 (핀치 줌 + 드래그). supportedOrientations로 모달이 세로 강제하지 않게 → 가로 유지 */}
            <Modal visible={!!editing} transparent animationType="fade" supportedOrientations={["portrait", "landscape"]} onRequestClose={() => setEditing(null)}>
                <GestureHandlerRootView style={styles.repoBackdrop}>
                    <Text style={styles.repoTitle}>{t.pbCropTitle}</Text>
                    {editing && (() => {
                        // 화면(세로/가로)에 맞춰 크롭 프레임 fit — 가로에서도 넘치지 않게
                        const maxW = WIN_W - 64, maxH = WIN_H * 0.52;
                        let fw = maxW, fh = fw / editing.cellAspect;
                        if (fh > maxH) { fh = maxH; fw = fh * editing.cellAspect; }
                        return (
                        <View style={{ width: fw, height: fh, borderRadius: 6, overflow: "hidden" }}>
                            <PhotobookCropEditor
                                uri={editUri}
                                frameW={fw}
                                frameH={fh}
                                aspect={editing.imgAspect}
                                value={draft}
                                onChange={setDraft}
                                grid
                            />
                        </View>
                        );
                    })()}
                    <Text style={styles.repoHint}>{t.pbRepositionHint}</Text>
                    {/* 이 사진 빼기 */}
                    <Pressable onPress={removePhoto} style={styles.removeBtn}>
                        <Feather name="trash-2" size={15} color="#fff" />
                        <Text style={styles.removeBtnTxt}>{t.pbRemovePhoto}</Text>
                    </Pressable>
                    <View style={styles.repoBtns}>
                        <Pressable onPress={() => setEditing(null)} style={[styles.repoBtn, { backgroundColor: "rgba(255,255,255,0.14)" }]}>
                            <Text style={styles.repoBtnTxt}>{t.pbCancel}</Text>
                        </Pressable>
                        <Pressable onPress={saveCrop} style={[styles.repoBtn, { backgroundColor: c.coral }]}>
                            <Text style={styles.repoBtnTxt}>{t.pbDone}</Text>
                        </Pressable>
                    </View>
                </GestureHandlerRootView>
            </Modal>

            {/* 표지 크롭 편집 (+ 사진 변경) */}
            <Modal visible={coverEditOpen} transparent animationType="fade" supportedOrientations={["portrait", "landscape"]} onRequestClose={() => setCoverEditOpen(false)}>
                <GestureHandlerRootView style={styles.repoBackdrop}>
                    <Text style={styles.repoTitle}>{t.pbRepositionTitle}</Text>
                    {coverEditOpen && (() => {
                        const cAsp = opts.coverStyle === "style" ? styleFrameW / styleFrameH : RATIO;
                        const maxW = WIN_W - 64, maxH = WIN_H * 0.52;
                        let fw = maxW, fh = fw / cAsp;
                        if (fh > maxH) { fh = maxH; fw = fh * cAsp; }
                        return (
                            <View style={{ width: fw, height: fh, borderRadius: 6, overflow: "hidden" }}>
                                <PhotobookCropEditor uri={coverUri} frameW={fw} frameH={fh} aspect={coverAspect} value={coverDraft} onChange={setCoverDraft} grid />
                            </View>
                        );
                    })()}
                    <Text style={styles.repoHint}>{t.pbRepositionHint}</Text>
                    <Pressable onPress={() => { setCoverEditOpen(false); setCoverPickerOpen(true); }} style={styles.removeBtn}>
                        <Feather name="image" size={15} color="#fff" />
                        <Text style={styles.removeBtnTxt}>{t.pbCoverPick}</Text>
                    </Pressable>
                    <View style={styles.repoBtns}>
                        <Pressable onPress={() => setCoverEditOpen(false)} style={[styles.repoBtn, { backgroundColor: "rgba(255,255,255,0.14)" }]}>
                            <Text style={styles.repoBtnTxt}>{t.pbCancel}</Text>
                        </Pressable>
                        <Pressable onPress={saveCoverCrop} style={[styles.repoBtn, { backgroundColor: c.coral }]}>
                            <Text style={styles.repoBtnTxt}>{t.pbDone}</Text>
                        </Pressable>
                    </View>
                </GestureHandlerRootView>
            </Modal>

            {/* 표지 사진 선택 */}
            <Modal visible={coverPickerOpen} transparent animationType="slide" supportedOrientations={["portrait", "landscape"]} onRequestClose={() => setCoverPickerOpen(false)}>
                <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={() => setCoverPickerOpen(false)} />
                <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: insets.bottom + 16 }]}>
                    <Text style={[styles.sheetTitle, { color: c.ink }]}>{t.pbCoverPick}</Text>
                    <ScrollView contentContainerStyle={styles.pickGrid} style={{ maxHeight: 380 }}>
                        {items.map((it) => (
                            <Pressable key={it.assetId} onPress={() => pickCover(it.assetId)} style={[styles.pickCell, { backgroundColor: c.surfaceAlt, borderWidth: coverAssetId === it.assetId ? 2 : 0, borderColor: c.coral }]}>
                                <ExpoImage source={{ uri: it.thumbUri }} style={{ width: "100%", height: "100%" }} contentFit="cover" cachePolicy="memory-disk" />
                            </Pressable>
                        ))}
                    </ScrollView>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: OUTER, paddingBottom: 4 },
    iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 18, fontWeight: "800", flex: 1, textAlign: "center" },
    undoBar: { flexDirection: "row", justifyContent: "flex-end", gap: 4, paddingHorizontal: OUTER, marginTop: 2 },
    undoBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
    addPill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, height: 34, borderRadius: 99, borderWidth: 1.5 },
    priceLine: { fontSize: 13, fontWeight: "700", textAlign: "center", marginBottom: 10 },
    floatBtn: { position: "absolute", height: 36, minWidth: 36, borderRadius: 18, borderWidth: 0.5, alignItems: "center", justifyContent: "center", zIndex: 30 },
    hintToast: { position: "absolute", alignSelf: "center", backgroundColor: "rgba(20,16,14,0.86)", paddingHorizontal: 16, paddingVertical: 11, borderRadius: 18, zIndex: 20 },
    hintToastTxt: { fontSize: 12.5, fontWeight: "700", color: "#fff" },
    note: { fontSize: 12, textAlign: "center", marginBottom: 4 },

    coverFill: { flex: 1, backgroundColor: "transparent", alignItems: "center", justifyContent: "center", padding: 14 },
    coverSheet: { borderRadius: 6, borderWidth: 0.5, overflow: "hidden", backgroundColor: "#fff" },
    pageEdge: { position: "absolute", borderRadius: 5, backgroundColor: "#F1E9DD", borderWidth: 0.5, borderColor: "rgba(0,0,0,0.08)" }, // 책 종이 단면

    coverEditChip: { position: "absolute", top: 7, right: 7, width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(20,16,14,0.5)" },
    sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 16 },
    sheetTitle: { fontSize: 16, fontWeight: "800", textAlign: "center", marginBottom: 12 },
    pickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    pickCell: { width: "31.5%", aspectRatio: 1, borderRadius: 8, overflow: "hidden" },
    coverBand: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "rgba(20,16,14,0.34)" },

    spread: { flexDirection: "row", borderRadius: 5, borderWidth: 0.5, overflow: "hidden" },
    gutter: { position: "absolute", left: "50%", top: 0, bottom: 0, width: 10, marginLeft: -5, backgroundColor: "rgba(0,0,0,0.06)" },
    spreadDate: { fontSize: 10.5, fontWeight: "600", letterSpacing: 0.6, marginBottom: 6, marginLeft: 2 },

    arrow: { position: "absolute", top: "50%", marginTop: -19, width: 38, height: 38, borderRadius: 19, borderWidth: 0.5, alignItems: "center", justifyContent: "center" },

    pager: { alignItems: "center", paddingHorizontal: OUTER, paddingTop: 2, paddingBottom: 8, zIndex: 5 },
    pagerLabel: { fontSize: 13, fontWeight: "800" },
    pagerCount: { fontSize: 11, fontWeight: "600", marginTop: 2 },
    progressTrack: { width: "60%", height: 3, borderRadius: 99, marginTop: 8, overflow: "hidden" },

    bottomBar: { paddingHorizontal: OUTER, paddingTop: 10, borderTopWidth: 0.5, zIndex: 50, elevation: 8 },
    cta: { height: 56, alignItems: "center", justifyContent: "center" },
    ctaText: { fontSize: 16, lineHeight: 30, fontWeight: "800", color: "#fff", textShadowColor: "rgba(0,0,0,0.25)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },

    densityRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 4, marginBottom: 2 },
    densityChip: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 99, borderWidth: 1 },

    repoBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.88)", alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
    repoTitle: { fontSize: 16, fontWeight: "800", color: "#fff", marginBottom: 16 },
    repoHint: { fontSize: 12.5, color: "rgba(255,255,255,0.75)", marginTop: 14 },
    repoBtns: { flexDirection: "row", gap: 12, marginTop: 22 },
    repoBtn: { paddingHorizontal: 30, paddingVertical: 12, borderRadius: 12 },
    repoBtnTxt: { fontSize: 15, fontWeight: "800", color: "#fff" },
    removeBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 16, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 99, borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" },
    removeBtnTxt: { fontSize: 13, fontWeight: "700", color: "#fff" },
});
