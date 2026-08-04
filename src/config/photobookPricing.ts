// src/config/photobookPricing.ts
//
// 포토북 판매가. 마진 = 원가 × VAT(1.07) × MARGIN(1.25), 10밧 반올림.
// 앵커(48/80/112)는 대표님 확정 심리가, 중간 페이지(64/96)는 페이지 추가단가로 보간.
//
// 🆕 원격 가격(Firebase config/prices.photobook)으로 덮어쓸 수 있음 — 인쇄소 단가가 바뀌어도
//    앱 심사 없이 반영. 아래 DEFAULT_*는 원격이 없거나 값이 이상할 때 쓰는 안전망(회귀 0).
//    가격 함수는 전부 동기 유지(호출부 6곳 무변경). 원격은 applyPhotobookPricing()으로 주입.
export type AlbumSize = "A4" | "A3" | "A5";
export type CoverType = "soft" | "hard";

const VAT = 1.07;
export const MARGIN = 1.25;

type AnchorMap = Record<number, number>;
type SizeMap<T> = Record<AlbumSize, T>;

// ── 기본값(= 원격 실패 시 fallback). IQLab 견적 × VAT × MARGIN 기준. ──
const DEFAULT_SOFT_ANCHOR: SizeMap<AnchorMap> = {
    A4: { 48: 1890, 80: 2890, 112: 3790 },
    A3: { 48: 4190, 80: 6290, 112: 8290 },
    A5: { 48: 1190, 80: 1890, 112: 2490 },
};
// 하드커버 추가액(판매가, 마진 포함).
const DEFAULT_HARD_ADD: SizeMap<number> = { A4: 1070, A3: 2680, A5: 670 };
// 페이지당 추가 원가 → 보간 시 ×VAT×MARGIN.
const DEFAULT_ADD_UNIT: SizeMap<number> = { A4: 25, A3: 70, A5: 15 };

const SIZES: AlbumSize[] = ["A4", "A3", "A5"];
const ANCHOR_TIERS = [48, 80, 112];
const round10 = (v: number) => Math.round(v / 10) * 10;

export const PAGE_TIERS = [48, 64, 80, 96, 112] as const;

// ── 현재 적용 중인 값(기본값 복사본에서 시작, 원격이 오면 사이즈 단위로 교체) ──
const softAnchor: SizeMap<AnchorMap> = {
    A4: { ...DEFAULT_SOFT_ANCHOR.A4 },
    A3: { ...DEFAULT_SOFT_ANCHOR.A3 },
    A5: { ...DEFAULT_SOFT_ANCHOR.A5 },
};
const hardAdd: SizeMap<number> = { ...DEFAULT_HARD_ADD };
const addUnit: SizeMap<number> = { ...DEFAULT_ADD_UNIT };

// ── 원격 반영 구독(가격 표시 화면 리렌더용) ──
let version = 0;
const subscribers = new Set<() => void>();

export function subscribePhotobookPricing(fn: () => void): () => void {
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
}
export function getPhotobookPricingVersion(): number {
    return version;
}

/** 원격 여부(디버그·어드민 표시용). true면 Firebase 값이 하나라도 적용된 상태. */
let remoteApplied = false;
export function isPhotobookPricingRemote(): boolean {
    return remoteApplied;
}

// ── 검증: 잘못된 원격값으로 ฿0/NaN에 파는 사고를 막는다 ──
const isPositive = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v > 0;
const isNonNegative = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * Firebase config/prices.photobook 을 적용. 사이즈 단위로 검증 —
 * 한 사이즈가 이상하면 그 사이즈만 기본값 유지(나머지는 반영).
 * 기대 형태:
 *   { softAnchor: { A4: {48,80,112}, ... }, hardAdd: { A4: n, ... }, addUnit: { A4: n, ... } }
 * 반환: 실제로 반영된 항목 수(0이면 전부 기본값 유지).
 */
