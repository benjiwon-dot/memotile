import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Alert,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    Image,
    Modal
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from '../context/LanguageContext';
import {
    sendEmailVerification,
    reload,
    sendPasswordResetEmail,
    OAuthProvider,
    signInWithCredential
} from "firebase/auth";

import { auth } from "../lib/firebase";

import {
    useGoogleAuthRequest,
    signUpWithEmail,
    signInWithEmail
} from '../utils/firebaseAuth';

import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

const showAlert = (title: string, message?: string) => {
    if (Platform.OS === 'web') {
        window.alert(`${title}\n\n${message || ""}`);
    } else {
        Alert.alert(title, message);
    }
};

// 💡 테스트 계정 목록을 배열로 관리 (유지보수 편의성)
const TEST_ACCOUNTS = [
    "test_apple@memotile.com",
    "test_android@memotile.com",
    "test_user@memotile.com"
];

export default function AuthEmailScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { t } = useLanguage();

    const navHandledRef = useRef(false);

    const [isSignUp, setIsSignUp] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const [isAppleLoggingIn, setIsAppleLoggingIn] = useState(false);

    const { promptAsync, isReady, isSigningIn, error: authError } = useGoogleAuthRequest();

    useEffect(() => {
        const unsub = auth.onAuthStateChanged((user) => {
            if (user && !navHandledRef.current) {
                const isOAuth = user.providerData.some(p => p.providerId === 'google.com' || p.providerId === 'apple.com');

                // 💡 수정됨: 배열에 포함된 이메일인지 확인
                const isTestAccount = user.email ? TEST_ACCOUNTS.includes(user.email) : false;

                if (isOAuth || user.emailVerified || isTestAccount) {
                    navHandledRef.current = true;
                    if (router.canGoBack()) {
                        router.back();
                    } else {
                        router.replace('/(tabs)/profile');
                    }
                }
            }
        });
        return unsub;
    }, [router]);

    useEffect(() => {
        if (authError) showAlert("Login Error", authError);
    }, [authError]);

    useEffect(() => {
        if (cooldown > 0) {
            const timer = setTimeout(() => setCooldown(c => c - 1), 1000);
            return () => clearTimeout(timer);
        }
    }, [cooldown]);

    const handleAuth = async () => {
        const emailTrim = (email ?? "").trim();
        const passwordTrim = password ?? "";

        if (!emailTrim || !passwordTrim) {
            showAlert("Error", (t as any)['auth.invalidEmail'] || "Please enter email and password.");
            return;
        }

        if (isSignUp && password !== confirmPassword) {
            showAlert("Error", (t as any)['auth.passwordMismatch'] || "Passwords do not match.");
            return;
        }

        setLoading(true);
        try {
            if (isSignUp) {
                const cred = await signUpWithEmail(emailTrim, passwordTrim);
                await sendEmailVerification(cred.user);

                showAlert(
                    (t as any)['auth.verificationSentTitle'] || "Verification email sent",
                    (t as any)['auth.verificationSentBody'] || "Please check your inbox and verify your email."
                );
                setIsSignUp(false);
            } else {
                const { user } = await signInWithEmail(emailTrim, passwordTrim);

                // 💡 수정됨: 배열에 포함된 이메일인지 확인
                const isTestAccount = user.email ? TEST_ACCOUNTS.includes(user.email) : false;

                if (!user.emailVerified && !isTestAccount) {
                    // 💡 핵심 버그 수정: 인증 안 된 유저는 Firebase 세션 강제 종료 (유령 로그인 방지)
                    await auth.signOut();

                    if (cooldown > 0) {
                        showAlert(
                            (t as any)['auth.verifyCheckInboxTitle'] || "Verify your email",
                            ((t as any)['auth.verifyCheckInboxBody'] || "Check inbox") + "\n\n" + ((t as any)['auth.verifySpamTip'] || "")
                        );
                        return;
                    }

                    try {
                        await sendEmailVerification(user);
                        setCooldown(30);
                        showAlert(
                            (t as any)['auth.verificationRequiredTitle'] || "Email verification required",
                            ((t as any)['auth.verificationRequiredBody'] || "Please verify.") + "\n\n" + ((t as any)['auth.verifySpamTip'] || "")
                        );
                    } catch (verifyErr: any) {
                        if (verifyErr.code === 'auth/too-many-requests') {
                            showAlert((t as any)['auth.verifyCheckInboxTitle'] || "Verify your email", "Check inbox");
                            setCooldown(30);
                        } else {
                            throw verifyErr;
                        }
                    }
                    return;
                }

                if (!navHandledRef.current) {
                    navHandledRef.current = true;
                    router.back();
                }
            }
        } catch (error: any) {
            console.error("Auth Error:", error);
            const code = error?.code ?? "";

            const errorTitle = (t as any)['paymentError'] || "Login Error";

            let msg = error?.message ?? "Authentication failed.";
            if (code === "auth/invalid-credential") msg = "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
            else if (code === "auth/email-already-in-use") msg = "อีเมลนี้ถูกใช้งานแล้ว โปรดเข้าสู่ระบบ";
            else if (code === "auth/weak-password") msg = "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร";

            showAlert(errorTitle, msg);
        } finally {
            setLoading(false);
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

                if (!navHandledRef.current) {
                    navHandledRef.current = true;
                    router.back();
                }
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

    const handleRefreshVerification = async () => {
        try {
            if (!auth.currentUser) return;
            setLoading(true);
            await reload(auth.currentUser);
            if (auth.currentUser.emailVerified) {
                showAlert((t as any)['auth.verifiedSuccess'] || "Verified ✅", "Success");
                if (!navHandledRef.current) {
                    navHandledRef.current = true;
                    router.back();
                }
            } else {
                showAlert((t as any)['auth.notVerifiedYet'] || "Not verified", "Check your email.");
            }
        } finally {
            setLoading(false);
        }
    };

    const handleForgotPassword = async () => {
        const emailTrim = (email ?? "").trim();
        if (!emailTrim) {
            showAlert("Error", (t as any)['auth.enterEmailFirst'] || "Enter email first.");
            return;
        }
        try {
            await sendPasswordResetEmail(auth, emailTrim);
            showAlert((t as any)['auth.resetSentTitle'] || "Sent", "Check your inbox.");
        } catch (e) {
            showAlert("Failed", "Reset failed.");
        }
    };

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color="black" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>
                    {isSignUp ? ((t as any)['auth.signupTab'] || "Sign Up") : ((t as any)['auth.loginTab'] || "Log In")}
                </Text>
                <View style={{ width: 40 }} />
            </View>

            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                    <View style={styles.formContainer}>
                        <View style={styles.tabContainer}>
                            <TouchableOpacity style={[styles.tab, !isSignUp && styles.activeTab]} onPress={() => setIsSignUp(false)}>
                                <Text style={[styles.tabText, !isSignUp && styles.activeTabText]}>{(t as any)['auth.loginTab'] || "Log In"}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.tab, isSignUp && styles.activeTab]} onPress={() => setIsSignUp(true)}>
                                <Text style={[styles.tabText, isSignUp && styles.activeTabText]}>{(t as any)['auth.signupTab'] || "Sign Up"}</Text>
                            </TouchableOpacity>
                        </View>

                        <View style={styles.inputs}>
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>{(t as any)['auth.emailLabel'] || "Email"}</Text>
                                <TextInput style={styles.input} placeholder="name@example.com" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
                            </View>
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>{(t as any)['auth.passwordLabel'] || "Password"}</Text>
                                <TextInput style={styles.input} placeholder="••••••" value={password} onChangeText={setPassword} secureTextEntry />
                            </View>
                            {isSignUp && (
                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>{(t as any)['auth.confirmPasswordLabel'] || "Confirm Password"}</Text>
                                    <TextInput style={styles.input} placeholder="••••••" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
                                </View>
                            )}
                        </View>

                        <TouchableOpacity style={[styles.mainBtn, loading && styles.disabledBtn]} onPress={handleAuth} disabled={loading}>
                            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.mainBtnText}>{isSignUp ? ((t as any)['auth.signupAction'] || "Create Account") : ((t as any)['auth.loginAction'] || "Log In")}</Text>}
                        </TouchableOpacity>

                        <View style={styles.dividerRow}><View style={styles.line} /><Text style={styles.dividerText}>OR</Text><View style={styles.line} /></View>

                        {/* ⭐️ Apple 로그인을 Google 로그인 위로 배치 */}
                        {Platform.OS === "ios" && (
                            <TouchableOpacity
                                style={[styles.socialBtn, isAppleLoggingIn && styles.disabledBtn]}
                                onPress={handleAppleLogin}
                                disabled={isAppleLoggingIn}
                            >
                                {isAppleLoggingIn ? <ActivityIndicator color="#000" /> :
                                    <View style={styles.socialBtnContent}>
                                        <Ionicons name="logo-apple" size={20} color="#000" />
                                        <Text style={styles.socialBtnText}>{(t as any)['auth.signinApple'] || "Continue with Apple"}</Text>
                                    </View>}
                            </TouchableOpacity>
                        )}

                        <TouchableOpacity
                            style={[styles.socialBtn, { marginTop: Platform.OS === "ios" ? 12 : 0 }, (isSigningIn || !isReady) && styles.disabledBtn]}
                            onPress={() => promptAsync()}
                            disabled={isSigningIn || !isReady}
                        >
                            {isSigningIn ? <ActivityIndicator color="#000" /> :
                                <View style={styles.socialBtnContent}>
                                    <Image source={require('../assets/google_logo.png')} style={styles.socialIcon} resizeMode="contain" />
                                    <Text style={styles.socialBtnText}>{(t as any)['signUpGoogle'] || "Continue with Google"}</Text>
                                </View>}
                        </TouchableOpacity>

                        {!isSignUp && (
                            <View style={styles.extraActions}>
                                <TouchableOpacity onPress={handleForgotPassword}><Text style={styles.secondaryBtnText}>{(t as any)['auth.forgotPassword'] || "Forgot password?"}</Text></TouchableOpacity>
                                {auth.currentUser && !auth.currentUser.emailVerified && (
                                    <TouchableOpacity style={styles.refreshBtn} onPress={handleRefreshVerification}>
                                        <Ionicons name="refresh" size={16} color="#007AFF" />
                                        <Text style={styles.refreshBtnText}>{(t as any)['auth.refreshBtn'] || "I verified my email (Refresh)"}</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        )}
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>

            <Modal visible={isSigningIn || loading || isAppleLoggingIn} transparent animationType="fade">
                <View style={styles.overlayContainer}>
                    <View style={styles.loadingBox}>
                        <ActivityIndicator size="large" color="#111" />
                        <Text style={styles.loadingText}>Processing...</Text>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
    backBtn: { padding: 4 },
    headerTitle: { flex: 1, textAlign: 'center', fontWeight: '700', fontSize: 16 },
    content: { flexGrow: 1, padding: 24, paddingTop: 40, justifyContent: 'flex-start' },
    formContainer: { maxWidth: 400, width: '100%', alignSelf: 'center' },
    tabContainer: { flexDirection: 'row', marginBottom: 24, backgroundColor: '#f3f4f6', borderRadius: 12, padding: 4 },
    tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
    activeTab: { backgroundColor: '#fff', elevation: 2 },
    tabText: { fontWeight: '600', color: '#666', fontSize: 14 },
    activeTabText: { color: '#000' },
    inputs: { gap: 16, marginBottom: 24 },
    inputGroup: { gap: 8 },
    label: { fontSize: 14, fontWeight: '600', color: '#333' },
    input: { height: 50, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, paddingHorizontal: 16, fontSize: 16, backgroundColor: '#f9fafb' },
    mainBtn: { height: 52, backgroundColor: '#111', borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
    disabledBtn: { opacity: 0.7 },
    mainBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    extraActions: { marginTop: 20, alignItems: 'center', gap: 16 },
    secondaryBtnText: { color: '#666', fontSize: 14, textDecorationLine: 'underline' },
    refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    refreshBtnText: { color: '#007AFF', fontWeight: '600', fontSize: 14 },
    dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 24 },
    line: { flex: 1, height: 1, backgroundColor: '#e5e7eb' },
    dividerText: { marginHorizontal: 16, color: '#9ca3af', fontSize: 12, fontWeight: '600' },
    socialBtn: { height: 52, borderRadius: 26, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
    socialBtnContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    socialIcon: { width: 18, height: 18 },
    socialBtnText: { color: '#333', fontSize: 16, fontWeight: '600' },
    overlayContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
    loadingBox: { backgroundColor: '#fff', padding: 24, borderRadius: 16, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 4 },
    loadingText: { marginTop: 12, fontSize: 15, fontWeight: '600', color: '#333' }
});