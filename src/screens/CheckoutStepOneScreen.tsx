// src/screens/CheckoutStepOneScreen.tsx
//
// ✅ 이번 버전 포함 내용 (이전 working 버전 기준, 추가만)
//  - computePricing 단일 소스 + 가격 로딩 스켈레톤(300 깜빡임 제거)
//  - VolumeTierBar(compact) 넛지
//  - "사진 더 담기"(+) : 기존 크롭/필터 유지하며 추가 → 새 사진만 에디터로 (addPhotos)
//  - 🆕 shippingTiers(수량별 배송비 38/41/0) 추가 — freeShipThreshold/shippingFee 는 폴백 유지

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

// Firebase / Auth / Firestore
import { auth } from "../lib/firebase";
import { User, GoogleAuthProvider, OAuthProvider, signInWithCredential, signInWithPopup, setPersistence, browserLocalPersistence } from "firebase/auth";
import { doc, getDoc, getFirestore } from "firebase/firestore";
import { useGoogleAuthRequest } from "../utils/firebaseAuth";

// ✨ Apple Auth Imports
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

// ✨ 가격 단일 소스 + 넛지
import { computePricing, getCurrencySymbol, type VolumeTier, type ShippingTier } from "../utils/pricing";
import VolumeTierBar from "../components/VolumeTierBar";

const LoginButton = ({
    text,
    onPress,
    style,
    disabled,
    icon,
}: {
    text: string;
    onPress: () => void;
    style?: any;
    disabled?: boolean;
    icon?: React.ReactNode;
}) => (
    <TouchableOpacity
        style={[
            styles.loginBtn,
            style,
            disabled && { opacity: 0.6 },
            { flexDirection: "row", gap: 8 },
        ]}
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
        const missing = arr
            .map((p: any, idx: number) => ({ idx, previewUri: p?.output?.previewUri }))
            .filter((x: any) => !x.previewUri);

        if (missing.length === 0) return true;
        await new Promise((r) => setTimeout(r, 200));
    }
    return false;
}

