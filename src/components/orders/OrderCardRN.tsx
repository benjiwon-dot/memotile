// src/components/orders/OrderCardRN.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, Pressable } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { ref, getDownloadURL } from 'firebase/storage';
import { OrderDoc } from '../../types/order';
import { useLanguage } from '../../context/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { shadows } from '../../theme/shadows';
import { storage } from '../../lib/firebase';

const _pbCoverCache: Record<string, string> = {};

interface Props {
    order: OrderDoc;
    onPress: () => void;
}

export default function OrderCardRN({ order, onPress }: Props) {
    // ✨ locale을 가져와서 날짜와 텍스트 번역에 사용합니다.
    const { t, locale } = useLanguage();

    // ✨ 언어에 맞게 날짜를 즉석에서 포맷팅합니다.
    let dateStr = "";
    if (order.createdAt) {
        // Firestore Timestamp 처리
        const dateObj = (order.createdAt as any)?.toDate ? (order.createdAt as any).toDate() : new Date(order.createdAt as any);
        dateStr = dateObj.toLocaleDateString(locale === 'TH' ? 'th-TH' : 'en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    const currencySymbol = order.currency === 'USD' ? '$' : '฿';

    // 📕 포토북: 사진 나열 대신 표지 1장 + "포토북" 라벨
    const isPhotobook = (order as any)?.productType === 'photobook';
    const coverPath: string | undefined = (order as any)?.photobook?.coverThumbPath;
    const [coverUrl, setCoverUrl] = useState<string | null>(coverPath ? _pbCoverCache[coverPath] || null : null);
    useEffect(() => {
        let alive = true;
        if (!isPhotobook || !coverPath) return;
        if (_pbCoverCache[coverPath]) { setCoverUrl(_pbCoverCache[coverPath]); return; }
        getDownloadURL(ref(storage, coverPath))
            .then((u) => { if (alive) { _pbCoverCache[coverPath] = u; setCoverUrl(u); } })
            .catch(() => { });
        return () => { alive = false; };
    }, [isPhotobook, coverPath]);
    const pbLabel = locale === 'TH' ? 'สมุดภาพ' : (locale === 'EN' ? 'Photobook' : '포토북');

    const previewImages: string[] = (order as any)?.previewImages?.filter(Boolean) ?? [];
    const itemPreviewUris: string[] = order.items?.map((it: any) => it.assets?.viewUrl || it.previewUrl || it.previewUri || it.src).filter(Boolean) ?? [];
    const previewUris = (previewImages.length > 0 ? previewImages : itemPreviewUris).slice(0, 5);

    const totalCount = order.items?.length ?? order.itemsCount ?? (previewImages.length > 0 ? previewImages.length : itemPreviewUris.length) ?? 0;
    const extraCount = Math.max(0, totalCount - 5);

    // ✨ 아이템 개수 번역 (t.items가 비어있을 경우를 대비한 안전 장치)
    const itemsLabel = t.items || (locale === 'TH' ? 'รายการ' : 'items');

    return (
        <Pressable
            style={({ pressed }) => [
                styles.card,
                pressed && { opacity: 0.7 }
            ]}
            onPress={onPress}
        >
            <View style={styles.content}>
                <View style={styles.topRow}>
                    <Text style={styles.date}>{dateStr}</Text>
                    <Text style={styles.orderId}>#{order.orderCode || (order.id as string).slice(-7).toUpperCase()}</Text>
                </View>

                {/* 📕 포토북: 표지 1장 + 라벨 / 타일: 사진 스트립 */}
                {isPhotobook ? (
                    <View style={styles.pbRow}>
                        <View style={styles.pbCover}>
                            {coverUrl ? (
                                <Image source={{ uri: coverUrl }} style={styles.pbCoverImg} resizeMode="cover" />
                            ) : (
                                <View style={[styles.pbCoverImg, { backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center' }]}>
                                    <Ionicons name="book-outline" size={22} color="#c9b8a8" />
                                </View>
                            )}
                        </View>
                        <View style={styles.pbBadge}>
                            <Text style={styles.pbBadgeText}>📕 {pbLabel}</Text>
                        </View>
                    </View>
                ) : (
                <View style={styles.imageStrip}>
                    {previewUris.length > 0 ? (
                        previewUris.map((uri, idx) => (
                            <View key={idx} style={styles.stripItem}>
                                <Image source={{ uri }} style={styles.stripImg} />
                            </View>
                        ))
                    ) : (
                        (order.itemsCount ?? 0) > 0 ? (
                            <View
                                style={[
                                    styles.stripImg,
                                    {
                                        backgroundColor: '#f0f0f0',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        borderRadius: 6,
                                        width: 44,
                                        height: 44
                                    }
                                ]}
                            >
                                <Ionicons name="images-outline" size={20} color="#ccc" />
                            </View>
                        ) : null
                    )}

                    {extraCount > 0 && (
                        <View style={styles.moreCount}>
                            <Text style={styles.moreCountText}>+{extraCount}</Text>
                        </View>
                    )}
                </View>
                )}

                <View style={styles.bottomRow}>
                    {/* ✨ 하드코딩 탈피! 언어 설정에 따라 정확히 렌더링됩니다. */}
                    <Text style={styles.itemCount}>
                        {isPhotobook
                            ? `${totalCount} ${locale === 'TH' ? 'รูป' : (locale === 'EN' ? 'photos' : '장')}`
                            : `${totalCount} ${itemsLabel}`}
                    </Text>
                    <Text style={styles.totalPrice}>{currencySymbol}{order.total.toFixed(2)}</Text>
                </View>
            </View>
            <ChevronRight size={20} color="#ccc" />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: { backgroundColor: '#fff', borderRadius: 20, padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', ...shadows.sm, marginBottom: 16 },
    content: { flex: 1 },
    topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    date: { fontSize: 13, color: '#8E8E93', fontWeight: '500' },
    orderId: { fontSize: 13, color: '#111', fontWeight: '600', fontFamily: 'Courier' },
    imageStrip: { flexDirection: 'row', gap: 6, marginBottom: 16, alignItems: 'center' },
    stripItem: { width: 44, height: 44, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: '#f0f0f0' },
    stripImg: { width: '100%', height: '100%' },
    moreCount: { width: 44, height: 44, borderRadius: 6, backgroundColor: '#f9f9f9', alignItems: 'center', justifyContent: 'center' },
    moreCountText: { fontSize: 12, color: '#666', fontWeight: '600' },
    pbRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
    pbCover: { width: 72, height: 56, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#eee', backgroundColor: '#faf7f2' },
    pbCoverImg: { width: '100%', height: '100%' },
    pbBadge: { backgroundColor: '#EEF0FF', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: '#dfe3ff' },
    pbBadgeText: { fontSize: 12, fontWeight: '800', color: '#4f46e5' },
    bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    itemCount: { fontSize: 14, color: '#666' },
    totalPrice: { fontSize: 16, fontWeight: '700', color: '#111' }
});