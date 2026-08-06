// src/components/photobook/PhotobookViewer.tsx
//
// 읽기전용 "받으실 포토북 감상" 뷰어 (모달) — 편집 UI(드래그·크롭 핸들) 없이 책만 깨끗하게.
// 펼침면(2페이지) 스와이프 + 가운데 책등(gutter) + 종이 여백 + 표지→속지→뒷표지.
// 편집 프리뷰(app/photobook/preview.tsx)와 같은 레이아웃 엔진(buildPages)·크롭·테마를 재사용해 동일하게 보이되,
// 여기선 정적 렌더(제스처 없음). "수정하기"는 부모(onEdit)가 편집 프리뷰로 보냄.
import React, { useMemo, useRef, useState } from "react";
import {
    View, Text, StyleSheet, FlatList, Pressable, Modal, useWindowDimensions,
    NativeSyntheticEvent, NativeScrollEvent,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLanguage } from "../../context/LanguageContext";
import { getAlbumDraft, getAlbumOptions, getAllCrops } from "../../services/albumDraft";
import { useHiResCover } from "../../services/coverImage";
import { useMidResMap } from "../../services/midResImage";
import { buildPages, LayoutPage, photoAspect, PAGE_TOP_BAND, Density, pageDateLabels } from "../../services/photoLayout";
import { usePhotobookTheme } from "../../config/photobookTheme";
import { CoverCrop } from "./CoverCrop";

