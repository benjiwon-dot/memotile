// src/screens/EditorScreen.tsx
//
// ✅ freeze 해결 버전 — 취약한 dual-buffer 크로스페이드/commit 의존 제거.
//    단일 CropFrameRN + "처리중 오버레이" + 다음 사진 prefetch 로 전환. 어떤 경우에도 isProcessing 은
//    finally 에서 반드시 해제 → 필터/Next/필름스트립이 잠기지 않음.
//
//   보존: isHighEndDevice(원본 화질 분기), export/bake, committed.cropRatio, output.printUri,
//         exportQueue, 드래프트 자동저장, 웹 폴백, 크롭 힌트, 필름스트립(앞뒤 재수정).
//   필름스트립 썸네일 = output.previewUri(크롭·필터 적용된 중간화질) → 렉 없음. 탭하면 edits.ui 복원 → 크롭 안 깨짐.

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Text,
  ActivityIndicator,
  Alert,
  Image as RNImage,
  ScrollView,
  Platform,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as FileSystem from "expo-file-system";
import { Feather } from "@expo/vector-icons";

// 🚀 [스마트 램(RAM) 감지 엔진 탑재]
import * as Device from 'expo-device';

import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  cancelAnimation,
} from "react-native-reanimated";

import { usePhoto } from "../context/PhotoContext";
import { useLanguage } from "../context/LanguageContext";
import { colors } from "../theme/colors";

import TopBarRN from "../components/editorRN/TopBarRN";
import CropFrameRN from "../components/editorRN/CropFrameRN";
import FilterStripRN from "../components/editorRN/FilterStripRN";
import FilteredImageSkia, { FilteredImageSkiaRef } from "../components/editorRN/FilteredImageSkia";
import { FILTERS } from "../components/editorRN/filters";
import { IDENTITY, type ColorMatrix } from "../utils/colorMatrix";

import { calculatePrecisionCrop } from "../utils/cropMath";
import { generatePreviewExport, bakeFilterFromCanvasSnapshot } from "../utils/editorLogic";
import { exportQueue } from "../utils/exportQueue";

type EditState = {
  crop: { x: number; y: number; scale: number };
  filterId: string;
};

const makeDefaultEdit = (): EditState => ({
  crop: { x: 0, y: 0, scale: 1 },
  filterId: "original",
});

type ResolvedInfo = { uri: string; width: number; height: number };

const getImageSizeAsync = (uri: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    if (!uri) return resolve({ width: 0, height: 0 });
    RNImage.getSize(uri, (w, h) => resolve({ width: w, height: h }), (err) => reject(err));
  });

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
const waitRaf = () => new Promise<void>((res) => requestAnimationFrame(() => res()));

type BakeJob = {
  uri: string; w: number; h: number; matrix: ColorMatrix;
  overlayColor?: string; overlayOpacity?: number; resolve: (out: string | null) => void;
};

const sanitizeCropRect = (r: any, srcW: number, srcH: number) => {
  const w = Math.max(1, Math.floor(Number.isFinite(r?.width) ? r.width : 1));
  const h = Math.max(1, Math.floor(Number.isFinite(r?.height) ? r.height : 1));
  let x = Math.floor(Number.isFinite(r?.x) ? r.x : 0);
  let y = Math.floor(Number.isFinite(r?.y) ? r.y : 0);
  x = Math.max(0, Math.min(x, Math.max(0, srcW - 1)));
  y = Math.max(0, Math.min(y, Math.max(0, srcH - 1)));
  const maxSizeW = Math.max(1, srcW - x);
  const maxSizeH = Math.max(1, srcH - y);
  const size = Math.max(1, Math.min(Math.max(w, h), maxSizeW, maxSizeH));
  if (x + size > srcW) x = Math.max(0, srcW - size);
  if (y + size > srcH) y = Math.max(0, srcH - size);
  return { x, y, width: size, height: size, isValid: true };
};

