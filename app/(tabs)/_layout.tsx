import React from "react";
import { Tabs } from "expo-router";
import { BlurView } from "expo-blur";
import { StyleSheet, View } from "react-native";
import { Home, Package, User } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "../../src/theme/colors";
import { useLanguage } from "../../src/context/LanguageContext";

/**
 * TabBar Design Intent:
 * 
 * 1. Persistent Context: The TabBar remains visible across main navigation flows (Home, Orders, Profile),
 *    grounding the user in the app's primary architecture.
 * 2. Glassmorphism: Matches the web's 'backdrop-filter: blur' using native `BlurView`.
 *    This ensures content scrolling behind the bar captures the premium, airy feel of the brand.
 * 3. Thumb-Friendly: Height is adjusted for safe areas + hit targets (60px + inset).
 * 4. Minimal Animation: Tabs switch instantly or with subtle cross-dissolve (default),
 *    avoiding heavy transitions that distract from the task.
 */
export default function TabLayout() {
    const { t } = useLanguage();
    const insets = useSafeAreaInsets();

    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarStyle: {
                    position: "absolute",
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                    elevation: 0,
                    height: 60 + insets.bottom,
                    backgroundColor: "transparent", // Transparent to let BlurView show through
                },
                tabBarBackground: () => (
                    // Native Glassmorphism
                    <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
                ),
                tabBarLabelStyle: {
                    fontSize: 10,
                    fontWeight: "500",
                    marginBottom: 4,
                    marginTop: -4,
                },
                tabBarActiveTintColor: colors.primary,
                tabBarInactiveTintColor: colors.textSecondary,
            }}
        >
            <Tabs.Screen
                name="index"
                options={{
                    title: t.home,
                    tabBarIcon: ({ color }) => (
                        <Home size={24} color={color} strokeWidth={2.5} />
                    ),
                }}
            />
            <Tabs.Screen
                name="orders"
                options={{
                    title: t.orders,
                    tabBarIcon: ({ color }) => (
                        <Package size={24} color={color} strokeWidth={2.5} />
                    ),
                }}
            />
            <Tabs.Screen
                name="profile"
                options={{
                    title: t.profile,
                    tabBarIcon: ({ color }) => (
                        <User size={24} color={color} strokeWidth={2.5} />
                    ),
                }}
            />
        </Tabs>
    );
}
