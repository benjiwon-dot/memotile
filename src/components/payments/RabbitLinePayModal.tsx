// src/components/payments/RabbitLinePayModal.tsx
import React from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity } from "react-native";

interface Props {
    visible: boolean;
    onClose: () => void;
}

export default function RabbitLinePayModal({ visible, onClose }: Props) {
    return (
        <Modal visible={visible} transparent animationType="slide">
            <View style={styles.overlay}>
                <View style={styles.modalContainer}>
                    <Text style={styles.title}>Rabbit LINE Pay</Text>
                    <Text style={styles.message}>결제 연동이 진행될 화면입니다.</Text>

                    <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                        <Text style={styles.closeText}>닫기</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.5)",
        justifyContent: "center",
        alignItems: "center",
    },
    modalContainer: {
        width: "80%",
        backgroundColor: "#fff",
        padding: 24,
        borderRadius: 16,
        alignItems: "center",
    },
    title: {
        fontSize: 20,
        fontWeight: "bold",
        marginBottom: 10,
        color: "#00C300", // 라인페이 브랜드 컬러
    },
    message: {
        fontSize: 14,
        color: "#666",
        marginBottom: 20,
    },
    closeButton: {
        backgroundColor: "#111",
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 8,
    },
    closeText: {
        color: "#fff",
        fontWeight: "bold",
        fontSize: 14,
    },
});