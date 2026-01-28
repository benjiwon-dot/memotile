// app/index.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    Alert,
    Linking,
    type PressableStateCallbackType,

    type StyleProp,
    type ViewStyle,
} from "react-native";
import { useRouter } from "expo-router";
import { Image as ExpoImage, type ImageSource } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { BlurView } from "expo-blur";

import { colors } from "../../src/theme/colors";
import { layout } from "../../src/theme/layout";
import { shadows } from "../../src/theme/shadows";
import { typography } from "../../src/theme/typography";
import { useLanguage } from "../../src/context/LanguageContext";
import { usePhoto } from "../../src/context/PhotoContext";

// --- Assets ---
// --- Assets ---
const heroNew1 = require("../../src/assets/hero_new_1.jpg") as ImageSource;
const heroNew2 = require("../../src/assets/hero_new_2.jpg") as ImageSource;
const heroNew3 = require("../../src/assets/hero_new_3.jpg") as ImageSource;
const heroNew4 = require("../../src/assets/hero_new_4.jpg") as ImageSource;

const ASSETS = {
    dog: require("../../src/assets/hero_1_dog.png") as ImageSource,
    family: require("../../src/assets/hero_2_family.png") as ImageSource,
    couple: require("../../src/assets/hero_3_couple.png") as ImageSource,
    travel: require("../../src/assets/hero_4_travel.jpg") as ImageSource,
};

const slideshowImages: ImageSource[] = [heroNew1, heroNew2, heroNew3, heroNew4];

type Benefit = { title: string; desc: string };
type Step = { title: string; desc: string };
type BillboardItem = { label: string; caption: string };

