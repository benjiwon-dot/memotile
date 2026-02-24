import React from 'react';
import { View, Text, StyleSheet, Image, Pressable } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { OrderDoc } from '../../types/order';
import { useLanguage } from '../../context/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { shadows } from '../../theme/shadows';
import { formatDate } from '../../utils/date';

interface Props {
    order: OrderDoc;
    onPress: () => void;
}

export default function OrderCardRN({ order, onPress }: Props) {
    const { t } = useLanguage();
    const dateStr = formatDate(order.createdAt);

    // ✅ DB에 저장된 currency 값에 따라 기호 결정 (과거 데이터 등 값이 없으면 기본 바트)
    const currencySymbol = order.currency === 'USD' ? '$' : '฿';

    // ✅ Prefer order-level previewImages (fast, no subcollection required)
    const previewImages: string[] =
        (order as any)?.previewImages?.filter(Boolean) ??
        [];

    // ✅ Fallback to item-level previews if items are loaded (detail/subscription)
    const itemPreviewUris: string[] =
        order.items?.map((it: any) => it.assets?.viewUrl || it.previewUrl || it.previewUri || it.src).filter(Boolean) ?? [];

    // ✅ Final uris for strip
    const previewUris = (previewImages.length > 0 ? previewImages : itemPreviewUris).slice(0, 5);

    const totalCount = order.items?.length ?? order.itemsCount ?? (previewImages.length > 0 ? previewImages.length : itemPreviewUris.length) ?? 0;
    const extraCount = Math.max(0, totalCount - 5);

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

                {/* Image strip */}
                <View style={styles.imageStrip}>
                    {previewUris.length > 0 ? (
                        previewUris.map((uri, idx) => (
                            <View key={idx} style={styles.stripItem}>
                                <Image
                                    source={{ uri }}
                                    style={styles.stripImg}
                                />
                            </View>
                        ))
                    ) : (
                        // No preview URIs available (show placeholder only if we know there are items)
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

                <View style={styles.bottomRow}>
                    <Text style={styles.itemCount}>
                        {(order.itemsCount || order.items?.length || 0)} {t.items}
                    </Text>
                    {/* ✅ 하드코딩된 ฿를 currencySymbol 변수로 교체 */}
                    <Text style={styles.totalPrice}>{currencySymbol}{order.total.toFixed(2)}</Text>
                </View>
            </View>
            <ChevronRight size={20} color="#ccc" />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#fff',
        borderRadius: 20,
        padding: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        ...shadows.sm,
        marginBottom: 16,
    },
    content: {
        flex: 1,
    },
    topRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    date: {
        fontSize: 13,
        color: '#8E8E93',
        fontWeight: '500',
    },
    orderId: {
        fontSize: 13,
        color: '#111',
        fontWeight: '600',
        fontFamily: 'Courier', // Better than monospace for RN cross-platform
    },
    imageStrip: {
        flexDirection: 'row',
        gap: 6,
        marginBottom: 16,
        alignItems: 'center',
    },
    stripItem: {
        width: 44,
        height: 44,
        borderRadius: 6,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#f0f0f0',
    },
    stripImg: {
        width: '100%',
        height: '100%',
    },
    moreCount: {
        width: 44,
        height: 44,
        borderRadius: 6,
        backgroundColor: '#f9f9f9',
        alignItems: 'center',
        justifyContent: 'center',
    },
    moreCountText: {
        fontSize: 12,
        color: '#666',
        fontWeight: '600',
    },
    bottomRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    itemCount: {
        fontSize: 14,
        color: '#666',
    },
    totalPrice: {
        fontSize: 16,
        fontWeight: '700',
        color: '#111',
    }
});