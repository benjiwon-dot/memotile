// src/screens/CheckoutStepTwoScreen.tsx
import React, { useState, useEffect, useRef, useMemo } from "react";
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
    Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import * as WebBrowser from "expo-web-browser";
import * as Linking from 'expo-linking';

// ⚠️ 앱 전용 라이브러리 (웹에서는 렌더링 차단)
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';

import { usePhoto } from "../context/PhotoContext";
import { useLanguage } from "../context/LanguageContext";
import { colors } from "../theme/colors";
import { shadows } from "../theme/shadows";

import { auth, db } from "../lib/firebase";
import { User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { createDevOrder } from "../services/orders";
import { validatePromo, PromoResult } from "../services/promo";

// ✨ Firebase Functions 연동 및 ExportQueue 가져오기
import { getApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import { exportQueue } from "../utils/exportQueue"; // ⭐️ 필수 추가

const GOOGLE_PLACES_API_KEY = "AIzaSyD4ZkAp0yIRpi4IkHCFRtJZrP6koLKMS0s";

export default function CheckoutStepTwoScreen() {
    const router = useRouter();
    const scrollViewRef = useRef<ScrollView>(null);

    const { photos = [], clearDraft = async () => { }, clearPhotos = () => { } } = usePhoto() || {};
    const { t, locale } = useLanguage() || {};

    const safePhotos = useMemo(() => {
        if (Platform.OS === 'web' && (!photos || photos.length === 0)) {
            return [{
                uri: "https://via.placeholder.com/300?text=Paymentwall+Test",
                quantity: 1
            }];
        }
        return photos || [];
    }, [photos]);

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

    const [errors, setErrors] = useState({
        fullName: false,
        addressLine1: false,
        city: false,
        state: false,
        postalCode: false,
        phone: false,
        email: false,
        emailFormat: false,
    });

    const [formErrorMsg, setFormErrorMsg] = useState<string | null>(null);
    const [isAgreed, setIsAgreed] = useState(false);

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

    const handleInputChange = (field: keyof typeof formData, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        if (errors[field as keyof typeof errors]) {
            setErrors((prev) => ({ ...prev, [field]: false }));
            setFormErrorMsg(null);
        }
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
        setErrors((prev) => ({ ...prev, addressLine1: false, city: false, state: false, postalCode: false }));
        setFormErrorMsg(null);
        Keyboard.dismiss();
    };

    const [promoCode, setPromoCode] = useState("");
    const [promoResult, setPromoResult] = useState<PromoResult | null>(null);
    const [isApplyingPromo, setIsApplyingPromo] = useState(false);

    const [isCreatingOrder, setIsCreatingOrder] = useState(false);

    const safeLocale = locale || "EN";

    const PRICE_PER_TILE = safeLocale === "TH" ? 200 : 6.45;
    const CURRENCY_SYMBOL = safeLocale === "TH" ? "฿" : "$";
    const BASE_PRICE_USD = 6.45;

    const safePhotosCount = Array.isArray(safePhotos) ? safePhotos.length : 0;

    const subtotal = safePhotosCount * PRICE_PER_TILE;
    const discount = promoResult?.discountAmount || 0;
    const shippingFee = 0;
    const total = Math.max(0, (subtotal || 0) - (discount || 0) + shippingFee);

    const subtotalUSD = safePhotosCount * BASE_PRICE_USD;
    const discountUSD = promoResult?.success ? subtotalUSD : 0;
    const totalInUSD = Math.max(0, subtotalUSD - discountUSD);

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
            Alert.alert("Login", (t as any)?.["auth.loginRequired"] || "Please login to place an order.");
            router.push("/auth/email");
            return false;
        }

        let isValid = true;
        let newErrors = { fullName: false, addressLine1: false, city: false, state: false, postalCode: false, phone: false, email: false, emailFormat: false };

        if (!formData.fullName.trim()) { newErrors.fullName = true; isValid = false; }
        if (!formData.addressLine1.trim()) { newErrors.addressLine1 = true; isValid = false; }
        if (!formData.city.trim()) { newErrors.city = true; isValid = false; }
        if (!formData.state.trim()) { newErrors.state = true; isValid = false; }
        if (!formData.postalCode.trim()) { newErrors.postalCode = true; isValid = false; }
        if (!formData.phone.trim()) { newErrors.phone = true; isValid = false; }

        if (!formData.email.trim()) {
            newErrors.email = true;
            isValid = false;
        } else if (!validateEmail(formData.email)) {
            newErrors.email = true;
            newErrors.emailFormat = true;
            isValid = false;
        }

        setErrors(newErrors);

        if (!isValid) {
            let msg = (t as any)?.["alertFillShipping"] || "Please fill in all required shipping fields marked with *.";
            if (newErrors.emailFormat) msg = (t as any)?.["auth.invalidEmail"] || "Please enter a valid email address format.";
            else if (newErrors.phone && formData.phone.length > 0 && formData.phone.length < 9) msg = "Please enter a valid phone number (min 9 digits).";

            setFormErrorMsg(msg);
            scrollViewRef.current?.scrollTo({ y: 0, animated: true });

            if (Platform.OS !== 'web') {
                Alert.alert("Required Fields", msg);
            }
            return false;
        }

        if (!isAgreed) {
            let msg = (t as any)?.["agreeTermsAlert"] || "Please agree to the Terms of Service to proceed.";
            setFormErrorMsg(msg);
            scrollViewRef.current?.scrollToEnd({ animated: true });

            if (Platform.OS !== 'web') {
                Alert.alert((t as any)?.["required"] || "Agreement Required", msg);
            }
            return false;
        }

        setFormErrorMsg(null);
        return true;
    };

    const requestPayletterPayment = async (orderId: string, method: string) => {
        try {
            let pgcode = "PLCreditCard";
            const functions = getFunctions(getApp(), "us-central1");
            const requestPayment = httpsCallable(functions, "payletterRequestPayment");

            const appScheme = Linking.createURL('');
            const webUrl = Platform.OS === 'web' ? `${window.location.origin}/myorder/success?id=${orderId}` : '';

            const response: any = await requestPayment({
                orderId,
                amount: totalInUSD,
                email: formData.email,
                pgcode: pgcode,
                platform: Platform.OS,
                webUrl: webUrl,
                appScheme: appScheme
            });

            const paymentUrl = response.data.paymentUrl;

            if (Platform.OS === 'web') {
                window.location.href = paymentUrl;
            } else {
                const alertTitle = (t as any)?.["paymentRedirectTitle"] || "Redirecting to Payment";
                const alertMessage = (t as any)?.["paymentRedirectMsg"] || "You will be redirected to a secure payment page. Please do not close the window until the process is complete.";
                const cancelText = (t as any)?.["cancel"] || "Cancel";
                const confirmText = (t as any)?.["confirm"] || "OK";

                Alert.alert(
                    alertTitle,
                    alertMessage,
                    [
                        {
                            text: cancelText,
                            style: "cancel",
                            onPress: () => setIsCreatingOrder(false)
                        },
                        {
                            text: confirmText,
                            onPress: async () => {
                                await WebBrowser.openBrowserAsync(paymentUrl);
                                try {
                                    const orderSnap = await getDoc(doc(db, "orders", orderId));
                                    const orderData = orderSnap.data();

                                    if (orderData?.status === 'paid') {
                                        await clearDraft();
                                        clearPhotos();
                                        router.replace({ pathname: "/myorder/success", params: { id: orderId } });
                                    } else {
                                        setIsCreatingOrder(false);
                                        Alert.alert(
                                            (t as any)?.["paymentCanceledTitle"] || "Payment Canceled",
                                            (t as any)?.["paymentCanceledMsg"] || "Your payment was canceled. Please try again."
                                        );
                                    }
                                } catch (e) {
                                    setIsCreatingOrder(false);
                                }
                            }
                        }
                    ]
                );
            }
        } catch (error: any) {
            console.error("Payletter request error:", error);
            setIsCreatingOrder(false);
            const errorTitle = (t as any)?.["paymentError"] || "Payment Error";
            Alert.alert(errorTitle, error.message || "An error occurred while preparing the payment.");
        }
    };

    const handlePlaceOrder = async (provider: "DEV_FREE" | "RABBIT_LINE_PAY" | "TRUEMONEY" | "PROMO_FREE" | "CREDIT_CARD") => {
        Keyboard.dismiss();

        if (provider === "TRUEMONEY" || provider === "RABBIT_LINE_PAY") {
            const title = (t as any)?.["comingSoon"] || "Coming Soon";
            const msg = provider === "TRUEMONEY"
                ? ((t as any)?.["trueMoneySoon"] || "TrueMoney payment is coming soon.")
                : ((t as any)?.["rabbitLinePaySoon"] || "Rabbit LINE Pay is coming soon.");

            if (Platform.OS === 'web') {
                window.alert(`${title}\n\n${msg}`);
            } else {
                Alert.alert(title, msg);
            }
            return;
        }

        const user = currentUser;

        if (!validateShipping()) return;

        const ok = await ensureTokenReady(user!);
        if (!ok) {
            Alert.alert("Auth", "Auth token not ready. Please try again.");
            return;
        }

        if (isCreatingOrder) return;

        // ⭐️ [로딩 시작] 결제 프로세스 시작
        setIsCreatingOrder(true);

        try {
            // ⭐️ [핵심 UX 개선] 백그라운드 이미지 작업 대기
            await exportQueue.waitForIdle(60000);

            await ensureTokenReady(user!);

            const CURRENCY_CODE = safeLocale === "TH" ? "THB" : "USD";

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
                photos: Array.isArray(safePhotos) ? safePhotos : [],
                promoCode: promoResult?.success
                    ? {
                        code: promoResult.promoCode!,
                        discountType: promoResult.discountType!,
                        discountValue: promoResult.discountValue!,
                    }
                    : undefined,
                locale,
                currency: CURRENCY_CODE,
                instagram: formData.instagram,
            });

            if (provider === "DEV_FREE" || provider === "PROMO_FREE") {
                await clearDraft();
                clearPhotos();
                router.replace({ pathname: "/myorder/success", params: { id: orderId } });
            } else {
                await requestPayletterPayment(orderId, provider);
            }

        } catch (e: any) {
            console.error("Failed to place order:", e);
            setIsCreatingOrder(false);
            Alert.alert("Order failed", e?.message || "Failed to place order.");
        }
    };

    const instaPlaceholder = (t as any)?.["instaPlaceholder"] || "Instagram ID (Get free coupons!)";

    const getCleanCardName = () => {
        const originalName = (t as any)?.["payCard"] || "Credit/Debit Card";
        return originalName.replace(" (Visa, Master)", "");
    };

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

            <ScrollView
                ref={scrollViewRef}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled={true}
                onScrollBeginDrag={() => Keyboard.dismiss()}
            >
                <View style={styles.stepContainer}>
                    <View style={styles.formSection}>
                        <Text style={styles.sectionTitle}>{(t as any)?.["shippingAddressTitle"] || "SHIPPING ADDRESS"}</Text>

                        {formErrorMsg && (
                            <View style={styles.errorBox}>
                                <Ionicons name="warning" size={16} color="#B91C1C" />
                                <Text style={styles.errorBoxText}>{formErrorMsg}</Text>
                            </View>
                        )}

                        <TextInput
                            placeholder={`${(t as any)?.["fullName"] || "Full Name"} *`}
                            style={[styles.input, errors.fullName && styles.inputError]}
                            value={formData.fullName}
                            onChangeText={(v) => handleInputChange("fullName", v)}
                        />

                        {Platform.OS === 'web' ? (
                            <TextInput
                                placeholder={(t as any)?.["streetAddress"] || "Street Address *"}
                                style={[styles.input, errors.addressLine1 && styles.inputError]}
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
                                    textInputProps={{
                                        value: formData.addressLine1 || "",
                                        onChangeText: (text) => handleInputChange("addressLine1", text),
                                        placeholderTextColor: "#C7C7CD"
                                    }}
                                    styles={{
                                        textInputContainer: { width: '100%', backgroundColor: 'transparent' },
                                        textInput: [styles.input, { marginBottom: 0 }, errors.addressLine1 && styles.inputError],
                                        listView: { position: 'absolute', top: 55, width: '100%', backgroundColor: 'white', borderRadius: 12, elevation: 5, zIndex: 9999, borderWidth: 1, borderColor: '#E5E7EB' },
                                        row: { padding: 13, height: 48, flexDirection: 'row' }, separator: { height: 0.5, backgroundColor: '#E5E7EB' },
                                    }}
                                    enablePoweredByContainer={false} fields={['address_components', 'formatted_address', 'geometry']}
                                />
                            </View>
                        )}

                        <TextInput
                            placeholder={`${(t as any)?.["address2"] || "Apartment, suite, etc."} ${(t as any)?.["optionalSuffix"] || "(optional)"}`}
                            style={styles.input}
                            value={formData.addressLine2}
                            onChangeText={(v) => handleInputChange("addressLine2", v)}
                        />

                        <View style={styles.row}>
                            <TextInput
                                placeholder={`${(t as any)?.["city"] || "City"} *`}
                                style={[styles.input, { flex: 1, marginRight: 8 }, errors.city && styles.inputError]}
                                value={formData.city}
                                onChangeText={(v) => handleInputChange("city", v)}
                            />
                            <TextInput
                                placeholder={`${(t as any)?.["stateProv"] || "State"} *`}
                                style={[styles.input, { flex: 1 }, errors.state && styles.inputError]}
                                value={formData.state}
                                onChangeText={(v) => handleInputChange("state", v)}
                            />
                        </View>

                        <View style={styles.row}>
                            <TextInput
                                placeholder={`${(t as any)?.["zipCode"] || "Zip Code"} *`}
                                style={[styles.input, { flex: 1, marginRight: 8 }, errors.postalCode && styles.inputError]}
                                value={formData.postalCode}
                                keyboardType="numeric"
                                onChangeText={(v) => handleInputChange("postalCode", v)}
                            />
                            <View style={[styles.input, styles.readOnlyInput, { flex: 1 }]}>
                                <Text style={{ color: "#666" }}>{(t as any)?.["thailand"] || "Thailand"}</Text>
                            </View>
                        </View>

                        <TextInput
                            placeholder={`${(t as any)?.["phoneNumber"] || "Phone"} *`}
                            style={[styles.input, errors.phone && styles.inputError]}
                            value={formData.phone}
                            keyboardType="phone-pad"
                            onChangeText={(v) => handleInputChange("phone", v)}
                        />

                        <TextInput
                            placeholder={`${(t as any)?.["emailAddress"] || "Email"} *`}
                            style={[styles.input, errors.email && styles.inputError]}
                            value={formData.email}
                            keyboardType="email-address"
                            autoCapitalize="none"
                            onChangeText={(v) => handleInputChange("email", v)}
                        />

                        <View style={styles.instagramInputContainer}>
                            <View style={styles.instagramIconBox}><Ionicons name="logo-instagram" size={22} color="#E4405F" /></View>
                            <TextInput placeholder={instaPlaceholder} style={[styles.input, { flex: 1, marginBottom: 0, borderWidth: 0 }]} value={formData.instagram} autoCapitalize="none" onChangeText={(v) => handleInputChange("instagram", v)} />
                        </View>
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
                        <View style={[styles.summaryRow, { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#f3f4f6", alignItems: 'center' }]}>
                            <Text style={styles.totalLabel}>{(t as any)?.["totalLabel"] || "Total"}</Text>
                            <Text style={styles.totalValue}>{CURRENCY_SYMBOL}{total.toFixed(2)}</Text>
                        </View>

                        {safeLocale === 'TH' && (
                            <Text style={styles.exchangeRateNotice}>
                                {(t as any)?.["exchangeRateNotice"]}
                            </Text>
                        )}
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

                        <View style={styles.agreementContainer}>
                            <TouchableOpacity style={styles.agreementRow} onPress={() => { Keyboard.dismiss(); setIsAgreed(!isAgreed); }} activeOpacity={0.7}>
                                <View style={[
                                    styles.checkbox,
                                    isAgreed && styles.checkboxChecked,
                                    !isAgreed && formErrorMsg === ((t as any)?.["agreeTermsAlert"] || "Please agree to the Terms of Service to proceed.") && styles.checkboxError
                                ]}>
                                    {isAgreed && <Ionicons name="checkmark" size={14} color="#fff" />}
                                </View>
                                <Text style={styles.agreementText}>
                                    {(t as any)?.["agreeTermsCombined"] || "I agree to the Terms of Service and the Cancellation/Refund Policy."}
                                </Text>
                            </TouchableOpacity>
                        </View>

                        <TouchableOpacity style={[styles.paymentItem, { borderColor: "#FF6F00" }, (!currentUser || isCreatingOrder) && { opacity: 0.5 }]} onPress={() => handlePlaceOrder("TRUEMONEY")} disabled={!currentUser || isCreatingOrder}>
                            <View style={styles.paymentItemLeft}>
                                <Image source={require("../assets/truemoney_logo.png")} style={styles.paymentLogo} resizeMode="contain" />
                                <Text style={styles.paymentItemText}>{(t as any)?.["payTrueMoney"] || "TrueMoney Wallet"}</Text>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <View style={styles.testBadge}><Text style={styles.testBadgeText}>TEST</Text></View>
                                {isCreatingOrder ? <ActivityIndicator size="small" color="#FF6F00" /> : <Ionicons name="chevron-forward" size={20} color="#ccc" />}
                            </View>
                        </TouchableOpacity>

                        <TouchableOpacity style={[styles.paymentItem, { borderColor: "#00C300" }, (!currentUser || isCreatingOrder) && { opacity: 0.5 }]} onPress={() => handlePlaceOrder("RABBIT_LINE_PAY")} disabled={!currentUser || isCreatingOrder}>
                            <View style={styles.paymentItemLeft}>
                                <Image source={require("../assets/rabbitlinepay_logo.png")} style={styles.paymentLogo} resizeMode="contain" />
                                <Text style={styles.paymentItemText}>{(t as any)?.["payRabbitLinePay"] || "Rabbit LINE Pay"}</Text>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <View style={styles.testBadge}><Text style={styles.testBadgeText}>TEST</Text></View>
                                {isCreatingOrder ? <ActivityIndicator size="small" color="#00C300" /> : <Ionicons name="chevron-forward" size={20} color="#ccc" />}
                            </View>
                        </TouchableOpacity>

                        <TouchableOpacity style={[styles.paymentItem, { borderColor: "#6366F1" }, (!currentUser || isCreatingOrder) && { opacity: 0.5 }]} onPress={() => handlePlaceOrder("CREDIT_CARD")} disabled={!currentUser || isCreatingOrder}>
                            <View style={styles.paymentItemLeft}>
                                <Image
                                    source={require("../assets/credit_card_logo.png")}
                                    style={styles.paymentLogo}
                                    resizeMode="contain"
                                />
                                <Text style={styles.paymentItemText}>{getCleanCardName()}</Text>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <View style={styles.testBadge}><Text style={styles.testBadgeText}>TEST</Text></View>
                                {isCreatingOrder ? <ActivityIndicator size="small" color="#6366F1" /> : <Ionicons name="chevron-forward" size={20} color="#ccc" />}
                            </View>
                        </TouchableOpacity>

                        {/* 개발자용 테스트 결제 */}
                        <TouchableOpacity style={[styles.paymentItem, { borderColor: "#10B981", borderStyle: 'dashed', marginTop: 20 }]} onPress={() => handlePlaceOrder("DEV_FREE")} disabled={isCreatingOrder || !currentUser}>
                            <View style={styles.paymentItemLeft}>
                                <View style={[styles.paymentIconBase, { backgroundColor: "#D1FAE5" }]}><Ionicons name="flask" size={20} color="#10B981" /></View>
                                <Text style={[styles.paymentItemText, { color: "#059669" }]}>{(t as any)?.["payFreeDev"] || "[Dev] Test Free Order"}</Text>
                            </View>
                            {isCreatingOrder ? <ActivityIndicator size="small" color="#10B981" /> : <Ionicons name="chevron-forward" size={20} color="#10B981" />}
                        </TouchableOpacity>
                    </View>
                </View>
            </ScrollView>

            <Modal visible={isCreatingOrder} transparent animationType="fade">
                <View style={styles.fullScreenLoading}>
                    <View style={styles.loadingBox}>
                        <ActivityIndicator size="large" color="#111" />
                        <Text style={styles.loadingText}>Processing Payment...</Text>
                    </View>
                </View>
            </Modal>

        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#fff" },
    header: { flexDirection: "row", alignItems: "center", padding: 12, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
    backBtn: { padding: 4 },
    headerTitle: { flex: 1, textAlign: "center", fontWeight: "700", fontSize: 16 },
    content: { padding: 20, flexGrow: 1 },
    stepContainer: { maxWidth: 500, alignSelf: "center", width: "100%" },
    formSection: { marginBottom: 32 },
    sectionTitle: { fontSize: 13, color: "#999", fontWeight: "700", marginBottom: 15, textTransform: "uppercase" },
    errorBox: { flexDirection: "row", alignItems: "center", backgroundColor: "#FEE2E2", padding: 12, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: "#FCA5A5" },
    errorBoxText: { color: "#B91C1C", fontSize: 13, fontWeight: "600", marginLeft: 8, flex: 1 },
    input: { width: "100%", height: 50, borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", paddingHorizontal: 16, marginBottom: 12, fontSize: 15, backgroundColor: "#fff" },
    inputError: { borderColor: "#EF4444", backgroundColor: "#FEF2F2", borderWidth: 1.5 },
    instagramInputContainer: { flexDirection: "row", alignItems: "center", width: "100%", height: 50, borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#fff", overflow: "hidden" },
    instagramIconBox: { paddingLeft: 14, paddingRight: 8, height: "100%", justifyContent: "center" },
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
    exchangeRateNotice: { fontSize: 11, color: "#9CA3AF", textAlign: "right", marginTop: 6 },
    authBlockContainer: { marginBottom: 32 },
    loggedInBox: { backgroundColor: "#D9ECFF", padding: 16, borderRadius: 14, alignItems: "center" },
    loggedInText: { fontSize: 15, fontWeight: "600", color: "#003a70" },
    loggedOutBox: { backgroundColor: "#FFF3CD", padding: 16, borderRadius: 14, alignItems: "center" },
    loggedOutText: { fontSize: 14, color: "#856404", opacity: 0.8, marginBottom: 12 },
    signInBtn: { backgroundColor: "#111", paddingHorizontal: 24, paddingVertical: 10, borderRadius: 12 },
    signInBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
    paymentSection: { marginBottom: 32 },
    agreementContainer: { marginBottom: 20, paddingHorizontal: 4 },
    agreementRow: { flexDirection: "row", alignItems: "flex-start", paddingRight: 10 },
    checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: "#D1D5DB", alignItems: "center", justifyContent: "center", marginRight: 10, marginTop: 2, backgroundColor: "#fff" },
    checkboxChecked: { backgroundColor: "#111", borderColor: "#111" },
    checkboxError: { borderColor: "#EF4444", backgroundColor: "#FEF2F2" },
    agreementText: { fontSize: 13, color: "#4B5563", lineHeight: 20, flex: 1 },
    paymentItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, backgroundColor: "#fff", borderRadius: 16, borderWidth: 1.5, marginBottom: 12, ...(shadows?.sm || {}) },
    paymentItemLeft: { flexDirection: "row", alignItems: "center" },
    paymentLogo: { width: 42, height: 42, marginRight: 12 },
    paymentIconBase: { width: 42, height: 42, borderRadius: 8, alignItems: "center", justifyContent: "center", marginRight: 12 },
    paymentItemText: { fontSize: 16, fontWeight: "600", color: "#111" },
    testBadge: { backgroundColor: "#FFFBEB", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: "#FBBF24", marginRight: 8, justifyContent: "center", alignItems: "center" },
    testBadgeText: { fontSize: 11, fontWeight: "800", color: "#D97706", letterSpacing: 0.5 },
    fullScreenLoading: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 9999, justifyContent: "center", alignItems: "center" },
    loadingBox: { backgroundColor: "#fff", padding: 30, borderRadius: 20, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 15, elevation: 8 },
    loadingText: { marginTop: 16, fontSize: 16, fontWeight: "700", color: "#333" },
});