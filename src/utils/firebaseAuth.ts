import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native"; // ✅ Platform 추가
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import { makeRedirectUri } from "expo-auth-session";
import { Buffer } from "buffer";

import {
    GoogleAuthProvider,
    signInWithCredential,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    UserCredential,
} from "firebase/auth";

import { auth } from "../lib/firebase"; // single auth instance

WebBrowser.maybeCompleteAuthSession();

// Helper: decode JWT payload safely (no full token logs)
function decodeJwtPayload(token: string): { aud?: string; iss?: string;[k: string]: any } | null {
    try {
        const parts = token.split(".");
        if (parts.length < 2) return null;

        const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4);
        const json = Buffer.from(padded, "base64").toString("utf8");
        return JSON.parse(json);
    } catch {
        return null;
    }
}

// --------------------
// Email Auth Helpers
// --------------------
export const signUpWithEmail = async (email: string, pass: string): Promise<UserCredential> => {
    if (!email.includes("@")) throw new Error("Invalid email format.");
    if (pass.length < 6) throw new Error("Password must be at least 6 characters.");
    return createUserWithEmailAndPassword(auth, email, pass);
};

export const signInWithEmail = async (email: string, pass: string): Promise<UserCredential> => {
    if (!email.includes("@")) throw new Error("Invalid email format.");
    if (!pass) throw new Error("Password is required.");
    return signInWithEmailAndPassword(auth, email, pass);
};

// --------------------
// Google -> Firebase
// --------------------
export const signInWithGoogleIdToken = async (idToken: string): Promise<UserCredential | any> => {
    if (!idToken) throw new Error("Missing idToken from Google auth response.");
    const credential = GoogleAuthProvider.credential(idToken);

    try {
        // 기존 정상 로그인 처리
        return await signInWithCredential(auth, credential);
    } catch (error: any) {
        // 🔥 핵심 수술 부위: 이미 가입된 구글 계정이 익명 계정과 충돌(Link 실패)할 때 발생하는 에러 방어
        if (error.code === 'auth/duplicate-raw-id' || error.code === 'auth/credential-already-in-use') {
            console.log("⚠️ [GoogleAuth] 계정 충돌 감지 -> 기존 익명 계정 로그아웃 후 진짜 구글 계정으로 강제 로그인");

            // 1. 방해물이 되는 현재 껍데기 세션(익명 계정)을 끊어버립니다.
            await auth.signOut();

            // 2. 에러창을 띄우지 않고 묻지도 따지지도 않고 그 구글 계정으로 다이렉트 로그인 시킵니다.
            return await signInWithCredential(auth, credential);
        }

        // 진짜 에러는 그대로 던짐
        throw error;
    }
};

/**
 * Google OAuth Hook (Harden for iOS Dev Client)
 */
export const useGoogleAuthRequest = () => {
    const extra = (Constants.expoConfig?.extra ?? {}) as any;

    useEffect(() => {
        if (__DEV__) console.log("🔥 [GoogleAuth] hook mounted");
    }, []);

    const isExpoGo = Constants.appOwnership === "expo";

    // Environment Variables (Audience Fix)
    const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
    const googleAndroidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

    if (!googleWebClientId) console.warn("[GoogleAuth] Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID");
    if (!googleIosClientId) console.warn("[GoogleAuth] Missing EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID");
    if (!googleAndroidClientId) console.warn("[GoogleAuth] Missing EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID");

    // Exact Native Redirect required by Google iOS
    const googleScheme = googleIosClientId
        ? `com.googleusercontent.apps.${googleIosClientId.split(".")[0]}`
        : "com.googleusercontent.apps.459952418126-2sptgnl1nsc5t5chmdll4i0rrovfo4fm";

    // ✅ 웹과 앱 환경을 분리하여 리다이렉트 URI 설정
    const redirectUri = useMemo(() => {
        if (Platform.OS === 'web') {
            // 웹(Vercel) 환경에서는 /auth 라우트로 리다이렉트
            return makeRedirectUri({
                path: "auth",
            });
        }

        // 앱 환경
        return makeRedirectUri({
            native: isExpoGo ? undefined : `${googleScheme}:/oauthredirect`,
            path: "oauthredirect",
        });
    }, [isExpoGo, googleScheme]);

    // IMPORTANT: To avoid audience mismatch (auth/invalid-credential), 
    // the Google id_token must be issued for the WEB client ID.
    const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
        clientId: googleWebClientId ?? "", // Force audience to Web Client ID
        webClientId: googleWebClientId ?? "",
        iosClientId: googleIosClientId ?? undefined,
        androidClientId: googleAndroidClientId ?? undefined,
        scopes: ["openid", "profile", "email"],
        usePKCE: true,
        redirectUri,
    });

    const [isSigningIn, setIsSigningIn] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // DEV 로그
    useEffect(() => {
        if (!__DEV__ || !request) return;
        console.log("[GoogleAuth] clientIds", {
            webClientId: googleWebClientId,
            iosClientId: googleIosClientId,
            androidClientId: googleAndroidClientId,
        });
        console.log("[GoogleAuth] isExpoGo:", isExpoGo);
        console.log("[GoogleAuth] redirectUri:", redirectUri);
    }, [isExpoGo, redirectUri, !!request, googleWebClientId, googleIosClientId, googleAndroidClientId]);

    // idToken Handling & Firebase Login
    useEffect(() => {
        if (!response || response.type !== "success") return;

        (async () => {
            try {
                setIsSigningIn(true);
                setError(null);

                const idToken = response.authentication?.idToken || response.params?.id_token;

                if (__DEV__) {
                    console.log("[GoogleAuth] Response success, idToken received:", {
                        hasIdToken: !!idToken,
                        head: idToken ? idToken.slice(0, 10) : null,
                    });

                    const payload = idToken ? decodeJwtPayload(idToken) : null;
                    console.log("[GoogleAuth] idToken payload:", {
                        aud: payload?.aud,
                        iss: payload?.iss,
                    });
                }

                if (!idToken) {
                    throw new Error("No idToken returned. Check client IDs and redirect URI configuration.");
                }

                await signInWithGoogleIdToken(idToken);
                if (__DEV__) console.log("[GoogleAuth] Firebase sign-in success ✅");
            } catch (e: any) {
                console.error("[GoogleAuth] Auth failed:", e);
                setError(e?.message ?? String(e));
            } finally {
                setIsSigningIn(false);
            }
        })();
    }, [response]);

    const promptAsyncFixed = useCallback((options?: any) => {
        if (!googleWebClientId || !googleIosClientId) {
            console.error("[GoogleAuth] Missing required client IDs in .env");
            return Promise.reject("Configuration error: Missing Google Client IDs.");
        }
        return promptAsync({
            ...options,
        });
    }, [promptAsync, googleWebClientId, googleIosClientId]);

    return {
        request,
        response,
        promptAsync: promptAsyncFixed,
        redirectUri,
        isReady: !!request,
        isSigningIn,
        error,
    };
};