// src/components/photobook/ChronoRangeSlider.tsx
//
// 연대기 범위 슬라이더(메인 UI). 왼쪽 핸들=시작, 오른쪽 핸들=끝. 아이 생일~오늘.
// 두 핸들 드래그로 기간 선택(월 단위 스냅, 최대 1년). 핸들 밑에 실시간 년월 라벨.
import React, { useRef, useState } from "react";
import { View, Text, StyleSheet, PanResponder, LayoutChangeEvent } from "react-native";
import * as Haptics from "expo-haptics";
import { PhotobookTheme } from "../../config/photobookTheme";

function ymLabel(ms: number): string {
    const d = new Date(ms);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
function monthStart(ms: number): number { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
function monthEnd(ms: number): number { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).getTime(); }

const HANDLE = 28;
const LBL_W = 76;    // "2025.02" 한 줄 폭
const MERGED_W = 150; // "2025.02 ~ 2025.08" 합친 라벨 폭

const MIN_GAP = 27 * 24 * 60 * 60 * 1000; // 최소 간격 ~1개월(프리즈 방지)

export function ChronoRangeSlider({
    birthMs, nowMs, startMs, endMs, active, onChange, theme,
}: {
    birthMs: number; nowMs: number; startMs: number; endMs: number;
    active: boolean;
    onChange: (startMs: number, endMs: number) => void;
    theme: PhotobookTheme;
}) {
    const [trackW, setTrackW] = useState(0);

    // 최신값을 responder(1회 생성) 안에서 읽기 위한 refs
    const sRef = useRef(startMs); sRef.current = startMs;
    const eRef = useRef(endMs); eRef.current = endMs;
    const bRef = useRef(birthMs); bRef.current = birthMs;
    const nRef = useRef(nowMs); nRef.current = nowMs;
    const wRef = useRef(0); wRef.current = trackW;
    const grab = useRef(0); // 잡은 시점의 그 핸들 ms(상대 드래그 기준)
    const grabbing = useRef<"start" | "end">("start");
    const lastSnap = useRef(0); // 마지막 스냅된 월(햅틱 중복 방지)
    const onChangeRef = useRef(onChange); onChangeRef.current = onChange;

    const INSET = HANDLE / 2 + 6; // 끝 핸들이 터치영역(trackWrap) 안에 오도록 안쪽 여백
    const spanOf = () => Math.max(1, nRef.current - bRef.current);
    const usableOf = () => Math.max(1, (wRef.current || 1) - 2 * INSET);
    const usableW = Math.max(1, trackW - 2 * INSET);
    const pxOf = (ms: number) => INSET + clamp((ms - birthMs) / Math.max(1, nowMs - birthMs), 0, 1) * usableW;
    const tick = (v: number) => { if (v !== lastSnap.current) { lastSnap.current = v; Haptics.selectionAsync().catch(() => { }); } };

    // 잡은 핸들을 ms로 이동(월 스냅 + 최소간격). 적용된 ms 반환.
    const applyHandle = (ms: number): number => {
        if (grabbing.current === "start") {
            const ns = clamp(monthStart(ms), bRef.current, eRef.current - MIN_GAP);
            tick(ns); onChangeRef.current(ns, eRef.current); return ns;
        }
        const ne = clamp(monthEnd(ms), sRef.current + MIN_GAP, nRef.current);
        tick(ne); onChangeRef.current(sRef.current, ne); return ne;
    };

    // 하이브리드: 핸들 근처 터치=잡기만(정밀 상대드래그), 빈 트랙 터치=그 위치로 즉시 이동 후 따라옴.
    const trackPan = useRef(PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false, // ScrollView에 뺏기지 않게
        onPanResponderGrant: (e) => {
            const x = e.nativeEvent.locationX;
            const u = usableOf();
            const sx = INSET + clamp((sRef.current - bRef.current) / spanOf(), 0, 1) * u;
            const ex = INSET + clamp((eRef.current - bRef.current) / spanOf(), 0, 1) * u;
            const nearStart = Math.abs(x - sx) <= Math.abs(x - ex);
            grabbing.current = nearStart ? "start" : "end";
            lastSnap.current = nearStart ? monthStart(sRef.current) : monthEnd(eRef.current);
            Haptics.selectionAsync().catch(() => { });
            const NEAR = 40; // 핸들 근처(px) → 점프 없이 잡기만
            if (Math.abs(x - (nearStart ? sx : ex)) <= NEAR) {
                grab.current = nearStart ? sRef.current : eRef.current;
                onChangeRef.current(sRef.current, eRef.current); // 활성화(코랄)만
            } else {
                grab.current = applyHandle(bRef.current + clamp((x - INSET) / u, 0, 1) * spanOf()); // 즉시 이동
            }
        },
        onPanResponderMove: (_, g) => {
            applyHandle(grab.current + (g.dx / usableOf()) * spanOf());
        },
    })).current;

    const startX = pxOf(startMs), endX = pxOf(endMs);
    const accent = active ? theme.coral : theme.textMuted;
    const lblColor = active ? theme.coral : theme.textSecondary;

    return (
        <View style={styles.wrap}>
            {/* 트랙 전체가 터치영역: 탭/드래그하면 가까운 핸들이 잡힘 */}
            <View {...trackPan.panHandlers} style={styles.trackWrap} onLayout={(e: LayoutChangeEvent) => setTrackW(e.nativeEvent.layout.width)}>
                <View style={[styles.track, { left: INSET, right: INSET, backgroundColor: theme.surfaceAlt }]} />
                <View style={[styles.fill, { left: startX, width: Math.max(0, endX - startX), backgroundColor: accent }]} />
                <View pointerEvents="none" style={[styles.handle, { left: startX - HANDLE / 2, borderColor: accent, backgroundColor: theme.surface }]}>
                    <View style={[styles.handleDot, { backgroundColor: accent }]} />
                </View>
                <View pointerEvents="none" style={[styles.handle, { left: endX - HANDLE / 2, borderColor: accent, backgroundColor: theme.surface }]}>
                    <View style={[styles.handleDot, { backgroundColor: accent }]} />
                </View>
            </View>

            {/* 핸들 밑 년월 라벨: 실제 라벨 박스가 겹치면 하나로 합쳐 "start ~ end"로 표시 */}
            <View style={styles.lblRow}>
                {(() => {
                    const maxLeft = Math.max(0, trackW - LBL_W);
                    const sLeft = clamp(startX - LBL_W / 2, 0, maxLeft);
                    const eLeft = clamp(endX - LBL_W / 2, 0, maxLeft);
                    const overlap = eLeft - sLeft < LBL_W; // 두 76px 라벨이 안 겹치려면 ≥LBL_W 떨어져야
                    if (overlap) {
                        return (
                            <Text numberOfLines={1} allowFontScaling={false}
                                style={[styles.mergedLbl, { left: clamp((startX + endX) / 2 - MERGED_W / 2, 0, Math.max(0, trackW - MERGED_W)), color: lblColor }]}>
                                {ymLabel(startMs)} ~ {ymLabel(endMs)}
                            </Text>
                        );
                    }
                    return (
                        <>
                            <Text numberOfLines={1} allowFontScaling={false} style={[styles.handleLbl, { left: sLeft, color: lblColor }]}>{ymLabel(startMs)}</Text>
                            <Text numberOfLines={1} allowFontScaling={false} style={[styles.handleLbl, { left: eLeft, color: lblColor }]}>{ymLabel(endMs)}</Text>
                        </>
                    );
                })()}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { width: "100%" },
    trackWrap: { height: 60, justifyContent: "center" }, // 전체 폭이 터치영역(끝 핸들도 안에 들어옴)
    track: { position: "absolute", height: 6, borderRadius: 999 }, // left/right는 INSET 인라인
    fill: { position: "absolute", height: 6, borderRadius: 999 },
    handle: {
        position: "absolute", width: HANDLE, height: HANDLE, borderRadius: HANDLE / 2, borderWidth: 3,
        alignItems: "center", justifyContent: "center",
        shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 3,
    },
    handleDot: { width: 6, height: 6, borderRadius: 3 },
    lblRow: { height: 20, marginTop: 8 },
    handleLbl: { position: "absolute", width: LBL_W, textAlign: "center", fontSize: 13, fontWeight: "800" },
    mergedLbl: { position: "absolute", width: MERGED_W, textAlign: "center", fontSize: 13, fontWeight: "800" },
});
