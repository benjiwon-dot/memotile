// src/components/orders/PreviewModalRN.tsx
import React, { useMemo } from "react";
import {
    Modal,
    View,
    StyleSheet,
    TouchableOpacity,
    Image,
    Pressable,
    Alert,
    Linking,
    Text,
    ActivityIndicator,
    Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { X, Download } from "lucide-react-native";

interface Props {
    visible: boolean;
    imageUri: string | null;
    downloadUrl?: string | null;
    onClose: () => void;

    /**
     * ✅ 고객(MyOrder) 기본: false (5000 생성/다운로드 UX 완전 숨김)
     * ✅ Admin 등에서만 true로 켜서 사용
     */
    enableHighRes?: boolean;
}

export default function PreviewModalRN({
    visible,
    imageUri,
    downloadUrl,
    onClose,
    enableHighRes = false, // ✅ 핵심: 기본값 OFF로 변경
}: Props) {
    // ✅ High-res 기능 ON일 때만 download 활성
    const canDownload = useMemo(() => {
        if (!enableHighRes) return false;
        return !!downloadUrl && typeof downloadUrl === "string" && downloadUrl.length > 8;
    }, [downloadUrl, enableHighRes]);

    if (!imageUri) return null;

    const handleDownload = async () => {
        if (!enableHighRes) return;

        if (!canDownload) {
            Alert.alert(
                "Preparing high-res file",
                "5000px file is being generated. Please try again in a moment."
            );
            return;
        }

        try {
            const url = downloadUrl as string;
            const ok = await Linking.canOpenURL(url);
            if (!ok) {
                Alert.alert("Error", "Cannot open the download link on this device.");
                return;
            }
            await Linking.openURL(url);
        } catch {
            Alert.alert("Error", "Could not open download link.");
        }
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.overlay}>
                <SafeAreaView style={styles.safeArea}>
                    <View style={styles.header}>
                        {/* ✅ enableHighRes=true일 때만 다운로드 버튼 노출 */}
                        {enableHighRes ? (
                            <TouchableOpacity
                                style={[styles.actionBtn, !canDownload && styles.actionBtnDisabled]}
                                onPress={handleDownload}
                                disabled={!canDownload}
                                accessibilityRole="button"
                                accessibilityLabel={canDownload ? "Download high-res" : "Preparing high-res"}
                            >
                                {!canDownload ? (
                                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                        <ActivityIndicator color="#fff" />
                                        <Text style={styles.actionText}>Preparing</Text>
                                    </View>
                                ) : (
                                    <Download size={22} color="#fff" />
                                )}
                            </TouchableOpacity>
                        ) : (
                            <View style={{ width: 44, height: 44 }} />
                        )}

                        <TouchableOpacity
                            style={styles.closeBtn}
                            onPress={onClose}
                            accessibilityRole="button"
                            accessibilityLabel="Close"
                        >
                            <X size={30} color="#fff" />
                        </TouchableOpacity>
                    </View>

                    {/* ✅ enableHighRes=true AND 다운로드 불가일 때만 안내 노출 */}
                    {enableHighRes && !canDownload && (
                        <View style={styles.notice}>
                            <Text style={styles.noticeTitle}>High-res (4K) is generating…</Text>
                            <Text style={styles.noticeBody}>
                                It will appear automatically when ready.{" "}
                                {Platform.OS === "ios"
                                    ? "You can close and re-open this preview."
                                    : "Please try again shortly."}
                            </Text>
                        </View>
                    )}

                    <Pressable style={styles.content} onPress={onClose}>
                        <Pressable style={styles.imageContainer} onPress={(e) => e.stopPropagation()}>
                            <Image source={{ uri: imageUri }} style={styles.image} resizeMode="contain" />
                        </Pressable>
                    </Pressable>
                </SafeAreaView>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)" },
    safeArea: { flex: 1 },

    header: {
        height: 60,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: 18,
    },

    actionBtn: {
        minWidth: 44,
        height: 44,
        paddingHorizontal: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.22)",
        borderRadius: 22,
    },
    actionBtnDisabled: {
        opacity: 0.6,
    },
    actionText: {
        color: "#fff",
        fontWeight: "700",
        fontSize: 13,
    },

    closeBtn: {
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
    },

    notice: {
        paddingHorizontal: 18,
        paddingBottom: 8,
    },
    noticeTitle: {
        color: "#fff",
        fontSize: 13,
        fontWeight: "800",
        marginBottom: 4,
    },
    noticeBody: {
        color: "rgba(255,255,255,0.75)",
        fontSize: 12,
        fontWeight: "600",
        lineHeight: 16,
    },

    content: { flex: 1, alignItems: "center", justifyContent: "center" },
    imageContainer: {
        width: "92%",
        aspectRatio: 1,
        backgroundColor: "#000",
        borderRadius: 14,
        overflow: "hidden",
    },
    image: { width: "100%", height: "100%" },
});
