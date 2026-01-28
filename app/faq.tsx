import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft, ChevronDown, ChevronUp } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLanguage } from '../src/context/LanguageContext';
import { colors } from '../src/theme/colors';
import { shadows } from '../src/theme/shadows';

export default function FAQ() {
    const router = useRouter();
    const { t } = useLanguage();
    const insets = useSafeAreaInsets();
    const [openIndex, setOpenIndex] = useState<number | null>(null);

    const faqItems = [
        {
            question: t.qSize,
            answer: t.aSize
        },
        {
            question: t.qDamage,
            answer: t.aDamage
        },
        {
            question: t.qShipping,
            answer: t.aShipping
        },
        {
            question: t.qFallOff,
            answer: t.aFallOff
        },
        {
            question: t.qLowQuality,
            answer: t.aLowQuality
        },
        {
            question: t.qModifyOrder,
            answer: t.aModifyOrder
        }
    ];

    const toggleAccordion = (index: number) => {
        setOpenIndex(openIndex === index ? null : index);
    };

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Pressable onPress={() => router.back()} style={styles.backBtn}>
                    <ChevronLeft size={24} color="#111" />
                </Pressable>
                <Text style={styles.title}>{t.faqTitle}</Text>
                <View style={{ width: 24 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.accordionList}>
                    {faqItems.map((item, index) => {
                        const isOpen = openIndex === index;
                        return (
                            <View key={index} style={styles.accordionItem}>
                                <Pressable
                                    style={({ pressed }) => [
                                        styles.accordionHeader,
                                        pressed && { backgroundColor: '#FAFAFA' }
                                    ]}
                                    onPress={() => toggleAccordion(index)}
                                >
                                    <Text style={styles.questionText}>{item.question}</Text>
                                    {isOpen ? (
                                        <ChevronUp size={20} color="#8E8E93" />
                                    ) : (
                                        <ChevronDown size={20} color="#8E8E93" />
                                    )}
                                </Pressable>

                                {isOpen && (
                                    <View style={styles.accordionBody}>
                                        <Text style={styles.answerText}>{item.answer}</Text>
                                    </View>
                                )}

                                {index < faqItems.length - 1 && <View style={styles.divider} />}
                            </View>
                        );
                    })}
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
        padding: 20,
        paddingBottom: 100,
    },
    accordionList: {
        backgroundColor: colors.surface,
        borderRadius: 16,
        overflow: 'hidden',
        ...shadows.sm,
    },
    accordionItem: {
        flexDirection: 'column',
    },
    accordionHeader: {
        minHeight: 56,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    questionText: {
        fontSize: 16,
        fontWeight: '500',
        color: colors.text,
        paddingRight: 12,
        lineHeight: 22,
        flex: 1,
    },
    accordionBody: {
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    answerText: {
        fontSize: 15,
        lineHeight: 22,
        color: colors.textMuted,
    },
    divider: {
        height: 1,
        backgroundColor: colors.background, // F2F2F7 in web
        marginHorizontal: 16,
    }
});
