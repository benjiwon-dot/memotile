// src/services/photobookFreeze.ts
//
// P1 — 조판 결과 "동결(freeze)".
// 프리뷰가 buildPages로 계산한 "고객이 본 그 페이지들"을 서버(PDF 렌더러)가
// 레이아웃 로직 재실행 없이 그대로 렌더할 수 있도록 JSON으로 직렬화한다.
// buildPages는 결정적(rngFrom 시드)이므로, 여기서 계산한 pages == 프리뷰가 보여준 pages.
//
// ⚠️ faceCenterOf / resolveCrop / ratioForSize 는 app/photobook/preview.tsx의
//    동일 로직을 미러링한 것 — 프리뷰 렌더와 100% 일치해야 하므로 둘을 함께 수정할 것.
//    실제 크롭 렌더 수식은 src/components/photobook/CoverCrop.tsx 참고(서버가 이걸 재현).
import { ScanItem } from "../types/scan";
import { buildPages, photoAspect, PAGE_TOP_BAND, LayoutPage, PageKind, Density, pageDateLabels } from "./photoLayout";
import type { PhotoCrop } from "./albumDraft";

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

// preview.tsx faceCenterOf 와 동일 — 가장 큰 얼굴 bbox 중심(없으면 0.5,0.5)
function faceCenterOf(p?: { faces?: { x: number; y: number; width: number; height: number }[] }): { x: number; y: number } {
    const f = p?.faces?.length ? p.faces.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b)) : null;
    return f ? { x: clamp01(f.x + f.width / 2), y: clamp01(f.y + f.height / 2) } : { x: 0.5, y: 0.5 };
}

// preview.tsx cropFor 와 동일 — 수동 저장 크롭 우선, 없으면 얼굴 자동중심
export function resolveCrop(item: ScanItem, crops: Record<string, PhotoCrop>): PhotoCrop {
    const stored = crops[item.assetId];
    if (stored) return stored;
    const fc = faceCenterOf(item);
    return { fx: fc.x, fy: fc.y, zoom: 1 };
}

// 표지 크롭 — 사용자가 명시적으로 조정한 값이 있으면 우선, 없으면 표지 사진의 얼굴 중심(중앙 0.5가 아님).
export function resolveCoverCrop(item: ScanItem | undefined, c: { fx?: number | null; fy?: number | null; zoom?: number | null }): PhotoCrop {
    if (c.fx != null && c.fy != null) return { fx: c.fx, fy: c.fy, zoom: c.zoom ?? 1 };
    const fc = item ? faceCenterOf(item) : { x: 0.5, y: 0.5 };
    return { fx: fc.x, fy: fc.y, zoom: 1 };
}

// preview.tsx RATIO 와 동일 — 가로형 페이지 w/h. A5는 A4와 동일 비율.
export function ratioForSize(size: string): number {
    return size === "A3" ? 38.6 / 29.7 : 27.9 / 21.5;
}

// preview.tsx monthRange 와 동일 — 페이지 상단 밴드에 인쇄할 촬영 년월 라벨
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

