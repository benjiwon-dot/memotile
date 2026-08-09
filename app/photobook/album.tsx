// app/photobook/album.tsx
//
// 포토북 옵션 화면: 표지 캐러셀(첫사진/스타일/직접) + 크기(A4/A3 비율카드) + 표지타입(소프트/하드 두께) +
//  실시간 가격 + 접이식 사진그리드. 앞표지=사진, 뒤표지=memotile 로고 고정.
import React, { useMemo, useRef, useState } from "react";
import {
    View, Text, StyleSheet, Pressable, ScrollView, Dimensions, Modal, TextInput,
    NativeSyntheticEvent, NativeScrollEvent,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image as ExpoImage } from "expo-image";
import { Feather } from "@expo/vector-icons";
import Animated, { useSharedValue, useAnimatedScrollHandler, useAnimatedStyle, interpolate, Extrapolate, SharedValue } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { useLanguage } from "../../src/context/LanguageContext";
import { usePhotobookEnabled } from "../../src/config/featureFlags";
import { usePhotobookTheme, pbRadius } from "../../src/config/photobookTheme";
import { PhotobookGradient } from "../../src/components/photobook/PhotobookGradient";
import { getAlbumDraft, getAlbumOptions, setAlbumOptions, setAlbumItems, CoverStyle } from "../../src/services/albumDraft";
import { useHiResCover } from "../../src/services/coverImage";
import { CoverCrop } from "../../src/components/photobook/CoverCrop";
import { PhotobookCropEditor } from "../../src/components/photobook/PhotobookCropEditor";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { albumPrice, pagesForPhotos, isSparse, AlbumSize, CoverType } from "../../src/config/photobookPricing";
import { usePhotobookPricing } from "../../src/services/photobookPriceConfig";
import { countPages, photosUsedCount, MAX_PAGES } from "../../src/services/photoLayout";

const SCREEN_W = Dimensions.get("window").width;
const CARD_W = Math.round(SCREEN_W * 0.64);      // 표지 슬라이드 한 칸(양옆 peek)
const SIDE_PAD = (SCREEN_W - CARD_W) / 2;        // 첫/마지막 표지 중앙 정렬
const H_PAD = 20;
const GAP = 6;
const COLS = 4;
const CELL = Math.floor((SCREEN_W - H_PAD * 2 - GAP * (COLS - 1)) / COLS);
const BW = 190, BH = 136; // 미니 책 크기 (가로형) — 살짝 축소
const COVER_STYLES: CoverStyle[] = ["photo", "style", "logo", "text"];

const COVER_RATIO = 27.9 / 21.5; // 표지 가로형 비율 (A4·A3 거의 동일)

