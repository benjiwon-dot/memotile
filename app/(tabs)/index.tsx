// app/(tabs)/index.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    Alert,
    Linking,
    Platform,
    type PressableStateCallbackType,
    type StyleProp,
    type ViewStyle,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Image as ExpoImage, type ImageSource } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

import { auth } from "../../src/lib/firebase";
import { User } from "firebase/auth";

import { colors } from "../../src/theme/colors";
import { layout } from "../../src/theme/layout";
import { shadows } from "../../src/theme/shadows";
import { typography } from "../../src/theme/typography";
import { useLanguage } from "../../src/context/LanguageContext";
import { usePhoto } from "../../src/context/PhotoContext";
import { usePhotobookEnabled } from "../../src/config/featureFlags";
import { hasAlbumDraft, loadAlbumDraft } from "../../src/services/albumDraft";
import { AiPhotobookCard } from "../../src/components/home/AiPhotobookCard";
import { TileEntryCard } from "../../src/components/home/TileEntryCard";
import { usePhotobookTheme } from "../../src/config/photobookTheme";
import { PhotobookWhyHow } from "../../src/components/home/PhotobookWhyHow";
import { PhotobookPriceTable } from "../../src/components/home/PhotobookPriceTable";

// ✨ 묶음 할인 가격표 (홈)
import BundlePricingTable from "../../src/components/BundlePricingTable";

import logoHorizontal from "../../assets/logo_horizontal.png";

const heroNew1 = require("../../src/assets/hero_new_1.jpg") as ImageSource;
const heroNew2 = require("../../src/assets/hero_new_2.jpg") as ImageSource;
const heroNew3 = require("../../src/assets/hero_new_3.jpg") as ImageSource;
const heroNew4 = require("../../src/assets/hero_new_4.jpg") as ImageSource;

const ASSETS = {
    dog: require("../../src/assets/hero_1_dog.png") as ImageSource,
    family: require("../../src/assets/hero_2_family.png") as ImageSource,
    couple: require("../../src/assets/hero_3_couple.png") as ImageSource,
    travel: require("../../src/assets/hero_4_travel.png") as ImageSource,
};

const slideshowImages: ImageSource[] = [heroNew1, heroNew2, heroNew3, heroNew4];

type Benefit = { title: string; desc: string };
type Step = { title: string; desc: string };
type BillboardItem = { label: string; caption: string };

