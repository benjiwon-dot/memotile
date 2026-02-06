import React, { useState } from "react";
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, Image, Alert, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { usePhoto } from "../context/PhotoContext";
import { useLanguage } from "../context/LanguageContext";
import { colors } from "../theme/colors";
import { shadows } from "../theme/shadows";

import { auth } from "../lib/firebase";
import { signOut, User } from "firebase/auth";
import { createDevOrder, getOrder } from "../services/orders";
import { validatePromo, PromoResult } from "../services/promo";
import PromptPayModal from "../components/payments/PromptPayModal";
import TrueMoneyModal from "../components/payments/TrueMoneyModal";

const PAYMENT_OPTIONS = [
    { id: 'promptpay', labelKey: 'promptpay', icon: require('../assets/promptpay_logo.png') },
    { id: 'truemoney', labelKey: 'truemoney', icon: require('../assets/truemoney_logo.png') },
    { id: 'card', labelKey: 'creditDebitCard', icon: 'card-outline' },
    { id: 'apple', labelKey: 'applePay', icon: 'logo-apple' },
    { id: 'google', labelKey: 'googlePay', icon: 'logo-google' }
];

export default function CheckoutStepTwoScreen() {
    const router = useRouter();
    const { photos, clearDraft, clearPhotos } = usePhoto();
    const { t, locale } = useLanguage();

    const [formData, setFormData] = useState({
        fullName: '',
        addressLine1: '',
        addressLine2: '',
        city: '',
        state: '',
        postalCode: '',
        phone: '',
        email: '',
        instagram: '',
    });
    const [currentUser, setCurrentUser] = React.useState<User | null>(auth.currentUser);

    React.useEffect(() => {
        const unsub = auth.onAuthStateChanged(user => {
            setCurrentUser(user);
        });
        return unsub;
    }, []);

    const handleInputChange = (field: string, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const [promoCode, setPromoCode] = useState("");
    const [promoResult, setPromoResult] = useState<PromoResult | null>(null);
    const [isApplyingPromo, setIsApplyingPromo] = useState(false);

    const [showPromptPay, setShowPromptPay] = useState(false);
    const [showTrueMoney, setShowTrueMoney] = useState(false);
    const [isCreatingOrder, setIsCreatingOrder] = useState(false);

    // Constants
    const PRICE_PER_TILE = locale === 'TH' ? 200 : 6.45;
    const CURRENCY_SYMBOL = locale === 'TH' ? '฿' : '$';

    // Total calc
    const subtotal = photos.length * PRICE_PER_TILE;
    const discount = promoResult?.discountAmount || 0;
    const shippingFee = 0; // Free for now
    const total = subtotal - discount + shippingFee;

    const handleApplyPromo = async () => {
        if (!promoCode) return;
        setIsApplyingPromo(true);
        const res = await validatePromo(promoCode, auth.currentUser?.uid || "anon", subtotal);
        setPromoResult(res);
        if (!res.success) {
            alert((t as any)[res.error || 'promoInvalid'] || res.error);
        }
        setIsApplyingPromo(false);
    };

    const handlePlaceOrder = async (provider: 'DEV_FREE' | 'PROMPT_PAY' | 'TRUEMONEY') => {
        const user = auth.currentUser;

        if (!user) {
            alert("Please login to place an order.");
            router.push("/auth/email");
            return;
        }

        // Validate form
        if (!formData.fullName || !formData.addressLine1 || !formData.city || !formData.phone || !formData.email) {
            alert(t['alertFillShipping'] || "Please fill in all required shipping fields.");
            return;
        }

        if (provider === 'PROMPT_PAY') {
            setShowPromptPay(true);
            return;
        }
        if (provider === 'TRUEMONEY') {
            setShowTrueMoney(true);
            return;
        }

        // DEV_FREE flow
        setIsCreatingOrder(true);
        try {
            const orderId = await createDevOrder({
                uid: user.uid,
                shipping: {
                    fullName: formData.fullName,
                    address1: formData.addressLine1,
                    address2: formData.addressLine2,
                    city: formData.city,
                    state: formData.state,
                    postalCode: formData.postalCode,
                    country: "Thailand",
                    phone: formData.phone,
                    email: formData.email
                },
                totals: {
                    subtotal,
                    discount,
                    shippingFee,
                    total,
                },
                photos,
                promoCode: promoResult?.success ? {
                    code: promoResult.promoCode!,
                    discountType: promoResult.discountType!,
                    discountValue: promoResult.discountValue!
                } : undefined,
                locale
            });

            console.log("Order created successfully:", orderId);

            // Post-order cleanup
            await clearDraft();
            clearPhotos();

            router.replace({ pathname: "/myorder/success", params: { id: orderId } });

        } catch (e) {
            console.error("Failed to place order:", e);
            alert("Failed to place order. Please try again.");
        } finally {
            setIsCreatingOrder(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color="black" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{t['checkoutTitle'] || "Checkout"}</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.stepContainer}>

                    {/* Shipping Form */}
                    <View style={styles.formSection}>
                        <Text style={styles.sectionTitle}>{t['shippingAddressTitle'] || "SHIPPING ADDRESS"}</Text>

                        <TextInput
                            placeholder={`${t['fullName'] || "Full Name"} *`}
                            style={styles.input}
                            value={formData.fullName}
                            onChangeText={(v) => handleInputChange('fullName', v)}
                        />
                        <TextInput
                            placeholder={`${t['streetAddress'] || "Street Address"} *`}
                            style={styles.input}
                            value={formData.addressLine1}
                            onChangeText={(v) => handleInputChange('addressLine1', v)}
                        />
                        <TextInput
                            placeholder={`${t['address2'] || "Apartment, suite, etc."} ${t['optionalSuffix'] || "(optional)"}`}
                            style={styles.input}
                            value={formData.addressLine2}
                            onChangeText={(v) => handleInputChange('addressLine2', v)}
                        />

                        <View style={styles.row}>
                            <TextInput
                                placeholder={`${t['city'] || "City"} *`}
                                style={[styles.input, { flex: 1, marginRight: 8 }]}
                                value={formData.city}
                                onChangeText={(v) => handleInputChange('city', v)}
                            />
                            <TextInput
                                placeholder={`${t['stateProv'] || "State"} *`}
                                style={[styles.input, { flex: 1 }]}
                                value={formData.state}
                                onChangeText={(v) => handleInputChange('state', v)}
                            />
                        </View>

                        <View style={styles.row}>
                            <TextInput
                                placeholder={`${t['zipCode'] || "Zip Code"} *`}
                                style={[styles.input, { flex: 1, marginRight: 8 }]}
                                value={formData.postalCode}
                                onChangeText={(v) => handleInputChange('postalCode', v)}
                            />
                            <View style={[styles.input, styles.readOnlyInput, { flex: 1 }]}>
                                <Text style={{ color: '#666' }}>{t['thailand'] || "Thailand"}</Text>
                            </View>
                        </View>

                        <TextInput
                            placeholder={`${t['phoneNumber'] || "Phone"} *`}
                            style={styles.input}
                            value={formData.phone}
                            keyboardType="phone-pad"
                            onChangeText={(v) => handleInputChange('phone', v)}
                        />
                        <TextInput
                            placeholder={`${t['emailAddress'] || "Email"} *`}
                            style={styles.input}
                            value={formData.email}
                            keyboardType="email-address"
                            autoCapitalize="none"
                            onChangeText={(v) => handleInputChange('email', v)}
                        />
                        <TextInput
                            placeholder={`${t['instagram'] || "Instagram"} ${t['optionalSuffix'] || "(optional)"}`}
                            style={styles.input}
                            value={formData.instagram}
                            autoCapitalize="none"
                            onChangeText={(v) => handleInputChange('instagram', v)}
                        />
                    </View>

                    {/* Promo Code Section */}
                    <View style={styles.promoSection}>
                        <Text style={styles.sectionTitle}>{t['promoHaveCode'] || "PROMO CODE"}</Text>
                        <View style={styles.promoInputRow}>
                            <TextInput
                                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                                placeholder={t['promoEnterCode']}
                                value={promoCode}
                                onChangeText={setPromoCode}
                                autoCapitalize="characters"
                            />
                            <TouchableOpacity
                                style={[styles.promoApplyBtn, isApplyingPromo && { opacity: 0.7 }]}
                                onPress={handleApplyPromo}
                                disabled={isApplyingPromo}
                            >
                                <Text style={styles.promoApplyText}>{t['promoApply']}</Text>
                            </TouchableOpacity>
                        </View>
                        {promoResult?.success && (
                            <Text style={styles.promoSuccessText}>{t['promoApplied']}: {promoResult.promoCode}</Text>
                        )}
                    </View>

                    {/* Order Summary */}
                    <View style={styles.summarySection}>
                        <View style={styles.summaryRow}>
                            <Text style={styles.summaryLabel}>{t['subtotalLabel'] || "Subtotal"}</Text>
                            <Text style={styles.summaryValue}>{CURRENCY_SYMBOL}{subtotal.toFixed(2)}</Text>
                        </View>
                        {discount > 0 && (
                            <View style={styles.summaryRow}>
                                <Text style={[styles.summaryLabel, { color: colors.primary }]}>{t['discountLabel'] || "Discount"}</Text>
                                <Text style={[styles.summaryValue, { color: colors.primary }]}>-{CURRENCY_SYMBOL}{discount.toFixed(2)}</Text>
                            </View>
                        )}
                        <View style={[styles.summaryRow, { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f3f4f6' }]}>
                            <Text style={styles.totalLabel}>{t['totalLabel'] || "Total"}</Text>
                            <Text style={styles.totalValue}>{CURRENCY_SYMBOL}{total.toFixed(2)}</Text>
                        </View>
                    </View>

                    {/* Auth Block */}
                    <View style={styles.authBlockContainer}>
                        {currentUser ? (
                            <View style={styles.loggedInBox}>
                                <Text style={styles.loggedInText}>
                                    {t['loggedInAs'] || "Logged in as"} {currentUser.email}
                                </Text>
                                {/* Logout removed as per request (Bug D)
                                <TouchableOpacity onPress={() => signOut(auth)}>
                                    <Text style={styles.signOutLink}>
                                        {t['signOut'] || "Sign Out"}
                                    </Text>
                                </TouchableOpacity> 
                                */}
                            </View>
                        ) : (
                            <View style={styles.loggedOutBox}>
                                <Text style={styles.loggedOutText}>
                                    {t['signInToContinue'] || "Please sign in to continue."}
                                </Text>
                                <TouchableOpacity
                                    style={styles.signInBtn}
                                    onPress={() => router.push("/auth/email")}
                                >
                                    <Text style={styles.signInBtnText}>{t['signIn'] || "Sign In"}</Text>
                                </TouchableOpacity>
                            </View>
                        )}
                    </View>

                    {/* Payment Selection Area */}
                    <View style={styles.paymentSection}>
                        <Text style={styles.sectionTitle}>{t['paymentMethodLabel'] || "Payment Method"}</Text>

                        {/* PromptPay */}
                        <TouchableOpacity
                            style={[styles.paymentItem, { borderColor: '#003a70' }, !currentUser && { opacity: 0.5 }]}
                            onPress={() => handlePlaceOrder('PROMPT_PAY')}
                            disabled={!currentUser}
                        >
                            <View style={styles.paymentItemLeft}>
                                <Image source={require('../assets/promptpay_logo.png')} style={styles.paymentLogo} resizeMode="contain" />
                                <Text style={styles.paymentItemText}>{t['payPromptPay'] || "PromptPay"}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={20} color="#ccc" />
                        </TouchableOpacity>

                        {/* TrueMoney */}
                        <TouchableOpacity
                            style={[styles.paymentItem, { borderColor: '#FF6F00' }, !currentUser && { opacity: 0.5 }]}
                            onPress={() => handlePlaceOrder('TRUEMONEY')}
                            disabled={!currentUser}
                        >
                            <View style={styles.paymentItemLeft}>
                                <Image source={require('../assets/truemoney_logo.png')} style={styles.paymentLogo} resizeMode="contain" />
                                <Text style={styles.paymentItemText}>{t['payTrueMoney'] || "TrueMoney"}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={20} color="#ccc" />
                        </TouchableOpacity>

                        {/* Credit/Debit Card */}
                        <TouchableOpacity
                            style={[styles.paymentItem, { borderColor: '#6366F1' }]}
                            onPress={() => Alert.alert(t['comingSoon'] || "Soon", t['cardPaymentSoon'] || "Credit card payment is coming soon.")}
                        >
                            <View style={styles.paymentItemLeft}>
                                <View style={[styles.paymentIconBase, { backgroundColor: '#EEF2FF' }]}>
                                    <Ionicons name="card-outline" size={22} color="#6366F1" />
                                </View>
                                <Text style={styles.paymentItemText}>{t['payCard'] || "Credit/Debit Card"}</Text>
                            </View>
                            <Text style={styles.soonBadge}>Soon</Text>
                        </TouchableOpacity>

                        {/* Google Pay */}
                        <TouchableOpacity
                            style={[styles.paymentItem, { borderColor: '#E5E7EB' }]}
                            onPress={() => Alert.alert(t['comingSoon'] || "Soon", "Google Pay support is coming soon.")}
                        >
                            <View style={styles.paymentItemLeft}>
                                <View style={[styles.paymentIconBase, { backgroundColor: '#F3F4F6' }]}>
                                    <Ionicons name="logo-google" size={20} color="#1F2937" />
                                </View>
                                <Text style={styles.paymentItemText}>Google Pay</Text>
                            </View>
                            <Text style={styles.soonBadge}>Soon</Text>
                        </TouchableOpacity>

                        {/* Apple Pay */}
                        <TouchableOpacity
                            style={[styles.paymentItem, { borderColor: '#E5E7EB' }]}
                            onPress={() => Alert.alert(t['comingSoon'] || "Soon", "Apple Pay support is coming soon.")}
                        >
                            <View style={styles.paymentItemLeft}>
                                <View style={[styles.paymentIconBase, { backgroundColor: '#F3F4F6' }]}>
                                    <Ionicons name="logo-apple" size={22} color="#000" />
                                </View>
                                <Text style={styles.paymentItemText}>Apple Pay</Text>
                            </View>
                            <Text style={styles.soonBadge}>Soon</Text>
                        </TouchableOpacity>

                        {/* Dev Free (Hidden or conditional) */}
                        <TouchableOpacity
                            style={[styles.paymentItem, { borderColor: '#000', marginTop: 20, borderStyle: 'dashed' }, !currentUser && { opacity: 0.5 }]}
                            onPress={() => handlePlaceOrder('DEV_FREE')}
                            disabled={isCreatingOrder || !currentUser}
                        >
                            <View style={styles.paymentItemLeft}>
                                <View style={[styles.paymentIconBase, { backgroundColor: '#F3F4F6' }]}>
                                    <Ionicons name="flask-outline" size={20} color="#000" />
                                </View>
                                <Text style={styles.paymentItemText}>{t['payFreeDev'] || "Free (Developer Only)"}</Text>
                            </View>
                            {isCreatingOrder ? <ActivityIndicator size="small" color="#000" /> : <Ionicons name="chevron-forward" size={20} color="#ccc" />}
                        </TouchableOpacity>
                    </View>

                </View>
            </ScrollView>

            <PromptPayModal visible={showPromptPay} onClose={() => setShowPromptPay(false)} />
            <TrueMoneyModal visible={showTrueMoney} onClose={() => setShowTrueMoney(false)} />

        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    header: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
    backBtn: { padding: 4 },
    headerTitle: { flex: 1, textAlign: 'center', fontWeight: '700', fontSize: 16 },
    content: { padding: 20 },
    stepContainer: { maxWidth: 500, alignSelf: 'center', width: '100%' },

    formSection: { marginBottom: 32 },
    sectionTitle: { fontSize: 13, color: '#999', fontWeight: '700', marginBottom: 15, textTransform: 'uppercase' },
    input: { width: '100%', height: 50, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', paddingHorizontal: 16, marginBottom: 12, fontSize: 15, backgroundColor: '#fff' },
    readOnlyInput: { backgroundColor: '#f9fafb', justifyContent: 'center' },
    row: { flexDirection: 'row' },

    paymentSection: { marginBottom: 32 },
    promoSection: { marginBottom: 24 },
    promoInputRow: { flexDirection: 'row', alignItems: 'center' },
    promoApplyBtn: { height: 50, backgroundColor: '#000', borderRadius: 12, marginLeft: 8, paddingHorizontal: 20, justifyContent: 'center' },
    promoApplyText: { color: '#fff', fontWeight: '700' },
    promoSuccessText: { color: colors.primary, fontSize: 13, marginTop: 8, fontWeight: '600' },

    summarySection: { marginBottom: 32, padding: 16, backgroundColor: '#f9fafb', borderRadius: 16 },
    summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
    summaryLabel: { color: '#666', fontSize: 14 },
    summaryValue: { fontWeight: '600', fontSize: 14 },
    totalLabel: { fontWeight: '700', fontSize: 16 },
    totalValue: { fontWeight: '800', fontSize: 18 },

    paymentActions: { marginBottom: 40 },
    paymentItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        backgroundColor: '#fff',
        borderRadius: 16,
        borderWidth: 1.5,
        marginBottom: 12,
        ...shadows.sm,
    },
    paymentItemLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    paymentLogo: {
        width: 32,
        height: 32,
        marginRight: 12,
    },
    paymentIconBase: {
        width: 32,
        height: 32,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    paymentItemText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#111',
    },
    soonBadge: {
        fontSize: 12,
        fontWeight: '700',
        color: '#9CA3AF',
        backgroundColor: '#F3F4F6',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    paymentBtn: { width: '100%', height: 56, borderRadius: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 12, shadowColor: "#000", shadowOpacity: 0.1, shadowOffset: { width: 0, height: 4 }, shadowRadius: 10 },
    paymentBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

    // Auth Block Styles
    authBlockContainer: { marginBottom: 32 },
    loggedInBox: { backgroundColor: '#D9ECFF', padding: 16, borderRadius: 14, alignItems: 'center' },
    loggedInText: { fontSize: 15, fontWeight: '600', color: '#003a70' },
    signOutLink: { marginTop: 8, textDecorationLine: 'underline', color: '#666', opacity: 0.8 },
    loggedOutBox: { backgroundColor: '#FFF3CD', padding: 16, borderRadius: 14, alignItems: 'center' },
    loggedOutText: { fontSize: 14, color: '#856404', opacity: 0.8, marginBottom: 12 },
    signInBtn: { backgroundColor: '#111', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 12 },
    signInBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
