// src/config/featureFlags.ts
//
// Phase 1 피처 플래그 (로컬 상수).
// - photobookEnabled = false 면 앱은 기존과 100% 동일(새 진입점 안 보임).
// - true 로 바꾸면 홈에 "AI 포토북" 진입 카드 + /photobook 라우트가 노출된다.
//
// 향후 "앱 재배포 없이 원격 토글"이 필요해지면 usePhotobookEnabled() 내부만
// Firestore config 읽기로 교체하면 되고, 호출부(컴포넌트)는 손대지 않아도 된다.

export const photobookEnabled = false;

/**
 * AI 포토북 기능 노출 여부.
 * 지금은 로컬 상수를 그대로 반환. (추후 Firestore 원격 플래그로 교체 가능)
 */
export function usePhotobookEnabled(): boolean {
    return photobookEnabled;
}