function ym(ms: number): string { const d = new Date(ms); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}`; }
function dateRangeLabel(items: { creationTime?: number }[]): string {
    const ts = items.map((i) => i.creationTime).filter((x): x is number => !!x);
    if (!ts.length) return "";
    const a = ym(Math.min(...ts)), b = ym(Math.max(...ts));
    return a === b ? a : `${a} ~ ${b}`; // 한 달이면 월 하나만
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// 표지 슬라이드 한 칸 — 중앙(선택)은 크고 선명, 양옆은 작고 흐리게(peek). 모듈 컴포넌트라 remount 없음.
function CoverSlide({ index, scrollX, children }: { index: number; scrollX: SharedValue<number>; children: React.ReactNode }) {
    const style = useAnimatedStyle(() => {
        const d = Math.abs(scrollX.value - index * CARD_W);
        const scale = interpolate(d, [0, CARD_W], [1, 0.8], Extrapolate.CLAMP);
        const opacity = interpolate(d, [0, CARD_W], [1, 0.45], Extrapolate.CLAMP);
        return { transform: [{ scale }], opacity };
    });
    return <Animated.View style={[{ width: CARD_W, alignItems: "center", justifyContent: "center" }, style]}>{children}</Animated.View>;
}
// 사진의 가장 큰 얼굴 중심(0~1) — 표지 크롭 기본 초점
function faceCenterOf(item?: { faces?: { x: number; y: number; width: number; height: number }[] }): { x: number; y: number } {
    const f = item?.faces?.length ? item.faces.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b)) : null;
    return f ? { x: clamp01(f.x + f.width / 2), y: clamp01(f.y + f.height / 2) } : { x: 0.5, y: 0.5 };
}

export default function PhotobookAlbum() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { t } = useLanguage();
    const c = usePhotobookTheme();
    const enabled = usePhotobookEnabled();
    usePhotobookPricing(); // 원격 가격 반영 시 표시가 재계산되도록 구독

    const draft = getAlbumDraft();
    const opts0 = getAlbumOptions(); // 이어서 하기 복귀 시 이전 옵션 복원(신규 흐름이면 기본값)
    const COVER_STYLE_IDX: Record<CoverStyle, number> = { photo: 0, style: 1, logo: 2, text: 3 };
    const [items, setItems] = useState(draft.items);
    const [size, setSize] = useState<AlbumSize>(opts0.size ?? "A4");
    const [cover, setCover] = useState<CoverType>(opts0.cover ?? "soft");
    const [coverIdx, setCoverIdx] = useState(COVER_STYLE_IDX[opts0.coverStyle] ?? 0); // 0 photo · 1 style · 2 logo · 3 text
    const [coverPhotoId, setCoverPhotoId] = useState<string | null>(opts0.coverPhotoId ?? null);
    const [title, setTitle] = useState(opts0.title || draft.subjectName || "");
    const [gridOpen, setGridOpen] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [repositionOpen, setRepositionOpen] = useState(false);
    const initFace = faceCenterOf(draft.items[0]);
    const [focusX, setFocusX] = useState(opts0.coverFocusX ?? initFace.x);
    const [focusY, setFocusY] = useState(opts0.coverFocusY ?? initFace.y);
    const [zoom, setZoom] = useState(opts0.coverZoom ?? 1);
    const carouselRef = useRef<any>(null);
    const scrollX = useSharedValue(0);
    const scrollHandler = useAnimatedScrollHandler((e) => { scrollX.value = e.contentOffset.x; });

    // A4/A3 선택 시 상단 표지 미리보기 크기도 변경 (A3 더 큼)
    const bw = size === "A3" ? 210 : 182;
    const bh = Math.round(bw / COVER_RATIO);
    const styleFrameW = bw - 24;   // 스타일 표지 안쪽 액자 크기
    const styleFrameH = bh - 58;

    // 크롭 리포지션 프레임 크기 (에디터는 PhotobookCropEditor가 제스처 처리)
    const RFW = SCREEN_W - 64;
    const RFH = RFW / COVER_RATIO;

    const firstUri = items[0]?.thumbUri;
    const coverUri = useMemo( // photo/style 표지에 쓸 사진: 고른 게 있으면 그거, 없으면 첫 사진
        () => (coverPhotoId ? items.find((i) => i.assetId === coverPhotoId)?.thumbUri : firstUri),
        [coverPhotoId, items, firstUri]
    );
    const coverAssetId = coverPhotoId ?? items[0]?.assetId;
    const hiCoverUri = useHiResCover(coverAssetId, coverUri); // 표지는 원본 고해상도
    const coverItem = coverPhotoId ? items.find((i) => i.assetId === coverPhotoId) : items[0];
    const coverAspect = coverItem && coverItem.height ? coverItem.width / coverItem.height : 1;
    const dateLabel = useMemo(() => dateRangeLabel(items), [items]);
    // 가격은 실제 buildPages 페이지 수 기준(사진 수 아님). 밀도는 preview에서 정하므로 여기선 기본 balanced로 추정.
    // 내지 = 표지로 쓴 사진 제외(freeze·체크아웃과 동일 집합이어야 가격이 어긋나지 않는다)
    const albumInterior = useMemo(
        () => (coverAssetId ? items.filter((i) => i.assetId !== coverAssetId) : items),
        [items, coverAssetId],
    );
    // 밀도는 프리뷰에서 바꾼 값이 저장돼 있고 체크아웃도 그 값으로 과금한다.
    // 여기서 "balanced"로 고정하면 프리뷰에서 밀도를 바꾼 뒤 이 화면 가격과 결제액이 달라진다.
    const albumDensity = (opts0.density as any) || "balanced";
    const albumActualPages = useMemo(() => countPages(albumInterior, 27.9 / 21.5, albumDensity), [albumInterior, albumDensity]);
    // 고객 표시용 총 페이지 = 표지 1 + 내지 + 뒷장 1
    const albumTotalPages = albumActualPages + 2;
    // 상한(MAX_PAGES) 때문에 일부 사진이 빠졌는지 — 빠졌으면 아래에서 안내
    const photoFit = useMemo(() => photosUsedCount(albumInterior, 27.9 / 21.5, albumDensity), [albumInterior, albumDensity]);
    const { price } = albumPrice(size, cover, albumActualPages);

    if (!enabled) return null;

    const pickCover = (id: string) => {
        setCoverPhotoId(id);
        const fc = faceCenterOf(items.find((x) => x.assetId === id));
        setFocusX(fc.x); setFocusY(fc.y); setZoom(1);
        setPickerOpen(false);
        setRepositionOpen(true); // 사진 바꾸면 바로 위치 조정
    };
    const openReposition = () => { if (coverUri) setRepositionOpen(true); };

    const remove = (id: string) => setItems((prev) => prev.filter((x) => x.assetId !== id));

    function onCarouselScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
        const i = Math.min(COVER_STYLES.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / CARD_W)));
        if (i !== coverIdx) { setCoverIdx(i); Haptics.selectionAsync(); } // snap 시 톡
    }
    const centerTo = (i: number) => {
        carouselRef.current?.scrollTo({ x: i * CARD_W, animated: true });
        if (i !== coverIdx) { setCoverIdx(i); Haptics.selectionAsync(); }
    };

    function onNext() {
        setAlbumItems(items); // 여기서 삭제한 사진을 draft에 반영(프리뷰/주문에 동기화)
        setAlbumOptions({ size, cover, coverStyle: COVER_STYLES[coverIdx], coverPhotoId, coverFocusX: focusX, coverFocusY: focusY, coverZoom: zoom, title });
        router.push("/photobook/preview");
    }

    // ⚠️ 아래는 컴포넌트가 아니라 "함수"로 호출(=인라인 JSX)한다. <Comp/>로 쓰면 매 렌더마다
    //    새 컴포넌트로 인식돼 ExpoImage가 remount → 제목 타이핑 시 표지가 깜빡였음. 함수 호출은 remount 없음.
    // 세련된 아이콘 버튼(사진 교체) — 카메라칩/문구 대신 미니멀하게
    const changeBtn = () => (
        <Pressable onPress={() => setPickerOpen(true)} hitSlop={10} style={styles.changeBtn}>
            <Feather name="repeat" size={13} color={c.ink} />
        </Pressable>
    );

    // 미니 책 표지 한 면
    const coverFace = (style: CoverStyle) => {
        // 미니멀 로고 표지
        if (style === "logo") {
            return (
                <View style={[styles.face, { backgroundColor: c.surface, alignItems: "center", justifyContent: "center", padding: 12 }]}>
                    <Text style={{ fontSize: 17, fontWeight: "900", color: c.ink, letterSpacing: -0.3 }}>memotile</Text>
                    <Text style={{ fontSize: 8, letterSpacing: 3, color: c.textMuted, marginTop: 2 }}>PHOTO BOOK</Text>
                    {!!title && <Text style={{ fontSize: 12, color: c.textSecondary, marginTop: 10 }} numberOfLines={1}>{title}</Text>}
                    {!!dateLabel && <Text style={{ fontSize: 9, color: c.textMuted, marginTop: 3 }}>{dateLabel}</Text>}
                </View>
            );
        }
        // 커스텀 글 표지 — 이름·날짜를 우측 하단에 작게
        if (style === "text") {
            return (
                <View style={[styles.face, { backgroundColor: c.surface, alignItems: "flex-end", justifyContent: "flex-end", padding: 12 }]}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: title ? c.ink : c.textMuted, textAlign: "right" }} numberOfLines={1}>
                        {title || t.pbCoverTextHint}
                    </Text>
                    {!!dateLabel && <Text style={{ fontSize: 9, color: c.textMuted, textAlign: "right", marginTop: 2 }}>{dateLabel}</Text>}
                </View>
            );
        }
        // 스타일 프레임: 흰 바탕에 사진 액자
        if (style === "style") {
            return (
                <View style={[styles.face, { backgroundColor: c.surface, alignItems: "center", justifyContent: "center", padding: 12 }]}>
                    {changeBtn()}
                    <View style={{ borderRadius: 3, overflow: "hidden" }}>
                        <CoverCrop uri={hiCoverUri} w={styleFrameW} h={styleFrameH} aspect={coverAspect} focusX={focusX} focusY={focusY} zoom={zoom} bg={c.surfaceAlt} />
                    </View>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: c.ink, marginTop: 6 }} numberOfLines={1}>{title}</Text>
                    <Text style={{ fontSize: 8, letterSpacing: 2, color: c.textMuted }}>{dateLabel || "PHOTOBOOK"}</Text>
                </View>
            );
        }
        // photo = 풀 사진 (얼굴 초점 크롭)
        return (
            <View style={[styles.face, { backgroundColor: c.surfaceAlt }]}>
                <CoverCrop uri={hiCoverUri} w={bw} h={bh} aspect={coverAspect} focusX={focusX} focusY={focusY} zoom={zoom} bg={c.surfaceAlt} />
                {changeBtn()}
                <View style={styles.faceBand}>
                    <Text style={{ fontSize: 15, fontWeight: "800", color: "#fff" }} numberOfLines={1}>{title}</Text>
                    <Text style={{ fontSize: 8, letterSpacing: 2, color: "rgba(255,255,255,0.85)" }}>{dateLabel || "PHOTOBOOK"}</Text>
                </View>
            </View>
        );
    };

    const hasPhoto = (style: CoverStyle) => style === "photo" || style === "style";
    const miniBook = (style: CoverStyle, selected: boolean) => (
        <View style={[styles.bookWrap, { width: bw + 8, height: bh + 8 }]}>
            <View style={[styles.pageStack2, { backgroundColor: c.surfaceAlt, borderColor: c.border, width: bw, height: bh - 8 }]} />
            <View style={[styles.pageStack1, { backgroundColor: c.surface, borderColor: c.border, width: bw, height: bh - 4 }]} />
            <View style={[styles.cover, { borderColor: selected ? c.coral : c.border, borderWidth: selected ? 2 : 0.5, width: bw, height: bh }]}>
                <View style={[styles.spine, { borderRightColor: c.border }]} />
                {coverFace(style)}
            </View>
        </View>
    );

    const RatioCard = (v: AlbumSize, w: number, h: number, dims: string) => {
        const on = size === v;
        return (
            <Pressable onPress={() => setSize(v)} style={[styles.optCard, { borderColor: on ? c.coral : c.border, borderWidth: on ? 2 : 1 }]}>
                <View style={{ width: w, height: h, backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 3 }} />
                <Text style={[styles.optTitle, { color: c.ink }]}>{v}</Text>
                <Text style={[styles.optSub, { color: c.textMuted }]}>{dims}</Text>
            </Pressable>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: c.bg, paddingTop: insets.top + 8 }]}>
            <View style={styles.header}>
                <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconBtn}>
                    <Feather name="arrow-left" size={24} color={c.ink} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: c.ink }]} numberOfLines={1}>{t.pbAlbumTitle}</Text>
                <View style={styles.iconBtn} />
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 100 }} showsVerticalScrollIndicator={false}>
                {/* 표지 캐러셀 (peek: 중앙 강조 + 양옆 흐리게) */}
                <Animated.ScrollView
                    ref={carouselRef} horizontal showsHorizontalScrollIndicator={false}
                    snapToInterval={CARD_W} decelerationRate="fast" disableIntervalMomentum snapToAlignment="start"
                    onScroll={scrollHandler} scrollEventThrottle={16}
                    onMomentumScrollEnd={onCarouselScroll}
                    contentContainerStyle={{ paddingHorizontal: SIDE_PAD }}
                    style={{ marginTop: 20 }}
                >
                    {COVER_STYLES.map((s, i) => (
                        <CoverSlide key={s} index={i} scrollX={scrollX}>
                            <Pressable onPress={() => (i === coverIdx ? (hasPhoto(s) && openReposition()) : centerTo(i))}>
                                {miniBook(s, i === coverIdx)}
                            </Pressable>
                        </CoverSlide>
                    ))}
                </Animated.ScrollView>

                <View style={styles.dots}>
                    {COVER_STYLES.map((_, i) => (
                        <View key={i} style={{ width: i === coverIdx ? 18 : 7, height: 7, borderRadius: 99, backgroundColor: i === coverIdx ? c.coral : c.border }} />
                    ))}
                </View>
                <View style={styles.coverNameRow}>
                    <Feather name="check-circle" size={13} color={c.coral} />
                    <Text style={[styles.coverName, { color: c.ink, marginTop: 0 }]}>
                        {[t.pbCoverPhoto, t.pbCoverStyle, t.pbCoverLogoName, t.pbCoverTextName][coverIdx]}
                    </Text>
                </View>
                <Text style={[styles.logoNote, { color: c.textMuted }]}>
                    {hasPhoto(COVER_STYLES[coverIdx]) ? t.pbAdjustPos : t.pbCoverLogoBack}
                </Text>
                <Text style={[styles.appliesNote, { color: c.coral }]}>{t.pbCoverApplies}</Text>

                {/* 제목 */}
                <View style={styles.section}>
                    <View style={[styles.titleField, { backgroundColor: c.surface, borderColor: c.border }]}>
                        <Feather name="edit-2" size={14} color={c.textMuted} />
                        <TextInput
                            value={title} onChangeText={setTitle} placeholder={t.pbEditTitle}
                            placeholderTextColor={c.textMuted}
                            style={{ flex: 1, marginLeft: 8, fontSize: 15, fontWeight: "700", color: c.ink, padding: 0 }}
                        />
                    </View>
                </View>

                {/* 크기 */}
                <View style={styles.section}>
                    <Text style={[styles.label, { color: c.textSecondary }]}>{t.pbAlbumSize}</Text>
                    <View style={styles.row}>
                        {RatioCard("A5", 46, 35, "21.0 × 14.8 cm")}
                        {RatioCard("A4", 66, 51, "27.9 × 21.5 cm")}
                        {RatioCard("A3", 92, 71, "38.6 × 29.7 cm")}
                    </View>
                </View>

                {/* 표지 타입 (두께) */}
                <View style={styles.section}>
                    <Text style={[styles.label, { color: c.textSecondary }]}>{t.pbAlbumCover}</Text>
                    <View style={styles.row}>
                        <Pressable onPress={() => setCover("soft")} style={[styles.optCard, { borderColor: cover === "soft" ? c.coral : c.border, borderWidth: cover === "soft" ? 2 : 1 }]}>
                            <View style={styles.thumbBox}>
                                <View style={{ width: 44, height: 34, backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 2, transform: [{ rotate: "-4deg" }] }} />
                            </View>
                            <Text style={[styles.optTitle, { color: c.ink }]}>{t.pbCoverSoft}</Text>
                        </Pressable>
                        <Pressable onPress={() => setCover("hard")} style={[styles.optCard, { borderColor: cover === "hard" ? c.coral : c.border, borderWidth: cover === "hard" ? 2 : 1 }]}>
                            <View style={styles.thumbBox}>
                                <View style={{ width: 46, height: 36 }}>
                                    <View style={{ position: "absolute", left: 0, bottom: -4, width: 46, height: 6, backgroundColor: "rgba(0,0,0,0.18)", borderRadius: 2 }} />
                                    <View style={{ position: "absolute", right: -4, top: 0, width: 6, height: 36, backgroundColor: "rgba(0,0,0,0.12)", borderRadius: 2 }} />
                                    <View style={{ position: "absolute", left: 0, top: 0, width: 46, height: 36, backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 2 }} />
                                </View>
                            </View>
                            <Text style={[styles.optTitle, { color: c.ink }]}>{t.pbCoverHard}</Text>
                        </Pressable>
                    </View>
                </View>

                {/* 실시간 가격 */}
                <View style={styles.section}>
                    <View style={[styles.priceBox, { backgroundColor: c.surfaceAlt, borderColor: c.coral }]}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ fontSize: 12.5, fontWeight: "700", color: c.coral }} numberOfLines={1}>
                                {items.length} {t.pbPhotosUnit} · {albumTotalPages} {t.pbPagesUnit} · {size} {cover === "soft" ? t.pbCoverSoft : t.pbCoverHard}
                            </Text>
                            <Text style={{ fontSize: 11, color: c.coral, opacity: 0.8 }} numberOfLines={1}>{t.pbInclVat}</Text>
                        </View>
                        <Text style={{ fontSize: 21, fontWeight: "900", color: c.coral }}>{price.toLocaleString()}฿</Text>
                    </View>
                    {isSparse(items.length) && (
                        <Pressable onPress={() => router.back()} style={[styles.nudge, { borderColor: c.peach }]}>
                            <Feather name="search" size={14} color={c.coral} />
                            <Text style={{ fontSize: 12.5, color: c.coral, fontWeight: "700", marginLeft: 6 }}>{t.pbFewNudge}</Text>
                        </Pressable>
                    )}
                    {/* 사진이 최대 페이지를 넘겨 일부만 담긴 경우 — 모르면 "사진이 사라졌다"는 오해가 생긴다 */}
                    {photoFit.used < photoFit.total && (
                        <View style={[styles.nudge, { borderColor: c.peach, alignItems: "flex-start" }]}>
                            <Feather name="layers" size={14} color={c.coral} style={{ marginTop: 1 }} />
                            <View style={{ flex: 1, marginLeft: 6 }}>
                                <Text style={{ fontSize: 12.5, color: c.ink, fontWeight: "800" }}>{t.pbTrimmedTitle}</Text>
                                <Text style={{ fontSize: 11.5, color: c.textSecondary, marginTop: 2, lineHeight: 16 }}>
                                    {t.pbTrimmedBody
                                        .replace("{used}", String(photoFit.used))
                                        .replace("{total}", String(photoFit.total))
                                        .replace("{max}", String(MAX_PAGES))}
                                </Text>
                            </View>
                        </View>
                    )}
                </View>

                {/* 사진 그리드 (접이식) */}
                <View style={styles.section}>
                    <Pressable onPress={() => setGridOpen((v) => !v)} style={[styles.gridHead, { borderColor: c.border }]}>
                        <Text style={{ fontSize: 14, color: c.ink }}>
                            <Feather name="image" size={15} color={c.textSecondary} />  {items.length} {t.pbPhotosUnit}
                        </Text>
                        <Feather name={gridOpen ? "chevron-up" : "chevron-down"} size={18} color={c.textSecondary} />
                    </Pressable>
                    {gridOpen && (
                        <View style={styles.grid}>
                            {items.map((it) => (
                                <View key={it.assetId} style={[styles.cell, { backgroundColor: c.surfaceAlt }]}>
                                    <ExpoImage source={{ uri: it.thumbUri }} style={styles.cellImg} contentFit="cover" />
                                    <Pressable style={styles.removeBadge} onPress={() => remove(it.assetId)} hitSlop={6}>
                                        <Feather name="x" size={12} color="#fff" />
                                    </Pressable>
                                </View>
                            ))}
                        </View>
                    )}
                </View>
            </ScrollView>

            {/* sticky 다음 */}
            <View style={[styles.bottomBar, { backgroundColor: c.bg, borderTopColor: c.border, paddingBottom: insets.bottom + 10 }]}>
                <Pressable onPress={onNext} style={{ width: "100%" }} disabled={items.length === 0}>
                    <PhotobookGradient colors={c.gradient} radius={pbRadius.lg} style={[styles.nextBtn, items.length === 0 && { opacity: 0.5 }]}>
                        <Text style={styles.nextText}>{t.pbNextPreview}</Text>
                    </PhotobookGradient>
                </Pressable>
            </View>

            {/* 표지 사진 직접 고르기 모달 */}
            <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
                <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={() => setPickerOpen(false)} />
                <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: insets.bottom + 16 }]}>
                    <Text style={[styles.sheetTitle, { color: c.ink }]}>{t.pbCoverPick}</Text>
                    <ScrollView contentContainerStyle={styles.grid} style={{ maxHeight: 360 }}>
                        {items.map((it) => (
                            <Pressable key={it.assetId} style={[styles.cell, { backgroundColor: c.surfaceAlt, borderWidth: coverPhotoId === it.assetId ? 2 : 0, borderColor: c.coral }]}
                                onPress={() => pickCover(it.assetId)}>
                                <ExpoImage source={{ uri: it.thumbUri }} style={styles.cellImg} contentFit="cover" />
                            </Pressable>
                        ))}
                    </ScrollView>
                </View>
            </Modal>

            {/* 표지 사진 크롭 위치 조정 (드래그로 이동) */}
            <Modal visible={repositionOpen} transparent animationType="fade" supportedOrientations={["portrait", "landscape"]} onRequestClose={() => setRepositionOpen(false)}>
                <GestureHandlerRootView style={styles.repoBackdrop}>
                    <Text style={styles.repoTitle}>{t.pbRepositionTitle}</Text>
                    <View style={[styles.repoFrame, { width: RFW, height: RFH }]}>
                        <PhotobookCropEditor
                            uri={hiCoverUri}
                            frameW={RFW}
                            frameH={RFH}
                            aspect={coverAspect}
                            value={{ fx: focusX, fy: focusY, zoom }}
                            onChange={(v) => { setFocusX(v.fx); setFocusY(v.fy); setZoom(v.zoom); }}
                            grid
                        />
                    </View>
                    <Text style={styles.repoHint}>{t.pbRepositionHint}</Text>
                    <View style={styles.repoBtns}>
                        <Pressable onPress={() => setRepositionOpen(false)} style={[styles.repoBtn, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
                            <Text style={styles.repoBtnTxt}>{t.pbDone}</Text>
                        </Pressable>
                    </View>
                </GestureHandlerRootView>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: H_PAD, paddingBottom: 8 },
    iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 18, fontWeight: "800", flex: 1, textAlign: "center" },

    bookWrap: { width: BW + 8, height: BH + 8, alignItems: "flex-start", justifyContent: "flex-start" },
    pageStack2: { position: "absolute", right: 0, top: 6, width: BW, height: BH - 8, borderWidth: 0.5, borderRadius: 4 },
    pageStack1: { position: "absolute", right: 2, top: 3, width: BW, height: BH - 4, borderWidth: 0.5, borderRadius: 4 },
    cover: { position: "absolute", left: 0, top: 0, width: BW, height: BH, borderWidth: 0.5, borderRadius: 4, overflow: "hidden" },
    spine: { position: "absolute", left: 0, top: 0, bottom: 0, width: 10, backgroundColor: "rgba(0,0,0,0.06)", zIndex: 2, borderRightWidth: 0.5 },
    face: { width: "100%", height: "100%" },
    faceBand: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "rgba(20,16,14,0.34)" },
    changeBtn: { position: "absolute", bottom: 8, right: 8, zIndex: 3, width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.92)" },

    repoBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.88)", alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
    repoTitle: { fontSize: 16, fontWeight: "800", color: "#fff", marginBottom: 16 },
    repoFrame: { borderRadius: 6, overflow: "hidden", backgroundColor: "#222" },
    thirdV: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "rgba(255,255,255,0.25)" },
    thirdH: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: "rgba(255,255,255,0.25)" },
    repoHint: { fontSize: 12.5, color: "rgba(255,255,255,0.75)", marginTop: 14 },
    repoBtns: { flexDirection: "row", gap: 12, marginTop: 22 },
    repoBtn: { paddingHorizontal: 34, paddingVertical: 12, borderRadius: 12 },
    repoBtnTxt: { fontSize: 15, fontWeight: "800", color: "#fff" },

    dots: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 16 },
    coverNameRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 8 },
    coverName: { fontSize: 14, fontWeight: "800", textAlign: "center", marginTop: 8 },
    logoNote: { fontSize: 11, fontWeight: "600", textAlign: "center", marginTop: 3 },
    appliesNote: { fontSize: 10.5, fontWeight: "600", textAlign: "center", marginTop: 3 },

    section: { paddingHorizontal: H_PAD, marginTop: 18 },
    label: { fontSize: 13, fontWeight: "700", marginBottom: 8 },
    row: { flexDirection: "row", gap: 10 },
    optCard: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: "center", gap: 8 },
    thumbBox: { height: 46, justifyContent: "center", alignItems: "center" },
    optTitle: { fontSize: 14, fontWeight: "700" },
    optSub: { fontSize: 11, fontWeight: "600" },

    titleField: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, height: 46 },

    priceBox: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
    nudge: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 10, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5 },

    gridHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP, marginTop: 12 },
    cell: { width: CELL, height: CELL, borderRadius: 8, overflow: "hidden" },
    cellImg: { width: "100%", height: "100%" },
    removeBadge: { position: "absolute", top: 3, right: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },

    bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: H_PAD, paddingTop: 10, borderTopWidth: 1 },
    nextBtn: { height: 52, alignItems: "center", justifyContent: "center" },
    nextText: { color: "#fff", fontWeight: "800", fontSize: 16 },

    sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: H_PAD, paddingTop: 16 },
    sheetTitle: { fontSize: 16, fontWeight: "800", marginBottom: 12 },
});
