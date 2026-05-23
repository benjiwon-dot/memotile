// app/oauthredirect.tsx
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

// 구글 창 확실히 닫기
WebBrowser.maybeCompleteAuthSession();

export default function OAuthRedirectScreen() {
    const router = useRouter();

    useEffect(() => {
        const timer = setTimeout(() => {
            // 🚨 애매한 뒤로가기(back) 삭제! 무조건 결제창으로 강제 꽂아버립니다.
            router.replace('/create/checkout');
        }, 50);

        return () => clearTimeout(timer);
    }, [router]);

    return null;
}