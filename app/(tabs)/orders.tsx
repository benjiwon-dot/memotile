import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Package, ChevronRight } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";

import { useLanguage } from "../../src/context/LanguageContext";
import { colors } from "../../src/theme/colors";
import { shadows } from "../../src/theme/shadows";

// Mock Data Structure matching src/utils/orders.js output
// Since we cannot use localStorage in Expo, we assume an empty state or use mock data for demo.
const MOCK_ORDERS: any[] = [
    // Uncomment to test populated state
    /*
    {
        id: "ORD-7782",
        createdAt: Date.now(),
        items: [
            { src: "https://picsum.photos/200" },
            { src: "https://picsum.photos/201" }
        ],
        total: 1290.00
    }
    */
];

export default function Orders() {
    const { t } = useLanguage();
    const router = useRouter();
    const insets = useSafeAreaInsets();

    // In a real app, this would be `const [orders] = useState(getOrders())`
    const [orders] = useState(MOCK_ORDERS);

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <Text style={styles.header}>{t.orders}</Text>

            {orders.length === 0 ? (
                <View style={styles.emptyState}>
                    <View style={styles.iconPlaceholder}>
                        <Package size={48} color="#ddd" strokeWidth={1} />
                    </View>
                    <Text style={styles.emptyTitle}>{t.noOrders}</Text>
                </View>
            ) : (
                <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
                    {orders.map((order: any) => (
                        <Pressable
                            key={order.id}
                            style={({ pressed }) => [
                                styles.card,
                                pressed && { opacity: 0.98, transform: [{ scale: 0.99 }] }
                            ]}
                            onPress={() => router.push(`/orders/${order.id}`)}
                        >
                            <View style={styles.cardContent}>
                                <View style={styles.topRow}>
                                    <Text style={styles.date}>{new Date(order.createdAt).toLocaleDateString()}</Text>
                                    <Text style={styles.orderId}>#{order.id}</Text>
                                </View>

                                {/* Image strip */}
                                <View style={styles.imageStrip}>
                                    {order.items.slice(0, 5).map((item: any, idx: number) => (
                                        <View key={idx} style={styles.stripItem}>
                                            <Image
                                                source={{ uri: item.previewUrl || item.src }}
                                                style={styles.stripImg}
                                                contentFit="cover"
                                            />
                                        </View>
                                    ))}
                                    {order.items.length > 5 && (
                                        <View style={styles.moreCount}>
                                            <Text style={styles.moreCountText}>+{order.items.length - 5}</Text>
                                        </View>
                                    )}
                                </View>

                                <View style={styles.bottomRow}>
                                    <Text style={styles.itemCount}>{order.items.length} {t.items}</Text>
                                    <Text style={styles.totalPrice}>฿{order.total.toFixed(2)}</Text>
                                </View>
                            </View>
                            <ChevronRight size={20} color="#ccc" />
                        </Pressable>
                    ))}
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.surface,
        paddingTop: 60, // Matches web styles.container padding
    },
    header: {
        fontSize: 32,
        fontWeight: "700", // Matches styles.header
        paddingHorizontal: 20, // Matches styles.header paddingLeft
        marginBottom: 20,
        color: "#111", // Matches default text color implicitly
    },
    emptyState: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        // Matches styles.emptyState height='50vh' roughly by using flex:1 and margin
        marginBottom: 100,
    },
    iconPlaceholder: {
        marginBottom: 16, // Matches styles.iconPlaceholder
    },
    emptyTitle: {
        fontWeight: "600",
        fontSize: 18, // Matches generic h3
        color: "#111", // Implicit
        marginBottom: 8,
    },
    list: {
        paddingHorizontal: 20, // Matches styles.list padding
        gap: 16, // Matches styles.list gap
        paddingBottom: 100, // Extra padding for TabBar
    },
    card: {
        backgroundColor: "#fff",
        borderRadius: 20,
        padding: 20,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        ...shadows.sm, // Approximates box-shadow
    },
    cardContent: {
        flex: 1,
        marginRight: 12,
    },
    topRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 12, // Matches styles.topRow
    },
    date: {
        fontSize: 13,
        color: "#8E8E93", // Matches styles.date
        fontWeight: "500",
    },
    orderId: {
        fontSize: 13,
        color: "#111", // Matches styles.orderId
        fontWeight: "600",
        fontFamily: "Courier", // Matches font-family: monospace
    },
    imageStrip: {
        flexDirection: "row",
        gap: 6, // Matches styles.imageStrip
        marginBottom: 16,
    },
    stripItem: {
        width: 44,
        height: 44,
        borderRadius: 6,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: "#f0f0f0",
    },
    stripImg: {
        width: "100%",
        height: "100%",
    },
    moreCount: {
        width: 44,
        height: 44,
        borderRadius: 6,
        backgroundColor: "#f9f9f9",
        alignItems: "center",
        justifyContent: "center",
    },
    moreCountText: {
        fontSize: 12,
        color: "#666",
        fontWeight: "600",
    },
    bottomRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    itemCount: {
        fontSize: 14,
        color: "#666", // Matches styles.itemCount
    },
    totalPrice: {
        fontSize: 16,
        fontWeight: "700",
        color: "#111", // Matches styles.totalPrice
    },
});
