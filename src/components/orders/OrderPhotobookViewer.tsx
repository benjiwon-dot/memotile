// src/components/orders/OrderPhotobookViewer.tsx
//
// 완료된 주문의 포토북을 프리뷰 슬라이드처럼 펼침면 단위로 스윽 넘겨보는 읽기전용 뷰어.
// 데이터는 order.photobook.frozen(동결 레이아웃) + Storage 원본(originals/{idx}.jpg)에서만 온다.
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Modal, Pressable, FlatList, useWindowDimensions, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ref, getDownloadURL } from "firebase/storage";
import { storage } from "../../lib/firebase";
import { CoverCrop } from "../photobook/CoverCrop";

type Crop = { fx: number; fy: number; zoom: number };
type Cell = { idx: number; x: number; y: number; w: number; h: number; aspect: number; crop: Crop };
type Page = { index: number; kind: string; dateLabel: string; cells: Cell[] };
type Frozen = {
    size: string; ratio: number; topBand: number;
    coverPage: { idx: number | null; style?: string; title?: string; dateLabel?: string; crop: Crop };
    pages: Page[];
};
type Row = { kind: "cover" } | { kind: "back" } | { kind: "spread"; left: Page | null; right: Page | null };

export function OrderPhotobookViewer({ visible, onClose, frozen, originalsBasePath }: {
    visible: boolean;
    onClose: () => void;
    frozen?: Frozen | null;
    originalsBasePath?: string;
}) {
    const { width: WIN_W, height: WIN_H } = useWindowDimensions();
    const [urls, setUrls] = useState<Record<number, string>>({});

    useEffect(() => {
        if (!visible || !frozen || !originalsBasePath) return;
        const need = new Set<number>();
        frozen.pages.forEach((p) => p.cells.forEach((c) => { if (c.idx >= 0) need.add(c.idx); }));
        if (frozen.coverPage?.idx != null && frozen.coverPage.idx >= 0) need.add(frozen.coverPage.idx);
        let alive = true;
        need.forEach((idx) => {
            if (urls[idx]) return;
            getDownloadURL(ref(storage, `${originalsBasePath}/${idx}.jpg`))
                .then((u) => { if (alive) setUrls((m) => (m[idx] ? m : { ...m, [idx]: u })); })
                .catch(() => { });
        });
        return () => { alive = false; };
    }, [visible, frozen, originalsBasePath]);

    const RATIO = frozen?.ratio || 27.9 / 21.5;

    const rows = useMemo<Row[]>(() => {
        if (!frozen) return [];
        const out: Row[] = [{ kind: "cover" }];
        for (let i = 0; i < frozen.pages.length; i += 2) out.push({ kind: "spread", left: frozen.pages[i] ?? null, right: frozen.pages[i + 1] ?? null });
        out.push({ kind: "back" });
        return out;
    }, [frozen]);

    // 펼침면(2페이지)을 화면에 맞춤
    const availW = WIN_W - 24;
    const availH = WIN_H * 0.72;
    const spreadAspect = 2 * RATIO;
    const spreadW = availW / availH > spreadAspect ? availH * spreadAspect : availW;
    const pageW = spreadW / 2;
    const pageH = spreadW / spreadAspect;
    const coverW = availW / availH > RATIO ? availH * RATIO : availW;
    const coverH = coverW / RATIO;

    const CellView = ({ page, offX }: { page: Page; offX: number }) => (
        <>
            {page.cells.map((c, i) => {
                const url = c.idx >= 0 ? urls[c.idx] : undefined;
                return (
                    <View key={i} style={{ position: "absolute", left: offX + c.x * pageW, top: c.y * pageH, width: c.w * pageW, height: c.h * pageH, overflow: "hidden", backgroundColor: "#eee" }}>
                        <CoverCrop uri={url} w={c.w * pageW} h={c.h * pageH} aspect={c.aspect} focusX={c.crop.fx} focusY={c.crop.fy} zoom={c.crop.zoom} bg="#eee" />
                    </View>
                );
            })}
            {!!page.dateLabel && page.kind !== "hero" && (
                <Text style={{ position: "absolute", left: offX + pageW * (page.cells.length ? Math.min(...page.cells.map((c) => c.x)) : 0.05), top: pageH * (frozen!.topBand) - 15, fontSize: 11, fontStyle: "italic", color: "#FF7E66", letterSpacing: 0.5 }}>{page.dateLabel}</Text>
            )}
        </>
    );

    const renderRow = ({ item }: { item: Row }) => {
        let inner: React.ReactNode;
        if (item.kind === "cover" && frozen) {
            const cp = frozen.coverPage;
            const url = cp?.idx != null && cp.idx >= 0 ? urls[cp.idx] : undefined;
            inner = (
                <View style={{ width: coverW, height: coverH, backgroundColor: "#faf7f2", borderRadius: 4, overflow: "hidden" }}>
                    <CoverCrop uri={url} w={coverW} h={coverH} aspect={1} focusX={cp?.crop?.fx ?? 0.5} focusY={cp?.crop?.fy ?? 0.5} zoom={cp?.crop?.zoom ?? 1} bg="#faf7f2" />
                    <View style={styles.coverBand}>
                        {!!cp?.title && <Text style={styles.coverTitle} numberOfLines={1}>{cp.title}</Text>}
                        {!!cp?.dateLabel && <Text style={styles.coverDate} numberOfLines={1}>{cp.dateLabel}</Text>}
                    </View>
                </View>
            );
        } else if (item.kind === "back") {
            inner = (
                <View style={{ width: coverW, height: coverH, backgroundColor: "#fff", borderRadius: 4, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#eee" }}>
                    <Text style={{ fontSize: 18, fontWeight: "900", color: "#1A1613" }}>memotile</Text>
                    <Text style={{ fontSize: 8, letterSpacing: 2, color: "#9A8E82", marginTop: 3 }}>PHOTO BOOK</Text>
                </View>
            );
        } else if (item.kind === "spread") {
            const both = !!item.left && !!item.right;
            inner = (
                <View style={{ width: both ? pageW * 2 : pageW, height: pageH, backgroundColor: "#fff", borderRadius: 4, overflow: "hidden", borderWidth: 1, borderColor: "#eee" }}>
                    {item.left && <CellView page={item.left} offX={0} />}
                    {item.right && <CellView page={item.right} offX={both ? pageW : 0} />}
                </View>
            );
        }
        return <View style={{ width: WIN_W, alignItems: "center", justifyContent: "center" }}>{inner}</View>;
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
                    <Ionicons name="close" size={26} color="#fff" />
                </Pressable>
                {frozen ? (
                    <FlatList
                        data={rows}
                        keyExtractor={(_, i) => String(i)}
                        renderItem={renderRow}
                        horizontal
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                        initialNumToRender={1}
                        maxToRenderPerBatch={2}
                        windowSize={3}
                        removeClippedSubviews
                    />
                ) : (
                    <ActivityIndicator color="#fff" size="large" />
                )}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center" },
    closeBtn: { position: "absolute", top: 54, right: 20, zIndex: 10, width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    coverBand: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "rgba(20,16,14,0.34)" },
    coverTitle: { fontSize: 18, fontWeight: "800", color: "#fff" },
    coverDate: { fontSize: 11, letterSpacing: 1, color: "rgba(255,255,255,0.9)", marginTop: 2, fontStyle: "italic" },
});
