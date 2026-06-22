// src/utils/pricing.ts
//
// 🎯 가격/할인 "단일 소스(single source of truth)"
// Select / Editor / Checkout1 / Checkout2 가 전부 이 함수 하나만 호출하도록 한다.
// 이렇게 하면 Firebase config/prices 의 volumeDiscounts 만 바꿔도 모든 화면이 동시에 바뀐다.
// (지금처럼 PhotoSelect 에 5/10/16 같은 숫자를 하드코딩하면 결제창과 안 맞아 신뢰가 깨짐)

export type VolumeTier = { minQty: number; discountPercent: number };

export type PromoInput = {
    success?: boolean;
    /** 이미 계산된 쿠폰 할인액 (PRICE 단위, 통화 그대로) */
    discountAmount?: number;
};

export type PricingInput = {
    /** 담은 타일 수 (= photos.length) */
    count: number;
    /** 타일 1장 가격 (locale 통화 기준. TH=฿, 그 외=$) */
    pricePerTile: number;
    /** Firebase config/prices 의 volumeDiscounts 배열 (정렬 안 돼 있어도 됨) */
    volumeDiscounts?: VolumeTier[];
    /** 이 수량 이상이면 무료배송. 없으면 shippingFee 로만 판단 */
    freeShipThreshold?: number;
    /** 무료배송 구간 미만일 때 부과할 배송비. 기본 0 (= 항상 무료) */
    shippingFee?: number;
    /** 쿠폰 적용 정보 (Checkout2 에서만 사용) */
    promo?: PromoInput;
    /** true 면 쿠폰+수량할인 중복 적용. 기본 false(쿠폰이 수량할인 대체 = 현재 앱 동작) */
    stackPromoWithVolume?: boolean;
};

export type PricingResult = {
    count: number;
    pricePerTile: number;

    /** 할인 전 원금 */
    subtotal: number;

    /** 실제 적용된 수량할인 % (쿠폰이 대체하면 0) */
    volumeDiscountPercent: number;
    /** 실제 적용된 수량할인 금액 (쿠폰이 대체하면 0) */
    volumeDiscountAmount: number;

    /** 쿠폰 할인 금액 */
    promoDiscountAmount: number;

    /** 수량할인 + 쿠폰 합계 */
    totalDiscount: number;

    shippingFee: number;
    isFreeShipping: boolean;

    /** 최종 결제 금액 */
    total: number;

    /** 할인 반영된 장당 실효 가격 (UI 넛지용: "지금 장당 ฿XXX") */
    effectivePricePerTile: number;

    // ── 티어 진행 바 / 넛지용 가이드 ──────────────────────────
    /** 오름차순 정렬된 전체 할인 구간 (진행 바 마커 렌더용) */
    tiers: VolumeTier[];
    /** 현재 적용 중인 구간 (없으면 null) */
    currentTier: VolumeTier | null;
    /** 다음 할인 구간 (이미 최대면 null) */
    nextTier: VolumeTier | null;
    /** 다음 구간까지 더 담아야 하는 수량 (0 이면 더 없음) */
    qtyToNextTier: number;
    /** 다음 구간 도달 시 장당 절약되는 금액 (per-tile, 0 이상) */
    savingsPerTileAtNextTier: number;
    /** 무료배송까지 남은 수량 (0 이면 이미 무료) */
    qtyToFreeShipping: number;
    /** 이미 최대 할인 구간에 도달했는지 */
    isMaxTier: boolean;
};

const round2 = (n: number) => Number((n || 0).toFixed(2));

export function computePricing(input: PricingInput): PricingResult {
    const {
        count,
        pricePerTile,
        volumeDiscounts = [],
        freeShipThreshold,
        shippingFee = 0,
        promo,
        stackPromoWithVolume = false,
    } = input;

    const tiers = [...volumeDiscounts]
        .filter((t) => t && Number.isFinite(t.minQty) && Number.isFinite(t.discountPercent))
        .sort((a, b) => a.minQty - b.minQty);

    const subtotal = round2(count * pricePerTile);

    // 현재 구간 = minQty <= count 인 구간 중 가장 높은 것
    let currentTier: VolumeTier | null = null;
    for (const t of tiers) if (count >= t.minQty) currentTier = t;

    // 다음 구간 = minQty > count 인 첫 구간
    const nextTier = tiers.find((t) => t.minQty > count) ?? null;

    let volumeDiscountPercent = currentTier?.discountPercent ?? 0;
    let volumeDiscountAmount = round2(subtotal * (volumeDiscountPercent / 100));

    // 쿠폰 처리: 기본은 쿠폰이 수량할인을 "대체" (현재 앱 동작과 동일)
    let promoDiscountAmount = 0;
    if (promo?.success && promo.discountAmount) {
        promoDiscountAmount = round2(promo.discountAmount);
        if (!stackPromoWithVolume) {
            volumeDiscountAmount = 0;
            volumeDiscountPercent = 0;
        }
    }

    const totalDiscount = round2(volumeDiscountAmount + promoDiscountAmount);

    // 무료배송 판단
    const isFreeShipping =
        freeShipThreshold == null ? shippingFee === 0 : count >= freeShipThreshold;
    const appliedShipping = isFreeShipping ? 0 : shippingFee;
    const qtyToFreeShipping =
        freeShipThreshold == null ? 0 : Math.max(0, freeShipThreshold - count);

    const total = Math.max(0, round2(subtotal - totalDiscount + appliedShipping));
    const effectivePricePerTile =
        count > 0 ? round2((subtotal - totalDiscount) / count) : pricePerTile;

    // 다음 구간 도달 시 장당 절약액 (넛지 문구 "한 장 더 담으면 장당 ฿X 더 싸짐")
    const qtyToNextTier = nextTier ? Math.max(0, nextTier.minQty - count) : 0;
    let savingsPerTileAtNextTier = 0;
    if (nextTier) {
        const nextEffPerTile = round2(pricePerTile * (1 - nextTier.discountPercent / 100));
        savingsPerTileAtNextTier = round2(Math.max(0, effectivePricePerTile - nextEffPerTile));
    }

    const isMaxTier = tiers.length > 0 && nextTier == null && currentTier != null;

    return {
        count,
        pricePerTile,
        subtotal,
        volumeDiscountPercent,
        volumeDiscountAmount,
        promoDiscountAmount,
        totalDiscount,
        shippingFee: appliedShipping,
        isFreeShipping,
        total,
        effectivePricePerTile,
        tiers,
        currentTier,
        nextTier,
        qtyToNextTier,
        savingsPerTileAtNextTier,
        qtyToFreeShipping,
        isMaxTier,
    };
}

// ── 통화 포맷 헬퍼 ───────────────────────────────────────────
// 현재 화면들이 쓰는 형식(฿/$ + 소수점 2자리)에 맞춤. 필요하면 바꿔도 됨.
export const getCurrencySymbol = (locale?: string) =>
    (locale || "").toUpperCase() === "TH" ? "฿" : "$";

export const formatPrice = (n: number, locale?: string) => {
    const symbol = getCurrencySymbol(locale);
    // 기존 화면이 toFixed(2)를 쓰고 있어 동일하게 유지 (฿300.00 형태).
    // 태국 바트를 정수로 보여주고 싶으면 아래 한 줄을 Math.round 로 바꾸면 됨.
    return `${symbol}${(n || 0).toFixed(2)}`;
};
