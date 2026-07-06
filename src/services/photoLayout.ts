// src/services/photoLayout.ts
//
// 포토북 자동 배치 — "디자인된 페이지 템플릿" 방식.
// 6종 템플릿(히어로/미니멀/좌우2/상하2/3장/4장)을 사진 방향·개수·강도로 지능 배치.
// 규칙: 방향 매칭 + 강한 컷(얼굴 큰 사진) 히어로 승격 + 리듬(연속 히어로/그리드 금지) + 여백 일관.
// 각 칸은 얼굴 bbox 중심으로 cover-crop(렌더 측에서 처리). 좌표만 다루므로 데이터 부담 0.
import { ScanItem } from "../types/scan";

export interface Slot { x: number; y: number; w: number; h: number; } // 0~1 페이지 정규화
export interface LayoutPage { index: number; kind: PageKind; cells: Slot[]; photos: ScanItem[]; }
export type PageKind = "hero" | "minimal" | "duo" | "grid";
export type Density = "relaxed" | "balanced" | "rich";

function rngFrom(seed: number): () => number {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function photoAspect(p: ScanItem): number {
    const a = p.width / p.height;
    return Number.isFinite(a) && a > 0 ? a : 1;
}
function isLandscape(p: ScanItem) { return photoAspect(p) >= 1.15; }

// 얼굴 크기(=강한 컷 지표). 얼굴 없으면 약하게.
function strengthOf(p: ScanItem): number {
    const f = p.faces?.length ? p.faces.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b)) : null;
    return f ? f.width * f.height : 0.01;
}

// ── 템플릿(정규화 칸). 가장자리 여백 ~1cm 유지하되 안쪽은 타이트하게(사진 크게). 히어로만 풀블리드 ──
// A4 기준: 폭 27.9cm·높이 21.5cm. MX≈1cm→0.036, MY≈1cm→0.047, 간격 G≈0.7cm.
const MX = 0.038, MY = 0.05, G = 0.026;
const IX = MX, IY = MY, IW = 1 - 2 * MX, IH = 1 - 2 * MY; // 안쪽 영역

const HERO: Slot[] = [{ x: 0, y: 0, w: 1, h: 1 }];
const DUO_LR: Slot[] = (() => { const w = (IW - G) / 2; return [{ x: IX, y: IY, w, h: IH }, { x: IX + w + G, y: IY, w, h: IH }]; })();
const DUO_STACK: Slot[] = (() => { const h = (IH - G) / 2; return [{ x: IX, y: IY, w: IW, h }, { x: IX, y: IY + h + G, w: IW, h }]; })();
const GRID3: Slot[] = (() => { const wL = (IW - G) * 0.6, wR = (IW - G) * 0.4, hR = (IH - G) / 2; return [{ x: IX, y: IY, w: wL, h: IH }, { x: IX + wL + G, y: IY, w: wR, h: hR }, { x: IX + wL + G, y: IY + hR + G, w: wR, h: hR }]; })();
const GRID4: Slot[] = (() => { const w = (IW - G) / 2, h = (IH - G) / 2; return [{ x: IX, y: IY, w, h }, { x: IX + w + G, y: IY, w, h }, { x: IX, y: IY + h + G, w, h }, { x: IX + w + G, y: IY + h + G, w, h }]; })();

// 각 페이지 상단에 흰 밴드(날짜가 실제 인쇄되는 영역) 확보. 사진 칸을 밴드 아래로 압축.
export const PAGE_TOP_BAND = 0.12; // 페이지 높이의 12% (~2.5cm on A4)
function withTopBand(cells: Slot[]): Slot[] {
    const B = PAGE_TOP_BAND;
    return cells.map((c) => ({ x: c.x, y: B + c.y * (1 - B), w: c.w, h: c.h * (1 - B) }));
}

