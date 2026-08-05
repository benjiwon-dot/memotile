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

// 강도(베스트컷 지표) = 얼굴크기(bbox) × 정면성(quality) × 선명도(sharpness). 얼굴 없으면 약하게.
function strengthOf(p: ScanItem): number {
    const f = p.faces?.length ? p.faces.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b)) : null;
    if (!f) return 0.01;
    const area = f.width * f.height;
    const q = 0.5 + (f.quality ?? 0.5) * 0.5;                 // 정면성 0~1 → 0.5~1.0 가중
    const s = f.sharpness != null ? Math.min(1.4, 0.6 + f.sharpness / 400) : 1; // 선명도(있을 때만)
    return area * q * s;
}

// ── 템플릿(정규화 칸). 가장자리 여백 ~1cm 유지하되 안쪽은 타이트하게(사진 크게). 히어로만 풀블리드 ──
// A4 기준: 폭 27.9cm·높이 21.5cm. MX≈1cm→0.036, MY≈1cm→0.047, 간격 G≈0.7cm.
const MX = 0.038, MY = 0.05, G = 0.026;
const IX = MX, IY = MY, IW = 1 - 2 * MX, IH = 1 - 2 * MY; // 안쪽 영역

const HERO: Slot[] = [{ x: 0, y: 0, w: 1, h: 1 }];

// ── 리드 슬롯 템플릿(세로 사진 위주). 대부분 사진이 세로라 "세로 칸(컬럼)" 중심으로 설계.
// 가로 사진은 히어로(풀블리드)로 별도 승격. 각 배열 cells[0] = 리드(그 페이지 베스트컷).
const _duoLR = (() => { const w = (IW - G) / 2; return [{ x: IX, y: IY, w, h: IH }, { x: IX + w + G, y: IY, w, h: IH }]; })();                                    // 세로 2단
const _duoLeadL = (() => { const wB = (IW - G) * 0.6, wS = (IW - G) * 0.4; return [{ x: IX, y: IY, w: wB, h: IH }, { x: IX + wB + G, y: IY, w: wS, h: IH }]; })();     // 리드-좌 + 세로 우
const _trioLR = (() => { const w = (IW - 2 * G) / 3; return [0, 1, 2].map((k) => ({ x: IX + k * (w + G), y: IY, w, h: IH })); })();                                    // 세로 3단
const _trioLeadL = (() => { const wL = (IW - G) * 0.5, wR = (IW - G) * 0.5, hR = (IH - G) / 2; return [{ x: IX, y: IY, w: wL, h: IH }, { x: IX + wL + G, y: IY, w: wR, h: hR }, { x: IX + wL + G, y: IY + hR + G, w: wR, h: hR }]; })(); // 리드-좌 + 2단-우
const _quadGrid = (() => { const w = (IW - G) / 2, h = (IH - G) / 2; return [{ x: IX, y: IY, w, h }, { x: IX + w + G, y: IY, w, h }, { x: IX, y: IY + h + G, w, h }, { x: IX + w + G, y: IY + h + G, w, h }]; })(); // 2×2
const _quadLeadTop = (() => { const hT = (IH - G) * 0.55, hB = (IH - G) * 0.45, w3 = (IW - 2 * G) / 3; return [{ x: IX, y: IY, w: IW, h: hT }, ...[0, 1, 2].map((k) => ({ x: IX + k * (w3 + G), y: IY + hT + G, w: w3, h: hB }))]; })(); // 리드-상 + 3열
const _quadLeadL = (() => { const wB = (IW - G) * 0.55, wS = (IW - G) * 0.45, h3 = (IH - 2 * G) / 3; return [{ x: IX, y: IY, w: wB, h: IH }, ...[0, 1, 2].map((k) => ({ x: IX + wB + G, y: IY + k * (h3 + G), w: wS, h: h3 }))]; })(); // 리드-좌 + 3단-우
const _pentaLead = (() => { const wB = (IW - G) * 0.5, wS = (IW - G) * 0.5, x0 = IX + wB + G, wc = (wS - G) / 2, hc = (IH - G) / 2; return [{ x: IX, y: IY, w: wB, h: IH }, { x: x0, y: IY, w: wc, h: hc }, { x: x0 + wc + G, y: IY, w: wc, h: hc }, { x: x0, y: IY + hc + G, w: wc, h: hc }, { x: x0 + wc + G, y: IY + hc + G, w: wc, h: hc }]; })(); // 리드 + 2×2
const _hexa = (() => { const w = (IW - 2 * G) / 3, h = (IH - G) / 2; const out: Slot[] = []; for (let r = 0; r < 2; r++) for (let k = 0; k < 3; k++) out.push({ x: IX + k * (w + G), y: IY + r * (h + G), w, h }); return out; })(); // 모자이크 6(3×2)

