import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../src/theme/colors';

export default function PrivacyPolicy() {
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const handleEmailPress = () => {
        Linking.openURL('mailto:support@memotiles.com');
    };

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Pressable onPress={() => router.back()} style={styles.backBtn}>
                    <ChevronLeft size={24} color="#111" />
                </Pressable>
                <Text style={styles.title}>Privacy Policy</Text>
                <View style={{ width: 24 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <Text style={styles.pageTitle}>Privacy Policy</Text>

                <Section title="1. Personal Information Collected">
                    <View style={styles.list}>
                        <Bullet>Contact information (Name, Email address)</Bullet>
                        <Bullet>Shipping information (Address, Phone number)</Bullet>
                        <Bullet>Payment-related (Processed by third-party)</Bullet>
                        <Bullet>Usage data and device information</Bullet>
                        <Bullet>Uploaded images and edit data</Bullet>
                    </View>
                </Section>

                <Section title="2. Purpose of Collection and Use">
                    <View style={styles.list}>
                        <Bullet>Order fulfillment and delivery</Bullet>
                        <Bullet>Payment processing and verification</Bullet>
                        <Bullet>Customer support and inquiries</Bullet>
                        <Bullet>Service improvement</Bullet>
                        <Bullet>Legal compliance</Bullet>
                    </View>
                </Section>

                <Section title="3. Data Retention">
                    <Text style={styles.paragraph}>
                        Retained only as necessary for fulfillment or legal obligations.
                    </Text>
                </Section>

                <Section title="4. Third-Party Sharing">
                    <Text style={styles.paragraph}>
                        Shared only with necessary partners:
                    </Text>
                    <View style={styles.list}>
                        <Bullet>Logistics for delivery</Bullet>
                        <Bullet>Payment processors</Bullet>
                        <Bullet>Legal requirements</Bullet>
                    </View>
                </Section>

                <Section title="5. Outsourcing">
                    <Text style={styles.paragraph}>
                        Data processing outsourced to cloud/payment/logistics providers.
                    </Text>
                </Section>

                <Section title="6. User Rights">
                    <Text style={styles.paragraph}>
                        Access, correct, delete, or restrict data use at any time.
                    </Text>
                </Section>

                <Section title="7. Security">
                    <Text style={styles.paragraph}>
                        Technical/organizational safeguards implemented.
                    </Text>
                </Section>

                <Section title="8. Minors">
                    <Text style={styles.paragraph}>
                        Accessible to all, but authorized payer responsible.
                    </Text>
                </Section>

                <Section title="9. Cookies">
                    <Text style={styles.paragraph}>
                        Cookies used for functionality/analytics.
                    </Text>
                </Section>

                <Section title="10. Updates">
                    <Text style={styles.paragraph}>
                        Effective immediately upon posting.
                    </Text>
                </Section>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>11. Contact</Text>
                    <Text style={styles.paragraph}>
                        Inquiries: <Text style={styles.link} onPress={handleEmailPress}>support@memotiles.com</Text>.
                    </Text>
                </View>
            </ScrollView>
        </View>
    );
}

const Section = ({ title, children }: { title: string, children: React.ReactNode }) => (
    <View style={styles.section}>
        <Text style={styles.sectionHeading}>{title}</Text>
        {children}
    </View>
);

const Bullet = ({ children }: { children: React.ReactNode }) => (
    <Text style={styles.listItem}>• {children}</Text>
);

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
    list: {
        paddingLeft: 8,
    },
    listItem: {
        fontSize: 15,
        lineHeight: 24,
        color: '#333',
        marginBottom: 4,
    },
    link: {
        color: colors.primary,
        fontWeight: '500',
    }
});
