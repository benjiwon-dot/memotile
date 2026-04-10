// src/components/orders/OrderSuccessPreviewStripRN.tsx
import React, { useState } from 'react';
import { View, ScrollView, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { OrderItem } from '../../types/order';

interface Props {
    items: OrderItem[];
}

const getFastPreview = (item: any) => {
    return item?.output?.previewUri ||
        item?.output?.viewUri ||
        item?.assets?.previewUrl ||
        item?.previewUrl ||
        item?.previewUri ||
        item?.assets?.viewUrl ||
        item?.src || '';
};

export default function OrderSuccessPreviewStripRN({ items }: Props) {
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.container}
        >
            {items.map((item, idx) => {
                const uri = getFastPreview(item);
                const [isImageLoaded, setIsImageLoaded] = useState(false);

                return (
                    <View key={idx} style={styles.previewBox}>
                        {/* ✅ 사진 주소가 아직 없거나, 다운로드 중일 때 '빙글빙글 로딩' 표시 */}
                        {(!uri || !isImageLoaded) && (
                            <View style={styles.placeholder}>
                                <ActivityIndicator size="small" color="#9CA3AF" />
                            </View>
                        )}

                        {uri ? (
                            <Image
                                source={{ uri }}
                                style={[styles.previewImg, !isImageLoaded && styles.hiddenImg]}
                                onLoad={() => setIsImageLoaded(true)}
                            />
                        ) : null}
                    </View>
                );
            })}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        gap: 12,
        alignItems: 'center',
        justifyContent: 'center',
        flexGrow: 1,
    },
    previewBox: {
        width: 80,
        height: 80,
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: '#F3F4F6',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
        elevation: 2,
    },
    previewImg: {
        width: '100%',
        height: '100%',
    },
    hiddenImg: {
        opacity: 0,
    },
    placeholder: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F3F4F6',
    }
});