// 장수별 템플릿 풀 (cells[0]=리드). 세로 위주 10종. 시퀀서가 rng+리듬으로 골라 다양화.
const TEMPLATES: Record<number, { key: string; cells: Slot[] }[]> = {
    2: [{ key: "duoLR", cells: _duoLR }, { key: "duoLeadL", cells: _duoLeadL }],
    3: [{ key: "trioLR", cells: _trioLR }, { key: "trioLeadL", cells: _trioLeadL }],
    4: [{ key: "quadGrid", cells: _quadGrid }, { key: "quadLeadTop", cells: _quadLeadTop }, { key: "quadLeadL", cells: _quadLeadL }],
    5: [{ key: "pentaLead", cells: _pentaLead }],
    6: [{ key: "hexa", cells: _hexa }],
};

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
// 6장(모자이크)은 풀에 안 넣음 → 아래 시퀀서에서 "간격 규칙"으로 가끔(~8쪽에 1번)만, 연속 없이.
const POOLS: Record<Density, number[]> = { relaxed: [2, 3], balanced: [3, 3, 4], rich: [4, 5] };
const FRACTION: Record<Density, number> = { relaxed: 0.4, balanced: 0.72, rich: 1.0 };

/** 제작 가능한 최대 내지 페이지(= 최상위 과금 티어). 이걸 넘으면 인쇄 원가가 판매가를 넘어 역마진이 되고,
 *  물리 제본 한계도 넘는다. 인쇄소가 더 두꺼운 제본을 확정해 주면 이 값과 PAGE_TIERS를 함께 올릴 것. */
export const MAX_PAGES = 112;

/** 선택 사진을 디자인된 템플릿 페이지 배열로. ratio=페이지 가로/세로, density=밀도 프리셋
 *  (내부용 — 상한 미적용. 외부는 상한이 걸린 buildPages를 쓸 것) */
function buildPagesRaw(items: ScanItem[], ratio: number = 27.9 / 21.5, density: Density = "balanced"): LayoutPage[] {
    let photos = [...items]; // items 순서 그대로 사용(드래그 스왑 유지). 호출부에서 시간순 정렬해 전달.
    if (photos.length === 0) return [];

    // 밀도 프리셋: 여유롭게일수록 강한 컷만 큐레이션(시간순 유지). 단 사용자가 직접 추가한(manual) 사진은 항상 유지.
    const frac = FRACTION[density];
    if (frac < 1 && photos.length > 8) {
        const auto = photos.filter((p) => !p.manual);
        const manualCount = photos.length - auto.length;
        const keep = Math.max(6, Math.round(photos.length * frac) - manualCount);
        const strong = new Set([...auto].sort((a, b) => strengthOf(b) - strengthOf(a)).slice(0, keep).map((p) => p.assetId));
        photos = photos.filter((p) => p.manual || strong.has(p.assetId));
    }

    // 히어로 승격 임계 = 강도 상위 30%
    const sorted = photos.map(strengthOf).sort((a, b) => b - a);
    const strongTh = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.3))] : Infinity;

    const rng = rngFrom(photos.length * 7 + 13);
    const pool = POOLS[density];
    // photos[idx]가 히어로로 승격될 강한 컷인지(가로 or 큰 얼굴)
    const isStrongCut = (idx: number, prevBig: boolean) => (isLandscape(photos[idx]) || strengthOf(photos[idx]) >= strongTh) && !prevBig;

    const pages: LayoutPage[] = [];
    let i = 0, prevBig = false, prevGrid = false, prevSingle = false, lastTmplKey = "";
    let since6 = 3; // 마지막 6장 페이지 이후 페이지 수(간격 제어)

    while (i < photos.length) {
        const remaining = photos.length - i;
        let count = Math.min(pool[Math.floor(rng() * pool.length)], remaining);
        let force6 = false;
        // 가로로 찍은 사진은 히어로 1장(풀블리드가 딱 맞음). 세로 위주라 가로는 귀함 → 크게.
        if (isLandscape(photos[i]) && !prevBig) count = 1;
        // 6장(위3/아래3 모자이크)은 "가끔"만 — 최소 7페이지 간격 뒤 확률적으로(연속 방지). ~8쪽에 1번.
        else if (remaining >= 6 && since6 >= 7 && rng() < 0.4) { count = 6; force6 = true; }
        if (!force6 && count >= 3 && prevGrid) count = Math.min(2, remaining);              // 연속 그리드 금지
        if (count === 1 && prevSingle && !isStrongCut(i, prevBig)) count = Math.min(2, remaining); // 애매한 1장 연속 금지
        if (count <= 0) count = 1;
        const group = photos.slice(i, i + count);

        let cells: Slot[]; let kind: PageKind;
        if (count === 1) {
            const p = group[0], a = photoAspect(p);
            if (isStrongCut(i, prevBig)) { cells = HERO; kind = "hero"; }
            else { cells = [minimalCell(a, ratio)]; kind = "minimal"; }
        } else {
            // 그룹 내 베스트컷을 맨 앞으로 → 리드 슬롯(cells[0], 가장 큰 칸)에 크게
            let li = 0; for (let k = 1; k < group.length; k++) if (strengthOf(group[k]) > strengthOf(group[li])) li = k;
            if (li !== 0) { const [best] = group.splice(li, 1); group.unshift(best); }
            // 템플릿 선택 — 같은 장수의 여러 버전 중 rng, 직전과 같은 키는 회피(리듬)
            const variants = TEMPLATES[count] || TEMPLATES[4];
            let idx = Math.floor(rng() * variants.length);
            if (variants.length > 1 && variants[idx].key === lastTmplKey) idx = (idx + 1) % variants.length;
            lastTmplKey = variants[idx].key;
            cells = variants[idx].cells;
            kind = count >= 3 ? "grid" : "duo";
        }

        // 히어로(강한 컷·가로 사진)는 풀블리드로 화면 꽉 차게 → 상단 밴드 미적용
        pages.push({ index: pages.length, kind, cells: kind === "hero" ? cells : withTopBand(cells), photos: group });
        prevBig = kind === "hero"; prevGrid = kind === "grid"; prevSingle = count === 1;
        since6 = count === 6 ? 0 : since6 + 1; // 6장 간격 추적
        i += count;
    }
    return pages;
}

