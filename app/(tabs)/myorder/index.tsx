// app/(tabs)/myorder/index.tsx
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Package } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLanguage } from "../../../src/context/LanguageContext";
import { colors } from "../../../src/theme/colors";
import { shadows } from "../../../src/theme/shadows";
import { auth } from "../../../src/lib/firebase";
import { listOrders } from "../../../src/services/orders";
import { OrderDoc } from "../../../src/types/order";
import OrderCardRN from "../../../src/components/orders/OrderCardRN";
import { User } from "firebase/auth";

export default function Orders() {
    const { t } = useLanguage();
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const [orders, setOrders] = useState<OrderDoc[]>([]);
    const [loading, setLoading] = useState(true);

    // ✨ 현재 로그인한 유저 상태를 실시간으로 추적하기 위한 State 추가
    const [user, setUser] = useState<User | null>(null);

    useEffect(() => {
        // ✨ 실시간 로그인 감지기: 프로필에서 로그인을 하든 로그아웃을 하든 즉시 반응합니다!
        const unsubscribe = auth.onAuthStateChanged((currentUser) => {
            setUser(currentUser);
            if (currentUser) {
                fetchOrders(currentUser.uid);
            } else {
                // 로그아웃 상태면 주문 내역을 비우고 로딩을 끕니다.
                setOrders([]);
                setLoading(false);
            }
        });

        // 화면이 꺼질 때 감지기 해제
        return () => unsubscribe();
    }, []);

    const fetchOrders = async (uid: string) => {
        setLoading(true);
        try {
            const data = await listOrders(uid);
            setOrders(data);
        } catch (e) {
            console.error("Failed to fetch orders", e);
            Alert.alert("Error", "Failed to load orders. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const renderHeader = () => (
        <Text style={styles.header}>{t.orders || "My Orders"}</Text>
    );

    const renderEmpty = () => (
        <View style={styles.emptyState}>
            <View style={styles.iconPlaceholder}>
                <Package size={64} color="#ddd" strokeWidth={1} />
            </View>
            <Text style={styles.emptyTitle}>{t.noOrders || "No orders yet"}</Text>
        </View>
    );

    if (loading) {
        return (
            <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
                <ActivityIndicator size="large" color="#000" />
            </View>
        );
    }

    // ✨ auth.currentUser 대신 실시간 추적 중인 user State를 사용합니다.
    if (!user) {
        return (
            <View style={[styles.container, { paddingTop: insets.top }]}>
                <Text style={styles.header}>{t.orders || "My Orders"}</Text>
                <View style={styles.emptyState}>
                    <Text style={styles.authMessage}>Please log in to view your orders.</Text>
                    <TouchableOpacity style={styles.loginBtn} onPress={() => router.push('/auth/email')}>
                        <Text style={styles.loginBtnText}>Go to Login</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <FlatList
                data={orders}
                keyExtractor={(item) => item.id || Math.random().toString()}
                ListHeaderComponent={renderHeader}
                ListEmptyComponent={renderEmpty}
                contentContainerStyle={styles.list}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => (
                    <OrderCardRN
                        order={item}
                        onPress={() => router.push(`/myorder/${item.id}`)}
                    />
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.surface || '#F7F7F8',
    },
    header: {
        fontSize: 32,
        fontWeight: "700",
        paddingHorizontal: 20,
        marginBottom: 20,
        color: "#111",
    },
    list: {
        paddingHorizontal: 20,
        paddingBottom: 100,
    },
    emptyState: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 100,
    },
    iconPlaceholder: {
        marginBottom: 16,
    },
    emptyTitle: {
        fontWeight: "600",
        fontSize: 18,
        color: "#999",
    },
    center: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    authMessage: {
        fontSize: 16,
        color: "#666",
        textAlign: "center",
        marginBottom: 20,
    },
    loginBtn: {
        backgroundColor: "#000",
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 20,
        ...shadows.sm,
    },
    loginBtnText: {
        color: "#fff",
        fontWeight: "700",
    },
});