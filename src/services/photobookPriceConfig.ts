// src/services/photobookPriceConfig.ts
//
// 포토북 판매가 원격 로드. Firebase config/prices 문서의 photobook 필드를 읽어
// photobookPricing에 주입한다 — 인쇄소 단가가 바뀌어도 앱 심사/재빌드 없이 반영.
//
// 타일 가격이 쓰는 config/prices 와 같은 문서라 조회가 추가되지 않는다
// (체크아웃처럼 이미 그 문서를 읽는 화면은 applyPhotobookPricing만 호출하면 됨).
//
// Firestore 기대 형태 (config/prices):
//   photobook: {
//     softAnchor: { A4: {48,80,112}, A3: {...}, A5: {...} },   // 소프트커버 판매가
//     hardAdd:    { A4: 1070, A3: 2680, A5: 670 },             // 하드커버 추가액
//     addUnit:    { A4: 25,   A3: 70,   A5: 15 }               // 중간 페이지 보간 단가(원가)
//   }
// 필드를 빼면 그 항목만 앱 기본값이 유지된다(부분 운영 가능).
import { useSyncExternalStore } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import {
    applyPhotobookPricing,
    getPhotobookPricingVersion,
    subscribePhotobookPricing,
} from "../config/photobookPricing";

let inFlight: Promise<void> | null = null;

/**
 * config/prices → photobook 가격 반영. 실패해도 조용히 기본값 유지(가격이 0이 되는 일은 없음).
 * 동시 호출은 하나로 합쳐진다(앱 시작 + 체크아웃 진입이 겹쳐도 조회 1회).
 */
export async function loadPhotobookPricing(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
        try {
            const snap = await getDoc(doc(db, "config", "prices"));
            if (snap.exists()) applyPhotobookPricing(snap.data()?.photobook);
        } catch {
            /* 네트워크/권한 실패 → 앱 기본값 사용 */
        } finally {
            inFlight = null;
        }
    })();
    return inFlight;
}

/**
 * 가격 표시 화면에서 호출 — 원격 가격이 늦게 도착해도 리렌더되어 최신가가 보인다.
 * 반환값 자체는 쓰지 않아도 되고, 호출만으로 구독된다.
 */
export function usePhotobookPricing(): number {
    return useSyncExternalStore(
        subscribePhotobookPricing,
        getPhotobookPricingVersion,
        getPhotobookPricingVersion, // SSR/초기 스냅샷
    );
}
