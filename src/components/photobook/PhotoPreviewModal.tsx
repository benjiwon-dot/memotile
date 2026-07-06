// src/components/photobook/PhotoPreviewModal.tsx
//
// 갤러리식 미리보기: 배경 블러 + 확대 + 좌우 스와이프(이전/다음) + 선택 토글. 바깥/뒤로 탭 시 닫힘.
import React, { useEffect, useRef, useState } from "react";
import {
    Modal, View, Text, StyleSheet, Pressable, FlatList, Dimensions,
    NativeSyntheticEvent, NativeScrollEvent,
} from "react-native";
import { BlurView } from "expo-blur";
import { Image as ExpoImage } from "expo-image";
import { Feather } from "@expo/vector-icons";
import * as MediaLibrary from "expo-media-library";
import { PhotobookTheme } from "../../config/photobookTheme";
import { ScanItem } from "../../types/scan";
import { useLanguage } from "../../context/LanguageContext";

const { width: W, height: H } = Dimensions.get("window");

export function PhotoPreviewModal({
    visible, items, index, isSelected, onToggle, onClose, theme,
}: {
    visible: boolean;
    items: ScanItem[];
    index: number;
    isSelected: (id: string) => boolean;
    onToggle: (id: string) => void;
    onClose: () => void;
    theme: PhotobookTheme;
}) {
    const { t } = useLanguage();
    const ref = useRef<FlatList>(null);
    const [cur, setCur] = useState(index);
    const [hi, setHi] = useState<Record<string, string>>({}); // assetId → 고해상도 localUri

    useEffect(() => { if (visible) setCur(index); }, [visible, index]);

    // 현재 페이지(±1)만 원본 고해상도 로드 (그리드는 저해상도 유지, 미리보기만 고화질)
    useEffect(() => {
        if (!visible) return;
        let active = true;
        const targets = [items[cur], items[cur - 1], items[cur + 1]].filter(Boolean) as ScanItem[];
        (async () => {
            for (const it of targets) {
                if (hi[it.assetId]) continue;
                try {
                    const info = await MediaLibrary.getAssetInfoAsync(it.assetId);
                    const uri = info.localUri || info.uri;
                    if (active && uri) setHi((prev) => (prev[it.assetId] ? prev : { ...prev, [it.assetId]: uri }));
                } catch { /* 실패 시 썸네일 유지 */ }
            }
        })();
        return () => { active = false; };
    }, [cur, visible, items, hi]);

    const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        setCur(Math.round(e.nativeEvent.contentOffset.x / W));
    };

    const current = items[cur];
    const on = current ? isSelected(current.assetId) : false;

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.fill}>
                <BlurView intensity={theme.isDark ? 60 : 40} tint={theme.isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

                <FlatList
                    ref={ref}
                    data={items}
                    keyExtractor={(it) => it.assetId}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    initialScrollIndex={index}
                    getItemLayout={(_, i) => ({ length: W, offset: W * i, index: i })}
                    onMomentumScrollEnd={onEnd}
                    renderItem={({ item }) => (
                        <Pressable style={styles.page} onPress={onClose}>
                            <ExpoImage
                                source={{ uri: hi[item.assetId] || item.thumbUri }}
                                placeholder={{ uri: item.thumbUri }}
                                style={styles.img}
                                contentFit="contain"
                                transition={150}
                            />
                        </Pressable>
                    )}
                />

                {/* 상단 바: 닫기 + 페이지 카운터 */}
                <View style={styles.topBar} pointerEvents="box-none">
                    <Pressable onPress={onClose} hitSlop={12} style={styles.topBtn}>
                        <Feather name="x" size={24} color="#fff" />
                    </Pressable>
                    <View style={styles.counter}>
                        <Text style={styles.selText}>{cur + 1} / {items.length}</Text>
                    </View>
                </View>

                {/* 하단: 빼기 / 되돌리기 (이 페이지 주목적) */}
                {current && (
                    <View style={styles.bottomBar} pointerEvents="box-none">
                        <Pressable
                            onPress={() => onToggle(current.assetId)}
                            style={[styles.actionBtn, { backgroundColor: on ? "rgba(0,0,0,0.5)" : theme.coral }]}
                        >
                            <Feather name={on ? "x-circle" : "rotate-ccw"} size={18} color="#fff" style={{ marginRight: 8 }} />
                            <Text style={styles.actionText}>{on ? t.pbRemovePhoto : t.pbRestorePhoto}</Text>
                        </Pressable>
                    </View>
                )}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    fill: { flex: 1, justifyContent: "center" },
    page: { width: W, height: H, alignItems: "center", justifyContent: "center" },
    img: { width: W, height: H * 0.8 },
    topBar: { position: "absolute", top: 52, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
    topBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, backgroundColor: "rgba(0,0,0,0.35)" },
    counter: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.4)" },
    selText: { color: "#fff", fontWeight: "800", fontSize: 13 },
    bottomBar: { position: "absolute", left: 0, right: 0, bottom: 44, alignItems: "center" },
    actionBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 22, height: 50, borderRadius: 999,
        shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
    actionText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
