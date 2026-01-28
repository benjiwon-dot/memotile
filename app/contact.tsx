import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft, Mail, MessageCircle, Copy, Check } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLanguage } from '../src/context/LanguageContext';
import { colors } from '../src/theme/colors';
import { shadows } from '../src/theme/shadows';
import { layout } from '../src/theme/layout';

const EMAIL_SUPPORT = 'support@memotiles.com';

export default function Contact() {
    const router = useRouter();
    const { t } = useLanguage();
    const insets = useSafeAreaInsets();
    const [copied, setCopied] = useState(false);

    const copyToClipboard = async () => {
        await Clipboard.setStringAsync(EMAIL_SUPPORT);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleEmailPress = () => {
        Linking.openURL(`mailto:${EMAIL_SUPPORT}`);
    };

    const handleLineClick = () => {
        Alert.alert("Info", t.comingSoon);
    };

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Pressable onPress={() => router.back()} style={styles.backBtn}>
                    <ChevronLeft size={24} color="#111" />
                </Pressable>
                <Text style={styles.title}>{t.chatTitle}</Text>
                <View style={{ width: 24 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <Text style={styles.sectionHeader}>{t.customerSupport}</Text>
                <Text style={styles.introText}>{t.contactIntro}</Text>

                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <Mail size={20} color={colors.primary} />
                        <Text style={styles.cardTitle}>{t.emailSupport}</Text>
                    </View>
                    <View style={styles.emailContainer}>
                        <Pressable onPress={handleEmailPress} style={{ flex: 1 }}>
                            <Text style={styles.emailText}>{EMAIL_SUPPORT}</Text>
                        </Pressable>
                        <Pressable
                            onPress={copyToClipboard}
                            style={({ pressed }) => [styles.copyBtn, pressed && { opacity: 0.5 }]}
                            hitSlop={10}
                        >
                            {copied ? <Check size={18} color={colors.success} /> : <Copy size={18} color="#8E8E93" />}
                        </Pressable>
                    </View>
                    <Text style={styles.cardHint}>{t.expectedResponse}</Text>
                </View>

                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <MessageCircle size={20} color="#06C755" />
                        <Text style={styles.cardTitle}>{t.lineSupport}</Text>
                    </View>
                    <Pressable
                        onPress={handleLineClick}
                        style={({ pressed }) => [styles.lineBtn, pressed && { opacity: 0.9 }]}
                    >
                        <Text style={styles.lineBtnText}>{t.chatWithUs} on LINE</Text>
                    </Pressable>
                    <Text style={styles.cardHint}>{t.quickAssistance}</Text>
                </View>

                <View style={styles.footer}>
                    <Text style={styles.footerText}>{t.supportHours}</Text>
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        height: 52,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        backgroundColor: colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    backBtn: {
        padding: 4,
    },
    title: {
        fontSize: 17,
        fontWeight: '600',
        color: colors.text,
    },
    content: {
        padding: 24,
        paddingBottom: 100,
    },
    sectionHeader: {
        fontSize: 22,
        fontWeight: '700',
        color: colors.text,
        marginBottom: 12,
    },
    introText: {
        fontSize: 15,
        lineHeight: 22,
        color: colors.textMuted,
        marginBottom: 24,
    },
    card: {
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: 20,
        marginBottom: 20,
        ...shadows.sm,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
    },
    cardTitle: {
        fontSize: 17,
        fontWeight: '600',
        color: colors.text,
    },
    emailContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#F8F8FA',
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
        marginBottom: 8,
    },
    emailText: {
        fontSize: 16,
        color: colors.text,
        fontWeight: '500',
    },
    copyBtn: {
        padding: 4,
    },
    lineBtn: {
        width: '100%',
        height: 48,
        backgroundColor: '#06C755',
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
    },
    lineBtnText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#fff',
    },
    cardHint: {
        fontSize: 13,
        color: colors.textSecondary,
    },
    footer: {
        marginTop: 12,
        alignItems: 'center',
    },
    footerText: {
        fontSize: 13,
        color: colors.textSecondary,
    }
});
