import React from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { useLanguage } from '../../context/LanguageContext';
import { colors } from '../../theme/colors';

interface TopBarProps {
    current: number;
    total: number;
    onBack: () => void;
    onNext: () => void;
}

export default function TopBarRN({ current, total, onBack, onNext }: TopBarProps) {
    const { t } = useLanguage();
    const insets = useSafeAreaInsets();

    return (
        <BlurView intensity={80} tint="light" style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.headerContent}>
                <Pressable onPress={onBack} style={styles.navBtn}>
                    <Feather name="arrow-left" size={24} color={colors.ink} />
                </Pressable>

                <Text style={styles.title}>
                    {t.editCount ? t.editCount.replace('%current%', current.toString()).replace('%total%', total.toString()) : `${current}/${total}`}
                </Text>

                <Pressable onPress={onNext} style={styles.navBtn}>
                    <Text style={styles.nextText}>{t.next}</Text>
                </Pressable>
            </View>
        </BlurView>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        backgroundColor: Platform.OS === 'ios' ? 'rgba(255,255,255,0.85)' : '#fff',
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0,0,0,0.05)',
    },
    headerContent: {
        height: 52,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
    },
    navBtn: {
        padding: 8,
        minWidth: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.ink,
    },
    nextText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.ink,
    },
});