/** 사진이 너무 많아 MAX_PAGES를 넘을 때, 강한 사진 순으로 줄여 상한에 맞춘 목록을 돌려준다.
 *  - 시간순(원래 배열 순서)은 유지 — 잘라내는 게 아니라 "솎아내기"라 책이 중간에 끊기지 않는다.
 *  - 사용자가 직접 추가한(manual) 사진은 항상 유지.
 *  - 상한 이내면 원본을 그대로 반환(참조 동일) → 기존 동작 무변경.
 */
export function fitToMaxPages(
    items: ScanItem[],
    ratio: number = 27.9 / 21.5,
    density: Density = "balanced",
): ScanItem[] {
    if (items.length === 0) return items;
    if (buildPagesRaw(items, ratio, density).length <= MAX_PAGES) return items;

    const manual = items.filter((p) => p.manual);
    const auto = items.filter((p) => !p.manual);
    // 강한 순 랭킹 → 상위 k장만 남기되, 최종 배열은 원래(시간) 순서를 유지
    const rank = new Map<string, number>();
    [...auto].sort((a, b) => strengthOf(b) - strengthOf(a)).forEach((p, i) => rank.set(p.assetId, i));
    const pick = (k: number) => items.filter((p) => p.manual || (rank.get(p.assetId) ?? Infinity) < k);

    // k에 대한 페이지 수는 단조 증가 → 이분탐색(최대 ~10회 빌드)
    let lo = 0, hi = auto.length, best = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (buildPagesRaw(pick(mid), ratio, density).length <= MAX_PAGES) { best = mid; lo = mid + 1; }
        else hi = mid - 1;
    }
    // manual 사진만으로도 상한을 넘으면 더 줄일 수단이 없다 → 그대로 두고 buildPages에서 페이지를 자른다.
    return pick(best);
}

/** 선택 사진 → 페이지 배열. MAX_PAGES 상한 적용(역마진·제본불가 방지). */
export function buildPages(items: ScanItem[], ratio: number = 27.9 / 21.5, density: Density = "balanced"): LayoutPage[] {
    const pages = buildPagesRaw(fitToMaxPages(items, ratio, density), ratio, density);
    // manual 사진만으로 상한 초과한 극단 케이스의 최후 방어선
    return pages.length > MAX_PAGES ? pages.slice(0, MAX_PAGES) : pages;
}

/** 실제 내지 페이지 수(커버·뒷표지 제외). buildPages가 만든 낱장 수 = 고객에게 보여줄 진짜 페이지수. */
export function countPages(items: ScanItem[], ratio: number = 27.9 / 21.5, density: Density = "balanced"): number {
    return buildPages(items, ratio, density).length;
}

/** 이 사진들이 책에 몇 장 실제로 담기는지(상한 적용 후). UI 안내용 —
 *  used < total 이면 "사진이 많아 일부만 담겼다"를 알려줘야 한다. */
export function photosUsedCount(
    items: ScanItem[],
    ratio: number = 27.9 / 21.5,
    density: Density = "balanced",
): { used: number; total: number } {
    return { used: fitToMaxPages(items, ratio, density).length, total: items.length };
}