// 🚀 램 6GB 이상 고사양 폰 판독 (원본 초고화질 표시용)
const isHighEndDevice = () => {
  if (Platform.OS === 'ios' || Platform.OS === 'web') return true;
  const ramGB = (Device.totalMemory || 0) / (1024 * 1024 * 1024);
  return ramGB >= 5.5;
};

export default function EditorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { photos, currentIndex, setCurrentIndex, saveDraft, updatePhoto } = usePhoto();
  const { t, locale } = useLanguage();

  const photosRef = useRef<any[]>(photos as any[]);
  useEffect(() => { photosRef.current = photos as any[]; }, [photos]);

  const resolvedCache = useRef<Record<string, ResolvedInfo>>({});
  const currentPhoto = photos?.[currentIndex] as any;

  const isAliveRef = useRef(true);

  const [bakeJob, setBakeJob] = useState<BakeJob | null>(null);
  const bakeBusyRef = useRef(false);
  const pendingBakeResolveRef = useRef<((out: string | null) => void) | null>(null);
  const filteredCanvasRef = useRef<FilteredImageSkiaRef>(null);

  const filmRef = useRef<ScrollView>(null);

  useEffect(() => {
    isAliveRef.current = true;
    return () => {
      isAliveRef.current = false;
      try { exportQueue.clear(); } catch { }
      try { pendingBakeResolveRef.current?.(null); } catch { }
      pendingBakeResolveRef.current = null;
      setBakeJob(null);
    };
  }, []);

  const [activeResolved, setActiveResolved] = useState<ResolvedInfo | null>(null);
  const [currentUi, setCurrentUi] = useState<EditState>(makeDefaultEdit());
  const [viewportDim, setViewportDim] = useState<{ width: number; height: number } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const busyRef = useRef(false); // 재진입 방지 (동기)

  const cropRef = useRef<any>(null);

  const hintOpacity = useSharedValue(0);
  const hintStyle = useAnimatedStyle(() => ({ opacity: hintOpacity.value }));

  // 표시용 소스 해석 (isHighEndDevice 분기 유지 + content:// 복사 + 캐시)
  const resolveDisplayInfo = useCallback(async (photo: any): Promise<ResolvedInfo> => {
    const isHighEnd = isHighEndDevice();
    let targetUri = isHighEnd
      ? (photo?.originalUri || photo?.uri)
      : (photo?.cachedPreviewUri || photo?.originalUri || photo?.uri);

    if (!targetUri) return { uri: photo?.uri || "", width: photo?.width || 1000, height: photo?.height || 1000 };
    if (resolvedCache.current[targetUri]) return resolvedCache.current[targetUri];

    let inputUri = targetUri;
    if (inputUri.startsWith("content://")) {
      try {
        const baseDir = (FileSystem as any).cacheDirectory ?? (FileSystem as any).documentDirectory;
        const dest = `${baseDir}editor_import_${Date.now()}.jpg`;
        await FileSystem.copyAsync({ from: inputUri, to: dest });
        inputUri = dest;
      } catch { }
    }
    try {
      const size = await getImageSizeAsync(inputUri);
      const info = { uri: inputUri, width: size.width, height: size.height };
      resolvedCache.current[targetUri] = info;
      return info;
    } catch {
      return { uri: inputUri, width: photo?.width || 1000, height: photo?.height || 1000 };
    }
  }, []);

  // 크롭 힌트 — 자동으로 안 사라지고 "첫 터치(드래그/핀치)" 전까지 계속 떠 있음 (사람들이 잘 보게)
  useEffect(() => {
    if (!isProcessing && viewportDim && activeResolved) {
      cancelAnimation(hintOpacity);
      hintOpacity.value = 0;
      hintOpacity.value = withDelay(400, withTiming(1, { duration: 400 }));
    }
  }, [isProcessing, currentIndex, viewportDim, activeResolved]);

  // 특정 인덱스 사진 로드 (표시 정보 + 저장된 UI 복원). prefetch 로 디코딩 후 표시.
  const loadPhoto = useCallback(async (idx: number) => {
    const photo = photosRef.current?.[idx];
    if (!photo) return;
    const info = await resolveDisplayInfo(photo);
    try { await RNImage.prefetch(info.uri); } catch { }
    const savedUi = photo?.edits?.ui;
    const savedFilterId = photo?.edits?.filterId ?? "original";
    if (!isAliveRef.current) return;
    setCurrentUi(savedUi ? { ...savedUi, filterId: savedFilterId } : { ...makeDefaultEdit(), filterId: savedFilterId });
    setActiveResolved(info);
  }, [resolveDisplayInfo]);

  // 최초 로드
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!currentPhoto) { setActiveResolved(null); return; }
      if (activeResolved) return;
      const info = await resolveDisplayInfo(currentPhoto);
      if (!alive) return;
      const savedUi = currentPhoto?.edits?.ui;
      const savedFilterId = currentPhoto?.edits?.filterId ?? "original";
      setCurrentUi(savedUi ? { ...savedUi, filterId: savedFilterId } : { ...makeDefaultEdit(), filterId: savedFilterId });
      setActiveResolved(info);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPhoto?.uri]);

  // 필름스트립 현재 위치로 스크롤
  useEffect(() => {
    if (!filmRef.current) return;
    try { filmRef.current.scrollTo({ x: Math.max(0, currentIndex * 60 - 120), animated: true }); } catch { }
  }, [currentIndex]);

  const displayUri = activeResolved?.uri || currentPhoto?.uri;
  const thumbnailUri = (currentPhoto as any)?.cachedThumbnailUri || displayUri;

  const activeFilterObj = useMemo(
    () => FILTERS.find((f) => f.id === currentUi.filterId) || FILTERS[0],
    [currentUi.filterId]
  );
  const activeMatrix = useMemo(() => (activeFilterObj.matrix ?? IDENTITY) as ColorMatrix, [activeFilterObj]);

  // 드래프트 자동저장
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSigRef = useRef<string>("");
  const savingRef = useRef(false);
  const buildDraftSig = (ui: EditState, idx: number) => {
    const c = ui.crop;
    return `${idx}|${ui.filterId}|${Math.round(c.x)}|${Math.round(c.y)}|${Math.round(c.scale * 1000)}`;
  };
  useEffect(() => {
    if (isProcessing) return;
    const sig = buildDraftSig(currentUi, currentIndex);
    if (sig === lastSavedSigRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (savingRef.current) return;
      savingRef.current = true;
      try { await saveDraft("editor"); lastSavedSigRef.current = sig; } catch { } finally { savingRef.current = false; }
    }, 700);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [currentUi, currentIndex, saveDraft, isProcessing]);

  // Skia bake (필터 굽기)
  const requestSkiaBake = useCallback(
    async (uri: string, w: number, h: number, matrix: ColorMatrix,
      opts?: { maxSide?: number; overlayColor?: string; overlayOpacity?: number }): Promise<string | null> => {
      if (!isAliveRef.current) return null;
      const maxSide = Math.max(512, Math.floor(opts?.maxSide ?? 4000));
      let bakeUri = uri;
      let bakeW = Number(w) || 0;
      let bakeH = Number(h) || 0;
      if (!bakeW || !bakeH) {
        try { const real = await getImageSizeAsync(uri); bakeW = real.width; bakeH = real.height; } catch { }
      }
      const bigger = Math.max(bakeW, bakeH);
      if (bigger > maxSide) {
        try {
          const scale = maxSide / bigger;
          const targetW = Math.max(1, Math.round(bakeW * scale));
          const targetH = Math.max(1, Math.round(bakeH * scale));
          const resized = await manipulateAsync(uri, [{ resize: { width: targetW, height: targetH } }], { compress: 0.98, format: SaveFormat.JPEG });
          bakeUri = resized.uri; bakeW = resized.width || targetW; bakeH = resized.height || targetH;
        } catch (e) { console.warn("[Filter] Pre-resize failed", e); }
      }
      // bake busy 안전장치: 최대 2초 대기 후 진행
      let waited = 0;
      while (bakeBusyRef.current && waited < 2000) { await waitRaf(); waited += 16; }
      bakeBusyRef.current = true;
      try {
        if (!isAliveRef.current) return null;
        return await new Promise<string | null>((resolve) => {
          pendingBakeResolveRef.current = resolve;
          setBakeJob({ uri: bakeUri, w: bakeW, h: bakeH, matrix, overlayColor: opts?.overlayColor, overlayOpacity: opts?.overlayOpacity, resolve });
        });
      } finally {
        pendingBakeResolveRef.current = null;
        bakeBusyRef.current = false;
      }
    }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!bakeJob) return;
      const finish = (out: string | null) => { if (cancelled) return; try { bakeJob.resolve(out); } catch { } setBakeJob(null); };
      if (!isAliveRef.current) return finish(null);
      for (let i = 0; i < 10; i++) {
        if (cancelled || !isAliveRef.current) return finish(null);
        const snapshot = filteredCanvasRef.current?.snapshot();
        if (snapshot) {
          try { const result = await bakeFilterFromCanvasSnapshot(snapshot); if (result) return finish(result); }
          catch (e) { console.warn("Bake attempt failed", e); }
        }
        await sleep(100);
      }
      return finish(null);
    };
    run();
    return () => { cancelled = true; };
  }, [bakeJob]);

  // 🔑 현재 사진 export (크롭/필터 → updatePhoto). 인쇄는 orders.ts 가 committed.cropRatio 로 원본 재크롭.
  const exportCurrentPhoto = async () => {
    const idx = currentIndex;
    const photo = { ...photosRef.current[idx] } as any;
    const vp = viewportDim;
    if (!vp) return;

    const currentPhotoUri = activeResolved?.uri || photo.uri;
    const currentCrop = cropRef.current?.getLatestCrop() || currentUi.crop;
    const activeFilter = activeFilterObj;
    const matrix = activeMatrix;
    if (!currentPhotoUri) return;

    let uiW = activeResolved?.width ?? photo.width;
    let uiH = activeResolved?.height ?? photo.height;
    try { const real = await getImageSizeAsync(currentPhotoUri); if (real?.width && real?.height) { uiW = real.width; uiH = real.height; } } catch { }

    const rawCropUI = calculatePrecisionCrop({
      sourceSize: { width: uiW, height: uiH },
      containerSize: { width: vp.width, height: vp.height },
      frameRect: cropRef.current?.getFrameRect() || { x: 0, y: 0, width: vp.width, height: vp.height },
      transform: { scale: currentCrop.scale, translateX: currentCrop.x, translateY: currentCrop.y },
    });
    const safeUI = sanitizeCropRect(rawCropUI, uiW, uiH);
    const finalCropUI = { x: Math.floor(safeUI.x), y: Math.floor(safeUI.y), width: Math.floor(safeUI.width), height: Math.floor(safeUI.width) };

    const cropRatio = {
      x: Math.max(0, Math.min(1, finalCropUI.x / uiW)),
      y: Math.max(0, Math.min(1, finalCropUI.y / uiH)),
      w: Math.max(0, Math.min(1, finalCropUI.width / uiW)),
      h: Math.max(0, Math.min(1, finalCropUI.height / uiH)),
    };

    const previewRes = await generatePreviewExport(currentPhotoUri, finalCropUI);
    let finalPreviewUri = previewRes.uri;
    let finalPrintUri = "";

    if (currentUi.filterId !== "original") {
      try {
        const originalSourceUri = photo.originalUri || photo.sourceUri || photo.uri;
        const trueMeta = await manipulateAsync(originalSourceUri, []);
        const oX = Math.max(0, Math.min(Math.floor(trueMeta.width * cropRatio.x), trueMeta.width - 1));
        const oY = Math.max(0, Math.min(Math.floor(trueMeta.height * cropRatio.y), trueMeta.height - 1));
        const cW = Math.max(1, Math.min(Math.floor(trueMeta.width * cropRatio.w), trueMeta.width - oX));
        const cH = Math.max(1, Math.min(Math.floor(trueMeta.height * cropRatio.h), trueMeta.height - oY));
        const hrCrop = await manipulateAsync(originalSourceUri, [{ crop: { originX: oX, originY: oY, width: cW, height: cH } }], { compress: 1, format: SaveFormat.JPEG });
        const bakedPrint = await requestSkiaBake(hrCrop.uri, hrCrop.width, hrCrop.height, matrix, { maxSide: 2048, overlayColor: activeFilter.overlayColor, overlayOpacity: activeFilter.overlayOpacity });
        if (bakedPrint) { finalPrintUri = bakedPrint; finalPreviewUri = bakedPrint; }
      } catch (e) { console.error("Filter bake error:", e); }
    }

    await updatePhoto(idx, {
      edits: {
        crop: finalCropUI,
        filterId: currentUi.filterId,
        filterParams: { matrix, overlayColor: activeFilter.overlayColor || null, overlayOpacity: activeFilter.overlayOpacity || 0 },
        ui: { ...currentUi, crop: currentCrop },
        committed: { cropRatio, filterId: currentUi.filterId, filterParams: { matrix } },
      } as any,
      output: { ...(photo.output || {}), previewUri: finalPreviewUri || null, viewUri: finalPreviewUri || null, printUri: finalPrintUri },
    });
  };

  const goNextOrCheckout = async () => {
    if (busyRef.current) return;
    if (!photos || photos.length === 0) return;
    busyRef.current = true;
    setIsProcessing(true);
    await sleep(16);
    try {
      await exportCurrentPhoto();
      const idx = currentIndex;
      if (idx < photos.length - 1) {
        await loadPhoto(idx + 1);
        setCurrentIndex(idx + 1);
        await sleep(120); // 새 이미지가 그려질 시간 (오버레이가 가려줌)
      } else {
        router.push("/create/checkout");
      }
    } catch (e) {
      console.error("[Editor] next failed", e);
      Alert.alert("Error", "Failed to process image.");
    } finally {
      setIsProcessing(false);
      busyRef.current = false;
    }
  };

  // 🎞️ 필름스트립 탭 → 현재 commit 후 해당 사진으로 점프 (앞뒤 자유 재수정)
  const handleJumpTo = async (targetIdx: number) => {
    if (busyRef.current) return;
    if (targetIdx === currentIndex) return;
    if (!photos || targetIdx < 0 || targetIdx >= photos.length) return;
    busyRef.current = true;
    setIsProcessing(true);
    await sleep(16);
    try {
      await exportCurrentPhoto();
      await loadPhoto(targetIdx);
      setCurrentIndex(targetIdx);
      await sleep(120);
    } catch (e) {
      console.error("[Editor] jump failed", e);
      Alert.alert("Error", "Failed to switch photo.");
    } finally {
      setIsProcessing(false);
      busyRef.current = false;
    }
  };

  const handleBack = async () => {
    if (busyRef.current) return;
    if (currentIndex > 0) {
      busyRef.current = true;
      setIsProcessing(true);
      try {
        await loadPhoto(currentIndex - 1); // 뒤로가기는 export 없이 로드만 (원본 동작 유지)
        setCurrentIndex(currentIndex - 1);
        await sleep(120);
      } finally {
        setIsProcessing(false);
        busyRef.current = false;
      }
    } else {
      router.replace("/create/select");
    }
  };

  useFocusEffect(
    useCallback(() => {
      // 포커스 복귀 시 현재 사진 UI 동기화 (export 중이 아닐 때만)
      if (busyRef.current) return;
      const p = photosRef.current?.[currentIndex] as any;
      if (!p) return;
      const savedUi = p.edits?.ui;
      const savedFilterId = p.edits?.filterId ?? "original";
      if (savedUi) setCurrentUi({ ...savedUi, filterId: savedFilterId });
      else setCurrentUi((prev) => ({ ...prev, filterId: savedFilterId }));
      return () => { };
    }, [currentIndex])
  );

  const onSelectFilter = async (f: any) => {
    if (busyRef.current) return;
    const newId = f.id;
    setCurrentUi((prev) => ({ ...prev, filterId: newId }));
    const p = photosRef.current[currentIndex] as any;
    try {
      await updatePhoto(currentIndex, { edits: { ...p?.edits, filterId: newId, ui: { ...currentUi, filterId: newId } } });
    } catch (e) { console.warn("Failed to persist filter choice", e); }
  };

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
        <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>Photo Editing is App Exclusive</Text>
        <Text style={{ textAlign: 'center', color: '#666', marginBottom: 20 }}>
          The web version is for preview and checkout testing. Please download our mobile app for full photo editing features.
        </Text>
        <Pressable style={styles.primaryBtn} onPress={() => router.push("/create/checkout")}>
          <Text style={styles.primaryBtnText}>Skip to Checkout</Text>
        </Pressable>
      </View>
    );
  }

  // 드래그 + 핀치 줌 둘 다 안내 (사람들이 줌 가능한 걸 모름)
  const cropHintText = locale === 'TH' ? "ลากเพื่อเลื่อน · ใช้สองนิ้วซูม" : "Drag to move · pinch to zoom";
  const editingDisabled = busyRef.current || isProcessing;

  return (
    <View style={styles.container}>
      <View style={{ paddingTop: insets.top }}>
        <TopBarRN current={currentIndex + 1} total={photos.length} onBack={handleBack} onNext={goNextOrCheckout} />
      </View>

      <View
        style={styles.editorArea}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          if (width > 0 && height > 0) setViewportDim({ width, height });
        }}
      >
        <View style={{ flex: 1, width: "100%", height: "100%" }}>
          {viewportDim && activeResolved ? (
            <CropFrameRN
              key={`crop-${currentIndex}`}
              ref={cropRef}
              imageSrc={activeResolved.uri}
              imageWidth={activeResolved.width || 1000}
              imageHeight={activeResolved.height || 1000}
              containerWidth={viewportDim.width}
              containerHeight={viewportDim.height}
              crop={currentUi.crop}
              matrix={activeMatrix}
              overlayColor={activeFilterObj.overlayColor}
              overlayOpacity={activeFilterObj.overlayOpacity}
              onChange={(newCrop: any) => {
                if (isProcessing) return;
                hintOpacity.value = withTiming(0, { duration: 150 });
                setCurrentUi((prev) => {
                  const p = prev.crop;
                  const dx = Math.abs((newCrop?.x ?? 0) - p.x);
                  const dy = Math.abs((newCrop?.y ?? 0) - p.y);
                  const ds = Math.abs((newCrop?.scale ?? 1) - p.scale);
                  if (dx < 0.25 && dy < 0.25 && ds < 0.0005) return prev;
                  return { ...prev, crop: newCrop };
                });
              }}
              photoIndex={currentIndex}
            />
          ) : (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <ActivityIndicator size="large" color={colors.ink} style={{ flex: 1 }} />
            </View>
          )}

          {!isProcessing && viewportDim && activeResolved && (
            <Animated.View pointerEvents="none" style={[styles.cropHintWrapper, hintStyle]}>
              <View style={styles.cropHintBadge}>
                <Feather name="crop" size={16} color="#fff" />
                <Text style={styles.cropHintText}>{cropHintText}</Text>
              </View>
            </Animated.View>
          )}
        </View>

        {/* 필터 bake용 숨김 캔버스 */}
        <View pointerEvents="none" style={{ position: "absolute", width: 10, height: 10, top: '50%', left: '50%', opacity: 0.01, zIndex: -1 }}>
          {bakeJob?.uri ? (
            <FilteredImageSkia ref={filteredCanvasRef} uri={bakeJob.uri} width={bakeJob.w} height={bakeJob.h} matrix={bakeJob.matrix} overlayColor={bakeJob.overlayColor} overlayOpacity={bakeJob.overlayOpacity} />
          ) : null}
        </View>

        {isProcessing && (
          <View style={styles.fullLoading}>
            <ActivityIndicator size="large" color={colors.ink} />
            <Text style={styles.loadingText}>Processing...</Text>
          </View>
        )}
      </View>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(20, insets.bottom) }]}>
        {/* 🎞️ 필름스트립 — 탭하면 그 사진으로 점프 (저장된 크롭·필터 복원) */}
        {photos.length > 1 && (
          <ScrollView ref={filmRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filmStrip}>
            {photos.map((p: any, i: number) => {
              const thumb = p?.output?.previewUri || p?.cachedThumbnailUri || p?.uri;
              const isCur = i === currentIndex;
              return (
                <Pressable
                  key={p?.assetId || p?.uri || i}
                  onPress={() => handleJumpTo(i)}
                  disabled={editingDisabled}
                  style={[styles.filmThumbWrap, isCur && styles.filmThumbWrapActive, editingDisabled && { opacity: 0.6 }]}
                >
                  {thumb ? <RNImage source={{ uri: thumb }} style={styles.filmThumb} /> : <View style={[styles.filmThumb, { backgroundColor: "#e5e7eb" }]} />}
                  <View style={styles.filmNumBadge}><Text style={styles.filmNumText}>{i + 1}</Text></View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <FilterStripRN currentFilter={activeFilterObj} imageSrc={thumbnailUri} onSelect={onSelectFilter} />
        <View style={styles.primaryBtnContainer}>
          <Pressable
            style={[styles.primaryBtn, (!viewportDim || !activeResolved || isProcessing) && { opacity: 0.5, backgroundColor: '#888' }]}
            onPress={goNextOrCheckout}
            disabled={!viewportDim || !activeResolved || isProcessing}
          >
            {isProcessing ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{currentIndex === photos.length - 1 ? ((t as any).saveCheckout || "Save & Checkout") : ((t as any).nextPhoto || "Next Photo")}</Text>}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  editorArea: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F7F7F8" },

  cropHintWrapper: { position: 'absolute', top: Platform.OS === 'ios' ? 40 : 80, left: 0, right: 0, alignItems: 'center', zIndex: 100 },
  cropHintBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 24, gap: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 10, elevation: 5 },
  cropHintText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  bottomBar: { backgroundColor: "#F7F7F8", borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.05)" },

  filmStrip: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4, gap: 8 },
  filmThumbWrap: { width: 52, height: 52, borderRadius: 8, borderWidth: 2, borderColor: "transparent", overflow: "hidden", marginRight: 8 },
  filmThumbWrapActive: { borderColor: colors.ink || "#111" },
  filmThumb: { width: "100%", height: "100%", resizeMode: "cover", backgroundColor: "#eee" },
  filmNumBadge: { position: "absolute", top: 2, left: 2, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 8, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  filmNumText: { color: "#fff", fontSize: 10, fontWeight: "700" },

  primaryBtnContainer: { padding: 16, alignItems: "center" },
  primaryBtn: { width: "100%", maxWidth: 340, height: 52, backgroundColor: colors.ink, borderRadius: 26, alignItems: "center", justifyContent: "center", elevation: 6 },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  fullLoading: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(255,255,255,0.8)", zIndex: 9999, justifyContent: "center", alignItems: "center" },
  loadingText: { marginTop: 15, fontWeight: "700", color: "#111" },
});
