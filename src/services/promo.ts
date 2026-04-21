import {
    doc,
    getDoc,
    collection
} from 'firebase/firestore';
import { db } from '../lib/firebase';

export type PromoType = 'percent' | 'amount';

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
}

export interface PromoResult {
    success: boolean;
    discountAmount: number;
    total: number;
    promoCode?: string;
    discountType?: PromoType;
    discountValue?: number;
    error?: string;
}

/**
 * ✨ [수정됨] 이제 DB 횟수를 깎지 않습니다! 오직 유효한지 검사만 합니다 (Read-Only)
 */
export const validatePromo = async (
    code: string,
    uid: string,
    subtotal: number
): Promise<PromoResult> => {
    if (!code) return { success: false, discountAmount: 0, total: subtotal, error: 'Empty code' };

    const promoRef = doc(db, 'promoCodes', code.toUpperCase());
    const redemptionRef = doc(db, 'promoRedemptions', `${code.toUpperCase()}_${uid}`);

    try {
        const promoSnap = await getDoc(promoRef);

        if (!promoSnap.exists()) {
            throw new Error('promoInvalid');
        }

        const data = promoSnap.data() as PromoCode;

        // 1. Check Active
        if (!data.active) throw new Error('promoInvalid');

        // 2. Check Expiry
        if (data.expiresAt) {
            const now = new Date();
            const expiry = data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
            if (now > expiry) throw new Error('promoExpired');
        }

        // 3. Check Max Redemptions
        if (data.maxRedemptions && (data.redeemedCount || 0) >= data.maxRedemptions) {
            throw new Error('promoLimitReached');
        }

        // 4. Check if user already used it
        const redemptionSnap = await getDoc(redemptionRef);
        const perUserLimit = data.perUserLimit || 1;

        if (redemptionSnap.exists()) {
            const currentUsage = redemptionSnap.data().usageCount || 1;
            if (currentUsage >= perUserLimit) {
                throw new Error('promoAlreadyUsed');
            }
        }

        // 5. Calculate Discount
        let discountAmount = 0;
        const actualValue = data.discountValue !== undefined ? data.discountValue : (data.value || 0);

        if (data.type === 'percent') {
            discountAmount = (subtotal * actualValue) / 100;
        } else {
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
            discountValue: actualValue
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