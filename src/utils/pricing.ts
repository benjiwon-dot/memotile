// src/utils/pricing.ts
//
// 🎯 가격/할인/배송 "단일 소스(single source of truth)"
// Select / Editor / Checkout1 / Checkout2 가 전부 이 함수만 호출.
// Firebase config/prices 만 바꾸면 모든 화면이 동시에 바뀜.
//
// PDF 정책(기준가 200฿):
//  - 할인: 3개 25% / 6개 37.5% / 9개 44.5% / 12개 50.5% / 15개 60%
//  - 배송: 1~4개 38฿ / 5~8개 41฿ / 9개+ 무료

export type VolumeTier = { minQty: number; discountPercent: number };

// 배송 구간: 해당 수량 이상이면 fee 적용 (가장 높은 minQty 우선). fee:0 = 무료
export type ShippingTier = { minQty: number; fee: number };

export type PromoInput = {
    success?: boolean;
    discountAmount?: number;
    // 상품 전액 할인 시 배송비 처리. 기본(미지정/true): 배송비도 무료(FREE100 동작 유지).
    // false 로 주면 상품은 100% 할인되어도 배송비는 고객 부담.
    waiveShipping?: boolean;
};

export type PricingInput = {
    count: number;
    pricePerTile: number;
    volumeDiscounts?: VolumeTier[];

    // 배송: shippingTiers 가 있으면 이게 우선. 없으면 freeShipThreshold/shippingFee 사용(하위호환)
    shippingTiers?: ShippingTier[];
    freeShipThreshold?: number;
    shippingFee?: number;

    promo?: PromoInput;
    stackPromoWithVolume?: boolean; // 기본 false: 쿠폰이 수량할인 대체(현재 앱 동작)
};

export type PricingResult = {
    count: number;
    pricePerTile: number;
    subtotal: number;

    volumeDiscountPercent: number;
    volumeDiscountAmount: number;

    promoDiscountAmount: number;
    totalDiscount: number;

    shippingFee: number;
    isFreeShipping: boolean;

    total: number;
    effectivePricePerTile: number;

    tiers: VolumeTier[];
    currentTier: VolumeTier | null;
    nextTier: VolumeTier | null;
    qtyToNextTier: number;
    savingsPerTileAtNextTier: number;

    qtyToFreeShipping: number;
    freeShipQty: number | null; // 무료배송 시작 수량(바 마커용)
    isMaxTier: boolean;
};

const round2 = (n: number) => Number((n || 0).toFixed(2));

export function computePricing(input: PricingInput): PricingResult {
    const {
        count,
        pricePerTile,
        volumeDiscounts = [],
        shippingTiers,
        freeShipThreshold,
        shippingFee = 0,
        promo,
        stackPromoWithVolume = false,
    } = input;

    const tiers = [...volumeDiscounts]
        .filter((t) => t && Number.isFinite(t.minQty) && Number.isFinite(t.discountPercent))
        .sort((a, b) => a.minQty - b.minQty);

    const subtotal = round2(count * pricePerTile);

    // 수량할인
    let currentTier: VolumeTier | null = null;
    for (const t of tiers) if (count >= t.minQty) currentTier = t;
    const nextTier = tiers.find((t) => t.minQty > count) ?? null;

    let volumeDiscountPercent = currentTier?.discountPercent ?? 0;
    let volumeDiscountAmount = round2(subtotal * (volumeDiscountPercent / 100));

    // 쿠폰 (기본: 수량할인 대체)
    let promoDiscountAmount = 0;
    if (promo?.success && promo.discountAmount) {
        promoDiscountAmount = round2(promo.discountAmount);
        if (!stackPromoWithVolume) {
            volumeDiscountAmount = 0;
            volumeDiscountPercent = 0;
        }
    }

    const totalDiscount = round2(volumeDiscountAmount + promoDiscountAmount);

    // 배송
    let appliedShipping = 0;
    let isFreeShipping = false;
    let qtyToFreeShipping = 0;
    let freeShipQty: number | null = null;

    if (shippingTiers && shippingTiers.length) {
        const st = [...shippingTiers]
            .filter((s) => s && Number.isFinite(s.minQty) && Number.isFinite(s.fee))
            .sort((a, b) => a.minQty - b.minQty);

        let fee = 0;
        let matched = false;
        for (const tr of st) if (count >= tr.minQty) { fee = tr.fee; matched = true; }
        appliedShipping = count > 0 && matched ? fee : 0;

        const freeTier = st.find((tr) => tr.fee === 0);
        freeShipQty = freeTier ? freeTier.minQty : null;
        isFreeShipping = count > 0 ? appliedShipping === 0 : false;
        qtyToFreeShipping = freeTier ? Math.max(0, freeTier.minQty - count) : 0;
    } else {
        isFreeShipping = freeShipThreshold == null ? shippingFee === 0 : count >= freeShipThreshold;
        appliedShipping = isFreeShipping ? 0 : shippingFee;
        freeShipQty = freeShipThreshold ?? null;
        qtyToFreeShipping = freeShipThreshold == null ? 0 : Math.max(0, freeShipThreshold - count);
    }

    // 🆕 할인 후 상품가가 0 (예: FREE100 같은 전액 무료 쿠폰)이면 배송도 무료 처리.
    //    단, 쿠폰이 waiveShipping: false 면 상품만 무료이고 배송비는 그대로 부과.
    //    (FREE100 처럼 플래그 미지정이면 기존대로 배송비도 무료)
    const productAfterDiscount = Math.max(0, round2(subtotal - totalDiscount));
    const promoWaivesShipping = promo?.waiveShipping !== false;
    if (productAfterDiscount <= 0 && totalDiscount > 0 && promoWaivesShipping) {
        appliedShipping = 0;
        isFreeShipping = true;
    }

    const total = round2(productAfterDiscount + appliedShipping);
    const effectivePricePerTile = count > 0 ? round2((subtotal - totalDiscount) / count) : pricePerTile;

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
        freeShipQty,
        isMaxTier,
    };
}

// ── 통화 헬퍼 ───────────────────────────────────────────────
export const getCurrencySymbol = (locale?: string) =>
    (locale || "").toUpperCase() === "TH" ? "฿" : "$";

export const formatPrice = (n: number, locale?: string) => {
    const symbol = getCurrencySymbol(locale);
    return `${symbol}${(n || 0).toFixed(2)}`;
};
