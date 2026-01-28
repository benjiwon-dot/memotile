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
    const { t } = useLanguage();
    const [selectedPreview, setSelectedPreview] = useState<string | null>(null);

    const numColumns = 3;
    const screenWidth = Dimensions.get('window').width;
    const itemSize = screenWidth / numColumns;

    // Render Grid Item
    const renderItem = ({ item }: { item: any }) => (
        <Pressable onPress={() => setSelectedPreview(item.uri)}>
            <Image
                source={{ uri: item.uri }}
                style={{ width: itemSize, height: itemSize }}
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
                    <Pressable onPress={() => router.back()} style={styles.backBtn}>
                        <Feather name="arrow-left" size={24} color={colors.ink} />
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
                contentContainerStyle={{
                    paddingTop: 100, // Header height + spacing
                    paddingBottom: 120, // Bottom bar + spacing
                }}
                showsVerticalScrollIndicator={false}
            />

            {/* BOTTOM BAR */}
            <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 10 }]}>
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
                        <Text style={styles.continueText}>{t.continue}</Text>
                        <Feather name="arrow-right" size={20} color="#fff" />
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

                    <Pressable style={[styles.closeBtn, { top: insets.top + 20 }]} onPress={() => setSelectedPreview(null)}>
                        <Feather name="x" size={24} color="#fff" />
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
        paddingTop: 16,
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
