// src/screens/CheckoutStepOneScreen.tsx
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
import { usePhoto } from "../context/PhotoContext";
import { useLanguage } from "../context/LanguageContext";
import { colors } from "../theme/colors";

// Firebase / Auth
import { auth } from "../lib/firebase";
import { User, GoogleAuthProvider, signInWithCredential, signInWithPopup, setPersistence, browserLocalPersistence } from "firebase/auth";
import { useGoogleAuthRequest } from "../utils/firebaseAuth";

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
    const { photos } = usePhoto();
    const { t, locale } = useLanguage();

    const photosRef = useRef<any[]>(photos as any[]);
    useEffect(() => {
        photosRef.current = photos as any[];
    }, [photos]);

    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [previewUri, setPreviewUri] = useState<string | null>(null);
    const [isWebLoggingIn, setIsWebLoggingIn] = useState(false);

    const PRICE_PER_TILE = locale === "TH" ? 200 : 6.45;
    const CURRENCY_SYMBOL = locale === "TH" ? "฿" : "$";

    const { promptAsync, isReady, isSigningIn, error: authError, response } = useGoogleAuthRequest();

    useEffect(() => {
        if (authError) Alert.alert("Login Error", authError);
    }, [authError]);

    useEffect(() => {
        if (Platform.OS !== 'web' && response?.type === "success") {
            const { id_token } = response.params;
            const credential = GoogleAuthProvider.credential(id_token);
            signInWithCredential(auth, credential)
                .then(() => {
                    console.log("Google Sign-In success to Firebase");
                })
                .catch((error) => {
                    console.error("Firebase Sign-In Error", error);
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

    const subtotal = useMemo(() => photos.length * PRICE_PER_TILE, [photos.length, locale]);
    const total = subtotal;

    const handleGoogleLogin = async () => {
        if (Platform.OS === 'web') {
            setIsWebLoggingIn(true);
            try {
                const provider = new GoogleAuthProvider();
                provider.setCustomParameters({ prompt: 'select_account' });
                await setPersistence(auth, browserLocalPersistence);
                await signInWithPopup(auth, provider);
                console.log("Web Google Login Success via Popup");
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

    const handleAppleLogin = () => {
        Alert.alert("Apple Sign-In", (t as any)["auth.appleNotConfigured"] || "Apple Sign-In is not configured yet.");
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
                        {photos.map((item: any, idx: number) => {
                            const sourceUri = pickDisplayUri(item);
                            if (!sourceUri) return null;

                            return (
                                <TouchableOpacity key={item.assetId || idx} onPress={() => setPreviewUri(sourceUri)}>
                                    <Image source={{ uri: sourceUri }} style={styles.previewImage} />
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>

                    <View style={styles.summaryBlock}>
                        <View style={styles.summaryRow}>
                            <Text style={styles.summaryLabel}>
                                {photos.length} {(t as any)["tilesSize"] || "Tiles"}
                            </Text>
                            <Text style={styles.summaryValue}>
                                {CURRENCY_SYMBOL}
                                {subtotal.toFixed(2)}
                            </Text>
                        </View>

                        <View style={styles.summaryRow}>
                            <Text style={[styles.summaryLabel, { color: "#10B981" }]}>
                                {(t as any)["shipping"] || "Shipping"}
                            </Text>
                            <Text style={[styles.summaryValue, { color: "#10B981" }]}>
                                {(t as any)["free"] || "Free"}
                            </Text>
                        </View>

                        <View style={styles.divider} />
                        <View style={styles.totalRow}>
                            <Text style={styles.totalLabel}>{(t as any)["totalLabel"] || "Total"}</Text>
                            <Text style={styles.totalValue}>
                                {CURRENCY_SYMBOL}
                                {total.toFixed(2)}
                            </Text>
                        </View>
                    </View>

                    <View style={styles.authSection}>
                        {!currentUser ? (
                            <>
                                <View style={styles.signInToContinueContainer}>
                                    <Text style={styles.signInToContinueText}>
                                        {(t as any)["signInToContinue"] || "Please sign in to continue."}
                                    </Text>
                                </View>

                                <LoginButton
                                    text={(t as any)["signUpGoogle"] || "Sign up with Google"}
                                    onPress={handleGoogleLogin}
                                    style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd" }}
                                    disabled={isWebLoggingIn || (!isReady && Platform.OS !== 'web') || isSigningIn}
                                    icon={(isWebLoggingIn || isSigningIn) ? <ActivityIndicator size="small" color="#000" /> : <GoogleIconFallback />}
                                />

                                {Platform.OS === "ios" && (
                                    <LoginButton
                                        text={(t as any)["auth.signinApple"] || "Continue with Apple"}
                                        onPress={handleAppleLogin}
                                        style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd" }}
                                        icon={<Ionicons name="logo-apple" size={20} color="#000" />}
                                    />
                                )}

                                {/* ✅ [버그 수정] 이메일 로그인 라우팅 경로를 루트 레벨의 /(auth)/email 모달로 변경 */}
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