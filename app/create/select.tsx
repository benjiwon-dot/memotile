// src/screens/PhotoSelect.tsx
import React, { useState } from 'react';
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

import { colors } from '../../src/theme/colors';
import { typography } from '../../src/theme/typography';
import { usePhoto } from '../../src/context/PhotoContext';
import { useLanguage } from '../../src/context/LanguageContext';

export default function PhotoSelect() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { photos, saveDraft } = usePhoto();

    const { t, locale } = useLanguage();
    const [selectedPreview, setSelectedPreview] = useState<string | null>(null);

    const numColumns = 3;
    const spacing = 0; // No gap between images
    const screenWidth = Dimensions.get('window').width;
    const itemSize = (screenWidth - (spacing * (numColumns - 1))) / numColumns;

    // ✨ [추가됨] 고객이 선택한 개수에 따라 문구가 똑똑하게 바뀌는 함수
    const getDiscountMessage = () => {
        const count = photos.length;
        const isTh = locale === 'TH';

        if (count === 0) {
            return isTh ? "✨ ซื้อ 5 ชิ้นขึ้นไป รับส่วนลดพิเศษ" : "✨ Buy 5 or more to unlock volume discounts";
        } else if (count < 5) {
            const left = 5 - count;
            return isTh ? `🎁 เพิ่มอีก ${left} ชิ้น เพื่อรับส่วนลด 10%` : `🎁 Add ${left} more to unlock 10% OFF!`;
        } else if (count < 10) {
            const left = 10 - count;
            return isTh ? `✅ รับส่วนลด 10% แล้ว! (เพิ่มอีก ${left} ชิ้นลด 20%)` : `✅ 10% OFF unlocked! (Add ${left} more for 20%)`;
        } else if (count < 16) {
            const left = 16 - count;
            return isTh ? `🔥 รับส่วนลด 20% แล้ว! (เพิ่มอีก ${left} ชิ้นลด 30%)` : `🔥 20% OFF unlocked! (Add ${left} more for 30%)`;
        } else {
            return isTh ? `👑 ปลดล็อกส่วนลดสูงสุด 30% แล้ว!` : `👑 Maximum 30% OFF unlocked!`;
        }
    };

    // ✨ [추가됨] 5장이 넘어가면 배너 색상이 연한 초록색으로 예쁘게 바뀝니다
    const isDiscountActive = photos.length >= 5;
    const bannerBgColor = isDiscountActive ? '#ecfdf5' : '#f8fafc';
    const bannerTextColor = isDiscountActive ? '#059669' : '#475569';
    const bannerBorderColor = isDiscountActive ? '#a7f3d0' : '#e2e8f0';

    // Render Grid Item
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
                    // ✨ 바텀바가 조금 높아졌으므로 스크롤 시 사진이 가려지지 않게 여백을 100 -> 140으로 늘렸습니다
                    paddingBottom: 140 + insets.bottom,
                }}
                showsVerticalScrollIndicator={false}
            />

            {/* BOTTOM BAR */}
            <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 10 }]}>

                {/* ✨ [핵심 변경] 여기에 알림 캡슐이 들어갑니다! (계속 버튼 바로 위) */}
                <View style={{
                    backgroundColor: bannerBgColor,
                    borderColor: bannerBorderColor,
                    borderWidth: 1,
                    borderRadius: 8,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    marginBottom: 12, // 아래 있는 Continue 버튼과의 간격
                    alignItems: 'center',
                }}>
                    <Text style={{ color: bannerTextColor, fontSize: 13, fontWeight: '700' }}>
                        {getDiscountMessage()}
                    </Text>
                </View>

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
        // ✨ 배너가 들어갔으므로 위쪽 패딩을 살짝 줄여서 비율을 맞췄습니다
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