export default function Index() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { t, locale, setLocale } = useLanguage();

    const { setPhotos, saveDraft, hasDraft, loadDraft, clearDraft } = usePhoto();
    const photobookEnabled = usePhotobookEnabled();
    const c = usePhotobookTheme();

    const [slideshowIndex, setSlideshowIndex] = useState(0);
    const [billboardIndex, setBillboardIndex] = useState(0);

    const [user, setUser] = useState<User | null>(auth.currentUser);

    const [isGhost, setIsGhost] = useState(false);

    // 포토북 draft "이어서 하기" (앱 종료 후에도 AI 앨범 복구). 홈 포커스마다 재확인.
    const [pbDraft, setPbDraft] = useState(false);
    useFocusEffect(
        React.useCallback(() => {
            let alive = true;
            hasAlbumDraft().then((v) => { if (alive) setPbDraft(v); });
            return () => { alive = false; };
        }, [])
    );
    const handleResumePhotobook = async () => {
        const ok = await loadAlbumDraft();
        if (!ok) { setPbDraft(false); return; }
        // 프리뷰로 단일 push(깨끗한 focus → 가로 언락 정상). 뒤로가기=홈(album 편집 복귀는 landscape 확인 후 재설계).
        router.push("/photobook/preview");
    };

    useEffect(() => {
        if (hasDraft) setIsGhost(false);
    }, [hasDraft]);

    const handleLinePress = () => {
        Linking.openURL("https://line.me/ti/p/@946zhley").catch(() => {
            Alert.alert("Error", "LINE 앱을 열 수 없습니다.");
        });
    };

    const handleInstagramPress = () => {
        Linking.openURL("https://instagram.com/memotile_studio").catch(() => {
            Alert.alert("Error", "인스타그램을 열 수 없습니다.");
        });
    };

    // 이어하기 배너 통합용 파생 상태 (배너는 항상 1개만 뜬다)
    const tileResumable = hasDraft && !!user && !isGhost;
    const pbResumable = photobookEnabled && pbDraft;
    const bothResumable = tileResumable && pbResumable;

    const handleResume = async () => {
        const loaded = await loadDraft();
        if (loaded) {
            router.push("/create/select");
        } else {
            setIsGhost(true);
            if (clearDraft) await clearDraft();
        }
    };

    useEffect(() => {
        const slideshowTimer = setInterval(() => {
            setSlideshowIndex((prev) => (prev + 1) % slideshowImages.length);
        }, 2500);

        const billboardTimer = setInterval(() => {
            setBillboardIndex((prev) => (prev + 1) % 4);
        }, 3000);

        const unsub = auth.onAuthStateChanged((u) => setUser(u));

        return () => {
            clearInterval(slideshowTimer);
            clearInterval(billboardTimer);
            unsub();
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
        if (Platform.OS !== "web") {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== ImagePicker.PermissionStatus.GRANTED) {
                Alert.alert(
                    t.permissionDeniedTitle,
                    t.permissionDeniedBody,
                    [{ text: t.cancel, style: "cancel" }, { text: t.openSettings, onPress: () => Linking.openSettings() }]
                );
                return;
            }
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsMultipleSelection: true,
            selectionLimit: 20,
            quality: 1, // 🌟 애플, 안드로이드 모두 '무조건 최고화질 원본' 요청
            exif: false, // ✨ [추가됨] 안드로이드 갤러리 앱이 멋대로 회전/압축하는 것을 방지
            base64: false, // ✨ [추가됨] 메모리 오버플로우 방지 (순수 URI만 사용)
        });

        if (!result.canceled && result.assets?.length) {
            const processedAssets = result.assets.map(asset => ({
                ...asset,
                originalUri: asset.uri, // 🌟 어떤 압축도 하지 않고 원본 주소를 영구 보존하여 다음 화면으로 넘김
            }));

            setPhotos(processedAssets);
            await saveDraft('select');
            router.push("/create/select");
        }
    };

    const primaryBtnStyle = ({ pressed }: PressableStateCallbackType): StyleProp<ViewStyle> => [
        styles.primaryBtn,
        pressed && { transform: [{ scale: 0.98 }] },
    ];

    const rawBenefits = (t.benefits ?? []) as Benefit[];
    const extraBenefit: Benefit = {
        title: locale === 'TH' ? 'ความคมชัดระดับแกลเลอรี' : 'Gallery-Grade Clarity',
        desc: locale === 'TH'
            ? 'อัปเกรดภาพเป็น 4000px โดยอัตโนมัติ เพื่อการพิมพ์ที่คมชัดสมจริง'
            : 'Auto-enhanced to 4000px for razor-sharp, exhibition-quality prints.'
    };
    const benefits = [...rawBenefits, extraBenefit];

    const steps = (t.steps ?? []) as Step[];

    const billboard = (t.billboard ?? [
        { id: 'couple', label: 'Couple', caption: 'Love, framed by none.' },
        { id: 'pet', label: 'Dog & Cat', caption: 'Your best buddy, always close.' },
        { id: 'travel', label: 'Travel', caption: 'Moments from everywhere.' },
        { id: 'family', label: 'Family', caption: 'Home is made of stories.' }
    ]) as BillboardItem[];

    const currentBillboard = billboard[billboardIndex] || billboard[0];

    // 슬라이드쇼 조각 (플래그 ON이면 맨 아래로, OFF면 기존 위치)
    const slideshow = (
        <View style={styles.heroPreview}>
            <View style={styles.slideshowContainer}>
                {slideshowImages.map((img, idx) => (
                    <View
                        key={idx}
                        style={[StyleSheet.absoluteFillObject, { opacity: slideshowIndex === idx ? 1 : 0 }]}
                    >
                        <ExpoImage
                            source={img}
                            style={styles.heroTile}
                            contentFit="cover"
                            transition={200}
                            priority="high"
                            cachePolicy="memory-disk"
                        />
                    </View>
                ))}
            </View>
        </View>
    );

    return (
        <View style={[styles.container, photobookEnabled && { backgroundColor: c.bg }]}>
            {/* 이어하기 배너 — 타일/포토북을 하나로 통합(둘 다 있어도 배너는 1개, 칩으로 선택) */}
            {(tileResumable || pbResumable) && (
                <View style={[styles.resumeBanner, { bottom: layout.spacing.bottomTabHeight + insets.bottom + 20 }, photobookEnabled && { backgroundColor: c.surface, borderColor: c.border }]}>
                    <View style={styles.resumeContent}>
                        <View style={{ flex: 1, marginRight: 10 }}>
                            <Text style={[styles.resumeTitle, photobookEnabled && { color: c.ink }]} numberOfLines={1}>
                                {bothResumable ? t.resumeBothTitle : pbResumable ? t.resumePbTitle : t.resumeTitle}
                            </Text>
                            <Text style={[styles.resumeSubtitle, photobookEnabled && { color: c.textSecondary }]} numberOfLines={1}>
                                {bothResumable ? t.resumeBothSubtitle : pbResumable ? t.resumePbSubtitle : t.resumeSubtitle}
                            </Text>
                        </View>

                        {bothResumable ? (
                            // 둘 다 있을 때: 한 배너 안에서 무엇을 이어할지 칩으로 선택
                            <View style={styles.resumeChips}>
                                <Pressable style={[styles.resumeChip, photobookEnabled && { backgroundColor: c.coral }]} onPress={handleResumePhotobook}>
                                    <Feather name="book-open" size={13} color="#fff" style={{ marginRight: 4 }} />
                                    <Text style={styles.resumeChipText}>{t.resumeChipPhotobook}</Text>
                                </Pressable>
                                <Pressable style={[styles.resumeChip, styles.resumeChipAlt, photobookEnabled && { borderColor: c.coral }]} onPress={handleResume}>
                                    <Feather name="image" size={13} color={photobookEnabled ? c.coral : colors.ink} style={{ marginRight: 4 }} />
                                    <Text style={[styles.resumeChipText, { color: photobookEnabled ? c.coral : colors.ink }]}>{t.resumeChipTile}</Text>
                                </Pressable>
                            </View>
                        ) : (
                            <Pressable
                                style={[styles.resumeBtn, photobookEnabled && { backgroundColor: c.coral }]}
                                onPress={pbResumable ? handleResumePhotobook : handleResume}
                            >
                                <Feather name={pbResumable ? "book-open" : "arrow-right"} size={15} color="#fff" style={{ marginRight: 5 }} />
                                <Text style={styles.resumeBtnText}>{t.resumeCta}</Text>
                            </Pressable>
                        )}
                    </View>
                </View>
            )}

            <ScrollView
                contentContainerStyle={{
                    paddingTop: 0,
                    paddingBottom: layout.spacing.bottomTabHeight + insets.bottom + 20,
                }}
                showsVerticalScrollIndicator={false}
                style={{ flex: 1 }}
            >
                <View style={[styles.headerRow, { paddingTop: insets.top - 20 }]}>
                    <View style={styles.logoContainer}>
                        {/* 새 로고는 여백 없이 꽉 찬 이미지라 폭 기준으로 맞춰진다.
                            예전 로고(1536×1024, 여백 큼)는 높이 기준이라 180pt로 렌더됐는데
                            같은 박스면 360pt(2배)가 되어 언어 토글까지 침범 → 폭을 직접 지정. */}
                        <ExpoImage
                            source={logoHorizontal}
                            style={{ width: 140, height: 44 }}
                            contentFit="contain"
                            contentPosition="left"
                            transition={200}
                        />
                    </View>

                    <View style={[styles.langPill, { transform: [{ translateY: -4 }] }]}>
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

                <View style={[styles.hero, photobookEnabled && { paddingBottom: 14 }]}>
                    <View style={styles.heroContent}>
                        <View style={styles.headlineGroup}>
                            <Text style={[
                                styles.heroHeadline1,
                                locale === 'TH' ? styles.heroHeadline1_TH : styles.heroHeadline1_EN
                            ]}>
                                {t.heroHeadlineLine1}
                            </Text>
                            {!!t.heroHeadlineLine2 && (
                                <Text style={[
                                    styles.heroHeadline2,
                                    locale === 'TH' ? styles.heroHeadline2_TH : styles.heroHeadline2_EN
                                ]}>
                                    {t.heroHeadlineLine2}
                                </Text>
                            )}
                        </View>

                        {!!t.heroSupporting && (
                            <Text style={[
                                styles.heroSupporting,
                                locale === 'TH' ? styles.heroSupporting_TH : styles.heroSupporting_EN
                            ]}>
                                {t.heroSupporting.replace(/\.$/, '')}
                            </Text>
                        )}

                        {!photobookEnabled && slideshow}

                        {photobookEnabled ? (
                            <View style={styles.entryStack}>
                                <AiPhotobookCard />
                                <TileEntryCard onPress={handleStart} />
                            </View>
                        ) : (
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
                        )}
                    </View>
                </View>

                {/* Why MemoTile → hero 슬라이드쇼 → How it works (플래그 ON) */}
                {photobookEnabled && <PhotobookWhyHow part="why" />}
                {photobookEnabled && slideshow}
                {photobookEnabled && <PhotobookWhyHow part="how" />}

                {!photobookEnabled && (
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
                                    ) : i === 2 ? (
                                        <Feather name={"info" as any} size={20} color={colors.ink} />
                                    ) : (
                                        <Feather name={"zap" as any} size={20} color={colors.ink} />
                                    )
                                }
                                title={b.title}
                                desc={b.desc}
                            />
                        ))}
                    </View>
                </View>
                )}

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
                                        <ExpoImage
                                            source={theme.img}
                                            style={{ width: 280, height: 280 }}
                                            contentFit="cover"
                                            priority="high" // ✨ 빌보드 이미지도 우선순위 높임
                                            cachePolicy="memory-disk"
                                        />
                                    </View>
                                </View>
                            ))}
                        </View>

                        <View style={styles.billboardInfo}>
                            <View style={styles.billboardLabelContainer}>
                                <Text style={styles.billboardLabel}>{currentBillboard?.label}</Text>
                            </View>
                            <View style={styles.billboardCaptionWrapper}>
                                <Text style={styles.billboardCaption}>{currentBillboard?.caption}</Text>
                            </View>
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

                {!photobookEnabled && (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t.howItWorks}</Text>
                    <View style={styles.stepsContainer}>
                        {steps.map((s, i) => (
                            <StepItem key={i} num={i + 1} title={s.title} desc={s.desc} />
                        ))}
                    </View>
                </View>
                )}

                {/* ✨ 묶음 할인 가격표 + 2차 CTA (사용법 이해 직후 → 가격 → 즉시 시작) */}
                <View style={[styles.section, photobookEnabled ? { backgroundColor: c.bg } : { backgroundColor: colors.canvas }]}>
                    {photobookEnabled && (
                        <>
                            <Text style={[styles.priceLabel, { color: c.ink }]}>{t.priceAiLabel}</Text>
                            <PhotobookPriceTable />
                            <Text style={[styles.priceLabel, { color: c.ink, marginTop: 28 }]}>{t.priceTileLabel}</Text>
                        </>
                    )}
                    <BundlePricingTable />
                    <View style={{ alignItems: "center", marginTop: 24 }}>
                        <Pressable style={primaryBtnStyle} onPress={handleStart}>
                            <View style={styles.ctaInner}>
                                <Feather name={"crop" as any} size={20} color="#fff" style={{ marginRight: 12 }} />
                                <Text style={styles.ctaText}>{t.ctaStart}</Text>
                            </View>
                        </Pressable>
                    </View>
                </View>

                <View style={styles.deliverySection}>
                    <Feather name={"truck" as any} size={40} color="#fff" style={{ marginBottom: 16 }} />
                    <Text style={styles.deliveryTitle}>{t.deliveryHeadline}</Text>
                    <Text style={styles.deliverySubtitle}>{t.deliverySub}</Text>
                </View>

                <View style={styles.footer}>
                    <Text style={styles.footerHelpTitle}>{t.needHelp}</Text>
                    <View style={styles.footerActions}>
                        <Pressable style={styles.footerBtn} onPress={handleLinePress}>
                            <Feather name={"message-circle" as any} size={18} color={colors.ink} />
                            <Text style={styles.footerBtnText}>LINE</Text>
                        </Pressable>
                        <Pressable style={styles.footerBtn} onPress={handleInstagramPress}>
                            <Feather name={"instagram" as any} size={18} color={colors.ink} />
                            <Text style={styles.footerBtnText}>Instagram</Text>
                        </Pressable>
                    </View>

                    <View style={styles.legalLinksRow}>
                        <Pressable onPress={() => router.push("/privacy" as any)}>
                            <Text style={styles.legalLinkText}>Privacy Policy</Text>
                        </Pressable>
                        <Text style={styles.legalDot}> • </Text>
                        <Pressable onPress={() => router.push("/terms" as any)}>
                            <Text style={styles.legalLinkText}>Terms of Service</Text>
                        </Pressable>
                    </View>

                    <View style={styles.minimalBizInfo}>
                        <Text style={styles.bizInfoText}>{t.business_name}</Text>
                        <Text style={styles.bizInfoText}>{t.business_representative}</Text>
                        <Text style={styles.bizInfoText}>{t.business_tax_id}</Text>
                        <Text style={styles.bizInfoText}>{t.business_address}</Text>
                        <Text style={styles.bizInfoText}>{t.supportPhone}</Text>
                        <Text style={styles.bizInfoText}>Email: official@memotile.com</Text>
                    </View>

                    <Text style={styles.legal}>{t.copyright}</Text>
                </View>
            </ScrollView>
        </View>
    );
}

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

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },

    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        marginBottom: -20,
    },
    logoContainer: {
        flex: 1,
        alignItems: 'flex-start',
        justifyContent: 'center',
        marginLeft: -20,
    },

    brandTitle: { ...typography.brand, color: colors.text },
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

    section: { padding: layout.spacing.pagePadding, paddingVertical: 28 },
    hero: { paddingTop: 0, paddingBottom: 48, alignItems: "center" },
    heroContent: { maxWidth: 480, width: "100%", alignItems: "center" },
    headlineGroup: { marginBottom: 8, paddingHorizontal: 20, alignItems: "center" },
    // 헤드라인 색 (메인=웜 차콜, 서브=코랄). 서브 쿨그레이 대안: "#8A8A8E"

    heroHeadline1: { textAlign: "center", color: "#2B2320", fontWeight: "900" },
    heroHeadline2: { marginTop: 0, textAlign: "center", color: "#2B2320", fontWeight: "900" },
    heroSupporting: { textAlign: "center", marginTop: 6, marginBottom: 18, paddingHorizontal: 24, color: "#FF8C7C", fontWeight: "600" },

    heroHeadline1_TH: { fontSize: 28, lineHeight: 42 },   // TH 메인: EN보다 작게 + lineHeight 여유(답답함 해소)
    heroHeadline2_TH: { fontSize: 28, lineHeight: 42 },
    heroSupporting_TH: { fontSize: 17, lineHeight: 28, fontWeight: "700" },  // TH 서브: 크기보다 굵기로 강조

    heroHeadline1_EN: { fontSize: 34, lineHeight: 40 },   // EN 메인: 더 크게(폭 채움) + Black(900)
    heroHeadline2_EN: { fontSize: 34, lineHeight: 40 },
    heroSupporting_EN: { fontSize: 18, lineHeight: 24 },  // EN 서브: 크기 키움

    heroPreview: { height: 280, width: "100%", alignItems: "center", justifyContent: "center", marginBottom: 16 },
    slideshowContainer: { width: 260, height: 260 },
    heroTile: { width: 260, height: 260, borderRadius: 4, ...shadows.md },

    ctaWrapper: { width: "100%", alignItems: "center", paddingHorizontal: 24 },
    ctaGroup: { width: "100%", maxWidth: 360, alignItems: "center" },
    primaryBtn: { width: 320, height: 68, backgroundColor: colors.ink, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", ...shadows.md },
    ctaInner: { flexDirection: "row", alignItems: "center" },
    ctaText: { ...typography.button, fontSize: 20, fontWeight: "700" },
    ctaHint: { ...typography.caption, marginTop: 10, textAlign: "center" },
    entryStack: { width: "100%", paddingHorizontal: 24, gap: 14, marginTop: 4 },
    priceLabel: { fontSize: 18, fontWeight: "800", marginBottom: 12 },
    // STEP 2: AI 포토북 정식 진입점 (플래그 ON일 때만 렌더)
    entryDivider: {
        width: 320, flexDirection: "row", alignItems: "center", marginTop: 18, marginBottom: 2,
    },
    entryDividerLine: { flex: 1, height: 1, backgroundColor: "#E5E7EB" },
    entryDividerText: { ...typography.caption, marginHorizontal: 12, color: "#9CA3AF", fontSize: 13 },
    photobookCard: {
        width: 320, marginTop: 14, paddingVertical: 16, paddingHorizontal: 16,
        backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB",
        flexDirection: "row", alignItems: "center", ...shadows.md,
    },
    photobookIcon: {
        width: 44, height: 44, borderRadius: 13, backgroundColor: colors.canvas,
        alignItems: "center", justifyContent: "center", marginRight: 14,
    },
    photobookTitleRow: { flexDirection: "row", alignItems: "center" },
    photobookTitle: { fontSize: 17, fontWeight: "800", color: colors.ink },
    photobookBadge: {
        marginLeft: 8, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6,
        backgroundColor: colors.ink,
    },
    photobookBadgeText: { fontSize: 10, fontWeight: "800", color: "#fff", letterSpacing: 0.5 },
    photobookDesc: { fontSize: 13, color: "#6B7280", marginTop: 3 },

    sectionTitle: { ...typography.h3, marginBottom: 24, textAlign: "center", color: colors.ink },
    sectionSmallTitle: { ...typography.sectionHeader, marginBottom: 24, textAlign: "center" },
    grid: { gap: 24 },

    benefitCard: { flexDirection: "row", gap: 16, alignItems: "center" },
    benefitIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", ...shadows.sm },
    benefitTitle: { ...typography.h4, marginBottom: 4, color: colors.ink },
    benefitDesc: { fontSize: 14, color: colors.textMuted, lineHeight: 21 },

    billboardContainer: { paddingVertical: 40, backgroundColor: colors.canvas, borderRadius: 32, alignItems: "center" },
    billboardImgWrapper: { width: 280, height: 280, marginBottom: 32, position: "relative", alignItems: "center", justifyContent: "center" },
    billboardImgContainer: { borderRadius: 4, overflow: "hidden", ...shadows.md },

    billboardInfo: { paddingHorizontal: 24, alignItems: "center", width: "100%" },
    billboardLabelContainer: { backgroundColor: colors.fill, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 14, marginBottom: 16 },
    billboardLabel: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.55, color: colors.text },
    billboardCaptionWrapper: { minHeight: 60, justifyContent: "flex-start", alignItems: "center" },
    billboardCaption: { fontSize: 19, fontWeight: "700", color: colors.ink, textAlign: "center", lineHeight: 27 },

    billboardDots: { flexDirection: "row", gap: 8, marginTop: 16 },
    dot: { width: 6, height: 6, borderRadius: 3 },

    stepsContainer: { gap: 40, paddingVertical: 10 },
    stepItem: { flexDirection: "row", gap: 20, alignItems: "flex-start" },
    stepNum: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
    stepNumText: { color: colors.surface, fontSize: 14, fontWeight: "800" },
    stepInfo: { flex: 1 },
    stepTitle: { fontSize: 20, fontWeight: "900", marginBottom: 6, color: colors.ink },
    stepDesc: { ...typography.bodySmall, color: colors.textMuted },

    deliverySection: { margin: 24, paddingVertical: 60, paddingHorizontal: 24, backgroundColor: colors.ink, borderRadius: 32, alignItems: "center" },
    deliveryTitle: { color: colors.surface, fontSize: 28, fontWeight: "800", marginBottom: 12 },
    deliverySubtitle: { color: colors.surface, fontSize: 18, opacity: 0.8, textAlign: "center" },

    footer: { paddingVertical: 60, paddingHorizontal: 24, alignItems: "center", borderTopWidth: 1, borderTopColor: colors.border },
    footerHelpTitle: { fontSize: 20, fontWeight: "800", marginBottom: 24, color: colors.ink },
    footerActions: { flexDirection: "row", justifyContent: "center", gap: 12, marginBottom: 32 },
    footerBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 14, paddingHorizontal: 24, borderColor: colors.border, borderWidth: 1, borderRadius: 14, backgroundColor: colors.surface, ...shadows.sm },
    footerBtnText: { fontSize: 15, fontWeight: "700", color: colors.text },

    legalLinksRow: { flexDirection: "row", alignItems: "center", marginBottom: 24 },
    legalLinkText: { fontSize: 13, color: colors.ink, textDecorationLine: "underline", fontWeight: "500" },
    legalDot: { fontSize: 13, color: colors.textMuted, marginHorizontal: 8 },

    minimalBizInfo: {
        width: '100%',
        alignItems: 'flex-start',
        marginBottom: 10,
    },
    bizInfoText: {
        fontSize: 11,
        color: '#9CA3AF',
        textAlign: 'left',
        lineHeight: 18,
        marginBottom: 2,
    },
    legal: { fontSize: 12, color: '#9CA3AF', fontWeight: '500', marginTop: 10 },

    resumeBanner: { position: 'absolute', left: 16, right: 16, backgroundColor: colors.surface, borderRadius: 16, padding: 10, zIndex: 90, ...shadows.md, borderWidth: 1, borderColor: colors.border },
    resumeContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    resumeTitle: { fontSize: 14, fontWeight: '700', color: colors.ink, marginBottom: 2 },
    resumeSubtitle: { fontSize: 12, color: colors.textMuted },
    resumeBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.ink, paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, gap: 6 },
    resumeBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    // 타일·포토북 draft가 둘 다 있을 때 한 배너 안에서 고르는 칩
    resumeChips: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    resumeChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.ink, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 20, borderWidth: 1, borderColor: 'transparent' },
    resumeChipAlt: { backgroundColor: 'transparent', borderColor: colors.ink },
    resumeChipText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
