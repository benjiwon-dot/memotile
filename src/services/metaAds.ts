// src/services/metaAds.ts
//
// Meta(Facebook) 광고 이벤트 래퍼. 광고 성과 측정용 — 앱 로직과 완전히 분리되어
// 어떤 실패도 삼킨다(광고 SDK 문제로 스캔·결제가 죽으면 안 된다).
//
// 웹 빌드 주의: react-native-fbsdk-next는 네이티브 전용이라 top-level import 하면
// 웹 번들이 깨진다 → 함수 안에서 lazy require.
//
// ATT(iOS): 추적 동의는 사용자가 앱 가치를 이해한 시점(첫 스캔 시작 직전)에 요청한다.
// 거부해도 앱 기능은 전부 정상 — SDK가 비식별 이벤트만 보낸다.
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const isNative = Platform.OS === "ios" || Platform.OS === "android";

function sdk(): { Settings: any; AppEventsLogger: any } | null {
    if (!isNative) return null;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const m = require("react-native-fbsdk-next");
        return { Settings: m.Settings, AppEventsLogger: m.AppEventsLogger };
    } catch {
        return null; // 네이티브 미포함 빌드(재빌드 전 개발 클라이언트 등) → 조용히 무시
    }
}

/** 앱 시작 시 1회. 자동 이벤트(설치/실행/세션)는 이 호출로 활성화된다. */
export function initMetaAds(): void {
    const m = sdk();
    if (!m) return;
    try {
        m.Settings.initializeSDK();
        m.Settings.setAutoLogAppEventsEnabled(true);
    } catch { /* noop */ }
}

let attRequested = false;
/**
 * iOS ATT 동의 요청 → 결과를 Meta SDK에 반영. 여러 번 불려도 시스템 팝업은 최초 1회만 뜬다.
 * Android는 ATT 개념이 없어 광고 ID 수집만 켠다.
 */
export async function requestTrackingConsent(): Promise<void> {
    const m = sdk();
    if (!m) return;
    try {
        if (Platform.OS === "ios") {
            if (attRequested) return;
            attRequested = true;
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { requestTrackingPermissionsAsync } = require("expo-tracking-transparency");
            const { status } = await requestTrackingPermissionsAsync();
            await m.Settings.setAdvertiserTrackingEnabled(status === "granted");
        } else {
            await m.Settings.setAdvertiserIDCollectionEnabled(true);
        }
    } catch { /* noop — 동의 실패해도 앱 흐름 지속 */ }
}

/** 얼굴 스캔 완료 — 찾은 사진 수 포함(광고 타겟군의 사용 깊이 파악용) */
export function logFaceScanCompleted(matchedCount: number): void {
    const m = sdk();
    if (!m) return;
    try {
        m.AppEventsLogger.logEvent("FaceScanCompleted", { matched_count: matchedCount });
    } catch { /* noop */ }
}

const PURCHASE_KEY = (orderId: string) => `meta_purchase_logged:${orderId}`;
/**
 * 구매 이벤트 — 같은 orderId로는 평생 1회만 전송(AsyncStorage 가드).
 * 주문이 서버에서 paid로 확정된 뒤에만 호출할 것. 금액 0(무료 프로모)은 ROAS를
 * 오염시키므로 보내지 않는다.
 */
export async function logPurchaseOnce(orderId: string, amount: number, currency: string = "THB"): Promise<void> {
    const m = sdk();
    if (!m || !orderId || !(amount > 0)) return;
    try {
        if (await AsyncStorage.getItem(PURCHASE_KEY(orderId))) return; // 이미 보냄
        m.AppEventsLogger.logPurchase(amount, currency, { order_id: orderId });
        await AsyncStorage.setItem(PURCHASE_KEY(orderId), "1");
    } catch { /* noop */ }
}
