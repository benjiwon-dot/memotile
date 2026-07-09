// src/config/photobookPricing.ts
//
// 포토북 판매가. 마진 = 원가 × VAT(1.07) × MARGIN(1.25), 10밧 반올림.
// 앵커(48/80/112)는 대표님 확정 심리가, 중간 페이지(64/96)는 페이지 추가단가로 보간.
export type AlbumSize = "A4" | "A3" | "A5";
export type CoverType = "soft" | "hard";

const VAT = 1.07;
export const MARGIN = 1.25;

// 소프트커버 확정 판매가(앵커). 중간 페이지는 아래 ADD_UNIT로 보간.
const SOFT_ANCHOR: Record<AlbumSize, Record<number, number>> = {
    A4: { 48: 1890, 80: 2890, 112: 3790 },
    A3: { 48: 4190, 80: 6290, 112: 8290 },
    A5: { 48: 1190, 80: 1890, 112: 2490 },
};
// 하드커버 추가액(판매가, 마진 포함).
const HARD_ADD: Record<AlbumSize, number> = { A4: 1070, A3: 2680, A5: 670 };
// 페이지당 추가 원가 → 보간 시 ×VAT×MARGIN.
const ADD_UNIT: Record<AlbumSize, number> = { A4: 25, A3: 70, A5: 15 };

const ANCHOR_TIERS = [48, 80, 112];
const round10 = (v: number) => Math.round(v / 10) * 10;

export const PAGE_TIERS = [48, 64, 80, 96, 112] as const;

/** 사진 수 → 페이지 수 (IQLab 물리 최소 48p, 5단). 버킷은 사진/페이지 밀도 기준. */
export function pagesForPhotos(n: number): number {
    if (n <= 32) return 48;
    if (n <= 48) return 64;
    if (n <= 64) return 80;
    if (n <= 84) return 96;
    return 112;
}

/** 48p 책이 성긴지(사진이 적어 "더 찾기" 넛지/게이트 대상인지) */
export function isSparse(photos: number): boolean {
    return photos < 30;
}

// 소프트커버 가격: 앵커면 그대로, 중간 페이지면 아래 앵커 + 추가페이지×단가×VAT×MARGIN.
function softPriceFor(size: AlbumSize, pages: number): number {
    const anchors = SOFT_ANCHOR[size];
    if (anchors[pages] != null) return anchors[pages];
    const lower = [...ANCHOR_TIERS].reverse().find((t) => t <= pages) ?? 48;
    const extra = (pages - lower) * ADD_UNIT[size] * VAT * MARGIN;
    return round10(anchors[lower] + extra);
}

export function albumPrice(size: AlbumSize, cover: CoverType, photos: number): { pages: number; price: number } {
    const pages = pagesForPhotos(photos);
    const soft = softPriceFor(size, pages);
    const price = soft + (cover === "hard" ? HARD_ADD[size] : 0);
    return { pages, price };
}
