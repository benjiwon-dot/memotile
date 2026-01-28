import React, { useRef, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { Image } from "expo-image";
import { FILTERS, FilterType } from "./filters";
import { colors } from "../../theme/colors";

interface FilterStripProps {
    currentFilter: FilterType;
    imageSrc: string;
    onSelect: (filter: FilterType) => void;
}

export default function FilterStripRN({ currentFilter, imageSrc, onSelect }: FilterStripProps) {
    return (
        <View style={styles.container}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
            >
                {FILTERS.map((f) => {
                    const isActive = currentFilter.name === f.name;
                    return (
                        <Pressable
                            key={f.name}
                            style={styles.item}
                            onPress={() => onSelect(f)}
                        >
                            <View style={[styles.previewBox, isActive && styles.activeBox]}>
                                <Image source={{ uri: imageSrc }} style={styles.thumb} contentFit="cover" />
                                {/* Simplified filter simulation (overlay) */}
                                {f.overlayColor && (
                                    <View style={[
                                        styles.filterOverlay,
                                        { backgroundColor: f.overlayColor, opacity: f.overlayOpacity ?? 0.2 }
                                    ]} />
                                )}
                            </View>

                            <Text style={[styles.label, isActive && styles.activeLabel]}>
                                {f.name}
                            </Text>
                        </Pressable>
                    );
                })}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        height: 100, // Fixed height for the strip
        backgroundColor: "#F7F7F8",
        borderTopWidth: 1,
        borderTopColor: "rgba(0,0,0,0.05)",
    },
    scrollContent: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 6,
    },
    item: {
        width: 64,
        alignItems: "center",
        marginRight: 6,
    },
    previewBox: {
        width: 60,
        height: 60,
        marginBottom: 4,
        borderRadius: 10,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: "rgba(0,0,0,0.10)",
        backgroundColor: "#fff",
    },
    activeBox: {
        borderColor: colors.ink,
        borderWidth: 2,
        transform: [{ translateY: -1 }], // Mimic web layout shift or use scaled
    },
    thumb: {
        width: "100%",
        height: "100%",
    },
    filterOverlay: {
        ...StyleSheet.absoluteFillObject,
    },
    label: {
        fontSize: 11,
        color: colors.textMuted,
        fontWeight: "500",
        textAlign: "center",
    },
    activeLabel: {
        color: colors.ink,
        fontWeight: "600",
    },
});
