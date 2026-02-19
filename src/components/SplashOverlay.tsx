import React, { useEffect, useRef } from 'react';
import {
    View,
    Image,
    StyleSheet,
    Animated,
    Pressable,
    Dimensions
} from 'react-native';

interface SplashOverlayProps {
    onFinish: () => void;
}

export default function SplashOverlay({ onFinish }: SplashOverlayProps) {
    const fadeAnim = useRef(new Animated.Value(1)).current;

    // 중복 호출 방지용 Ref
    const hasFinished = useRef(false);

    const handleFinish = () => {
        if (hasFinished.current) return;
        hasFinished.current = true;
        onFinish();
    };

    useEffect(() => {
        // 1. 2초 대기 후 페이드 아웃 시작
        const timer = setTimeout(() => {
            Animated.timing(fadeAnim, {
                toValue: 0,
                duration: 500, // 0.5초 동안 부드럽게 사라짐
                useNativeDriver: true,
            }).start(() => {
                // 2. 애니메이션이 완전히 끝나면 종료 함수 호출
                handleFinish();
            });
        }, 2000);

        return () => clearTimeout(timer);
    }, []);

    return (
        <Animated.View
            style={[
                styles.container,
                { opacity: fadeAnim },
            ]}
            pointerEvents="auto" // 터치 이벤트 가로채기
        >
            <Pressable style={styles.touchable} onPress={handleFinish}>
                {/* React Native의 Image 컴포넌트는 padding 스타일이 
                  의도대로 작동하지 않을 수 있어 View로 감싸거나 
                  부모(touchable)에서 padding을 주는 것이 좋습니다.
                */}
                <Image
                    source={require('../../assets/splash.png')}
                    style={styles.image}
                    resizeMode="contain"
                />
            </Pressable>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#FFFFFF',
        zIndex: 9999, // 최상단 배치
        alignItems: 'center',
        justifyContent: 'center',
    },
    touchable: {
        flex: 1,
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        // ✅ 여기에 패딩을 주어야 이미지가 줄어들면서 여백이 생깁니다.
        paddingHorizontal: 40,
    },
    image: {
        width: '100%',
        height: '100%',
        // Image 컴포넌트 자체의 padding 대신 부모의 padding을 따릅니다.
        maxWidth: 400, // 로고가 태블릿 등에서 너무 커지는 것 방지
    },
});