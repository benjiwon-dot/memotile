import React, { useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Animated,
    Pressable,
    Platform,
} from 'react-native';

interface SplashOverlayProps {
    onFinish: () => void;
}

export default function SplashOverlay({ onFinish }: SplashOverlayProps) {
    const fadeAnim = useRef(new Animated.Value(1)).current;
    const hasFinished = useRef(false);

    const handleFinish = () => {
        if (hasFinished.current) return;
        hasFinished.current = true;
        onFinish();
    };

    useEffect(() => {
        // Start fade out after 1.5s
        const fadeTimer = setTimeout(() => {
            Animated.timing(fadeAnim, {
                toValue: 0,
                duration: 400,
                useNativeDriver: true,
            }).start();
        }, 1500);

        // Finish after 1.9s (1.5s delay + 0.4s fade)
        const finishTimer = setTimeout(() => {
            handleFinish();
        }, 1900);

        return () => {
            clearTimeout(fadeTimer);
            clearTimeout(finishTimer);
        };
    }, []);

    return (
        <Animated.View
            style={[
                styles.container,
                { opacity: fadeAnim },
            ]}
            pointerEvents="auto" // Ensure it captures touches
        >
            <Pressable style={styles.touchable} onPress={handleFinish}>
                <View style={styles.square}>
                    <Text style={styles.text}>MEMOTILE</Text>
                </View>
            </Pressable>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#FFFFFF',
        zIndex: 9999, // Ensure it's on top
        alignItems: 'center',
        justifyContent: 'center',
    },
    touchable: {
        flex: 1,
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
    },
    square: {
        width: 160,
        height: 160,
        backgroundColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
        // iOS Shadow
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.08,
        shadowRadius: 30,
        // Android Shadow
        elevation: 10,
    },
    text: {
        fontSize: 22,
        fontWeight: '700',
        letterSpacing: 2.6,
        color: '#111111',
    },
});
