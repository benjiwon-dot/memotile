// app/photobook/index.tsx
//
// AI 포토북 허브(격리). STEP 3: "프로필 등록" 진입점 연결.
// 실제 스캔/타임라인은 STEP 4 이후 이 폴더 아래에 추가된다.
import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { colors } from "../../src/theme/colors";
import { useLanguage } from "../../src/context/LanguageContext";
import { usePhotobookEnabled } from "../../src/config/featureFlags";

export default function PhotobookHome() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { t } = useLanguage();
    const enabled = usePhotobookEnabled();

    // 플래그가 꺼져 있으면 직접 진입(딥링크 등)도 차단.
    if (!enabled) return null;

    return (
        <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
            <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
                <Feather name="arrow-left" size={24} color={colors.ink} />
            </Pressable>

            <View style={styles.center}>
                <View style={styles.badge}>
                    <Feather name="cpu" size={28} color={colors.ink} />
                </View>
                <Text style={styles.title}>{t.photobookCardTitle}</Text>
                <Text style={styles.desc}>{t.pbRegisterSubtitle}</Text>

                <Pressable style={styles.cta} onPress={() => router.push("/photobook/register")}>
                    <Feather name="user-plus" size={18} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.ctaText}>{t.pbRegisterTitle}</Text>
                </Pressable>

                <Pressable style={styles.ctaSecondary} onPress={() => router.push("/photobook/scan")}>
                    <Feather name="search" size={18} color={colors.ink} style={{ marginRight: 8 }} />
                    <Text style={styles.ctaSecondaryText}>{t.pbScanTitle}</Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 24 },
    backBtn: { width: 44, height: 44, alignItems: "flex-start", justifyContent: "center" },
    center: { flex: 1, alignItems: "center", justifyContent: "center", marginTop: -40 },
    badge: {
        width: 64, height: 64, borderRadius: 20, backgroundColor: colors.surface,
        alignItems: "center", justifyContent: "center", marginBottom: 20,
        borderWidth: 1, borderColor: colors.border,
    },
    title: { fontSize: 28, fontWeight: "800", color: colors.ink, marginBottom: 10 },
    desc: { fontSize: 14, lineHeight: 22, color: colors.textMuted, textAlign: "center", marginBottom: 28, paddingHorizontal: 12 },
    cta: {
        flexDirection: "row", alignItems: "center", justifyContent: "center",
        height: 54, paddingHorizontal: 28, borderRadius: 16, backgroundColor: colors.ink,
    },
    ctaText: { fontSize: 16, fontWeight: "800", color: "#fff" },
    ctaSecondary: {
        flexDirection: "row", alignItems: "center", justifyContent: "center",
        height: 54, paddingHorizontal: 28, borderRadius: 16, marginTop: 12,
        backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    },
    ctaSecondaryText: { fontSize: 16, fontWeight: "800", color: colors.ink },
});
