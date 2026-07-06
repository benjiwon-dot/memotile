// src/config/photobookPricing.ts
//
// 포토북 판매가 계산. 판매가 = IQLab 원가 × VAT × 마진.
// ⚠️ 값 교체 지점은 여기 상수 3개뿐 (IQLAB 원가표 / VAT / MARGIN).
//    대표님 최종 마진 확정 시 MARGIN만 바꾸거나, 고정 판매가가 있으면 RETAIL_OVERRIDE에 넣으면 됨.
export type AlbumSize = "A4" | "A3";
export type CoverType = "soft" | "hard";

// IQLab 원가(밧, 2023.10 가격표) — 소프트커버 기준 페이지 tier + 하드커버 추가액.
const IQLAB: Record<AlbumSize, { base: Record<number, number>; hard: number }> = {
    A4: { base: { 48: 1400, 80: 2100, 112: 2800 }, hard: 800 },
    A3: { base: { 48: 3100, 80: 4700, 112: 6200 }, hard: 2000 },
};
const VAT = 1.07;               // 부가세 7%
export const MARGIN = 1.3;      // TODO(대표님): 최종 마진 배수. 고정액/% 방식이면 albumPrice() 교체.

// 확정 심리가표(대표님 승인). 자동계산 무시하고 이 값 사용. 십의 자리 90으로 "천 단위 하나 아래" 착시.
const RETAIL_OVERRIDE: Partial<Record<AlbumSize, Record<number, Partial<Record<CoverType, number>>>>> = {
    A4: {
        48: { soft: 1890, hard: 2990 },
        64: { soft: 2390, hard: 3490 },
        80: { soft: 2890, hard: 3990 },
        96: { soft: 3390, hard: 4490 },
        112: { soft: 3890, hard: 4990 },
    },
    A3: {
        48: { soft: 2690, hard: 3990 },
        64: { soft: 3390, hard: 4890 },
        80: { soft: 3990, hard: 5590 },
        96: { soft: 4690, hard: 6290 },
        112: { soft: 5390, hard: 6890 },
    },
};

export const PAGE_TIERS = [48, 64, 80, 96, 112] as const;

/** 사진 수 → 페이지 수 (IQLab 최소 48p, 5단). 버킷은 대표님 조정 가능(사진/페이지 밀도). */
export function pagesForPhotos(n: number): number {
    if (n <= 32) return 48;
    if (n <= 48) return 64;
    if (n <= 64) return 80;
    if (n <= 84) return 96;
    return 112;
}

/** 48p 책이 성긴지(사진이 적어 "더 찾기" 넛지 대상인지) */
export function isSparse(photos: number): boolean {
    return photos < 30;
}

export function albumPrice(size: AlbumSize, cover: CoverType, photos: number): { pages: number; price: number } {
    const pages = pagesForPhotos(photos);
    const override = RETAIL_OVERRIDE[size]?.[pages]?.[cover];
    if (override != null) return { pages, price: override };
    const iq = IQLAB[size];
    const cost = (iq.base[pages] ?? iq.base[48]) + (cover === "hard" ? iq.hard : 0);
    const price = Math.round((cost * VAT * MARGIN) / 10) * 10; // 10밧 단위 반올림
    return { pages, price };
}
