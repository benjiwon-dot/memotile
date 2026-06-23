// src/screens/CheckoutStepOneScreen.tsx
//
// 순서: 사진 → 가격(요약) → 안내문구(세일)+사진추가 → 로그인 → 다음
//  - 안내 카드는 가격 아래, 작고 덜 튀게
//  - 문구는 짧게(배송문구 제거) 2줄 허용
//  - key 는 index 포함(중복 사진 대비)

import React, { useMemo, useState, useEffect, useRef } from "react";
import {
    View,
    Text,
    ScrollView,
    Image,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    Alert,
    Platform,
    Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";

import { usePhoto } from "../context/PhotoContext";
import { useLanguage } from "../context/LanguageContext";
import { colors } from "../theme/colors";

import { auth } from "../lib/firebase";
import { User, GoogleAuthProvider, OAuthProvider, signInWithCredential, signInWithPopup, setPersistence, browserLocalPersistence } from "firebase/auth";
import { doc, getDoc, getFirestore } from "firebase/firestore";
import { useGoogleAuthRequest } from "../utils/firebaseAuth";

import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

import { computePricing, getCurrencySymbol, type VolumeTier, type ShippingTier } from "../utils/pricing";
import VolumeTierBar from "../components/VolumeTierBar";

const LoginButton = ({
    text, onPress, style, disabled, icon,
}: { text: string; onPress: () => void; style?: any; disabled?: boolean; icon?: React.ReactNode; }) => (
    <TouchableOpacity
        style={[styles.loginBtn, style, disabled && { opacity: 0.6 }, { flexDirection: "row", gap: 8 }]}
        onPress={onPress}
        disabled={disabled}
    >
        {icon}
        <Text style={styles.loginBtnText}>{text}</Text>
    </TouchableOpacity>
);

async function waitForPreviewUrisSnapshot(photosRef: () => any[], timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const arr = photosRef() || [];
        const missing = arr.map((p: any, idx: number) => ({ idx, previewUri: p?.output?.previewUri })).filter((x: any) => !x.previewUri);
        if (missing.length === 0) return true;
        await new Promise((r) => setTimeout(r, 200));
    }
    return false;
}

