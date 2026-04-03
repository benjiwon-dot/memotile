import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../firebase';

export type AdminStatus = 'loading' | 'allowed' | 'denied';
export type DeniedReason = 'NO_USER' | 'NOT_ALLOWED_EMAIL' | 'NOT_ADMIN' | 'ERROR';

export type AdminGate =
    | { status: 'loading' }
    | { status: 'denied', reason: DeniedReason, email?: string | null, claims?: any, message?: string }
    | { status: 'allowed', email: string, claims?: any };

// ✅ 관리자 이메일 명단
const ALLOWED_EMAILS = new Set([
    "ben.jiwon@kangkook.com"
]);

// ✅ 세션 만료 시간 설정: 12시간 (초 단위)
const SESSION_TIMEOUT_SEC = 12 * 60 * 60;

/**
 * Client-side hook to enforce admin access.
 */
export function useRequireAdmin(): AdminGate {
    const [gate, setGate] = useState<AdminGate>({ status: 'loading' });

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (!firebaseUser) {
                setGate({ status: 'denied', reason: 'NO_USER' });
                return;
            }

            try {
                // 토큰 정보 강제 갱신하여 최신 로그인 시간(auth_time) 가져오기
                const tokenResult = await firebaseUser.getIdTokenResult(true);

                // 1. 12시간(반나절) 경과 체크
                const authTime = tokenResult.claims.auth_time as number; // 로그인한 시간 (Unix Timestamp)
                const now = Math.floor(Date.now() / 1000); // 현재 시간 (Unix Timestamp)

                if (now - authTime > SESSION_TIMEOUT_SEC) {
                    console.log("ADMIN_GATE: Session expired (12h). Forcing re-login.");
                    await signOut(auth); // 🔥 12시간 지났으면 자동 로그아웃
                    setGate({ status: 'denied', reason: 'NO_USER' });
                    return;
                }

                // 2. 관리자 이메일 목록 검사
                const email = firebaseUser.email?.toLowerCase();
                if (!email || !ALLOWED_EMAILS.has(email)) {
                    console.warn(`ADMIN_GATE: ${email} is not admin. Forcing logout to show login form.`);
                    await signOut(auth); // 🔥 일반 유저가 들어오면 강제 로그아웃 시켜서 어드민 로그인 창 띄움
                    setGate({ status: 'denied', reason: 'NO_USER' });
                    return;
                }

                // 3. 모두 통과 시 어드민 화면 허용
                // (현재 Custom Claim 로직은 Firebase 백엔드 설정 전까지는 이메일 검사로 대체합니다)
                setGate({
                    status: 'allowed',
                    email: firebaseUser.email!,
                    claims: tokenResult.claims
                });

            } catch (error: any) {
                console.error("ADMIN_GATE: Error", error);
                setGate({ status: 'denied', reason: 'ERROR', email: firebaseUser.email, message: error.message });
            }
        });

        return () => unsubscribe();
    }, []);

    return gate;
}