// app/oauthredirect.tsx
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

// 혹시 열려있는 구글 인증 브라우저 창이 있다면 확실하게 닫아줍니다.
WebBrowser.maybeCompleteAuthSession();

export default function OAuthRedirectScreen() {
    const router = useRouter();

    useEffect(() => {
        // 화면이 렌더링되자마자 0.1초(100ms) 만에 원래 있던 결제창으로 바로 튕겨 보냅니다.
        // 시간이 너무 짧아서 고객 눈에는 화면이 이동했다는 느낌조차 들지 않습니다.
        const timer = setTimeout(() => {
            if (router.canGoBack()) {
                router.back();
            } else {
                router.replace('/create/checkout');
            }
        }, 100);

        return () => clearTimeout(timer);
    }, [router]);

    // UI를 아무것도 그리지 않습니다 (깜빡임과 이질감을 완벽 차단)
    return null;
}