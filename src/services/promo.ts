// src/services/promo.ts
import {
    doc,
    getDoc,
    collection
} from 'firebase/firestore';
import { db } from '../lib/firebase';

// 'buyXgetY' (N개 사면 M개 무료), 'freeTiles' (N장 무료) 타입 포함
export type PromoType = 'percent' | 'amount' | 'buyXgetY' | 'freeTiles';

export interface PromoCode {
    code: string;
    type: PromoType;
    value?: number;
    discountValue?: number;
    active: boolean;
    maxRedemptions?: number;
    redeemedCount?: number;
    expiresAt?: any;
    perUserLimit?: number;

    // 앱 심사 없이 통제하기 위한 만능 조건들
    minOrderAmount?: number; // 최소 결제 금액 (예: 1200)
    minQty?: number;         // 최소 구매 수량 (예: 4)
    buyQty?: number;         // N개 사면 (예: 3)
    getQty?: number;         // M개 무료 (예: 1)

    // 🆕 결제 동작 플래그 (Firebase 에서 켜고 끄면 코드 수정 없이 제어)
    stackWithVolume?: boolean; // true=수량(묶음)할인과 함께 / false·미지정=쿠폰이 수량할인 대체
    waiveShipping?: boolean;   // true=배송비도 무료 / false·미지정=배송비는 부과
}

export interface PromoResult {
    success: boolean;
    discountAmount: number;
    total: number;
    promoCode?: string;
    discountType?: PromoType;
    discountValue?: number;

    // 🆕 결제화면(computePricing)으로 전달되는 플래그
    stackWithVolume?: boolean;
    waiveShipping?: boolean;

    error?: string;
}

export const validatePromo = async (
    code: string,
    uid: string,
    subtotal: number,
    qty: number,           // 타일 수량
    pricePerItem: number   // 타일 1개당 단가
): Promise<PromoResult> => {
    if (!code) return { success: false, discountAmount: 0, total: subtotal, error: 'Empty code' };

    const promoRef = doc(db, 'promoCodes', code.toUpperCase());
    const redemptionRef = doc(db, 'promoRedemptions', `${code.toUpperCase()}_${uid}`);

    try {
        const promoSnap = await getDoc(promoRef);

        if (!promoSnap.exists()) {
            throw new Error('promoInvalid'); // 유효하지 않은 코드
        }

        const data = promoSnap.data() as PromoCode;

        // 1. 활성화 여부 체크
        if (!data.active) throw new Error('promoInvalid');

        // 2. 기한 만료 체크
        if (data.expiresAt) {
            const now = new Date();
            const expiry = data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
            if (now > expiry) throw new Error('promoExpired');
        }

        // 3. 전체 선착순 횟수 체크
        if (data.maxRedemptions && (data.redeemedCount || 0) >= data.maxRedemptions) {
            throw new Error('promoLimitReached');
        }

        // 4. 유저당 사용 횟수 제한 체크 (1계정 1번 제한)
        const redemptionSnap = await getDoc(redemptionRef);
        const perUserLimit = data.perUserLimit || 1;

        if (redemptionSnap.exists()) {
            const currentUsage = redemptionSnap.data().usageCount || 1;
            if (currentUsage >= perUserLimit) {
                throw new Error('promoAlreadyUsed'); // 이미 사용함
            }
        }

        // 5. 최소 결제 금액 검사
        if (data.minOrderAmount && subtotal < data.minOrderAmount) {
            throw new Error(`Minimum order amount is ฿${data.minOrderAmount}`);
        }

        // 6. 최소 타일 수량 검사
        if (data.minQty && qty < data.minQty) {
            throw new Error(`Please add at least ${data.minQty} items`);
        }

        // 7. 할인 금액 계산 로직
        let discountAmount = 0;
        const actualValue = data.discountValue !== undefined ? data.discountValue : (data.value || 0);

        if (data.type === 'percent') {
            // 퍼센트 할인
            discountAmount = (subtotal * actualValue) / 100;
        } else if (data.type === 'buyXgetY') {
            // N+M 무료 로직 (예: 3+1 이면 그룹사이즈 4. 4개마다 1개 무료)
            const b = data.buyQty || 1;
            const g = data.getQty || 1;
            const groupSize = b + g;
            const freeItemsCount = Math.floor(qty / groupSize) * g;
            discountAmount = freeItemsCount * pricePerItem;
        } else if (data.type === 'freeTiles') {
            // 🆕 N장 무료 (조건 없이): value 장만큼 무료. 예) "한장 무료" → value:1
            const freeN = Math.min(actualValue, qty);
            discountAmount = freeN * pricePerItem;
        } else {
            // 고정 금액 할인 (amount)
            discountAmount = actualValue;
        }

        discountAmount = Math.min(discountAmount, subtotal);
        const finalTotal = Math.max(0, subtotal - discountAmount);

        return {
            success: true,
            discountAmount,
            total: finalTotal,
            promoCode: code.toUpperCase(),
            discountType: data.type,
            discountValue: actualValue,
            // 🆕 플래그 전달 (없으면 undefined → 기존 동작)
            stackWithVolume: data.stackWithVolume,
            waiveShipping: data.waiveShipping,
        };

    } catch (e: any) {
        console.warn("[PromoService] Validation Failed:", e.message);
        return {
            success: false,
            discountAmount: 0,
            total: subtotal,
            error: e.message || 'promoInvalid'
        };
    }
};
