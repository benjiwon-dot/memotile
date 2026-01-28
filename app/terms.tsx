import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../src/theme/colors';

export default function TermsOfService() {
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
                <Text style={styles.title}>Terms of Service</Text>
                <View style={{ width: 24 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <Text style={styles.pageTitle}>Terms of Service</Text>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>1. Service Description</Text>
                    <Text style={styles.paragraph}>
                        MEMOTILES provides a service for uploading and editing photos to create and deliver custom-made photo tiles. All products are produced on a made-to-order basis.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>2. User Responsibility & Purchase Authority</Text>
                    <Text style={styles.paragraph}>
                        Users confirm they have the legal authority to use this service or have received permission from a parent, guardian, or authorized payer. The responsibility for all purchases and payments made within the service lies with the person who completes the transaction.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>3. User Content & Copyright</Text>
                    <Text style={styles.paragraph}>
                        Users retain ownership of the photos they upload. Users grant MEMOTILES a non-exclusive, royalty-free license to the extent necessary for order fulfillment (processing, printing, and delivery). MEMOTILES does not use user photos for marketing purposes without explicit consent. Users are responsible for any copyright violations resulting from uploaded photos.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>4. Prohibited Content</Text>
                    <Text style={styles.paragraph}>
                        Uploading illegal content, items that infringe on copyrights or privacy, or harmful content involving minors is strictly prohibited. MEMOTILES reserves the right to refuse or cancel orders that violate these regulations.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>5. Orders & Custom Products</Text>
                    <Text style={styles.paragraph}>
                        Since all products are custom-made, orders cannot be canceled or changed once printing has begun. Users must carefully review the editing and cropping state of their photos before checkout.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>6. Order Status Information</Text>
                    <Text style={styles.paragraph}>
                        Order statuses (Paid, Processing, Printing, Shipped, Delivered, etc.) are provided for informational purposes only and may differ slightly from the real-time situation.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>7. Pricing & Payments</Text>
                    <Text style={styles.paragraph}>
                        Product prices are displayed on the screen before checkout. Payments are processed through third-party payment systems, and any applicable taxes or customs duties are the responsibility of the user.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>8. Shipping & Delivery</Text>
                    <Text style={styles.paragraph}>
                        Delivery dates are estimates and not guaranteed arrival dates. MEMOTILES is not responsible for delivery delays caused by logistics conditions, customs, or incorrect address entry.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>9. Returns & Refunds</Text>
                    <Text style={styles.paragraph}>
                        Due to the nature of custom-made products, refunds for a simple change of mind are not possible. Reprints or refunds are only available in cases of defective or damaged products, and users must contact customer support within a reasonable period after delivery.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>10. Intellectual Property</Text>
                    <Text style={styles.paragraph}>
                        All rights to the MEMOTILES brand, UI design, and systems belong to MEMOTILES, and unauthorized use is prohibited.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>11. Service Changes</Text>
                    <Text style={styles.paragraph}>
                        MEMOTILES may modify, suspend, or terminate part or all of the service as needed.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>12. Limitation of Liability</Text>
                    <Text style={styles.paragraph}>
                        The service is provided 'as is'. Minor differences between screen colors and actual printed materials may occur. MEMOTILES' liability is limited to the amount paid at the time of the order.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>13. Changes to Terms</Text>
                    <Text style={styles.paragraph}>
                        These Terms may be updated from time to time, and updated Terms become effective immediately upon being posted on the website.
                    </Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>14. Contact Information</Text>
                    <Text style={styles.paragraph}>
                        If you have any questions, please contact our support team at <Text style={styles.link} onPress={handleEmailPress}>support@memotiles.com</Text>.
                    </Text>
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
    link: {
        color: colors.primary,
        fontWeight: '500',
    }
});
