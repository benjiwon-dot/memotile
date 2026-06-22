// src/screens/PhotoSelect.tsx
//
// ✅ 변경 요약
//  1) 하드코딩 getDiscountMessage(5/10/16·10/20/30%) 삭제 → VolumeTierBar(full) 로 교체
//     (Firebase 정책과 100% 일치, 결제창과 숫자 어긋남 0)
//  2) config/prices 에서 가격/할인/배송 로드 (priceLoaded 전엔 진행 바 숨김)
//  3) "더 담으면 더 싸다"를 진행 바 + 인지 문구로 고급스럽게 표현

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    Pressable,
    Modal,
    Dimensions,
    Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';

import { doc, getDoc, getFirestore } from 'firebase/firestore';

import { colors } from '../../src/theme/colors';
import { typography } from '../../src/theme/typography';
import { usePhoto } from '../../src/context/PhotoContext';
import { useLanguage } from '../../src/context/LanguageContext';

// ✨ 가격 단일 소스 + 진행 바
import VolumeTierBar from '../../src/components/VolumeTierBar';
import type { VolumeTier } from '../../src/utils/pricing';

export default function PhotoSelect() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { photos, saveDraft } = usePhoto();

    const { t, locale } = useLanguage();
    const [selectedPreview, setSelectedPreview] = useState<string | null>(null);

    // ✨ Firebase 가격/할인 정책 로드 (결제창과 동일 소스)
    const [pricePerTile, setPricePerTile] = useState<number>(locale === 'TH' ? 300 : 8.85);
    const [volumeDiscounts, setVolumeDiscounts] = useState<VolumeTier[]>([]);
    const [freeShipThreshold, setFreeShipThreshold] = useState<number | undefined>(undefined);
    const [shippingFee, setShippingFee] = useState<number>(0);
    const [priceLoaded, setPriceLoaded] = useState(false);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const db = getFirestore();
                const snap = await getDoc(doc(db, 'config', 'prices'));
                if (snap.exists() && alive) {
                    const data = snap.data();
                    if (data?.price_thb != null || data?.price_usd != null) {
                        setPricePerTile(locale === 'TH' ? data.price_thb : data.price_usd);
                    }
                    if (Array.isArray(data?.volumeDiscounts)) {
                        setVolumeDiscounts([...data.volumeDiscounts].sort((a, b) => a.minQty - b.minQty));
                    }
                    if (data?.freeShipThreshold != null) setFreeShipThreshold(data.freeShipThreshold);
                    if (data?.shippingFee != null) setShippingFee(data.shippingFee);
                }
            } catch (e) {
                console.error('PhotoSelect price load failed:', e);
            } finally {
                if (alive) setPriceLoaded(true);
            }
        })();
        return () => { alive = false; };
    }, [locale]);

    const numColumns = 3;
    const spacing = 0; // No gap between images
    const screenWidth = Dimensions.get('window').width;
    const itemSize = (screenWidth - (spacing * (numColumns - 1))) / numColumns;

    const renderItem = ({ item }: { item: any }) => (
        <Pressable onPress={() => setSelectedPreview(item.uri)} style={{ width: itemSize, height: itemSize, marginBottom: spacing }}>
            <Image
                source={{ uri: item.uri }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
                transition={200}
            />
        </Pressable>
    );

    return (
        <View style={styles.container}>
            {/* HEADER */}
            <BlurView intensity={80} tint="light" style={[styles.header, { paddingTop: insets.top }]}>
                <View style={styles.headerContent}>
                    <Pressable
                        onPress={() => router.back()}
                        style={styles.backBtn}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                        <View pointerEvents="none">
                            <Feather name="arrow-left" size={24} color={colors.ink} />
                        </View>
                    </Pressable>
                    <Text style={styles.headerTitle}>{t.selectPhotos}</Text>
                    <View style={{ width: 40 }} />
                </View>
            </BlurView>

            {/* PHOTO GRID */}
            <FlatList
                data={photos}
                renderItem={renderItem}
                keyExtractor={(item) => item.uri}
                numColumns={numColumns}
                columnWrapperStyle={{ gap: spacing }}
                contentContainerStyle={{
                    paddingTop: 56 + insets.top, // Header height
                    // 진행 바가 들어가 바텀바가 높아져서 여백을 더 줌
                    paddingBottom: 210 + insets.bottom,
                }}
                showsVerticalScrollIndicator={false}
            />

            {/* BOTTOM BAR */}
            <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 10 }]}>

                {/* ✨ 묶음 판매 진행 바 (고급 UI) */}
                {priceLoaded && (
                    <VolumeTierBar
                        variant="full"
                        count={photos.length}
                        pricePerTile={pricePerTile}
                        volumeDiscounts={volumeDiscounts}
                        freeShipThreshold={freeShipThreshold}
                        shippingFee={shippingFee}
                        locale={locale}
                        style={{ marginBottom: 14 }}
                    />
                )}

                <View style={styles.bottomContent}>
                    <Text style={styles.countText}>
                        {photos.length} {t.photosSelected}
                    </Text>

                    <Pressable
                        style={[styles.continueBtn, photos.length === 0 && styles.disabledBtn]}
                        onPress={async () => {
                            if (photos.length > 0) {
                                await saveDraft('editor');
                                router.replace('/create/editor');
                            }
                        }}
                        disabled={photos.length === 0}
                    >
                        <View pointerEvents="none" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Text style={styles.continueText}>{t.continue}</Text>
                            <Feather name="arrow-right" size={20} color="#fff" />
                        </View>
                    </Pressable>
                </View>
            </View>

            {/* FULL SCREEN PREVIEW MODAL */}
            <Modal visible={!!selectedPreview} transparent={true} animationType="fade">
                <View style={styles.modalContainer}>
                    <Pressable style={styles.closeArea} onPress={() => setSelectedPreview(null)} />

                    <View style={styles.previewWrapper}>
                        {selectedPreview && (
                            <Image
                                source={{ uri: selectedPreview }}
                                style={styles.previewImage}
                                contentFit="contain"
                            />
                        )}
                    </View>

                    <Pressable
                        style={[styles.closeBtn, { top: insets.top + 20 }]}
                        onPress={() => setSelectedPreview(null)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                        <View pointerEvents="none">
                            <Feather name="x" size={24} color="#fff" />
                        </View>
                    </Pressable>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.surface,
    },
    header: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        backgroundColor: Platform.OS === 'ios' ? 'rgba(255,255,255,0.85)' : '#fff',
    },
    headerContent: {
        height: 56,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    backBtn: {
        padding: 8,
    },
    headerTitle: {
        ...typography.h4,
        color: colors.ink,
    },
    bottomBar: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#fff',
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingTop: 12,
        paddingHorizontal: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
        elevation: 8,
    },
    bottomContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    countText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.ink,
    },
    continueBtn: {
        backgroundColor: colors.ink,
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 100,
        gap: 8,
    },
    disabledBtn: {
        backgroundColor: colors.border,
        opacity: 0.5,
    },
    continueText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
    },
    // Modal
    modalContainer: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.95)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    closeArea: {
        ...StyleSheet.absoluteFillObject,
    },
    previewWrapper: {
        width: '100%',
        height: '80%',
    },
    previewImage: {
        flex: 1,
        width: '100%',
        height: '100%',
    },
    closeBtn: {
        position: 'absolute',
        right: 20,
        width: 44,
        height: 44,
        backgroundColor: 'rgba(255,255,255,0.2)',
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
