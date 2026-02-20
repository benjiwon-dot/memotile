// src/screens/CheckoutStepTwoScreen.tsx
import React, { useState, useEffect } from "react";
import {
    View,
    Text,
    TextInput,
    ScrollView,
    TouchableOpacity,
    StyleSheet,
    Image,
    Alert,
    ActivityIndicator,
    Platform,
    Keyboard,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

// ⚠️ 앱 전용 라이브러리 (웹에서는 렌더링 차단)
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import PromptPayModal from "../components/payments/PromptPayModal";
import TrueMoneyModal from "../components/payments/TrueMoneyModal";

import { usePhoto } from "../context/PhotoContext";
import { useLanguage } from "../context/LanguageContext";
import { colors } from "../theme/colors";
import { shadows } from "../theme/shadows";

import { auth, db } from "../lib/firebase";
import { User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { createDevOrder } from "../services/orders";
import { validatePromo, PromoResult } from "../services/promo";

const GOOGLE_PLACES_API_KEY = "AIzaSyD4ZkAp0yIRpi4IkHCFRtJZrP6koLKMS0s";

export default function CheckoutStepTwoScreen() {
    const router = useRouter();

    const { photos = [], clearDraft = async () => { }, clearPhotos = () => { } } = usePhoto() || {};
    const { t, locale } = useLanguage() || {};

    const [formData, setFormData] = useState({
        fullName: "",
        addressLine1: "",
        addressLine2: "",
        city: "",
        state: "",
        postalCode: "",
        phone: "",
        email: "",
        instagram: "",
    });

    const [currentUser, setCurrentUser] = useState<User | null>(auth?.currentUser || null);
    const [isLoadingAddress, setIsLoadingAddress] = useState(false);

    useEffect(() => {
        if (!auth) return;
        const unsub = auth.onAuthStateChanged((user) => {
            setCurrentUser(user);
            if (user) loadSavedAddress(user.uid);
        });
        return unsub;
    }, []);

    const loadSavedAddress = async (uid: string) => {
        try {
            setIsLoadingAddress(true);
            const userDoc = await getDoc(doc(db, "users", uid));
            if (userDoc.exists()) {
                const data = userDoc.data();
                if (data.defaultAddress) {
                    setFormData(prev => ({
                        ...prev,
                        ...data.defaultAddress,
                        instagram: data.instagram || prev.instagram,
                        email: data.defaultAddress.email || auth.currentUser?.email || ""
                    }));
                } else if (auth.currentUser?.email) {
                    setFormData(prev => ({ ...prev, email: auth.currentUser?.email || "" }));
                }
            }
        } catch (e) {
            console.error("[Checkout] Failed to load saved address:", e);
        } finally {
            setIsLoadingAddress(false);
        }
    };

    const handleInputChange = (field: string, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const fillAddressFromGoogle = (details: any) => {
        if (!details || !details.address_components) return;

        let streetNumber = "", route = "", subLocality = "", locality = "", adminArea = "", postalCode = "";

        details.address_components.forEach((component: any) => {
            const types = component?.types || [];
            if (types.includes("street_number")) streetNumber = component.long_name;
            if (types.includes("route")) route = component.long_name;
            if (types.includes("sublocality") || types.includes("sublocality_level_1")) subLocality = component.long_name;
            if (types.includes("locality") || types.includes("administrative_area_level_2")) locality = component.long_name;
            if (types.includes("administrative_area_level_1")) adminArea = component.long_name;
            if (types.includes("postal_code")) postalCode = component.long_name;
        });

        setFormData(prev => ({
            ...prev,
            addressLine1: `${streetNumber} ${route}`.trim() || details.formatted_address || "",
            addressLine2: subLocality,
            city: locality,
            state: adminArea,
            postalCode: postalCode,
        }));
        Keyboard.dismiss();
    };

    const [promoCode, setPromoCode] = useState("");
    const [promoResult, setPromoResult] = useState<PromoResult | null>(null);
    const [isApplyingPromo, setIsApplyingPromo] = useState(false);

    const [showPromptPay, setShowPromptPay] = useState(false);
    const [showTrueMoney, setShowTrueMoney] = useState(false);
    const [isCreatingOrder, setIsCreatingOrder] = useState(false);

    const safeLocale = locale || "EN";
    const PRICE_PER_TILE = safeLocale === "TH" ? 200 : 6.45;
    const CURRENCY_SYMBOL = safeLocale === "TH" ? "฿" : "$";

    const safePhotosCount = Array.isArray(photos) ? photos.length : 0;
    const subtotal = safePhotosCount * PRICE_PER_TILE;
    const discount = promoResult?.discountAmount || 0;
    const shippingFee = 0;
    const total = Math.max(0, (subtotal || 0) - (discount || 0) + shippingFee);

    const handleApplyPromo = async () => {
        if (!promoCode) return;
        setIsApplyingPromo(true);
        try {
            const res = await validatePromo(promoCode, currentUser?.uid || "anon", subtotal);
            setPromoResult(res);
            if (!res.success) {
                Alert.alert("Promo", (t as any)?.[res.error || "promoInvalid"] || res.error || "Invalid promo.");
            }
        } catch (e) {
            Alert.alert("Promo", "Failed to validate promo.");
        } finally {
            setIsApplyingPromo(false);
        }
    };

    const ensureTokenReady = async (u: User) => {
        try {
            await u.getIdToken(true);
            await new Promise((r) => setTimeout(r, 50));
            return true;
        } catch (e) {
            console.error("[Checkout] getIdToken failed", e);
            return false;
        }
    };

    const validateEmail = (email: string) => {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    };

    const validateShipping = () => {
        if (!currentUser) {
            Alert.alert("Login", "Please login to place an order.");
            router.push("/auth/email");
            return false;
        }
        if (!formData.fullName || !formData.addressLine1 || !formData.city || !formData.phone || !formData.email) {
            Alert.alert("Shipping", (t as any)?.["alertFillShipping"] || "Please fill in all required shipping fields.");
            return false;
        }
        if (!validateEmail(formData.email)) {
            Alert.alert("Invalid Email", "Please enter a valid email address.");
            return false;
        }
        if (formData.phone.length < 9) {
            Alert.alert("Invalid Phone", "Please enter a valid phone number.");
            return false;
        }
        return true;
    };

    const handlePlaceOrder = async (provider: "DEV_FREE" | "PROMPT_PAY" | "TRUEMONEY" | "PROMO_FREE") => {
        const user = currentUser;

        if (!validateShipping()) return;

        const ok = await ensureTokenReady(user!);
        if (!ok) {
            Alert.alert("Auth", "Auth token not ready. Please try again.");
            return;
        }

        if (provider === "PROMPT_PAY") {
            setShowPromptPay(true);
            return;
        } else if (provider === "TRUEMONEY") {
            setShowTrueMoney(true);
            return;
        }

        if (isCreatingOrder) return;
        setIsCreatingOrder(true);

        try {
            // ✅ [강력한 보완] 웹과 모바일에서 던지던 예민한 에러를 모두 제거하고 무조건 주문을 생성하도록 유도
            await ensureTokenReady(user!);

            const orderId = await createDevOrder({
                uid: user!.uid,
                shipping: {
                    fullName: formData.fullName,
                    address1: formData.addressLine1,
                    address2: formData.addressLine2,
                    city: formData.city,
                    state: formData.state,
                    postalCode: formData.postalCode,
                    country: "Thailand",
                    phone: formData.phone,
                    email: formData.email,
                },
                totals: { subtotal, discount, shippingFee, total },
                photos: Array.isArray(photos) ? photos : [], // 안전한 배열 전달
                promoCode: promoResult?.success
                    ? {
                        code: promoResult.promoCode!,
                        discountType: promoResult.discountType!,
                        discountValue: promoResult.discountValue!,
                    }
                    : undefined,
                locale,
                instagram: formData.instagram,
            });

            await clearDraft();
            clearPhotos();

            // ✅ 즉시 라우팅 (에러 방지)
            router.replace({ pathname: "/myorder/success", params: { id: orderId } });
        } catch (e: any) {
            console.error("Failed to place order:", e);
            Alert.alert("Order failed", e?.message || "Failed to place order.");
        } finally {
            setIsCreatingOrder(false);
        }
    };

    const handleApplePay = () => {
        if (!validateShipping()) return;
        Alert.alert((t as any)?.["comingSoon"] || "Soon", (t as any)?.["applePaySoon"] || "Apple Pay is coming soon.");
    };

    const handleGooglePay = () => {
        if (!validateShipping()) return;
        Alert.alert((t as any)?.["comingSoon"] || "Soon", (t as any)?.["googlePaySoon"] || "Google Pay is coming soon.");
    };

    const instaPlaceholder = safeLocale === "TH"
        ? "Instagram ID (รับคูปองส่วนลดพิเศษ!)"
        : "Instagram ID (Get Free Coupons!)";

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color="black" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{(t as any)?.["checkoutTitle"] || "Checkout"}</Text>
                <View style={{ width: 40 }}>
                    {isLoadingAddress && <ActivityIndicator size="small" color={colors?.ink || "#000"} />}
                </View>
            </View>

            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" nestedScrollEnabled={true}>
                <View style={styles.stepContainer}>
                    <View style={styles.formSection}>
                        <Text style={styles.sectionTitle}>{(t as any)?.["shippingAddressTitle"] || "SHIPPING ADDRESS"}</Text>

                        <TextInput
                            placeholder={`${(t as any)?.["fullName"] || "Full Name"} *`}
                            style={styles.input}
                            value={formData.fullName}
                            onChangeText={(v) => handleInputChange("fullName", v)}
                        />

                        {Platform.OS === 'web' ? (
                            <TextInput
                                placeholder={(t as any)?.["streetAddress"] || "Street Address *"}
                                style={styles.input}
                                value={formData.addressLine1}
                                onChangeText={(v) => handleInputChange("addressLine1", v)}
                            />
                        ) : (
                            <View style={{ marginBottom: 12, zIndex: 5000 }}>
                                <GooglePlacesAutocomplete
                                    placeholder={(t as any)?.["streetAddress"] || "Search Address *"}
                                    fetchDetails={true}
                                    onPress={(data, details = null) => fillAddressFromGoogle(details)}
                                    query={{ key: GOOGLE_PLACES_API_KEY, language: safeLocale === 'TH' ? 'th' : 'en' }}
                                    disableScroll={true} listProps={{ scrollEnabled: false }}
                                    textInputProps={{ value: formData.addressLine1 || "", onChangeText: (text) => handleInputChange("addressLine1", text), placeholderTextColor: "#C7C7CD" }}
                                    styles={{
                                        textInputContainer: { width: '100%', backgroundColor: 'transparent' },
                                        textInput: { height: 50, color: '#000', fontSize: 15, borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", paddingHorizontal: 16, backgroundColor: "#fff" },
                                        listView: { position: 'absolute', top: 55, width: '100%', backgroundColor: 'white', borderRadius: 12, elevation: 5, zIndex: 9999, borderWidth: 1, borderColor: '#E5E7EB' },
                                        row: { padding: 13, height: 48, flexDirection: 'row' }, separator: { height: 0.5, backgroundColor: '#E5E7EB' },
                                    }}
                                    enablePoweredByContainer={false} fields={['address_components', 'formatted_address', 'geometry']}
                                />
                            </View>
                        )}

                        <TextInput placeholder={`${(t as any)?.["address2"] || "Apartment, suite, etc."} ${(t as any)?.["optionalSuffix"] || "(optional)"}`} style={styles.input} value={formData.addressLine2} onChangeText={(v) => handleInputChange("addressLine2", v)} />
                        <View style={styles.row}>
                            <TextInput placeholder={`${(t as any)?.["city"] || "City"} *`} style={[styles.input, { flex: 1, marginRight: 8 }]} value={formData.city} onChangeText={(v) => handleInputChange("city", v)} />
                            <TextInput placeholder={`${(t as any)?.["stateProv"] || "State"} *`} style={[styles.input, { flex: 1 }]} value={formData.state} onChangeText={(v) => handleInputChange("state", v)} />
                        </View>
                        <View style={styles.row}>
                            <TextInput placeholder={`${(t as any)?.["zipCode"] || "Zip Code"} *`} style={[styles.input, { flex: 1, marginRight: 8 }]} value={formData.postalCode} keyboardType="numeric" onChangeText={(v) => handleInputChange("postalCode", v)} />
                            <View style={[styles.input, styles.readOnlyInput, { flex: 1 }]}><Text style={{ color: "#666" }}>{(t as any)?.["thailand"] || "Thailand"}</Text></View>
                        </View>
                        <TextInput placeholder={`${(t as any)?.["phoneNumber"] || "Phone"} *`} style={styles.input} value={formData.phone} keyboardType="phone-pad" onChangeText={(v) => handleInputChange("phone", v)} />
                        <TextInput placeholder={`${(t as any)?.["emailAddress"] || "Email"} *`} style={styles.input} value={formData.email} keyboardType="email-address" autoCapitalize="none" onChangeText={(v) => handleInputChange("email", v)} />

                        <View style={styles.instagramInputContainer}>
                            <View style={styles.instagramIconBox}><Ionicons name="logo-instagram" size={22} color="#E4405F" /></View>
                            <TextInput placeholder={instaPlaceholder} style={[styles.input, { flex: 1, marginBottom: 0, borderWidth: 0 }]} value={formData.instagram} autoCapitalize="none" onChangeText={(v) => handleInputChange("instagram", v)} />
                        </View>
                        <Text style={styles.marketingHint}>{safeLocale === 'TH' ? '🎁 ติดตามเราเพื่อรับรางวัลและส่วนลดพิเศษ' : '🎁 Follow us for exclusive rewards & discounts'}</Text>
                    </View>

                    <View style={styles.promoSection}>
                        <Text style={styles.sectionTitle}>{(t as any)?.["promoHaveCode"] || "PROMO CODE"}</Text>
                        <View style={styles.promoInputRow}>
                            <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder={(t as any)?.["promoEnterCode"]} value={promoCode} onChangeText={setPromoCode} autoCapitalize="characters" />
                            <TouchableOpacity style={[styles.promoApplyBtn, isApplyingPromo && { opacity: 0.7 }]} onPress={handleApplyPromo} disabled={isApplyingPromo}>
                                {isApplyingPromo ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.promoApplyText}>{(t as any)?.["promoApply"]}</Text>}
                            </TouchableOpacity>
                        </View>
                        {promoResult?.success && <Text style={styles.promoSuccessText}>{(t as any)?.["promoApplied"]}: {promoResult.promoCode}</Text>}
                    </View>

                    <View style={styles.summarySection}>
                        <View style={styles.summaryRow}><Text style={styles.summaryLabel}>{(t as any)?.["subtotalLabel"] || "Subtotal"}</Text><Text style={styles.summaryValue}>{CURRENCY_SYMBOL}{subtotal.toFixed(2)}</Text></View>
                        {discount > 0 && <View style={styles.summaryRow}><Text style={[styles.summaryLabel, { color: colors?.primary || "#E4405F" }]}>{(t as any)?.["discountLabel"] || "Discount"}</Text><Text style={[styles.summaryValue, { color: colors?.primary || "#E4405F" }]}>-{CURRENCY_SYMBOL}{discount.toFixed(2)}</Text></View>}
                        <View style={[styles.summaryRow, { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#f3f4f6" }]}><Text style={styles.totalLabel}>{(t as any)?.["totalLabel"] || "Total"}</Text><Text style={styles.totalValue}>{CURRENCY_SYMBOL}{total.toFixed(2)}</Text></View>
                    </View>

                    <View style={styles.authBlockContainer}>
                        {currentUser ? (
                            <View style={styles.loggedInBox}><Text style={styles.loggedInText}>{(t as any)?.["loggedInAs"] || "Logged in as"} {currentUser.email}</Text></View>
                        ) : (
                            <View style={styles.loggedOutBox}>
                                <Text style={styles.loggedOutText}>{(t as any)?.["signInToContinue"] || "Please sign in to continue."}</Text>
                                <TouchableOpacity style={styles.signInBtn} onPress={() => router.push("/auth/email")}><Text style={styles.signInBtnText}>{(t as any)?.["signIn"] || "Sign In"}</Text></TouchableOpacity>
                            </View>
                        )}
                    </View>

                    <View style={styles.paymentSection}>
                        <Text style={styles.sectionTitle}>{(t as any)?.["paymentMethodLabel"] || "Payment Method"}</Text>

                        {/* PromptPay */}
                        <TouchableOpacity style={[styles.paymentItem, { borderColor: "#003a70" }, !currentUser && { opacity: 0.5 }]} onPress={() => handlePlaceOrder("PROMPT_PAY")} disabled={!currentUser || isCreatingOrder}>
                            <View style={styles.paymentItemLeft}>
                                <Image source={require("../assets/promptpay_logo.png")} style={styles.paymentLogo} resizeMode="contain" />
                                <Text style={styles.paymentItemText}>{(t as any)?.["payPromptPay"] || "PromptPay"}</Text>
                            </View>
                            {Platform.OS === 'web' ? <Text style={styles.soonBadge}>Soon</Text> : <Ionicons name="chevron-forward" size={20} color="#ccc" />}
                        </TouchableOpacity>

                        {/* TrueMoney */}
                        <TouchableOpacity style={[styles.paymentItem, { borderColor: "#FF6F00" }, !currentUser && { opacity: 0.5 }]} onPress={() => handlePlaceOrder("TRUEMONEY")} disabled={!currentUser || isCreatingOrder}>
                            <View style={styles.paymentItemLeft}>
                                <Image source={require("../assets/truemoney_logo.png")} style={styles.paymentLogo} resizeMode="contain" />
                                <Text style={styles.paymentItemText}>{(t as any)?.["payTrueMoney"] || "TrueMoney"}</Text>
                            </View>
                            {Platform.OS === 'web' ? <Text style={styles.soonBadge}>Soon</Text> : <Ionicons name="chevron-forward" size={20} color="#ccc" />}
                        </TouchableOpacity>

                        {/* Google Pay */}
                        <TouchableOpacity style={[styles.paymentItem, { borderColor: "#111" }, !currentUser && { opacity: 0.5 }]} onPress={handleGooglePay} disabled={!currentUser || isCreatingOrder}>
                            <View style={styles.paymentItemLeft}>
                                <View style={[styles.paymentIconBase, { backgroundColor: "#F3F4F6" }]}><Ionicons name="logo-google" size={20} color="#111" /></View>
                                <Text style={styles.paymentItemText}>{(t as any)?.["payGooglePay"] || "Google Pay"}</Text>
                            </View>
                            <Text style={styles.soonBadge}>Soon</Text>
                        </TouchableOpacity>

                        {/* Apple Pay */}
                        {(Platform.OS === "ios" || Platform.OS === "web") && (
                            <TouchableOpacity style={[styles.paymentItem, { borderColor: "#111" }, !currentUser && { opacity: 0.5 }]} onPress={handleApplePay} disabled={!currentUser || isCreatingOrder}>
                                <View style={styles.paymentItemLeft}>
                                    <View style={[styles.paymentIconBase, { backgroundColor: "#F3F4F6" }]}><Ionicons name="logo-apple" size={20} color="#111" /></View>
                                    <Text style={styles.paymentItemText}>{(t as any)?.["payApplePay"] || "Apple Pay"}</Text>
                                </View>
                                <Text style={styles.soonBadge}>Soon</Text>
                            </TouchableOpacity>
                        )}

                        {/* Credit Card */}
                        <TouchableOpacity style={[styles.paymentItem, { borderColor: "#6366F1" }]} onPress={() => Alert.alert((t as any)?.["comingSoon"] || "Soon", (t as any)?.["cardPaymentSoon"] || "Credit card payment is coming soon.")} disabled={isCreatingOrder}>
                            <View style={styles.paymentItemLeft}>
                                <View style={[styles.paymentIconBase, { backgroundColor: "#EEF2FF" }]}><Ionicons name="card-outline" size={22} color="#6366F1" /></View>
                                <Text style={styles.paymentItemText}>{(t as any)?.["payCard"] || "Credit/Debit Card"}</Text>
                            </View>
                            <Text style={styles.soonBadge}>Soon</Text>
                        </TouchableOpacity>

                        {/* ✅ Test Free Order 버튼 (무조건 작동) */}
                        <TouchableOpacity style={[styles.paymentItem, { borderColor: "#10B981", borderStyle: 'dashed', marginTop: 20 }]} onPress={() => handlePlaceOrder("DEV_FREE")} disabled={isCreatingOrder || !currentUser}>
                            <View style={styles.paymentItemLeft}>
                                <View style={[styles.paymentIconBase, { backgroundColor: "#D1FAE5" }]}><Ionicons name="flask" size={20} color="#10B981" /></View>
                                <Text style={[styles.paymentItemText, { color: "#059669" }]}>[Dev] Test Free Order</Text>
                            </View>
                            {isCreatingOrder ? <ActivityIndicator size="small" color="#10B981" /> : <Ionicons name="chevron-forward" size={20} color="#10B981" />}
                        </TouchableOpacity>
                    </View>
                </View>
            </ScrollView>

            {Platform.OS !== 'web' && showPromptPay && <PromptPayModal visible={showPromptPay} onClose={() => setShowPromptPay(false)} />}
            {Platform.OS !== 'web' && showTrueMoney && <TrueMoneyModal visible={showTrueMoney} onClose={() => setShowTrueMoney(false)} />}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#fff" },
    header: { flexDirection: "row", alignItems: "center", padding: 12, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
    backBtn: { padding: 4 },
    headerTitle: { flex: 1, textAlign: "center", fontWeight: "700", fontSize: 16 },
    content: { padding: 20 },
    stepContainer: { maxWidth: 500, alignSelf: "center", width: "100%" },
    formSection: { marginBottom: 32 },
    sectionTitle: { fontSize: 13, color: "#999", fontWeight: "700", marginBottom: 15, textTransform: "uppercase" },
    input: { width: "100%", height: 50, borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", paddingHorizontal: 16, marginBottom: 12, fontSize: 15, backgroundColor: "#fff" },
    instagramInputContainer: { flexDirection: "row", alignItems: "center", width: "100%", height: 50, borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#fff", overflow: "hidden" },
    instagramIconBox: { paddingLeft: 14, paddingRight: 8, height: "100%", justifyContent: "center" },
    marketingHint: { fontSize: 10, color: "#6366F1", fontWeight: "bold", marginLeft: 4, marginTop: 4, marginBottom: 16 },
    readOnlyInput: { backgroundColor: "#f9fafb", justifyContent: "center" },
    row: { flexDirection: "row" },
    promoSection: { marginBottom: 24 },
    promoInputRow: { flexDirection: "row", alignItems: "center" },
    promoApplyBtn: { height: 50, backgroundColor: "#000", borderRadius: 12, marginLeft: 8, paddingHorizontal: 20, justifyContent: "center" },
    promoApplyText: { color: "#fff", fontWeight: "700" },
    promoSuccessText: { color: colors?.primary || "#E4405F", fontSize: 13, marginTop: 8, fontWeight: "600" },
    summarySection: { marginBottom: 32, padding: 16, backgroundColor: "#f9fafb", borderRadius: 16 },
    summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
    summaryLabel: { color: "#666", fontSize: 14 },
    summaryValue: { fontWeight: "600", fontSize: 14 },
    totalLabel: { fontWeight: "700", fontSize: 16 },
    totalValue: { fontWeight: "800", fontSize: 18 },
    authBlockContainer: { marginBottom: 32 },
    loggedInBox: { backgroundColor: "#D9ECFF", padding: 16, borderRadius: 14, alignItems: "center" },
    loggedInText: { fontSize: 15, fontWeight: "600", color: "#003a70" },
    loggedOutBox: { backgroundColor: "#FFF3CD", padding: 16, borderRadius: 14, alignItems: "center" },
    loggedOutText: { fontSize: 14, color: "#856404", opacity: 0.8, marginBottom: 12 },
    signInBtn: { backgroundColor: "#111", paddingHorizontal: 24, paddingVertical: 10, borderRadius: 12 },
    signInBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
    paymentSection: { marginBottom: 32 },
    paymentItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, backgroundColor: "#fff", borderRadius: 16, borderWidth: 1.5, marginBottom: 12, ...(shadows?.sm || {}) },
    paymentItemLeft: { flexDirection: "row", alignItems: "center" },
    paymentLogo: { width: 32, height: 32, marginRight: 12 },
    paymentIconBase: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", marginRight: 12 },
    paymentItemText: { fontSize: 16, fontWeight: "600", color: "#111" },
    soonBadge: { fontSize: 12, fontWeight: "700", color: "#9CA3AF", backgroundColor: "#F3F4F6", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
});