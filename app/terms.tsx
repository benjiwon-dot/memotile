import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLanguage } from '../src/context/LanguageContext';
import { colors } from '../src/theme/colors';

export default function TermsOfService() {
    const router = useRouter();
    const { t } = useLanguage();
    const insets = useSafeAreaInsets();

    const handleEmailPress = () => {
        Linking.openURL(`mailto:${t.supportEmail}`);
    };

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Pressable
                    onPress={() => router.back()}
                    style={styles.backBtn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                    <View pointerEvents="none">
                        <ChevronLeft size={24} color="#111" />
                    </View>
                </Pressable>
                <Text style={styles.title}>{t.terms_title}</Text>
                <View style={{ width: 24 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <Text style={styles.pageTitle}>{t.terms_title}</Text>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>{t.terms_sec1_title}</Text>
                    <Text style={styles.paragraph}>
                        {t.terms_sec1_text}
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>{t.terms_sec2_title}</Text>
                    <Text style={styles.paragraph}>
                        {t.terms_sec2_text}
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>{t.terms_sec3_title}</Text>
                    <Text style={styles.paragraph}>
                        {t.terms_sec3_text}
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>{t.terms_sec4_title}</Text>
                    <Text style={styles.paragraph}>
                        {t.terms_sec4_text}
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>{t.terms_sec5_title}</Text>
                    <Text style={styles.paragraph}>
                        {t.terms_sec5_text}
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>{t.terms_sec6_title}</Text>
                    <Text style={styles.paragraph}>
                        {t.terms_sec6_text}
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>{t.terms_sec7_title}</Text>
                    <Text style={styles.paragraph}>
                        {t.terms_sec7_text}
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>{t.terms_sec8_title}</Text>
                    <Text style={styles.paragraph}>
                        {t.terms_sec8_text}
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>{t.terms_sec9_title}</Text>
                    <Text style={styles.paragraph}>
                        {t.terms_sec9_text}
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>{t.terms_sec10_title}</Text>
                    <Text style={styles.paragraph}>
                        {t.terms_sec10_text}
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>{t.terms_sec11_title}</Text>
                    <Text style={styles.paragraph}>
                        {t.terms_sec11_text}
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>{t.terms_sec12_title}</Text>
                    <Text style={styles.paragraph}>
                        {t.terms_sec12_text}
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>{t.terms_sec13_title}</Text>
                    <Text style={styles.paragraph}>
                        {t.terms_sec13_text}
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>{t.terms_sec14_title}</Text>
                    <Text style={styles.paragraph}>
                        {t.terms_sec14_text}
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>{t.terms_sec15_title}</Text>
                    <Text style={styles.paragraph}>
                        {t.terms_sec15_text} <Text style={styles.link} onPress={handleEmailPress}>{t.supportEmail}</Text>.
                    </Text>
                </View>

                {/* Business Info Section */}
                <View style={styles.businessInfoContainer}>
                    <Text style={styles.businessInfoTitle}>{t.business_info_title}</Text>
                    <Text style={styles.businessInfoText}>{t.business_name}</Text>
                    <Text style={styles.businessInfoText}>{t.business_representative}</Text>
                    <Text style={styles.businessInfoText}>{t.business_address}</Text>
                    <Text style={styles.businessInfoText}>{t.business_tax_id}</Text>
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
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
        padding: 8,
        marginLeft: -4,
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
    pageTitle: {
        fontSize: 24,
        fontWeight: '700',
        marginBottom: 24,
        color: colors.text,
    },
    section: {
        marginBottom: 28,
    },
    sectionHeading: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 12,
        color: colors.text,
    },
    paragraph: {
        fontSize: 15,
        lineHeight: 24,
        color: '#333',
        marginBottom: 8,
    },
    link: {
        color: colors.primary,
        fontWeight: '500',
    },
    // Styles for Business Info
    businessInfoContainer: {
        marginTop: 40,
        paddingTop: 24,
        borderTopWidth: 1,
        borderTopColor: '#eee',
    },
    businessInfoTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: '#888',
        marginBottom: 8,
    },
    businessInfoText: {
        fontSize: 12,
        color: '#999',
        lineHeight: 18,
        marginBottom: 2,
    }
});