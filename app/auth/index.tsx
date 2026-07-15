// app/auth/index.tsx
import React, { useEffect } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

/**
 * Empty landing page for Google OAuth redirects.
 * expo-auth-session handles the result, but this route prevents "Page not found".
 */
const AuthRedirectHandler = () => {
    const router = useRouter();

    useEffect(() => {
        const timer = setTimeout(() => {
            if (router.canGoBack()) {
                router.back();
            } else {
                router.replace("/");
            }
        }, 3000);

        return () => clearTimeout(timer);
    }, [router]);

    return (
        <View style={styles.container}>
            <ActivityIndicator size="large" color="#FF7E66" />
            <Text style={styles.text}>Authenticating...</Text>
        </View>
    );
};

export default AuthRedirectHandler;

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#fff",
    },
    text: {
        marginTop: 20,
        fontSize: 16,
        color: "#8C7B73",
    },
});