export default function Index() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { t, locale, setLocale } = useLanguage();
    // Destructure everything we need from usePhoto
    const { setPhotos, saveDraft, hasDraft, loadDraft } = usePhoto();

    const [slideshowIndex, setSlideshowIndex] = useState(0);
    const [billboardIndex, setBillboardIndex] = useState(0);

    // Draft loading on mount? Or just rely on hasDraft if context checks it.
    // We can rely on hasDraft from context.

    // Resume Handler
    const handleResume = async () => {
        const loaded = await loadDraft();
        if (loaded) {
            router.push("/create/select");
        } else {
            // Draft invalid
            Alert.alert("", t.noPhotosSelected);
        }
    };

    useEffect(() => {
        const slideshowTimer = setInterval(() => {
            setSlideshowIndex((prev) => (prev + 1) % slideshowImages.length);
        }, 2000);

        const billboardTimer = setInterval(() => {
            setBillboardIndex((prev) => (prev + 1) % 4);
        }, 2000);

        return () => {
            clearInterval(slideshowTimer);
            clearInterval(billboardTimer);
        };
    }, []);

    const billboardThemes = useMemo(
        () => [
            { id: "couple", img: ASSETS.couple },
            { id: "pet", img: ASSETS.dog },
            { id: "travel", img: ASSETS.travel },
            { id: "family", img: ASSETS.family },
        ],
        []
    );

    const handleStart = async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

        if (status !== ImagePicker.PermissionStatus.GRANTED) {
            Alert.alert(
                t.permissionDeniedTitle,
                t.permissionDeniedBody,
                [
                    { text: t.cancel, style: "cancel" },
                    { text: t.openSettings, onPress: () => Linking.openSettings() }
                ]
            );
            return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsMultipleSelection: true,
            selectionLimit: 20,
            quality: 1,
        });

        if (!result.canceled && result.assets?.length) {
            setPhotos(result.assets);
            await saveDraft('select'); // Save draft
            router.push("/create/select");
        }
    };

    // ✅ Pressable style callback 타입 안전 처리
    const primaryBtnStyle = ({ pressed }: PressableStateCallbackType): StyleProp<ViewStyle> => [
        styles.primaryBtn,
        pressed && { transform: [{ scale: 0.98 }] },
    ];

    const benefits = (t.benefits ?? []) as Benefit[];
    const steps = (t.steps ?? []) as Step[];
    const billboard = (t.billboard ?? []) as BillboardItem[];

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            {/* --- RESUME BANNER (Fixed above TabBar) --- */}
            {hasDraft && (
                <View style={[styles.resumeBanner, { bottom: layout.spacing.bottomTabHeight + insets.bottom + 20 }]}>
                    <View style={styles.resumeContent}>
                        <View>
                            <Text style={styles.resumeTitle}>{t.resumeTitle}</Text>
                            <Text style={styles.resumeSubtitle}>{t.resumeSubtitle}</Text>
                        </View>
                        <Pressable style={styles.resumeBtn} onPress={handleResume}>
                            <Text style={styles.resumeBtnText}>{t.resumeCta}</Text>
                            <Feather name="arrow-right" size={16} color="#fff" />
                        </Pressable>
                    </View>
                </View>
            )}

            {/* --- TOP NAV (Blur Effect) --- */}
            <BlurView intensity={80} tint="light" style={[styles.topNav, { paddingTop: insets.top }]}>
                <View style={styles.navContent}>
                    <View style={styles.logoGroup}>
                        <Text style={styles.brandTitle}>MEMOTILE</Text>

                    </View>

                    <View style={styles.langContainer}>
                        <Feather
                            // Feather name 타입이 빡세서 literal 캐스팅으로 안정화
                            name={"globe" as any}
                            size={14}
                            color={colors.textSecondary}
                            style={{ marginRight: 6 }}
                        />
                        <View style={styles.langPill}>
                            <Pressable
                                style={[styles.langBtn, locale === "TH" && styles.langBtnActive]}
                                onPress={() => setLocale("TH")}
                            >
                                <Text style={[styles.langText, locale === "TH" && styles.langTextActive]}>TH</Text>
                            </Pressable>
                            <Pressable
                                style={[styles.langBtn, locale === "EN" && styles.langBtnActive]}
                                onPress={() => setLocale("EN")}
                            >
                                <Text style={[styles.langText, locale === "EN" && styles.langTextActive]}>EN</Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </BlurView>

            <ScrollView
                contentContainerStyle={{
                    paddingTop: 64,
                    paddingBottom: layout.spacing.bottomTabHeight + insets.bottom + 20,
                }}
                showsVerticalScrollIndicator={false}
            >
                {/* --- HERO SECTION --- */}
                <View style={styles.hero}>
                    <View style={styles.heroContent}>
                        <View style={styles.headlineGroup}>
                            <Text style={styles.heroHeadline1}>{t.heroHeadlineLine1}</Text>
                            <Text style={styles.heroHeadline2}>{t.heroHeadlineLine2}</Text>
                        </View>
                        <Text style={styles.heroSupporting}>{t.heroSupporting}</Text>

                        <View style={styles.heroPreview}>
                            <View style={styles.slideshowContainer}>
                                {slideshowImages.map((img, idx) => (
                                    <View
                                        key={idx}
                                        style={[
                                            StyleSheet.absoluteFillObject,
                                            { opacity: slideshowIndex === idx ? 1 : 0 },
                                        ]}
                                    >
                                        <ExpoImage source={img} style={styles.heroTile} contentFit="cover" transition={200} />
                                    </View>
                                ))}
                            </View>
                        </View>

                        <View style={styles.ctaWrapper}>
                            <View style={styles.ctaGroup}>
                                <Pressable style={primaryBtnStyle} onPress={handleStart}>
                                    <View style={styles.ctaInner}>
                                        <Feather name={"crop" as any} size={20} color="#fff" style={{ marginRight: 12 }} />
                                        <Text style={styles.ctaText}>{t.ctaStart}</Text>
                                    </View>
                                </Pressable>
                                <Text style={styles.ctaHint}>{t.ctaHint}</Text>
                            </View>
                        </View>
                    </View>
                </View>

                {/* --- KEY BENEFITS --- */}
                <View style={[styles.section, { backgroundColor: colors.canvas }]}>
                    <Text style={styles.sectionSmallTitle}>{t.benefitsTitle}</Text>
                    <View style={styles.grid}>
                        {benefits.map((b, i) => (
                            <BenefitCard
                                key={i}
                                icon={
                                    i === 0 ? (
                                        <Feather name={"scissors" as any} size={20} color={colors.ink} />
                                    ) : i === 1 ? (
                                        <Feather name={"move" as any} size={20} color={colors.ink} />
                                    ) : (
                                        <Feather name={"info" as any} size={20} color={colors.ink} />
                                    )
                                }
                                title={b.title}
                                desc={b.desc}
                            />
                        ))}
                    </View>
                </View>

                {/* --- AUTO-ROTATING BILLBOARD --- */}
                <View style={styles.section}>
                    <View style={styles.billboardContainer}>
                        <View style={styles.billboardImgWrapper}>
                            {billboardThemes.map((theme, idx) => (
                                <View
                                    key={theme.id}
                                    style={[
                                        StyleSheet.absoluteFillObject,
                                        {
                                            zIndex: billboardIndex === idx ? 2 : 1,
                                            justifyContent: "center",
                                            alignItems: "center",
                                            opacity: billboardIndex === idx ? 1 : 0,
                                            transform: [{ scale: billboardIndex === idx ? 1 : 0.98 }],
                                        },
                                    ]}
                                >
                                    <View style={styles.billboardImgContainer}>
                                        <ExpoImage source={theme.img} style={{ width: 280, height: 280 }} contentFit="cover" />
                                    </View>
                                </View>
                            ))}
                        </View>

                        <View style={styles.billboardInfo}>
                            <View style={styles.billboardLabelContainer}>
                                <Text style={styles.billboardLabel}>{billboard[billboardIndex]?.label}</Text>
                            </View>
                            <Text style={styles.billboardCaption}>{billboard[billboardIndex]?.caption}</Text>
                        </View>

                        <View style={styles.billboardDots}>
                            {[0, 1, 2, 3].map((i) => (
                                <View
                                    key={i}
                                    style={[
                                        styles.dot,
                                        {
                                            backgroundColor:
                                                billboardIndex === i ? colors.billboardDotActive : colors.billboardDot,
                                        },
                                    ]}
                                />
                            ))}
                        </View>
                    </View>
                </View>

                {/* --- HOW IT WORKS --- */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t.howItWorks}</Text>
                    <View style={styles.stepsContainer}>
                        {steps.map((s, i) => (
                            <StepItem key={i} num={i + 1} title={s.title} desc={s.desc} />
                        ))}
                    </View>
                </View>

                {/* --- DELIVERY PROMISE --- */}
                <View style={styles.deliverySection}>
                    <Feather name={"truck" as any} size={40} color="#fff" style={{ marginBottom: 16 }} />
                    <Text style={styles.deliveryTitle}>{t.deliveryHeadline}</Text>
                    <Text style={styles.deliverySubtitle}>{t.deliverySub}</Text>
                </View>

                {/* --- FOOTER --- */}
                <View style={styles.footer}>
                    <Text style={styles.footerHelpTitle}>{t.needHelp}</Text>
                    <View style={styles.footerActions}>
                        <Pressable style={styles.footerBtn}>
                            <Feather name={"message-circle" as any} size={18} color={colors.ink} />
                            <Text style={styles.footerBtnText}>LINE</Text>
                        </Pressable>
                        <Pressable style={styles.footerBtn}>
                            <Feather name={"instagram" as any} size={18} color={colors.ink} />
                            <Text style={styles.footerBtnText}>Instagram</Text>
                        </Pressable>
                    </View>
                    <Text style={styles.legal}>{t.copyright}</Text>
                </View>
            </ScrollView>
        </View>
    );
}