export default function CheckoutStepOneScreen() {
    const router = useRouter();
    // 🆕 addPhotos / setCurrentIndex 추가 (이미 PhotoContext 에 존재)
    const { photos, addPhotos, setCurrentIndex } = usePhoto();
    const { t, locale } = useLanguage();

    const safePhotos = useMemo(() => {
        if (Platform.OS === 'web' && (!photos || photos.length === 0)) {
            console.log("Web test mode: Injecting mock photo to prevent 0 price");
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
    useEffect(() => {
        photosRef.current = safePhotos as any[];
    }, [safePhotos]);

    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [previewUri, setPreviewUri] = useState<string | null>(null);
    const [isWebLoggingIn, setIsWebLoggingIn] = useState(false);
    const [isAppleLoggingIn, setIsAppleLoggingIn] = useState(false);
    const [isAddingPhotos, setIsAddingPhotos] = useState(false); // 🆕

    const [pricePerTile, setPricePerTile] = useState<number>(locale === "TH" ? 300 : 8.85);
    const [volumeDiscounts, setVolumeDiscounts] = useState<VolumeTier[]>([]);
    const [freeShipThreshold, setFreeShipThreshold] = useState<number | undefined>(undefined);
    const [shippingFee, setShippingFee] = useState<number>(0);
    const [shippingTiers, setShippingTiers] = useState<ShippingTier[]>([]); // 🆕 수량별 배송비
    const [priceLoaded, setPriceLoaded] = useState(false); // 300 깜빡임 방지

    useEffect(() => {
        let alive = true;
        const fetchPriceAndDiscounts = async () => {
            try {
                const db = getFirestore();
                const docRef = doc(db, "config", "prices");
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    const data = docSnap.data();
                    const remotePrice = locale === "TH" ? data.price_thb : data.price_usd;
                    if (alive && remotePrice != null) setPricePerTile(remotePrice);

                    if (data.volumeDiscounts && Array.isArray(data.volumeDiscounts)) {
                        const sortedTiers = [...data.volumeDiscounts].sort((a, b) => a.minQty - b.minQty);
                        if (alive) setVolumeDiscounts(sortedTiers);
                    }
                    if (alive && data.freeShipThreshold != null) setFreeShipThreshold(data.freeShipThreshold);
                    if (alive && data.shippingFee != null) setShippingFee(data.shippingFee);
                    if (alive && Array.isArray(data.shippingTiers)) {
                        setShippingTiers([...data.shippingTiers].sort((a, b) => a.minQty - b.minQty)); // 🆕
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

    useEffect(() => {
        if (authError) Alert.alert("Login Error", authError);
    }, [authError]);

    useEffect(() => {
        if (Platform.OS !== 'web' && response?.type === "success") {
            const idToken = response.authentication?.idToken || response.params?.id_token || response.params?.idToken;

            if (!idToken) {
                console.error("Google response 획득 성공했으나 idToken이 누락되었습니다.");
                return;
            }

            const credential = GoogleAuthProvider.credential(idToken);
            signInWithCredential(auth, credential)
                .then(() => {
                    console.log("Google Sign-In success to Firebase from Checkout");
                })
                .catch((error) => {
                    console.error("Firebase Sign-In Error at Checkout", error);
                    Alert.alert("Login Failed", error.message);
                });
        }
    }, [response]);

    useEffect(() => {
        const unsub = auth.onAuthStateChanged((user) => {
            setCurrentUser(user);

            if (user && Platform.OS === 'web' && window.location.href.includes('oauthredirect')) {
                console.log("Cleaning up invalid oauthredirect route...");
                router.replace("/create/checkout");
            }
        });
        return unsub;
    }, []);

    // ✨ 가격/할인 계산 (단일 소스)
    const safePhotosCount = safePhotos.length;
    const pricing = useMemo(
        () => computePricing({
            count: safePhotosCount,
            pricePerTile,
            volumeDiscounts,
            shippingTiers,        // 🆕 수량별 배송비(있으면 우선 적용)
            freeShipThreshold,    // 폴백
            shippingFee,          // 폴백
        }),
        [safePhotosCount, pricePerTile, volumeDiscounts, shippingTiers, freeShipThreshold, shippingFee]
    );

    // 🆕 사진 더 담기 (기존 크롭/필터 유지, 새 사진만 에디터로)
    const handleAddMorePhotos = async () => {
        if (isAddingPhotos) return;
        if (Platform.OS === 'web') {
            Alert.alert("Notice", "Adding photos is available in the mobile app.");
            return;
        }
        try {
            setIsAddingPhotos(true);

            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!perm.granted) {
                Alert.alert(
                    (t as any)["permNeededTitle"] || "Permission needed",
                    (t as any)["permNeededMsg"] || "Please allow photo access to add more tiles."
                );
                return;
            }

            const startIndex = (photosRef.current || []).length; // 첫 새 사진 위치

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsMultipleSelection: true,
                quality: 1, // ⚠️ 메인 피커와 동일 옵션으로 맞추세요 (원본 화질 유지)
                exif: false,
            });

            if (result.canceled || !result.assets?.length) return;

            // 기존 사진들의 edits/output 은 그대로 유지된 채 뒤에 append (PhotoContext.addPhotos)
            await addPhotos(result.assets, { persist: true, step: "editor" });

            // 새 사진만 편집하도록 첫 새 인덱스로 이동 → 에디터
            // (addPhotos 의 state 커밋을 기다리기 위해 짧은 지연: clamp 레이스 방지)
            setTimeout(() => {
                setCurrentIndex(startIndex, { persist: true, step: "editor" });
                router.push("/create/editor");
            }, 80);
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
                console.error("Firebase Web Login Error", error);
                if (error.code !== 'auth/popup-closed-by-user') {
                    Alert.alert("Login Failed", error.message || "Please check your browser popup settings and try again.");
                }
            } finally {
                setIsWebLoggingIn(false);
            }
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
                requestedScopes: [
                    AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                    AppleAuthentication.AppleAuthenticationScope.EMAIL,
                ],
                nonce: nonce,
            });

            const { identityToken } = appleCredential;

            if (identityToken) {
                const provider = new OAuthProvider('apple.com');
                const credential = provider.credential({
                    idToken: identityToken,
                    rawNonce: csrf,
                });
                await signInWithCredential(auth, credential);
                console.log("Apple Sign-In success");
            } else {
                throw new Error("No identity token provided.");
            }
        } catch (e: any) {
            if (e.code === 'ERR_REQUEST_CANCELED') {
                console.log("User canceled Apple Sign-in");
            } else if (e.message && e.message.includes("not available on ios")) {
                Alert.alert(
                    "Test Environment Notice",
                    "Apple Sign-In requires a standalone build to test. App Store reviewers will see it working perfectly! For now, please use Email or Google to continue testing."
                );
            } else {
                console.error("Apple Sign-in Error:", e);
                Alert.alert("Apple Login Failed", e.message || "An error occurred during Apple Sign-In.");
            }
        } finally {
            setIsAppleLoggingIn(false);
        }
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
                const missing = latest
                    .map((p: any, idx: number) => ({ idx, previewUri: p?.output?.previewUri }))
                    .filter((x: any) => !x.previewUri);

                if (!ok || missing.length > 0) {
                    Alert.alert(
                        "Preparing photos…",
                        `Still rendering preview files.\nMissing: ${missing.map((m: any) => m.idx + 1).join(", ")}\n\nPlease wait a moment and try again.`
                    );
                    return;
                }
            }
            router.push("/create/checkout/payment");
        } catch (e) {
            console.error("[CheckoutStepOne] wait failed", e);
            Alert.alert("Please wait", "Photos are still being prepared. Please try again in a moment.");
        } finally {
            setIsPreparing(false);
        }
    };

    const GoogleIconFallback = () => (
        <Image source={require("../assets/google_logo.png")} style={{ width: 18, height: 18 }} resizeMode="contain" />
    );

    const pickDisplayUri = (item: any) => {
        return item?.output?.previewUri || item?.output?.viewUri || item?.uri;
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity
                    onPress={() => router.back()}
                    style={styles.backBtn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                    <View pointerEvents="none">
                        <Ionicons name="chevron-back" size={24} color="black" />
                    </View>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{(t as any)["checkoutTitle"] || "Checkout"}</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.stepContainer}>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={styles.imageScroll}
                        contentContainerStyle={{ gap: 12 }}
                    >
                        {safePhotos.map((item: any, idx: number) => {
                            const sourceUri = pickDisplayUri(item);
                            if (!sourceUri) return null;

                            return (
                                <TouchableOpacity key={item.assetId || idx} onPress={() => setPreviewUri(sourceUri)}>
                                    <Image source={{ uri: sourceUri }} style={styles.previewImage} />
                                </TouchableOpacity>
                            );
                        })}

                        {/* 🆕 사진 더 담기 (+) — 점선 타일 */}
                        <TouchableOpacity
                            onPress={handleAddMorePhotos}
                            style={styles.addTile}
                            disabled={isAddingPhotos}
                            activeOpacity={0.7}
                        >
                            {isAddingPhotos ? (
                                <ActivityIndicator color="#9CA3AF" />
                            ) : (
                                <>
                                    <Ionicons name="add" size={26} color="#9CA3AF" />
                                    <Text style={styles.addTileText}>{(t as any)["addMore"] || "Add"}</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </ScrollView>

                    {/* ✨ 묶음 판매 넛지 */}
                    {priceLoaded && (
                        <VolumeTierBar
                            variant="compact"
                            count={safePhotosCount}
                            pricePerTile={pricePerTile}
                            volumeDiscounts={volumeDiscounts}
                            shippingTiers={shippingTiers}
                            freeShipThreshold={freeShipThreshold}
                            shippingFee={shippingFee}
                            locale={locale}
                            style={{ marginBottom: 14 }}
                        />
                    )}

                    {/* ✨ 가격 요약 (priceLoaded 전엔 스켈레톤) */}
                    {!priceLoaded ? (
                        <View style={[styles.summaryBlock, { alignItems: "center", justifyContent: "center", minHeight: 130 }]}>
                            <ActivityIndicator color={colors.ink || "#000"} />
                            <Text style={{ marginTop: 10, color: "#9CA3AF", fontSize: 13 }}>
                                {(t as any)["loadingPrice"] || "Loading price…"}
                            </Text>
                        </View>
                    ) : (
                        <View style={styles.summaryBlock}>
                            <View style={styles.summaryRow}>
                                <Text style={styles.summaryLabel}>
                                    {safePhotosCount} {(t as any)["tilesSize"] || "Tiles"}
                                </Text>
                                <Text style={styles.summaryValue}>
                                    {CURRENCY_SYMBOL}{pricing.subtotal.toFixed(2)}
                                </Text>
                            </View>

                            {pricing.volumeDiscountAmount > 0 && (
                                <View style={styles.summaryRow}>
                                    <Text style={[styles.summaryLabel, { color: "#10B981" }]}>
                                        {(t as any)?.["volumeDiscount"] || "Volume Discount"} ({pricing.volumeDiscountPercent}%)
                                    </Text>
                                    <Text style={[styles.summaryValue, { color: "#10B981" }]}>
                                        -{CURRENCY_SYMBOL}{pricing.volumeDiscountAmount.toFixed(2)}
                                    </Text>
                                </View>
                            )}

                            <View style={styles.summaryRow}>
                                <Text style={[styles.summaryLabel, { color: pricing.isFreeShipping ? "#10B981" : "#333" }]}>
                                    {(t as any)["shipping"] || "Shipping"}
                                </Text>
                                <Text style={[styles.summaryValue, { color: pricing.isFreeShipping ? "#10B981" : "#333" }]}>
                                    {pricing.isFreeShipping
                                        ? ((t as any)["free"] || "Free")
                                        : `${CURRENCY_SYMBOL}${pricing.shippingFee.toFixed(2)}`}
                                </Text>
                            </View>

                            <View style={styles.divider} />
                            <View style={styles.totalRow}>
                                <Text style={styles.totalLabel}>{(t as any)["totalLabel"] || "Total"}</Text>
                                <Text style={styles.totalValue}>
                                    {CURRENCY_SYMBOL}{pricing.total.toFixed(2)}
                                </Text>
                            </View>
                        </View>
                    )}

                    <View style={styles.authSection}>
                        {!currentUser ? (
                            <>
                                <View style={styles.signInToContinueContainer}>
                                    <Text style={styles.signInToContinueText}>
                                        {(t as any)["signInToContinue"] || "Please sign in to continue."}
                                    </Text>
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
                                <Text style={styles.loggedInText}>
                                    {(t as any)["loggedInAs"] || "Logged in as"} {currentUser.email || "User"}
                                </Text>
                                <TouchableOpacity onPress={() => auth.signOut()}>
                                    <Text style={styles.signOutText}>{(t as any)["signOut"] || "Sign Out"}</Text>
                                </TouchableOpacity>
                            </View>
                        )}
                    </View>

                    <TouchableOpacity
                        style={[styles.nextBtn, (!currentUser || isPreparing) && styles.disabledBtn]}
                        onPress={handleNext}
                        disabled={!currentUser || isPreparing}
                    >
                        {isPreparing ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text style={styles.nextBtnText}>{(t as any)["next"] || "Next"}</Text>
                        )}
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

    // 🆕 사진 더 담기 타일
    addTile: {
        width: 100, height: 100, borderRadius: 8,
        borderWidth: 1.5, borderColor: "#E5E7EB", borderStyle: "dashed",
        alignItems: "center", justifyContent: "center", backgroundColor: "#FAFAFA",
    },
    addTileText: { fontSize: 11, color: "#9CA3AF", fontWeight: "600", marginTop: 2 },

    summaryBlock: {
        backgroundColor: "#fff",
        borderRadius: 20,
        padding: 20,
        borderWidth: 1,
        borderColor: "#f0f0f0",
        marginBottom: 24,
        shadowColor: "#000",
        shadowOpacity: 0.05,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 8,
        elevation: 2,
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
