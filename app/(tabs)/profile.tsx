// app/(tabs)/profile.tsx
import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, Alert } from "react-native";
import { useRouter } from "expo-router";
import {
    User as UserIcon, MapPin, CreditCard, HelpCircle, MessageCircle, Shield, FileText, ChevronRight, LogIn, LogOut, Trash2
} from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLanguage } from "../../src/context/LanguageContext";
import { usePhoto } from "../../src/context/PhotoContext";
import { colors } from "../../src/theme/colors";
import { shadows } from "../../src/theme/shadows";
import { auth, db } from "../../src/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { deleteUser } from "firebase/auth";

export default function Profile() {
    const { t, locale } = useLanguage();
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const { clearDraft, clearPhotos } = usePhoto() || {};

    const [user, setUser] = useState(auth.currentUser);
    const [userData, setUserData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);

    const [modalVisible, setModalVisible] = useState(false);
    const [modalInfo, setModalInfo] = useState({ title: "", content: "" });

    const unsubDocRef = React.useRef<(() => void) | null>(null);

    useEffect(() => {
        const unsubAuth = auth.onAuthStateChanged((u) => {
            setUser(u);
            if (u) {
                fetchUserData(u.uid);
            } else {
                setUserData(null);
                if (unsubDocRef.current) {
                    unsubDocRef.current();
                    unsubDocRef.current = null;
                }
            }
        });
        return () => {
            unsubAuth();
            if (unsubDocRef.current) unsubDocRef.current();
        };
    }, []);

    const fetchUserData = (uid: string) => {
        setIsLoading(true);
        if (unsubDocRef.current) unsubDocRef.current();

        unsubDocRef.current = onSnapshot(doc(db, "users", uid), (docSnap) => {
            if (docSnap.exists()) {
                setUserData(docSnap.data());
            }
            setIsLoading(false);
        }, (error) => {
            console.warn("Profile snapshot error:", error.message);
            setIsLoading(false);
        });
    };

    // ✨ 실수 방지용 로그아웃 확인 팝업 (태국어/영어 지원)
    const handleLogout = () => {
        Alert.alert(
            (t as any).signOut || (locale === 'TH' ? "ออกจากระบบ" : "Sign Out"),
            locale === 'TH' ? "คุณต้องการออกจากระบบใช่หรือไม่?" : "Are you sure you want to sign out?",
            [
                { text: locale === 'TH' ? "ยกเลิก" : "Cancel", style: "cancel" },
                {
                    text: (t as any).signOut || (locale === 'TH' ? "ออกจากระบบ" : "Sign Out"),
                    style: "destructive",
                    onPress: async () => {
                        try {
                            if (clearDraft) await clearDraft();
                            if (clearPhotos) clearPhotos();
                            await auth.signOut();
                            router.replace("/");
                        } catch (e) {
                            console.error("Logout failed", e);
                        }
                    }
                }
            ]
        );
    };

    // 회원 탈퇴 로직
    const handleDeleteAccount = () => {
        Alert.alert(
            (t as any).deleteAccountTitle || (locale === 'TH' ? "ลบบัญชี" : "Delete Account"),
            (t as any).deleteAccountMsg || (locale === 'TH' ? "คุณแน่ใจหรือไม่ว่าต้องการลบบัญชีของคุณอย่างถาวร? การกระทำนี้ไม่สามารถย้อนกลับได้" : "Are you sure you want to permanently delete your account? This action cannot be undone."),
            [
                { text: (t as any).cancel || (locale === 'TH' ? "ยกเลิก" : "Cancel"), style: "cancel" },
                {
                    text: (t as any).delete || (locale === 'TH' ? "ลบ" : "Delete"),
                    style: "destructive",
                    onPress: async () => {
                        if (user) {
                            try {
                                await deleteUser(user);
                                if (clearDraft) await clearDraft();
                                if (clearPhotos) clearPhotos();
                                router.replace("/");
                            } catch (error: any) {
                                if (error.code === 'auth/requires-recent-login') {
                                    Alert.alert(
                                        locale === 'TH' ? "จำเป็นต้องยืนยันตัวตน" : "Authentication Required",
                                        locale === 'TH' ? "โปรดออกจากระบบและเข้าสู่ระบบอีกครั้งเพื่อลบบัญชีของคุณ" : "Please sign out and sign in again to delete your account."
                                    );
                                } else {
                                    Alert.alert(locale === 'TH' ? "ข้อผิดพลาด" : "Error", error.message);
                                }
                            }
                        }
                    }
                }
            ]
        );
    };

    const showDetail = (title: string, type: 'address' | 'payment') => {
        if (!user) return router.push("/auth/email");

        let content = "";
        if (type === 'address') {
            const addr = userData?.defaultAddress;
            if (!addr) {
                content = (t as any).noAddressSaved || (locale === 'TH' ? "ไม่มีที่อยู่ที่บันทึกไว้" : "No address saved");
            } else {
                content = `${addr.fullName || ""}\n${addr.addressLine1 || ""}\n${addr.addressLine2 ? addr.addressLine2 + "\n" : ""}${addr.city}, ${addr.state} ${addr.postalCode}\n\nPhone: ${addr.phone || ""}`;
            }
        } else {
            const pay = userData?.lastPayment;
            if (!pay) {
                content = (t as any).noPaymentHistory || (locale === 'TH' ? "ไม่มีประวัติการชำระเงิน" : "No payment history");
            } else {
                content = `Date: ${pay.date}\nMethod: ${pay.method}\n\nID: ${pay.id || 'N/A'}`;
            }
        }

        setModalInfo({ title, content });
        setModalVisible(true);
    };

    const getAddressSummary = () => {
        if (!userData?.defaultAddress) return (t as any).noAddressSaved || (locale === 'TH' ? "ไม่มีที่อยู่ที่บันทึกไว้" : "No address saved");
        const addr = userData.defaultAddress;
        return `${addr.city || ""}, ${addr.state || ""}`.replace(/^, /, "");
    };

    const getPaymentSummary = () => {
        if (!userData?.lastPayment) return (t as any).noPaymentHistory || (locale === 'TH' ? "ไม่มีประวัติ" : "No history");
        return `${userData.lastPayment.date} (${userData.lastPayment.method})`;
    };

    const menuGroups = [
        {
            title: t.account,
            items: [
                user ? {
                    title: (t as any).signOut || (locale === 'TH' ? "ออกจากระบบ" : "Sign Out"),
                    icon: LogOut,
                    subtitle: user.email,
                    onClick: handleLogout,
                    isDestructive: false
                } : {
                    title: t.signIn,
                    icon: LogIn,
                    subtitle: (t as any).signInToContinue || (locale === 'TH' ? "เข้าสู่ระบบเพื่อดำเนินการต่อ" : "Sign in to continue"),
                    onClick: () => router.push("/auth/email")
                },
                {
                    title: t.addresses,
                    icon: MapPin,
                    subtitle: user ? getAddressSummary() : null,
                    onClick: () => showDetail(t.addresses, 'address')
                },
                {
                    title: t.paymentMethods,
                    icon: CreditCard,
                    subtitle: user ? getPaymentSummary() : null,
                    onClick: () => showDetail(t.paymentMethods, 'payment')
                },
            ]
        },
        {
            title: t.support,
            items: [
                { title: t.faq, icon: HelpCircle, onClick: () => router.push('/faq') },
                { title: t.chatWithUs, icon: MessageCircle, onClick: () => router.push('/contact') },
            ]
        },
        {
            title: t.legal,
            items: [
                { title: t.privacyPolicy, icon: Shield, onClick: () => router.push('/privacy') },
                { title: t.termsOfService, icon: FileText, onClick: () => router.push('/terms') },
                ...(user ? [{
                    title: (t as any).deleteAccount || (locale === 'TH' ? "ลบบัญชี" : "Delete Account"),
                    icon: Trash2,
                    onClick: handleDeleteAccount,
                    isDestructive: true
                }] : [])
            ]
        }
    ];

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.headerRow}>
                <Text style={styles.header}>{t.profile}</Text>
                {isLoading && <ActivityIndicator size="small" color={colors.ink} style={{ marginRight: 20 }} />}
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                {menuGroups.map((group, gIdx) => (
                    <View key={gIdx} style={styles.section}>
                        <Text style={styles.sectionTitle}>{group.title}</Text>
                        <View style={styles.card}>
                            {group.items.map((item: any, iIdx: number) => {
                                const isLast = iIdx === group.items.length - 1;
                                const textColor = item.isDestructive ? colors.danger : "#111";
                                const iconColor = item.isDestructive ? colors.danger : "#111";

                                return (
                                    <Pressable
                                        key={`${group.title}-${iIdx}`}
                                        style={({ pressed }) => [
                                            styles.row,
                                            pressed && { backgroundColor: "#F2F2F7" }
                                        ]}
                                        onPress={item.onClick}
                                    >
                                        <View style={styles.rowLeft}>
                                            <item.icon size={20} color={iconColor} strokeWidth={2} />
                                            <Text style={[styles.rowTitle, { color: textColor }]} numberOfLines={1}>
                                                {item.title}
                                            </Text>
                                        </View>

                                        <View style={styles.rowRight}>
                                            {item.subtitle && (
                                                <Text style={styles.rowSubtitle} numberOfLines={1}>
                                                    {item.subtitle}
                                                </Text>
                                            )}
                                            <ChevronRight size={18} color="#8E8E93" />
                                        </View>
                                        {!isLast && <View style={styles.divider} />}
                                    </Pressable>
                                );
                            })}
                        </View>
                    </View>
                ))}

                <View style={styles.footer}>
                    <Text style={styles.version}>{(t as any).version || (locale === 'TH' ? 'เวอร์ชั่น' : 'Version')} 1.0.0 (Build 124)</Text>
                    <Text style={styles.copyright}>© 2026 Memotile</Text>
                </View>
            </ScrollView>

            <Modal
                animationType="slide"
                transparent={true}
                visible={modalVisible}
                onRequestClose={() => setModalVisible(false)}
            >
                <Pressable style={styles.modalOverlay} onPress={() => setModalVisible(false)} />
                <View style={styles.bottomSheet}>
                    <View style={styles.sheetHandle} />
                    <Text style={styles.sheetTitle}>{modalInfo.title}</Text>
                    <View style={styles.sheetCard}>
                        <Text style={styles.sheetContent}>{modalInfo.content}</Text>
                    </View>
                    <Pressable
                        style={styles.confirmButton}
                        onPress={() => setModalVisible(false)}
                    >
                        <Text style={styles.confirmButtonText}>
                            {(t as any).ok || (locale === 'TH' ? 'ตกลง' : 'OK')}
                        </Text>
                    </Pressable>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#F7F7F8", paddingBottom: 60 },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    header: { fontSize: 28, fontWeight: "800", marginBottom: 24, color: "#111", paddingHorizontal: 20, marginTop: 20 },
    scrollContent: { paddingHorizontal: 20 },
    section: { marginBottom: 28 },
    sectionTitle: { fontSize: 13, fontWeight: "600", color: "#8E8E93", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8, marginLeft: 4 },
    card: { backgroundColor: "#fff", borderRadius: 16, overflow: "hidden", ...shadows.sm },
    row: {
        width: "100%",
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        position: "relative"
    },
    rowLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        flexShrink: 1,
        marginRight: 10
    },
    rowTitle: { fontSize: 16, fontWeight: "500", color: "#111" },
    rowRight: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        flex: 1,
        justifyContent: 'flex-end'
    },
    rowSubtitle: { fontSize: 13, color: "#8E8E93", flexShrink: 1 },
    divider: { position: "absolute", bottom: 0, right: 0, left: 48, height: 1, backgroundColor: "#F2F2F7" },
    footer: { alignItems: "center", marginTop: 12, marginBottom: 40 },
    version: { fontSize: 12, color: "#C7C7CC", marginBottom: 4 },
    copyright: { fontSize: 12, color: "#C7C7CC" },
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
    bottomSheet: {
        position: "absolute", bottom: 0, left: 0, right: 0,
        backgroundColor: "white", borderTopLeftRadius: 24, borderTopRightRadius: 24,
        padding: 24, paddingBottom: 50, alignItems: "center", ...shadows.lg,
    },
    sheetHandle: { width: 40, height: 5, backgroundColor: "#E5E7EB", borderRadius: 10, marginBottom: 20 },
    sheetTitle: { fontSize: 18, fontWeight: "700", color: "#111", marginBottom: 20 },
    sheetCard: { width: '100%', backgroundColor: "#F8F9FA", padding: 18, borderRadius: 16, marginBottom: 24 },
    sheetContent: { fontSize: 15, lineHeight: 22, color: "#4B5563" },
    confirmButton: { width: '100%', height: 54, backgroundColor: "#111", borderRadius: 12, justifyContent: "center", alignItems: "center" },
    confirmButtonText: { color: "white", fontSize: 16, fontWeight: "600" }
});