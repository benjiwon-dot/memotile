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
    ScrollView
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from '../context/LanguageContext';
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendEmailVerification,
    reload,
} from "firebase/auth";
import { auth } from "../lib/firebase";
import { resetPassword } from "../lib/firebaseAuth";

import { useGoogleAuthRequest } from '../utils/firebaseAuth';
import { Image } from 'react-native';

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

    // Google Auth Hook (Auto-handles Firebase sign-in)
    const { promptAsync, isReady, isSigningIn, error: authError } = useGoogleAuthRequest();

    useEffect(() => {
        if (authError) {
            Alert.alert("Login Error", authError);
        }
    }, [authError]);

    // Cooldown Timer
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
            Alert.alert("Error", t['auth.invalidEmail'] || "Please enter email and password.");
            return;
        }

        if (isSignUp && password !== confirmPassword) {
            Alert.alert("Error", t['auth.passwordMismatch'] || "Passwords do not match");
            return;
        }

        setLoading(true);
        try {
            if (isSignUp) {
                const cred = await createUserWithEmailAndPassword(auth, emailTrim, passwordTrim);
                await sendEmailVerification(cred.user);

                Alert.alert(
                    t['auth.verificationSentTitle'] || "Verification email sent",
                    t['auth.verificationSentBody'] || "Please check your inbox and verify your email."
                );
                setIsSignUp(false); // Switch to login tab
            } else {
                const { user } = await signInWithEmailAndPassword(auth, emailTrim, passwordTrim);

                if (!user.emailVerified) {
                    // Check Cooldown
                    if (cooldown > 0) {
                        Alert.alert(
                            t['auth.verifyCheckInboxTitle'] || "Verify your email",
                            (t['auth.verifyCheckInboxBody'] || "Check inbox") + "\n\n" + (t['auth.verifySpamTip'] || "")
                        );
                        return;
                    }

                    try {
                        await sendEmailVerification(user);
                        setCooldown(30); // 30s cooldown
                        Alert.alert(
                            t['auth.verificationRequiredTitle'] || "Email verification required",
                            (t['auth.verificationRequiredBody'] || "Please verify.") + "\n\n" + (t['auth.verifySpamTip'] || "")
                        );
                    } catch (verifyErr: any) {
                        if (verifyErr.code === 'auth/too-many-requests') {
                            // Suppress error, just show guidance
                            Alert.alert(
                                t['auth.verifyCheckInboxTitle'] || "Verify your email",
                                (t['auth.verifyCheckInboxBody'] || "Check inbox") + "\n\n" + (t['auth.verifySpamTip'] || "")
                            );
                            setCooldown(30); // Enforce cooldown on error too
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

            if (code === "auth/invalid-credential") {
                msg = "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
            } else if (code === "auth/email-already-in-use") {
                msg = "อีเมลนี้ถูกใช้งานแล้ว โปรดเข้าสู่ระบบ";
            } else if (code === "auth/weak-password") {
                msg = "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร";
            } else if (code === "auth/invalid-email") {
                msg = "รูปแบบอีเมลไม่ถูกต้อง";
            } else if (code === "auth/network-request-failed") {
                msg = "เครือข่ายขัดข้อง โปรดตรวจสอบอินเทอร์เน็ต";
            } else if (code === "auth/too-many-requests") {
                // Handle top-level too many requests (rare for login, but possible)
                msg = "กรุณารอสักครู่ก่อนทำรายการใหม่";
            }

            Alert.alert(t['failedTitle'] || "Failed", msg);
        } finally {
            setLoading(false);
        }
    };

    const handleRefreshVerification = async () => {
        try {
            if (!auth.currentUser) {
                Alert.alert(t['auth.refresh'] || "Refresh", t['auth.notLoggedIn'] || "Not logged in.");
                return;
            }

            setLoading(true);
            await reload(auth.currentUser);

            if (auth.currentUser.emailVerified) {
                Alert.alert(t['auth.verifiedSuccess'] || "Verified ✅", t['auth.verifiedSuccessBody'] || "Verified.");
                router.back();
            } else {
                Alert.alert(t['auth.notVerifiedYet'] || "Not verified", t['auth.notVerifiedYetBody'] || "Not verified.");
            }
        } catch (e) {
            Alert.alert(t['auth.refresh'] || "Refresh", t['auth.refreshFailed'] || "Failed.");
        } finally {
            setLoading(false);
        }
    };

    const handleForgotPassword = async () => {
        try {
            const emailTrim = (email ?? "").trim();
            if (!emailTrim) {
                Alert.alert("Error", t['auth.enterEmailFirst'] || "Please enter your email address first.");
                return;
            }
            await resetPassword(emailTrim);
            Alert.alert(t['auth.resetSentTitle'] || "Password reset email sent", t['auth.resetSentBody'] || "Please check your inbox for instructions to reset your password.");
        } catch (e: any) {
            Alert.alert(t['auth.resetFailed'] || "Reset failed", t['auth.resetFailed'] || "Failed to reset password.");
        }
    };

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color="black" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>
                    {isSignUp ? (t['auth.signupTab'] || "Sign Up") : (t['auth.loginTab'] || "Log In")}
                </Text>
                <View style={{ width: 40 }} />
            </View>

            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                style={{ flex: 1 }}
            >
                <ScrollView contentContainerStyle={styles.content}>
                    <View style={styles.formContainer}>

                        {/* Tab Switcher */}
                        <View style={styles.tabContainer}>
                            <TouchableOpacity
                                style={[styles.tab, !isSignUp && styles.activeTab]}
                                onPress={() => setIsSignUp(false)}
                            >
                                <Text style={[styles.tabText, !isSignUp && styles.activeTabText]}>
                                    {t['auth.loginTab'] || "Log In"}
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.tab, isSignUp && styles.activeTab]}
                                onPress={() => setIsSignUp(true)}
                            >
                                <Text style={[styles.tabText, isSignUp && styles.activeTabText]}>
                                    {t['auth.signupTab'] || "Sign Up"}
                                </Text>
                            </TouchableOpacity>
                        </View>

                        {/* Form Inputs */}
                        <View style={styles.inputs}>
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>{t['auth.emailLabel'] || "Email"}</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="name@example.com"
                                    value={email}
                                    onChangeText={setEmail}
                                    autoCapitalize="none"
                                    keyboardType="email-address"
                                />
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>{t['auth.passwordLabel'] || "Password"}</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="••••••"
                                    value={password}
                                    onChangeText={setPassword}
                                    secureTextEntry
                                />
                            </View>

                            {isSignUp && (
                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>{t['auth.confirmPasswordLabel'] || "Confirm Password"}</Text>
                                    <TextInput
                                        style={styles.input}
                                        placeholder="••••••"
                                        value={confirmPassword}
                                        onChangeText={setConfirmPassword}
                                        secureTextEntry
                                    />
                                </View>
                            )}
                        </View>

                        {/* Action Button */}
                        <TouchableOpacity
                            style={[styles.mainBtn, loading && styles.disabledBtn]}
                            onPress={handleAuth}
                            disabled={loading}
                        >
                            {loading ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.mainBtnText}>
                                    {isSignUp ? (t['auth.signupAction'] || "Create Account") : (t['auth.loginAction'] || "Log In")}
                                </Text>
                            )}
                        </TouchableOpacity>

                        {/* Divider */}
                        <View style={styles.dividerRow}>
                            <View style={styles.line} />
                            <Text style={styles.dividerText}>OR</Text>
                            <View style={styles.line} />
                        </View>

                        {/* Google Login Button */}
                        <TouchableOpacity
                            style={[styles.socialBtn, (isSigningIn || !isReady) && styles.disabledBtn]}
                            onPress={() => promptAsync()}
                            disabled={isSigningIn || !isReady}
                        >
                            {isSigningIn ? (
                                <ActivityIndicator color="#000" />
                            ) : (
                                <View style={styles.socialBtnContent}>
                                    <Image
                                        source={require('../assets/google_logo.png')}
                                        style={styles.socialIcon}
                                        resizeMode="contain"
                                    />
                                    <Text style={styles.socialBtnText}>
                                        {t['signUpGoogle'] || "Continue with Google"}
                                    </Text>
                                </View>
                            )}
                        </TouchableOpacity>

                        {/* Extra Actions */}
                        {!isSignUp && (
                            <View style={styles.extraActions}>
                                <TouchableOpacity onPress={handleForgotPassword}>
                                    <Text style={styles.secondaryBtnText}>{t['auth.forgotPassword'] || "Forgot password?"}</Text>
                                </TouchableOpacity>

                                {auth.currentUser && !auth.currentUser.emailVerified && (
                                    <TouchableOpacity style={styles.refreshBtn} onPress={handleRefreshVerification}>
                                        <Ionicons name="refresh" size={16} color="#007AFF" />
                                        <Text style={styles.refreshBtnText}>{t['auth.refreshBtn'] || "I verified my email (Refresh)"}</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        )}

                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6'
    },
    backBtn: { padding: 4 },
    headerTitle: { flex: 1, textAlign: 'center', fontWeight: '700', fontSize: 16 },
    content: { flexGrow: 1, padding: 24, paddingTop: 40, justifyContent: 'flex-start' },
    formContainer: { maxWidth: 400, width: '100%', alignSelf: 'center' },

    tabContainer: {
        flexDirection: 'row',
        marginBottom: 24,
        backgroundColor: '#f3f4f6',
        borderRadius: 12,
        padding: 4,
    },
    tab: {
        flex: 1,
        paddingVertical: 10,
        alignItems: 'center',
        borderRadius: 8,
    },
    activeTab: {
        backgroundColor: '#fff',
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    tabText: {
        fontWeight: '600',
        color: '#666',
        fontSize: 14,
    },
    activeTabText: {
        color: '#000',
    },

    inputs: { gap: 16, marginBottom: 24 },
    inputGroup: { gap: 8 },
    label: { fontSize: 14, fontWeight: '600', color: '#333' },
    input: {
        height: 50,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 12,
        paddingHorizontal: 16,
        fontSize: 16,
        backgroundColor: '#f9fafb'
    },

    mainBtn: {
        height: 52,
        backgroundColor: colors.ink || '#000',
        borderRadius: 26,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 2,
    },
    disabledBtn: { opacity: 0.7 },
    mainBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    extraActions: { marginTop: 20, alignItems: 'center', gap: 16 },
    secondaryBtnText: { color: '#666', fontSize: 14, textDecorationLine: 'underline' },
    refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
    refreshBtnText: { color: '#007AFF', fontWeight: '600', fontSize: 14 },
    dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 24 },
    line: { flex: 1, height: 1, backgroundColor: '#e5e7eb' },
    dividerText: { marginHorizontal: 16, color: '#9ca3af', fontSize: 12, fontWeight: '600' },
    socialBtn: {
        height: 52,
        borderRadius: 26,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        backgroundColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
    },
    socialBtnContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    socialIcon: { width: 18, height: 18 },
    socialBtnText: { color: '#333', fontSize: 16, fontWeight: '600' },
});