// 미니멀: 사진 비율 그대로, 약간 넉넉한 여백 안에(크롭 없음, 숨 쉬는 페이지)
function minimalCell(a: number, ratio: number): Slot {
    const mx = 0.11, my = 0.13;
    const maxW = 1 - 2 * mx, maxH = 1 - 2 * my;
    let cw = maxW, ch = (cw * ratio) / a; // 칸 픽셀비율 = (cw*ratio)/ch = a
    if (ch > maxH) { ch = maxH; cw = (ch * a) / ratio; }
    return { x: (1 - cw) / 2, y: (1 - ch) / 2, w: cw, h: ch };
}

// 1장 페이지 빈도 축소 (강한 컷 히어로는 별도로 승격). 애매한 1장씩 연속 방지는 시퀀서에서.
const POOLS: Record<Density, number[]> = { relaxed: [1, 2, 2, 3], balanced: [2, 2, 3, 3], rich: [2, 3, 3, 4] };
const FRACTION: Record<Density, number> = { relaxed: 0.4, balanced: 0.72, rich: 1.0 };

/** 선택 사진을 디자인된 템플릿 페이지 배열로. ratio=페이지 가로/세로, density=밀도 프리셋 */
export function buildPages(items: ScanItem[], ratio: number = 27.9 / 21.5, density: Density = "balanced"): LayoutPage[] {
    let photos = [...items]; // items 순서 그대로 사용(드래그 스왑 유지). 호출부에서 시간순 정렬해 전달.
    if (photos.length === 0) return [];

    // 밀도 프리셋: 여유롭게일수록 강한 컷만 큐레이션(시간순 유지)
    const frac = FRACTION[density];
    if (frac < 1 && photos.length > 8) {
        const keep = Math.max(6, Math.round(photos.length * frac));
        const strong = new Set([...photos].sort((a, b) => strengthOf(b) - strengthOf(a)).slice(0, keep).map((p) => p.assetId));
        photos = photos.filter((p) => strong.has(p.assetId));
    }

    // 히어로 승격 임계 = 강도 상위 30%
    const sorted = photos.map(strengthOf).sort((a, b) => b - a);
    const strongTh = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.3))] : Infinity;

    const rng = rngFrom(photos.length * 7 + 13);
    const pool = POOLS[density];
    // photos[idx]가 히어로로 승격될 강한 컷인지(가로 or 큰 얼굴)
    const isStrongCut = (idx: number, prevBig: boolean) => (isLandscape(photos[idx]) || strengthOf(photos[idx]) >= strongTh) && !prevBig;

    const pages: LayoutPage[] = [];
    let i = 0, prevBig = false, prevGrid = false, prevSingle = false;

    while (i < photos.length) {
        const remaining = photos.length - i;
        let count = Math.min(pool[Math.floor(rng() * pool.length)], remaining);
        if (count >= 3 && prevGrid) count = Math.min(2, remaining);                       // 연속 그리드 금지
        if (count === 1 && prevSingle && !isStrongCut(i, prevBig)) count = Math.min(2, remaining); // 애매한 1장 연속 금지
        if (count <= 0) count = 1;
        const group = photos.slice(i, i + count);

        let cells: Slot[]; let kind: PageKind;
        if (count === 1) {
            const p = group[0], a = photoAspect(p);
            if (isStrongCut(i, prevBig)) { cells = HERO; kind = "hero"; }
            else { cells = [minimalCell(a, ratio)]; kind = "minimal"; }
        } else if (count === 2) {
            cells = group.every(isLandscape) ? DUO_STACK : DUO_LR; kind = "duo";
        } else if (count === 3) { cells = GRID3; kind = "grid"; }
        else { cells = GRID4; kind = "grid"; }

        pages.push({ index: pages.length, kind, cells: withTopBand(cells), photos: group });
        prevBig = kind === "hero"; prevGrid = kind === "grid"; prevSingle = count === 1;
        i += count;
    }
    return pages;
}
