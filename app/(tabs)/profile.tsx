import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import {
    User, MapPin, CreditCard, HelpCircle, MessageCircle, Shield, FileText, ChevronRight, LogIn, LogOut
} from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLanguage } from "../../src/context/LanguageContext";
import { colors } from "../../src/theme/colors";
import { shadows } from "../../src/theme/shadows";

// Mock Auth logic to replace Web AuthContext locally for this step
const useMockAuth = () => {
    const [user, setUser] = useState<{ email: string } | null>(null);
    const login = () => setUser({ email: "demo@memotile.com" });
    const logout = () => setUser(null);
    return { user, login, logout };
};

export default function Profile() {
    const { t } = useLanguage();
    const router = useRouter();
    const insets = useSafeAreaInsets();

    // Use local mock auth instead of importing from src/context/AuthContext (which uses localStorage)
    const { user, login, logout } = useMockAuth();

    const handleSignIn = () => {
        login();
    };

    const handleLogout = () => {
        logout();
    };

    // Logic ported from src/pages/Profile.jsx
    const menuGroups = [
        {
            title: t.account,
            items: [
                user ? {
                    title: t.signOut || "Sign Out",
                    icon: LogOut, // Using LogOut for better UX
                    subtitle: user.email,
                    onClick: handleLogout,
                    isDestructive: true
                } : {
                    title: t.signIn,
                    icon: LogIn,
                    subtitle: t.exampleUser,
                    onClick: handleSignIn
                },
                { title: t.addresses, icon: MapPin, onClick: () => { } },
                { title: t.paymentMethods, icon: CreditCard, onClick: () => { } },
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
            ]
        }
    ];

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <Text style={styles.header}>{t.profile}</Text>

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                {menuGroups.map((group, gIdx) => (
                    <View key={gIdx} style={styles.section}>
                        <Text style={styles.sectionTitle}>{group.title}</Text>
                        <View style={styles.card}>
                            {group.items.map((item: any, iIdx: number) => {
                                const isLast = iIdx === group.items.length - 1;
                                const textColor = item.isDestructive ? colors.danger : "#111"; // Matches styles.rowTitle color
                                const iconColor = item.isDestructive ? colors.danger : "#111"; // Matches icon color

                                return (
                                    <Pressable
                                        key={`${group.title}-${iIdx}`}
                                        style={({ pressed }) => [
                                            styles.row,
                                            pressed && { backgroundColor: "#F2F2F7" } // Matches onTouchStart bg
                                        ]}
                                        onPress={item.onClick}
                                    >
                                        <View style={styles.rowLeft}>
                                            <item.icon size={20} color={iconColor} strokeWidth={2} />
                                            <Text style={[styles.rowTitle, { color: textColor }]}>{item.title}</Text>
                                        </View>
                                        <View style={styles.rowRight}>
                                            {item.subtitle && <Text style={styles.rowSubtitle}>{item.subtitle}</Text>}
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
                    <Text style={styles.version}>{t.version || "Version"} 1.0.0 (Build 124)</Text>
                    <Text style={styles.copyright}>© 2026 Memotile</Text>
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        // Note: MyOrders had paddingBottom, Profile has paddingBottom in container
        paddingBottom: 120, // Matches styles.container paddingBottom
    },
    header: {
        fontSize: 28,
        fontWeight: "800",
        marginBottom: 24,
        color: "#111", // Matches styles.header
        paddingHorizontal: 20, // In web it was implicit or from Layout, adding for safety
        marginTop: 20,
    },
    scrollContent: {
        paddingHorizontal: 20,
    },
    section: {
        marginBottom: 28, // Matches styles.section
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: "600",
        color: "#8E8E93", // Matches styles.sectionTitle
        textTransform: "uppercase",
        letterSpacing: 0.4,
        marginBottom: 8,
        marginLeft: 4,
    },
    card: {
        backgroundColor: "#fff",
        borderRadius: 16,
        overflow: "hidden",
        ...shadows.sm, // Matches box-shadow
    },
    row: {
        width: "100%",
        height: 56, // Matches styles.row
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        position: "relative",
    },
    rowLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12, // Matches styles.rowLeft
    },
    rowTitle: {
        fontSize: 16,
        fontWeight: "500",
        color: "#111", // Matches styles.rowTitle
    },
    rowRight: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8, // Matches styles.rowRight
    },
    rowSubtitle: {
        fontSize: 14,
        color: "#8E8E93", // Matches styles.rowSubtitle
    },
    divider: {
        position: "absolute",
        bottom: 0,
        right: 0,
        left: 48, // Matches styles.divider left
        height: 1, // Matches styles.divider height
        backgroundColor: "#F2F2F7", // Matches styles.divider bg
    },
    footer: {
        alignItems: "center",
        marginTop: 12, // Matches styles.footer
    },
    version: {
        fontSize: 12,
        color: "#C7C7CC", // Matches styles.version
        marginBottom: 4,
    },
    copyright: {
        fontSize: 12,
        color: "#C7C7CC", // Matches styles.copyright
    },
});