const OUTER = 14;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function ym(ms: number) { const d = new Date(ms); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}`; }
function dateRangeLabel(items: { creationTime?: number }[]): string {
    const ts = items.map((i) => i.creationTime).filter((x): x is number => !!x);
    if (!ts.length) return "";
    const a = ym(Math.min(...ts)), b = ym(Math.max(...ts));
    return a === b ? a : `${a} ~ ${b}`;
}
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
function faceCenter(p?: { faces?: { x: number; y: number; width: number; height: number }[] }): { x: number; y: number } {
    const f = p?.faces?.length ? p.faces.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b)) : null;
    return f ? { x: clamp01(f.x + f.width / 2), y: clamp01(f.y + f.height / 2) } : { x: 0.5, y: 0.5 };
}

type Row =
    | { kind: "cover" }
    | { kind: "back" }
    | { kind: "spread"; left: LayoutPage | null; right: LayoutPage | null; n: number };

export function PhotobookViewer({ visible, onClose, onEdit }: {
    visible: boolean;
    onClose: () => void;
    onEdit: () => void;
}) {
    const c = usePhotobookTheme();
    const insets = useSafeAreaInsets();
    const { t, locale } = useLanguage();
    const { width: WIN_W } = useWindowDimensions();

    const opts = getAlbumOptions();
    const draft = getAlbumDraft();
    const crops = getAllCrops();
    const RATIO = opts.size === "A3" ? 38.6 / 29.7 : 27.9 / 21.5; // 가로형 w/h (편집 프리뷰와 동일)
    const density = ((opts.density as Density) || "balanced");

    // 편집 프리뷰와 동일: 시간순 정렬(드래그 순서는 albumDraft에 이미 반영돼 있음)
    const items = useMemo(() => [...draft.items].sort((a, b) => (a.creationTime ?? 0) - (b.creationTime ?? 0)), [visible]);

    const pages = useMemo(() => buildPages(items, RATIO, density), [items, RATIO, density, visible]);
    // 페이지별 날짜 라벨(단독사진 제외·연속 중복 생략) — freeze/PDF와 같은 함수라 인쇄물과 일치
    const dateLabels = useMemo(() => pageDateLabels(pages), [pages]);

    const rows = useMemo<Row[]>(() => {
        const spreads: Row[] = [];
        for (let i = 0; i < pages.length; i += 2) spreads.push({ kind: "spread", left: pages[i] ?? null, right: pages[i + 1] ?? null, n: i / 2 + 1 });
        return [{ kind: "cover" }, ...spreads, { kind: "back" }];
    }, [pages]);

    const [cur, setCur] = useState(0);
    const [areaH, setAreaH] = useState(340);
    const listRef = useRef<FlatList<Row>>(null);
    const goTo = (i: number) => {
        const n = Math.max(0, Math.min(rows.length - 1, i));
        listRef.current?.scrollToIndex({ index: n, animated: true });
        setCur(n);
    };

    // (C) 현재 펼침면 + 양옆만 중간해상도로 선명하게(나머지는 썸네일). 보이는 윈도우만 로드.
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

    // contain-fit (편집 프리뷰 세로 기준과 동일 계산)
    const availW = WIN_W - OUTER * 2;
    const availH = Math.max(120, areaH - 20);
    const spreadAspect = 2 * RATIO;
    const spreadW = availW / availH > spreadAspect ? availH * spreadAspect : availW;
    const pageW = spreadW / 2;
    const pageH = spreadW / spreadAspect;
    const coverBoxW = availW * 0.78;
    const coverW = coverBoxW / availH > RATIO ? availH * RATIO : coverBoxW;
    const coverH = coverW / RATIO;

    // 표지 변수 (albumDraft options). 표지는 원본 고해상도(useHiResCover) — 고객이 제일 먼저 봄.
    const coverAssetId = opts.coverPhotoId ?? items[0]?.assetId;
    const coverItem = items.find((i) => i.assetId === coverAssetId);
    const coverUri = useHiResCover(coverAssetId, coverItem?.thumbUri);
    const coverAspect = coverItem && coverItem.height ? coverItem.width / coverItem.height : 1;
    const cFocusX = opts.coverFocusX ?? 0.5, cFocusY = opts.coverFocusY ?? 0.5, cZoom = opts.coverZoom ?? 1;
    const styleFrameW = coverW - 28, styleFrameH = coverH - 64;
    const dateLabel = dateRangeLabel(items);
    const subjectName = draft.subjectName;

    const cropFor = (p: { assetId: string; faces?: any[] }) => crops[p.assetId] ?? { fx: faceCenter(p).x, fy: faceCenter(p).y, zoom: 1 };

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

    const renderPage = (page: LayoutPage | null, side: "l" | "r") => {
        // 라벨은 pageDateLabels가 결정(단독사진 제외 + 직전과 같으면 생략). freeze/PDF와 동일 규칙.
        const label = page ? (dateLabels[page.index] ?? "") : "";
        // 작게, 그리고 사진 바로 위에 붙여서 — 밴드 한가운데 크게 떠 있으면 지저분하다.
        const fs = Math.max(7, Math.min(10, Math.round(pageH * 0.038)));
        return (
        <View style={{ width: pageW, height: pageH, backgroundColor: c.surface, borderRightWidth: side === "l" ? 1 : 0, borderRightColor: "rgba(0,0,0,0.06)" }}>
            {label ? (
                <Text style={{ position: "absolute", top: Math.max(2, pageH * PAGE_TOP_BAND - fs * 1.5), left: pageW * 0.055, fontSize: fs, fontWeight: "700", letterSpacing: 0.3, color: c.coral, opacity: 0.85 }}>
                    {label}
                </Text>
            ) : null}
            {page?.photos.map((p, i) => {
                const s = page.cells[i];
                if (!p || !s) return null;
                const cr = cropFor(p);
                return (
                    <View key={p.assetId} style={{ position: "absolute", left: s.x * pageW, top: s.y * pageH, width: s.w * pageW, height: s.h * pageH, borderRadius: 2, overflow: "hidden", backgroundColor: c.surfaceAlt }}>
                        <CoverCrop uri={midMap[p.assetId] ?? p.thumbUri} w={s.w * pageW} h={s.h * pageH} aspect={photoAspect(p)} focusX={cr.fx} focusY={cr.fy} zoom={cr.zoom} bg={c.surfaceAlt} />
                    </View>
                );
            })}
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
                    <View style={[styles.coverSheet, { width: coverW, height: coverH, borderColor: c.border, backgroundColor: c.surface, position: "absolute", left: 0, top: 0 }]}>{coverBody()}</View>
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
                    {item.left && renderPage(item.left, both ? "l" : "r")}
                    {item.right && renderPage(item.right, "r")}
                    {both && <View style={styles.gutter} pointerEvents="none" />}
                </View>
            );
        }
        return <View style={{ width: WIN_W, height: areaH, alignItems: "center", justifyContent: "center" }}>{inner}</View>;
    };

    function onScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
        const i = Math.round(e.nativeEvent.contentOffset.x / WIN_W);
        if (i !== cur) setCur(i);
    }

    const curRow = rows[cur];
    const label = curRow?.kind === "cover" ? t.pbFrontCover : curRow?.kind === "back" ? t.pbBackCover : curRow?.kind === "spread" ? `${t.pbSpread} ${curRow.n}` : "";
    const headerTitle = (locale || "EN") === "TH" ? "โฟโต้บุ๊กของคุณ" : "Your photobook";
    const editLabel = (locale || "EN") === "TH" ? "แก้ไข" : "Edit";

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={onClose} supportedOrientations={["portrait"]}>
            <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top }]}>
                <View style={styles.header}>
                    <Pressable onPress={onClose} hitSlop={16} style={styles.iconBtn}><Feather name="x" size={24} color={c.ink} /></Pressable>
                    <Text style={[styles.title, { color: c.ink }]} numberOfLines={1}>{headerTitle}</Text>
                    <View style={styles.iconBtn} />
                </View>

                <View style={{ flex: 1, justifyContent: "center", overflow: "hidden" }} onLayout={(e) => setAreaH(e.nativeEvent.layout.height)}>
                    <FlatList
                        ref={listRef}
                        data={rows}
                        keyExtractor={(_, i) => String(i)}
                        renderItem={renderRow}
                        horizontal
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                        onMomentumScrollEnd={onScrollEnd}
                        getItemLayout={(_, i) => ({ length: WIN_W, offset: WIN_W * i, index: i })}
                        initialNumToRender={2}
                        windowSize={3}
                    />
                    {/* 넘김 유도 — 스와이프 안 해도 탭으로 책장 넘김 */}
                    {cur > 0 && (
                        <Pressable onPress={() => goTo(cur - 1)} hitSlop={8} style={[styles.navBtn, { left: 8, backgroundColor: c.surface, borderColor: c.border }]}>
                            <Feather name="chevron-left" size={22} color={c.ink} />
                        </Pressable>
                    )}
                    {cur < rows.length - 1 && (
                        <Pressable onPress={() => goTo(cur + 1)} hitSlop={8} style={[styles.navBtn, { right: 8, backgroundColor: c.surface, borderColor: c.border }]}>
                            <Feather name="chevron-right" size={22} color={c.ink} />
                        </Pressable>
                    )}
                </View>

                <View style={styles.pager}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: c.textSecondary }}>{label}</Text>
                    <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${rows.length > 1 ? (cur / (rows.length - 1)) * 100 : 0}%`, backgroundColor: c.coral }]} />
                    </View>
                </View>

                <View style={[styles.footer, { borderTopColor: c.border, backgroundColor: c.bg }]}>
                    <Pressable onPress={onEdit} style={[styles.editBtn, { borderColor: c.border, backgroundColor: c.surface }]}>
                        <Feather name="edit-2" size={16} color={c.ink} />
                        <Text style={[styles.editText, { color: c.ink }]}>{editLabel}</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: OUTER, paddingTop: 12, paddingBottom: 6 },
    iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    title: { fontSize: 17, fontWeight: "800" },
    coverSheet: { borderRadius: 6, borderWidth: 0.5, overflow: "hidden" },
    pageEdge: { position: "absolute", borderRadius: 5, backgroundColor: "#F1E9DD", borderWidth: 0.5, borderColor: "rgba(0,0,0,0.08)" }, // 책 종이 단면
    coverFill: { flex: 1, alignItems: "center", justifyContent: "center" },
    coverBand: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "rgba(0,0,0,0.28)" },
    spread: { flexDirection: "row", borderRadius: 5, borderWidth: 0.5, overflow: "hidden" },
    gutter: { position: "absolute", left: "50%", top: 0, bottom: 0, width: 10, marginLeft: -5, backgroundColor: "rgba(0,0,0,0.06)" },
    navBtn: { position: "absolute", top: "50%", marginTop: -20, width: 40, height: 40, borderRadius: 20, borderWidth: 0.5, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
    pager: { alignItems: "center", paddingVertical: 8, gap: 6 },
    progressTrack: { width: 160, height: 3, borderRadius: 2, backgroundColor: "rgba(0,0,0,0.08)", overflow: "hidden" },
    progressFill: { height: 3, borderRadius: 2 },
    footer: { paddingHorizontal: OUTER, paddingTop: 10, paddingBottom: 28, borderTopWidth: 0.5 },
    editBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 52, borderRadius: 14, borderWidth: 1 },
    editText: { fontSize: 15, fontWeight: "800" },
});
