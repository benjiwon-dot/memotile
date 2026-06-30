// src/components/photobook/WheelDatePicker.tsx
//
// 의존성 없는 휠 롤링 날짜 피커 (년/월/일 한 번에). 바텀시트 모달.
import React, { useMemo, useRef, useState } from "react";
import {
    Modal, View, Text, ScrollView, Pressable, StyleSheet,
    NativeSyntheticEvent, NativeScrollEvent,
} from "react-native";
import { PhotobookTheme } from "../../config/photobookTheme";

const ITEM_H = 44;
const VISIBLE = 5;
const PAD = ITEM_H * Math.floor(VISIBLE / 2);

function clamp(n: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, n));
}

function Wheel({
    data, index, onChange, theme, width, suffix,
}: {
    data: number[]; index: number; onChange: (i: number) => void;
    theme: PhotobookTheme; width: number; suffix?: string;
}) {
    const ref = useRef<ScrollView>(null);
    const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const y = e.nativeEvent.contentOffset.y;
        const i = clamp(Math.round(y / ITEM_H), 0, data.length - 1);
        if (i !== index) onChange(i);
    };
    return (
        <ScrollView
            ref={ref}
            style={{ width }}
            showsVerticalScrollIndicator={false}
            snapToInterval={ITEM_H}
            decelerationRate="fast"
            contentOffset={{ x: 0, y: index * ITEM_H }}
            onMomentumScrollEnd={onEnd}
            contentContainerStyle={{ paddingVertical: PAD }}
        >
            {data.map((d, i) => (
                <Pressable
                    key={i}
                    onPress={() => { ref.current?.scrollTo({ y: i * ITEM_H, animated: true }); onChange(i); }}
                    style={{ height: ITEM_H, alignItems: "center", justifyContent: "center" }}
                >
                    <Text style={{
                        fontSize: 19,
                        fontWeight: i === index ? "700" : "400",
                        color: i === index ? theme.ink : theme.textMuted,
                    }}>
                        {d}{suffix || ""}
                    </Text>
                </Pressable>
            ))}
        </ScrollView>
    );
}

export function WheelDatePicker({
    visible, value, onConfirm, onCancel, theme, confirmLabel, cancelLabel,
}: {
    visible: boolean;
    value: string | null;            // ISO YYYY-MM-DD
    onConfirm: (iso: string) => void;
    onCancel: () => void;
    theme: PhotobookTheme;
    confirmLabel: string;
    cancelLabel: string;
}) {
    const now = new Date();
    const curY = now.getFullYear();
    const years = useMemo(() => {
        const arr: number[] = [];
        for (let y = curY; y >= curY - 15; y--) arr.push(y);
        return arr;
    }, [curY]);
    const months = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);

    const init = value ? new Date(value) : new Date(curY, now.getMonth(), now.getDate());
    const [yi, setYi] = useState(() => {
        const idx = years.indexOf(init.getFullYear());
        return idx >= 0 ? idx : 0;
    });
    const [mi, setMi] = useState(() => clamp(init.getMonth(), 0, 11));
    const daysInMonth = new Date(years[yi], mi + 1, 0).getDate();
    const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth]);
    const [di, setDi] = useState(() => clamp(init.getDate() - 1, 0, daysInMonth - 1));

    const confirm = () => {
        const y = years[yi];
        const m = mi + 1;
        const d = clamp(di, 0, days.length - 1) + 1;
        const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        onConfirm(iso);
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
            <Pressable style={styles.backdrop} onPress={onCancel} />
            <View style={[styles.sheet, { backgroundColor: theme.surface }]}>
                <View style={styles.headerRow}>
                    <Pressable onPress={onCancel} hitSlop={10}><Text style={[styles.action, { color: theme.textSecondary }]}>{cancelLabel}</Text></Pressable>
                    <Pressable onPress={confirm} hitSlop={10}><Text style={[styles.action, { color: theme.coral, fontWeight: "800" }]}>{confirmLabel}</Text></Pressable>
                </View>
                <View style={styles.wheels}>
                    {/* 중앙 하이라이트 밴드 */}
                    <View pointerEvents="none" style={[styles.band, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]} />
                    <Wheel data={years} index={yi} onChange={setYi} theme={theme} width={110} />
                    <Wheel data={months} index={mi} onChange={(i) => { setMi(i); }} theme={theme} width={70} />
                    <Wheel key={`${years[yi]}-${mi}`} data={days} index={clamp(di, 0, days.length - 1)} onChange={setDi} theme={theme} width={70} />
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
    sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32, paddingTop: 8 },
    headerRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
    action: { fontSize: 16, fontWeight: "600" },
    wheels: { height: ITEM_H * VISIBLE, flexDirection: "row", justifyContent: "center", alignItems: "center" },
    band: {
        position: "absolute", left: 24, right: 24, height: ITEM_H, top: ITEM_H * 2,
        borderRadius: 12, borderWidth: 1,
    },
});
