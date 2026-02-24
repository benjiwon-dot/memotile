// app/auth/email.tsx
import React, { useState, useEffect } from 'react';
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
    Modal // ✅ Modal 추가
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
} from "firebase/auth";

// ✅ Firebase 공통 인스턴스
import { auth } from "../lib/firebase";

import {
    useGoogleAuthRequest,
    signUpWithEmail,
    signInWithEmail
} from '../utils/firebaseAuth';

const showAlert = (title: string, message?: string) => {
    if (Platform.OS === 'web') {
        window.alert(`${title}\n\n${message || ""}`);
    } else {
        Alert.alert(title, message);
    }
};

export default function AuthEmailScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { t } = useLanguage();

    const [isSignUp, setIsSignUp] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);

    // Google Auth Hook
    const { promptAsync, isReady, isSigningIn, error: authError } = useGoogleAuthRequest();

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

                if (!user.emailVerified) {
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
                router.back();
            }
        } catch (error: any) {
            console.error("Auth Error:", error);
            const code = error?.code ?? "";
            let msg = error?.message ?? "Authentication failed.";
            if (code === "auth/invalid-credential") msg = "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
            else if (code === "auth/email-already-in-use") msg = "อีเมลนี้ถูกใช้งานแล้ว โปรดเข้าสู่ระบบ";
            else if (code === "auth/weak-password") msg = "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร";
            showAlert((t as any)['failedTitle'] || "Failed", msg);
        } finally {
            setLoading(false);
        }
    };

    const handleRefreshVerification = async () => {
        try {
            if (!auth.currentUser) return;
            setLoading(true);
            await reload(auth.currentUser);
            if (auth.currentUser.emailVerified) {
                showAlert((t as any)['auth.verifiedSuccess'] || "Verified ✅", "Success");
                router.back();
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

                        <TouchableOpacity style={[styles.socialBtn, (isSigningIn || !isReady) && styles.disabledBtn]} onPress={() => promptAsync()} disabled={isSigningIn || !isReady}>
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

            {/* ✅ [추가됨] 화면 멈춤(5초 지연) 시 연타 방지용 전체 화면 모달 */}
            <Modal visible={isSigningIn || loading} transparent animationType="fade">
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

    // ✅ 연타 방지 모달 스타일
    overlayContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
    loadingBox: { backgroundColor: '#fff', padding: 24, borderRadius: 16, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 4 },
    loadingText: { marginTop: 12, fontSize: 15, fontWeight: '600', color: '#333' }
});