export default function CheckoutStepOneScreen() {
    const router = useRouter();
    const { photos, addPhotos, setCurrentIndex } = usePhoto();
    const { t, locale } = useLanguage();

    const safePhotos = useMemo(() => {
        if (Platform.OS === 'web' && (!photos || photos.length === 0)) {
            return [{
                assetId: "mock-web-1",
                uri: "https://via.placeholder.com/300?text=Paymentwall+Test",
                output: { previewUri: "https://via.placeholder.com/300?text=Paymentwall+Test" },
                quantity: 1
            }];
        }
        return photos || [];
    }, [photos]);

    const photosRef = useRef<any[]>(safePhotos as any[]);
    useEffect(() => { photosRef.current = safePhotos as any[]; }, [safePhotos]);

    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [previewUri, setPreviewUri] = useState<string | null>(null);
    const [isWebLoggingIn, setIsWebLoggingIn] = useState(false);
    const [isAppleLoggingIn, setIsAppleLoggingIn] = useState(false);
    const [isAddingPhotos, setIsAddingPhotos] = useState(false);

    const [pricePerTile, setPricePerTile] = useState<number>(locale === "TH" ? 200 : 5.71);
    const [volumeDiscounts, setVolumeDiscounts] = useState<VolumeTier[]>([]);
    const [shippingTiers, setShippingTiers] = useState<ShippingTier[]>([]);
    const [priceLoaded, setPriceLoaded] = useState(false);

    useEffect(() => {
        let alive = true;
        const fetchPriceAndDiscounts = async () => {
            try {
                const db = getFirestore();
                const docSnap = await getDoc(doc(db, "config", "prices"));
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    const remotePrice = locale === "TH" ? data.price_thb : data.price_usd;
                    if (alive && remotePrice != null) setPricePerTile(remotePrice);
                    if (Array.isArray(data.volumeDiscounts)) {
                        if (alive) setVolumeDiscounts([...data.volumeDiscounts].sort((a, b) => a.minQty - b.minQty));
                    }
                    if (Array.isArray(data.shippingTiers)) {
                        if (alive) setShippingTiers([...data.shippingTiers].sort((a, b) => a.minQty - b.minQty));
                    }
                }
            } catch (error) {
                console.error("가격 데이터 불러오기 실패 (기본값 사용):", error);
            } finally {
                if (alive) setPriceLoaded(true);
            }
        };
        fetchPriceAndDiscounts();
        return () => { alive = false; };
    }, [locale]);

    const CURRENCY_SYMBOL = getCurrencySymbol(locale);

    const { promptAsync, isReady, isSigningIn, error: authError, response } = useGoogleAuthRequest();

    useEffect(() => { if (authError) Alert.alert("Login Error", authError); }, [authError]);

    useEffect(() => {
        if (Platform.OS !== 'web' && response?.type === "success") {
            const idToken = response.authentication?.idToken || response.params?.id_token || response.params?.idToken;
            if (!idToken) { console.error("Google idToken 누락"); return; }
            const credential = GoogleAuthProvider.credential(idToken);
            signInWithCredential(auth, credential)
                .then(() => console.log("Google Sign-In success at Checkout"))
                .catch((error) => { console.error("Firebase Sign-In Error at Checkout", error); Alert.alert("Login Failed", error.message); });
        }
    }, [response]);

    useEffect(() => {
        const unsub = auth.onAuthStateChanged((user) => {
            setCurrentUser(user);
            if (user && Platform.OS === 'web' && window.location.href.includes('oauthredirect')) {
                router.replace("/create/checkout");
            }
        });
        return unsub;
    }, []);

    const safePhotosCount = safePhotos.length;
    const pricing = useMemo(
        () => computePricing({ count: safePhotosCount, pricePerTile, volumeDiscounts, shippingTiers }),
        [safePhotosCount, pricePerTile, volumeDiscounts, shippingTiers]
    );

    const handleAddMorePhotos = async () => {
        if (isAddingPhotos) return;
        if (Platform.OS === 'web') { Alert.alert("Notice", "Adding photos is available in the mobile app."); return; }
        try {
            setIsAddingPhotos(true);
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!perm.granted) {
                Alert.alert((t as any)["permNeededTitle"] || "Permission needed", (t as any)["permNeededMsg"] || "Please allow photo access to add more tiles.");
                return;
            }
            const startIndex = (photosRef.current || []).length;
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsMultipleSelection: true,
                selectionLimit: 20,
                quality: 1,
                exif: false,
                base64: false,
            });
            if (result.canceled || !result.assets?.length) return;
            const processed = result.assets.map((a) => ({ ...a, originalUri: a.uri }));
            await addPhotos(processed as any, { persist: true, step: "editor" });
            setTimeout(() => {
                setCurrentIndex(startIndex, { persist: true, step: "editor" });
                router.push("/create/editor");
            }, 150);
        } catch (e: any) {
            console.error("[AddMore] failed", e);
            Alert.alert("Error", e?.message || "Failed to add photos.");
        } finally {
            setIsAddingPhotos(false);
        }
    };

    const handleGoogleLogin = async () => {
        if (Platform.OS === 'web') {
            setIsWebLoggingIn(true);
            try {
                const provider = new GoogleAuthProvider();
                provider.setCustomParameters({ prompt: 'select_account' });
                await setPersistence(auth, browserLocalPersistence);
                await signInWithPopup(auth, provider);
            } catch (error: any) {
                if (error.code !== 'auth/popup-closed-by-user') Alert.alert("Login Failed", error.message || "Please check your browser popup settings and try again.");
            } finally { setIsWebLoggingIn(false); }
        } else {
            if (isSigningIn) return;
            promptAsync();
        }
    };

    const handleAppleLogin = async () => {
        if (Platform.OS !== 'ios') return;
        setIsAppleLoggingIn(true);
        try {
            const csrf = Math.random().toString(36).substring(2, 15);
            const nonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, csrf);
            const appleCredential = await AppleAuthentication.signInAsync({
                requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
                nonce: nonce,
            });
            const { identityToken } = appleCredential;
            if (identityToken) {
                const provider = new OAuthProvider('apple.com');
                const credential = provider.credential({ idToken: identityToken, rawNonce: csrf });
                await signInWithCredential(auth, credential);
            } else { throw new Error("No identity token provided."); }
        } catch (e: any) {
            if (e.code === 'ERR_REQUEST_CANCELED') { /* canceled */ }
            else if (e.message && e.message.includes("not available on ios")) {
                Alert.alert("Test Environment Notice", "Apple Sign-In requires a standalone build to test. Please use Email or Google for now.");
            } else { console.error("Apple Sign-in Error:", e); Alert.alert("Apple Login Failed", e.message || "An error occurred during Apple Sign-In."); }
        } finally { setIsAppleLoggingIn(false); }
    };

    const [isPreparing, setIsPreparing] = useState(false);

    const handleNext = async () => {
        if (!currentUser) return;
        if (isPreparing) return;
        try {
            setIsPreparing(true);
            if (Platform.OS !== 'web') {
                const ok = await waitForPreviewUrisSnapshot(() => photosRef.current, 8000);
                const latest = photosRef.current || [];
                const missing = latest.map((p: any, idx: number) => ({ idx, previewUri: p?.output?.previewUri })).filter((x: any) => !x.previewUri);
                if (!ok || missing.length > 0) {
                    Alert.alert("Preparing photos…", `Still rendering preview files.\nMissing: ${missing.map((m: any) => m.idx + 1).join(", ")}\n\nPlease wait a moment and try again.`);
                    return;
                }
            }
            router.push("/create/checkout/payment");
        } catch (e) {
            console.error("[CheckoutStepOne] wait failed", e);
            Alert.alert("Please wait", "Photos are still being prepared. Please try again in a moment.");
        } finally { setIsPreparing(false); }
    };

    const GoogleIconFallback = () => (
        <Image source={require("../assets/google_logo.png")} style={{ width: 18, height: 18 }} resizeMode="contain" />
    );

    const pickDisplayUri = (item: any) => item?.output?.previewUri || item?.output?.viewUri || item?.uri;

    const addMoreLabel = locale === "TH" ? "เพิ่มรูป (ยิ่งเยอะยิ่งถูก)" : "Add more photos — save more";

    // ✨ 가격 밑에 들어갈 "안내문구(세일) + 사진추가" 카드 (작고 덜 튀게)
    const renderPromo = () => (
        <View style={styles.promoCard}>
            <VolumeTierBar
                variant="compact"
                count={safePhotosCount}
                pricePerTile={pricePerTile}
                volumeDiscounts={volumeDiscounts}
                shippingTiers={shippingTiers}
                locale={locale}
                style={styles.promoNudge}
            />
            <TouchableOpacity onPress={handleAddMorePhotos} style={styles.addMoreBtn} disabled={isAddingPhotos} activeOpacity={0.85}>
                {isAddingPhotos ? (
                    <ActivityIndicator size="small" color="#047857" />
                ) : (
                    <>
                        <Ionicons name="add" size={16} color="#047857" />
                        <Text style={styles.addMoreBtnText}>{addMoreLabel}</Text>
                    </>
                )}
            </TouchableOpacity>
        </View>
    );

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <View pointerEvents="none"><Ionicons name="chevron-back" size={24} color="black" /></View>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{(t as any)["checkoutTitle"] || "Checkout"}</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.stepContainer}>
                    {/* 1) 사진 */}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageScroll} contentContainerStyle={{ gap: 12 }}>
                        {safePhotos.map((item: any, idx: number) => {
                            const sourceUri = pickDisplayUri(item);
                            if (!sourceUri) return null;
                            return (
                                <TouchableOpacity key={`${item.assetId || item.uri || "p"}-${idx}`} onPress={() => setPreviewUri(sourceUri)}>
                                    <Image source={{ uri: sourceUri }} style={styles.previewImage} />
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>

                    {/* 2) 가격 (요약) */}
                    {!priceLoaded ? (
                        <View style={[styles.summaryBlock, { alignItems: "center", justifyContent: "center", minHeight: 130 }]}>
                            <ActivityIndicator color={colors.ink || "#000"} />
                            <Text style={{ marginTop: 10, color: "#9CA3AF", fontSize: 13 }}>{(t as any)["loadingPrice"] || "Loading price…"}</Text>
                        </View>
                    ) : (
                        <View style={styles.summaryBlock}>
                            <View style={styles.summaryRow}>
                                <Text style={styles.summaryLabel}>{safePhotosCount} {(t as any)["tilesSize"] || "Tiles"}</Text>
                                <Text style={styles.summaryValue}>{CURRENCY_SYMBOL}{pricing.subtotal.toFixed(2)}</Text>
                            </View>

                            {pricing.volumeDiscountAmount > 0 && (
                                <View style={styles.summaryRow}>
                                    <Text style={[styles.summaryLabel, { color: "#10B981" }]}>{(t as any)?.["volumeDiscount"] || "Volume Discount"} ({pricing.volumeDiscountPercent}%)</Text>
                                    <Text style={[styles.summaryValue, { color: "#10B981" }]}>-{CURRENCY_SYMBOL}{pricing.volumeDiscountAmount.toFixed(2)}</Text>
                                </View>
                            )}

                            <View style={styles.summaryRow}>
                                <Text style={[styles.summaryLabel, { color: pricing.isFreeShipping ? "#10B981" : "#333" }]}>{(t as any)["shipping"] || "Shipping"}</Text>
                                <Text style={[styles.summaryValue, { color: pricing.isFreeShipping ? "#10B981" : "#333" }]}>
                                    {pricing.isFreeShipping ? ((t as any)["free"] || "Free") : `${CURRENCY_SYMBOL}${pricing.shippingFee.toFixed(2)}`}
                                </Text>
                            </View>

                            <View style={styles.divider} />
                            <View style={styles.totalRow}>
                                <Text style={styles.totalLabel}>{(t as any)["totalLabel"] || "Total"}</Text>
                                <Text style={styles.totalValue}>{CURRENCY_SYMBOL}{pricing.total.toFixed(2)}</Text>
                            </View>
                        </View>
                    )}

                    {/* 3) 안내문구(세일) + 사진추가 — 가격 바로 밑 */}
                    {priceLoaded && renderPromo()}

                    {/* 4) 로그인 */}
                    <View style={styles.authSection}>
                        {!currentUser ? (
                            <>
                                <View style={styles.signInToContinueContainer}>
                                    <Text style={styles.signInToContinueText}>{(t as any)["signInToContinue"] || "Please sign in to continue."}</Text>
                                </View>

                                {Platform.OS === "ios" && (
                                    <LoginButton
                                        text={(t as any)["auth.signinApple"] || "Continue with Apple"}
                                        onPress={handleAppleLogin}
                                        style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd" }}
                                        disabled={isAppleLoggingIn}
                                        icon={isAppleLoggingIn ? <ActivityIndicator size="small" color="#000" /> : <Ionicons name="logo-apple" size={20} color="#000" />}
                                    />
                                )}

                                <LoginButton
                                    text={(t as any)["signUpGoogle"] || "Sign up with Google"}
                                    onPress={handleGoogleLogin}
                                    style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd" }}
                                    disabled={isWebLoggingIn || (!isReady && Platform.OS !== 'web') || isSigningIn}
                                    icon={(isWebLoggingIn || isSigningIn) ? <ActivityIndicator size="small" color="#000" /> : <GoogleIconFallback />}
                                />

                                <LoginButton
                                    text={(t as any)["auth.continueEmail"] || "Continue with email"}
                                    onPress={() => router.push("/auth/email")}
                                    style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd" }}
                                    icon={<Ionicons name="mail" size={20} color="#333" />}
                                />
                            </>
                        ) : (
                            <View style={styles.loggedInInfo}>
                                <Text style={styles.loggedInText}>{(t as any)["loggedInAs"] || "Logged in as"} {currentUser.email || "User"}</Text>
                                <TouchableOpacity onPress={() => auth.signOut()}>
                                    <Text style={styles.signOutText}>{(t as any)["signOut"] || "Sign Out"}</Text>
                                </TouchableOpacity>
                            </View>
                        )}
                    </View>

                    {/* 5) 다음 */}
                    <TouchableOpacity
                        style={[styles.nextBtn, (!currentUser || isPreparing) && styles.disabledBtn]}
                        onPress={handleNext}
                        disabled={!currentUser || isPreparing}
                    >
                        {isPreparing ? <ActivityIndicator color="#fff" /> : <Text style={styles.nextBtnText}>{(t as any)["next"] || "Next"}</Text>}
                    </TouchableOpacity>
                </View>
            </ScrollView>

            <Modal visible={!!previewUri} transparent animationType="fade" onRequestClose={() => setPreviewUri(null)}>
                <View style={styles.modalContainer}>
                    <TouchableOpacity style={styles.modalBackground} onPress={() => setPreviewUri(null)} />
                    <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setPreviewUri(null)}>
                        <Ionicons name="close" size={28} color="#fff" />
                    </TouchableOpacity>
                    {previewUri && <Image source={{ uri: previewUri }} style={styles.modalImage} resizeMode="contain" />}
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
    content: { padding: 20 },
    stepContainer: { maxWidth: 500, alignSelf: "center", width: "100%" },

    imageScroll: { marginBottom: 16 },
    previewImage: { width: 100, height: 100, borderRadius: 8, backgroundColor: "#eee", resizeMode: "cover" },

    // 🆕 안내 카드 — 작고 덜 튀게 (가격 밑)
    promoCard: { borderWidth: 1, borderColor: "#D7F0E4", backgroundColor: "#F6FCF9", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 24 },
    promoNudge: { backgroundColor: "transparent", borderWidth: 0, paddingVertical: 0, paddingHorizontal: 0 },
    addMoreBtn: { marginTop: 9, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 38, borderRadius: 10, backgroundColor: "#fff", borderWidth: 1, borderColor: "#BBEBD7" },
    addMoreBtnText: { fontSize: 12.5, fontWeight: "700", color: "#047857" },

    summaryBlock: {
        backgroundColor: "#fff", borderRadius: 20, padding: 20, borderWidth: 1, borderColor: "#f0f0f0", marginBottom: 16,
        shadowColor: "#000", shadowOpacity: 0.05, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 2,
    },
    summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
    summaryLabel: { fontSize: 15, color: "#333" },
    summaryValue: { fontSize: 15, fontWeight: "600" },

    divider: { height: 1, backgroundColor: "#eee", marginVertical: 15 },
    totalRow: { flexDirection: "row", justifyContent: "space-between" },
    totalLabel: { fontSize: 18, fontWeight: "700" },
    totalValue: { fontSize: 18, fontWeight: "700" },

    authSection: { gap: 10, marginBottom: 20 },
    loginBtn: { height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center" },
    loginBtnText: { fontWeight: "600", fontSize: 15, color: "#333" },

    loggedInInfo: { padding: 15, backgroundColor: "#e0f2fe", borderRadius: 12, alignItems: "center" },
    loggedInText: { color: "#0284c7", fontWeight: "600" },
    signOutText: { color: "#666", fontSize: 13, marginTop: 4, textDecorationLine: "underline" },
    signInToContinueContainer: { marginBottom: 12, alignItems: "center" },
    signInToContinueText: { fontSize: 14, color: "#666", opacity: 0.8 },

    nextBtn: { height: 56, borderRadius: 28, backgroundColor: colors.ink || "#000", alignItems: "center", justifyContent: "center", marginTop: 10 },
    disabledBtn: { backgroundColor: "#ccc" },
    nextBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },

    modalContainer: { flex: 1, backgroundColor: "rgba(0,0,0,0.95)", justifyContent: "center", alignItems: "center" },
    modalBackground: { ...StyleSheet.absoluteFillObject },
    modalCloseBtn: { position: "absolute", top: 60, right: 30, zIndex: 10, padding: 8, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 20 },
    modalImage: { width: "100%", height: "80%" },
});