// preview.tsx dateRangeLabel 와 동일 — 표지에 인쇄할 전체 기간(년월). "2025.06" / "2025.06 ~ 08".
function coverDateRange(items: { creationTime?: number }[]): string {
    const ts = items.map((i) => i.creationTime).filter((x): x is number => !!x);
    if (!ts.length) return "";
    const ym = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}`; };
    const a = ym(Math.min(...ts)), b = ym(Math.max(...ts));
    return a === b ? a : `${a} ~ ${b}`;
}

// ── 동결 스키마(서버 PDF 렌더러 입력) ──
// 좌표는 모두 0~1 페이지 정규화. idx = originals/{idx}.jpg 인덱스(= 주문 photos 순서).
export interface FrozenCell {
    idx: number;          // 원본 인덱스 (originals/{idx}.jpg). -1 = 사진 없음
    assetId: string;
    x: number; y: number; w: number; h: number;  // 0~1 페이지 정규화 셀 사각형
    aspect: number;       // 소스 사진 가로/세로 (서버가 원본에서 재확인해도 됨)
    crop: PhotoCrop;      // {fx,fy,zoom} — CoverCrop 수식으로 렌더
}
export interface FrozenPage {
    index: number;
    kind: PageKind;       // hero | minimal | duo | grid
    dateLabel: string;    // 상단 밴드 인쇄 년월(hero는 밴드 없음 → 미인쇄)
    cells: FrozenCell[];
}
export interface FrozenCover {
    idx: number | null;   // 표지 사진의 원본 인덱스
    assetId: string | null;
    style?: string;       // logo | text | style | photo — 프리뷰 표지 모델
    title?: string;
    dateLabel?: string;   // 전체 기간(년월) — 표지에 인쇄
    crop: PhotoCrop;
}
export interface FrozenLayout {
    version: 2;
    engine: "buildPages@1";
    size: string;         // A4 | A3 | A5
    coverMaterial: string; // soft | hard
    density: Density;
    ratio: number;        // 페이지 가로/세로
    topBand: number;      // 상단 흰 밴드 비율(PAGE_TOP_BAND)
    coverPage: FrozenCover;
    pages: FrozenPage[];  // 내지(커버·뒷표지 제외)
}

export function buildFrozenLayout(opts: {
    items: ScanItem[];
    size: string;
    coverMaterial: string;
    density: Density;
    crops: Record<string, PhotoCrop>;
    // fx/fy가 null/undefined면 표지 사진의 얼굴 중심으로 자동 크롭(중앙 0.5가 아님).
    cover: { assetId: string | null; style?: string; title?: string; fx?: number | null; fy?: number | null; zoom?: number | null };
}): FrozenLayout {
    const ratio = ratioForSize(opts.size);
    // 표지 사진은 내지에서 제외(표지 다음 첫 장이 같은 사진으로 중복되는 것 방지). indexOf/originals는 전체 유지.
    const coverAssetId = opts.cover.assetId;
    const interiorItems = coverAssetId ? opts.items.filter((it) => it.assetId !== coverAssetId) : opts.items;
    const pages: LayoutPage[] = buildPages(interiorItems, ratio, opts.density);
    const indexOf = new Map(opts.items.map((it, i) => [it.assetId, i] as const));

    // 날짜 라벨은 photoLayout.pageDateLabels 한 곳에서 결정(단독사진 제외 + 연속 중복 생략).
    // 프리뷰(PhotobookViewer)도 같은 함수를 쓰므로 화면과 인쇄물이 반드시 일치한다.
    const dateLabels = pageDateLabels(pages);

    const fpages: FrozenPage[] = pages.map((pg) => ({
        index: pg.index,
        kind: pg.kind,
        dateLabel: dateLabels[pg.index] ?? "",
        cells: pg.cells.map((s, k) => {
            const p = pg.photos[k];
            return {
                idx: p ? (indexOf.get(p.assetId) ?? -1) : -1,
                assetId: p?.assetId ?? "",
                x: s.x, y: s.y, w: s.w, h: s.h,
                aspect: p ? photoAspect(p) : 1,
                crop: p ? resolveCrop(p, opts.crops) : { fx: 0.5, fy: 0.5, zoom: 1 },
            };
        }),
    }));

    const coverIdx = opts.cover.assetId ? (indexOf.get(opts.cover.assetId) ?? null) : null;
    const coverItem = opts.cover.assetId ? opts.items.find((it) => it.assetId === opts.cover.assetId) : undefined;
    const coverCrop = resolveCoverCrop(coverItem, { fx: opts.cover.fx, fy: opts.cover.fy, zoom: opts.cover.zoom });

    return {
        version: 2,
        engine: "buildPages@1",
        size: opts.size,
        coverMaterial: opts.coverMaterial,
        density: opts.density,
        ratio,
        topBand: PAGE_TOP_BAND,
        coverPage: {
            idx: coverIdx,
            assetId: opts.cover.assetId,
            style: opts.cover.style,
            title: opts.cover.title,
            dateLabel: coverDateRange(opts.items as any),
            crop: coverCrop,
        },
        pages: fpages,
    };
}