export function applyPhotobookPricing(raw: unknown): number {
    // 콘솔에서 중첩 map을 만드는 건 필드가 24개라 실수하기 쉬움 →
    // JSON 문자열 한 덩어리로 넣는 것도 허용(권장). 파싱 실패는 조용히 무시.
    if (typeof raw === "string") {
        try { raw = JSON.parse(raw); } catch { return 0; }
    }
    if (!raw || typeof raw !== "object") return 0;
    const d = raw as Record<string, any>;
    let applied = 0;

    for (const size of SIZES) {
        // 앵커: 48/80/112 셋 다 양수여야 그 사이즈를 교체(부분 적용 금지 — 보간이 깨짐)
        const a = d.softAnchor?.[size];
        if (a && ANCHOR_TIERS.every((t) => isPositive(a[t]))) {
            for (const t of ANCHOR_TIERS) softAnchor[size][t] = a[t];
            applied++;
        }
        // 하드커버 추가액: 0 허용(하드=소프트 동가 정책 가능), 음수·NaN은 거부
        const h = d.hardAdd?.[size];
        if (isNonNegative(h)) { hardAdd[size] = h; applied++; }
        // 페이지 추가단가: 0 허용(중간 티어를 아래 앵커와 동가로), 음수 거부
        const u = d.addUnit?.[size];
        if (isNonNegative(u)) { addUnit[size] = u; applied++; }
    }

    if (applied > 0) {
        remoteApplied = true;
        version++;
        subscribers.forEach((fn) => { try { fn(); } catch { /* 구독자 오류 무시 */ } });
    }
    return applied;
}

/** ⚠️ 폐기: 사진 수를 페이지로 착각해 과금됨(64장→80p). 실제 buildPages 페이지수로 pageTierFor를 써야 함. */
export function pagesForPhotos(n: number): number {
    if (n <= 32) return 48;
    if (n <= 48) return 64;
    if (n <= 64) return 80;
    if (n <= 84) return 96;
    return 112;
}

/** 실제 내지 페이지 수(buildPages 결과) → 과금 페이지 티어. IQLab 물리 최소 48p.
 *  실제 ≤48 → 48p 최소가 / 49~64 → 64p / 65~80 → 80p / 81~96 → 96p / else 112p. */
export function pageTierFor(actualPages: number): number {
    if (actualPages <= 48) return 48;
    if (actualPages <= 64) return 64;
    if (actualPages <= 80) return 80;
    if (actualPages <= 96) return 96;
    return 112;
}

/** 48p 책이 성긴지(사진이 적어 "더 찾기" 넛지/게이트 대상인지) */
export function isSparse(photos: number): boolean {
    return photos < 30;
}

// 소프트커버 가격: 앵커면 그대로, 중간 페이지면 아래 앵커 + 추가페이지×단가×VAT×MARGIN.
function softPriceFor(size: AlbumSize, pages: number): number {
    const anchors = softAnchor[size];
    if (anchors[pages] != null) return anchors[pages];
    const lower = [...ANCHOR_TIERS].reverse().find((t) => t <= pages) ?? 48;
    const extra = (pages - lower) * addUnit[size] * VAT * MARGIN;
    return round10(anchors[lower] + extra);
}

/** 사이즈별 최소가(소프트 48p) — 랜딩 "฿X부터" 표시용. 하드코딩 대신 앵커 참조. */
export function albumMinPrice(size: AlbumSize): number {
    return softPriceFor(size, 48);
}

/** 과금가. 3번째 인자 = 실제 buildPages 페이지 수(사진 수 아님!). 실제 페이지 → pageTierFor → 티어 가격.
 *  반환 pages = 과금 티어(48/64/80/96/112). 실제 페이지가 48 미만이면 48p 최소가. */
export function albumPrice(size: AlbumSize, cover: CoverType, actualPages: number): { pages: number; price: number } {
    const tier = pageTierFor(Math.max(0, actualPages || 0));
    const soft = softPriceFor(size, tier);
    const price = soft + (cover === "hard" ? hardAdd[size] : 0);
    return { pages: tier, price };
}