// --- Subcomponents ---
const BenefitCard = ({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) => (
    <View style={styles.benefitCard}>
        <View style={styles.benefitIcon}>{icon}</View>
        <View style={{ flex: 1 }}>
            <Text style={styles.benefitTitle}>{title}</Text>
            <Text style={styles.benefitDesc}>{desc}</Text>
        </View>
    </View>
);

const StepItem = ({ num, title, desc }: { num: number; title: string; desc: string }) => (
    <View style={styles.stepItem}>
        <View style={styles.stepNum}>
            <Text style={styles.stepNumText}>{num}</Text>
        </View>
        <View style={styles.stepInfo}>
            <Text style={styles.stepTitle}>{title}</Text>
            <Text style={styles.stepDesc}>{desc}</Text>
        </View>
    </View>
);

// --- STYLES ---
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    topNav: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 100 },
    navContent: {
        height: 64,
        paddingHorizontal: 24,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    logoGroup: { flexDirection: "row", alignItems: "center" },
    brandTitle: { ...typography.brand, color: colors.text },
    langContainer: { flexDirection: "row", alignItems: "center" },
    langPill: {
        flexDirection: "row",
        backgroundColor: colors.background,
        borderRadius: 20,
        padding: 2,
        borderWidth: 1,
        borderColor: colors.border,
    },
    langBtn: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 16 },
    langBtnActive: { backgroundColor: colors.surface, ...shadows.sm },
    langText: { fontSize: 11, fontWeight: "700", color: colors.textSecondary },
    langTextActive: { color: colors.text },

    section: { padding: layout.spacing.pagePadding, paddingVertical: 40 },
    hero: { paddingTop: 32, paddingBottom: 48, alignItems: "center" },
    heroContent: { maxWidth: 480, width: "100%", alignItems: "center" },
    headlineGroup: { marginBottom: 8, paddingHorizontal: 20, alignItems: "center" },
    heroHeadline1: { ...typography.h1, textAlign: "center", color: colors.ink },
    heroHeadline2: { ...typography.h2, marginTop: 4, textAlign: "center", color: colors.ink },
    heroSupporting: {
        ...typography.body,
        textAlign: "center",
        marginBottom: 40,
        paddingHorizontal: 24,
        opacity: 0.9,
        color: colors.textMuted,
    },
    heroPreview: {
        height: 280,
        width: "100%",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 40,
    },
    slideshowContainer: { width: 260, height: 260 },
    heroTile: { width: 260, height: 260, borderRadius: 4, ...shadows.md },

    ctaWrapper: { width: "100%", alignItems: "center", paddingHorizontal: 24 },
    ctaGroup: { width: "100%", maxWidth: 360 },
    primaryBtn: {
        width: "100%",
        backgroundColor: colors.ink,
        height: 52,
        borderRadius: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        ...shadows.cta,
    },
    ctaInner: { flexDirection: "row", alignItems: "center" },
    ctaText: { ...typography.button },
    ctaHint: { ...typography.caption, marginTop: 10, textAlign: "center" },

    sectionTitle: { ...typography.h3, marginBottom: 24, textAlign: "center", color: colors.ink },
    sectionSmallTitle: { ...typography.sectionHeader, marginBottom: 24, textAlign: "center" },
    grid: { gap: 24 },

    benefitCard: { flexDirection: "row", gap: 16, alignItems: "center" },
    benefitIcon: {
        width: 48,
        height: 48,
        borderRadius: 12,
        backgroundColor: colors.surface,
        alignItems: "center",
        justifyContent: "center",
        ...shadows.sm,
    },
    benefitTitle: { ...typography.h4, marginBottom: 4, color: colors.ink },
    benefitDesc: { fontSize: 14, color: colors.textMuted, lineHeight: 21 },

    billboardContainer: {
        paddingVertical: 40,
        backgroundColor: colors.canvas,
        borderRadius: 32,
        alignItems: "center",
    },
    billboardImgWrapper: {
        width: 280,
        height: 280,
        marginBottom: 32,
        position: "relative",
        alignItems: "center",
        justifyContent: "center",
    },
    billboardImgContainer: { borderRadius: 4, overflow: "hidden", ...shadows.md },
    billboardInfo: { paddingHorizontal: 24, alignItems: "center" },
    billboardLabelContainer: {
        backgroundColor: colors.fill,
        borderRadius: 20,
        paddingVertical: 6,
        paddingHorizontal: 14,
        marginBottom: 16,
    },
    billboardLabel: {
        fontSize: 11,
        fontWeight: "800",
        textTransform: "uppercase",
        letterSpacing: 0.55,
        color: colors.text,
    },
    billboardCaption: { fontSize: 19, fontWeight: "700", color: colors.ink, textAlign: "center", lineHeight: 27 },
    billboardDots: { flexDirection: "row", gap: 8, marginTop: 24 },
    dot: { width: 6, height: 6, borderRadius: 3 },

    stepsContainer: { gap: 40, paddingVertical: 10 },
    stepItem: { flexDirection: "row", gap: 20, alignItems: "flex-start" },
    stepNum: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: colors.ink,
        alignItems: "center",
        justifyContent: "center",
    },
    stepNumText: { color: colors.surface, fontSize: 14, fontWeight: "800" },
    stepInfo: { flex: 1 },
    stepTitle: { fontSize: 20, fontWeight: "900", marginBottom: 6, color: colors.ink },
    stepDesc: { ...typography.bodySmall, color: colors.textMuted },

    deliverySection: {
        margin: 24,
        paddingVertical: 60,
        paddingHorizontal: 24,
        backgroundColor: colors.ink,
        borderRadius: 32,
        alignItems: "center",
    },
    deliveryTitle: { color: colors.surface, fontSize: 28, fontWeight: "800", marginBottom: 12 },
    deliverySubtitle: { color: colors.surface, fontSize: 18, opacity: 0.8, textAlign: "center" },

    footer: {
        paddingVertical: 60,
        paddingHorizontal: 24,
        alignItems: "center",
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    footerHelpTitle: { fontSize: 20, fontWeight: "800", marginBottom: 24, color: colors.ink },
    footerActions: { flexDirection: "row", justifyContent: "center", gap: 12, marginBottom: 48 },
    footerBtn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 14,
        paddingHorizontal: 24,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 14,
        backgroundColor: colors.surface,
        ...shadows.sm,
    },
    footerBtnText: { fontSize: 15, fontWeight: "700", color: colors.text },
    legal: { fontSize: 13, color: colors.textSecondary },

    // Resume Banner
    resumeBanner: {
        position: 'absolute',
        left: 16,
        right: 16,
        backgroundColor: colors.surface, // Use surface or ink? Lets use white with shadow
        borderRadius: 16,
        padding: 16,
        zIndex: 90, // below nav but above scroll
        ...shadows.md,
        borderWidth: 1,
        borderColor: colors.border,
    },
    resumeContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    resumeTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: colors.ink,
        marginBottom: 2,
    },
    resumeSubtitle: {
        fontSize: 12,
        color: colors.textMuted,
    },
    resumeBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.ink,
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 20,
        gap: 6,
    },
    resumeBtnText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '700',
    },
});
