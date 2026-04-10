// src/screens/EditorScreen.tsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Text,
  ActivityIndicator,
  Alert,
  Image as RNImage,
  Platform,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as FileSystem from "expo-file-system";

import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
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

import {
  calculatePrecisionCrop,
  defaultCenterCrop,
} from "../utils/cropMath";
import {
  generatePreviewExport,
  bakeFilterFromCanvasSnapshot,
} from "../utils/editorLogic";
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
    RNImage.getSize(
      uri,
      (w, h) => resolve({ width: w, height: h }),
      (err) => reject(err)
    );
  });

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

const waitRaf = () => new Promise<void>((res) => requestAnimationFrame(() => res()));

type BakeJob = {
  uri: string;
  w: number;
  h: number;
  matrix: ColorMatrix;
  overlayColor?: string;
  overlayOpacity?: number;
  resolve: (out: string | null) => void;
};

type OutgoingFrame = {
  index: number;
  resolved: ResolvedInfo;
  ui: EditState;
  matrix: ColorMatrix;
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

export default function EditorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { photos, currentIndex, setCurrentIndex, saveDraft, updatePhoto } = usePhoto();
  const { t } = useLanguage();

  const photosRef = useRef<any[]>(photos as any[]);
  useEffect(() => {
    photosRef.current = photos as any[];
  }, [photos]);

  const resolvedCache = useRef<Record<string, ResolvedInfo>>({});
  const currentPhoto = photos?.[currentIndex] as any;

  const isAliveRef = useRef(true);
  const bgPausedRef = useRef(false);
  const bgTokenRef = useRef(0);

  const [bakeJob, setBakeJob] = useState<BakeJob | null>(null);
  const bakeBusyRef = useRef(false);
  const pendingBakeResolveRef = useRef<((out: string | null) => void) | null>(null);
  const filteredCanvasRef = useRef<FilteredImageSkiaRef>(null);

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
  const [incomingResolved, setIncomingResolved] = useState<ResolvedInfo | null>(null);
  const [currentUi, setCurrentUi] = useState<EditState>(makeDefaultEdit());
  const [viewportDim, setViewportDim] = useState<{ width: number; height: number } | null>(null);

  const [isSwitchingPhoto, setIsSwitchingPhoto] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const isExporting = useRef(false);

  const [frozenSnapshot, setFrozenSnapshot] = useState<{
    uri: string;
    crop: any;
    matrix: ColorMatrix;
    overlayColor?: string;
    overlayOpacity?: number;
  } | null>(null);

  const cropRef = useRef<any>(null);
  const outgoingRef = useRef<OutgoingFrame | null>(null);

  const outgoingOpacity = useSharedValue(0);
  const incomingOpacity = useSharedValue(1);

  const outgoingStyle = useAnimatedStyle(() => ({ opacity: outgoingOpacity.value }));
  const incomingStyle = useAnimatedStyle(() => ({ opacity: incomingOpacity.value }));

  const commitCrossfade = useCallback(() => {
    if (!isAliveRef.current) return;
    bgPausedRef.current = false;
    if (incomingResolved) setActiveResolved(incomingResolved);
    setIncomingResolved(null);
    outgoingRef.current = null;
    outgoingOpacity.value = 0;
    incomingOpacity.value = 1;
    setIsSwitchingPhoto(false);
    setIsProcessing(false);
  }, [incomingResolved, outgoingOpacity, incomingOpacity]);

  const initialInfo = useMemo<ResolvedInfo | null>(() => {
    if (!currentPhoto) return null;
    const bestUri = (currentPhoto as any).cachedPreviewUri || currentPhoto.uri;
    return {
      uri: bestUri,
      width: currentPhoto.width,
      height: currentPhoto.height,
    };
  }, [currentPhoto]);

  useEffect(() => {
    if (!isSwitchingPhoto && initialInfo?.uri) {
      setActiveResolved((prev) => {
        if (!prev) return initialInfo;
        if (prev.uri !== initialInfo.uri) return initialInfo;
        return prev;
      });
    }
  }, [initialInfo?.uri, isSwitchingPhoto]);

  useEffect(() => {
    if (isExporting.current) return;

    let alive = true;
    const uri = currentPhoto?.uri;
    if (!uri) {
      setActiveResolved(null);
      setIncomingResolved(null);
      return;
    }

    const applyUiForIndex = (info: ResolvedInfo) => {
      const p = photos?.[currentIndex] as any;
      const savedUi = p?.edits?.ui;
      const savedFilterId = p?.edits?.filterId ?? "original";

      if (savedUi) {
        setCurrentUi({ ...savedUi, filterId: savedFilterId });
      } else {
        setCurrentUi({
          ...makeDefaultEdit(),
          filterId: "original",
          crop: defaultCenterCrop(),
        });
      }

      if (isSwitchingPhoto) setIncomingResolved(info);
      else {
        setActiveResolved(info);
        setIncomingResolved(null);
      }
    };

    const resolve = async () => {
      const cachedPreview = (currentPhoto as any)?.cachedPreviewUri;
      if (cachedPreview) {
        let w = 1080; let h = 1080;
        try {
          const s = await getImageSizeAsync(cachedPreview);
          w = s.width; h = s.height;
        } catch { }

        const info = { uri: cachedPreview, width: w, height: h };
        if (!alive) return;
        resolvedCache.current[uri] = info;
        applyUiForIndex(info);
        return;
      }

      try {
        if (resolvedCache.current[uri]) {
          if (!alive) return;
          applyUiForIndex(resolvedCache.current[uri]);
          return;
        }

        let inputUri = uri;
        if (uri.startsWith("content://")) {
          const baseDir = (FileSystem as any).cacheDirectory ?? (FileSystem as any).documentDirectory;
          const dest = `${baseDir}editor_import_${Date.now()}.jpg`;
          await FileSystem.copyAsync({ from: uri, to: dest });
          inputUri = dest;
        }

        const targetPreviewW = 1280;
        const result = await manipulateAsync(
          inputUri,
          [{ resize: { width: targetPreviewW } }],
          { compress: 0.9, format: SaveFormat.JPEG }
        );

        const info: ResolvedInfo = { uri: result.uri, width: result.width, height: result.height };
        if (!alive) return;

        resolvedCache.current[uri] = info;
        applyUiForIndex(info);
      } catch (e) {
        try {
          const s = await getImageSizeAsync(uri);
          const info = { uri, width: s.width, height: s.height };
          if (!alive) return;
          applyUiForIndex(info);
        } catch {
          applyUiForIndex({ uri, width: 1000, height: 1000 });
        }
      }
    };

    resolve();
    return () => { alive = false; };
  }, [currentPhoto?.uri, currentIndex, photos, isSwitchingPhoto]);

  const displayResolved = activeResolved || initialInfo;
  const displayUri = displayResolved?.uri || currentPhoto?.uri;
  const thumbnailUri = (currentPhoto as any)?.cachedThumbnailUri || displayUri;

  const activeFilterId = currentUi.filterId;
  const activeFilterObj = useMemo(
    () => FILTERS.find((f) => f.id === activeFilterId) || FILTERS[0],
    [activeFilterId]
  );
  const activeMatrix = useMemo(
    () => (activeFilterObj.matrix ?? IDENTITY) as ColorMatrix,
    [activeFilterObj]
  );

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSigRef = useRef<string>("");
  const savingRef = useRef(false);

  const buildDraftSig = (ui: EditState, idx: number) => {
    const c = ui.crop;
    const cropSig = `${Math.round(c.x)}|${Math.round(c.y)}|${Math.round(c.scale * 1000)}`;
    return `${idx}|${ui.filterId}|${cropSig}`;
  };

  useEffect(() => {
    if (isSwitchingPhoto || isExporting.current) return;
    const sig = buildDraftSig(currentUi, currentIndex);
    if (sig === lastSavedSigRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (savingRef.current) return;
      savingRef.current = true;
      try {
        await saveDraft("editor");
        lastSavedSigRef.current = sig;
      } catch { } finally { savingRef.current = false; }
    }, 700);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [currentUi, currentIndex, saveDraft, isSwitchingPhoto]);

  const handleBack = () => {
    if (isSwitchingPhoto || isProcessing) return;
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
    else router.replace("/create/select");
  };

  const requestSkiaBake = useCallback(
    async (
      uri: string, w: number, h: number, matrix: ColorMatrix,
      opts?: { maxSide?: number; overlayColor?: string; overlayOpacity?: number }
    ): Promise<string | null> => {
      if (!isAliveRef.current) return null;
      const maxSide = Math.max(512, Math.floor(opts?.maxSide ?? 3072));
      let bakeUri = uri;
      let bakeW = Number(w) || 0;
      let bakeH = Number(h) || 0;

      if (!bakeW || !bakeH) {
        try {
          const real = await getImageSizeAsync(uri);
          bakeW = real.width; bakeH = real.height;
        } catch { }
      }
      const bigger = Math.max(bakeW, bakeH);
      if (bigger > maxSide) {
        try {
          const scale = maxSide / bigger;
          const targetW = Math.max(1, Math.round(bakeW * scale));
          const targetH = Math.max(1, Math.round(bakeH * scale));
          const resized = await manipulateAsync(
            uri,
            [{ resize: { width: targetW, height: targetH } }],
            { compress: 0.92, format: SaveFormat.JPEG }
          );
          bakeUri = resized.uri;
          bakeW = resized.width || targetW;
          bakeH = resized.height || targetH;
        } catch (e) { console.warn("[Filter] Pre-resize failed", e); }
      }

      while (bakeBusyRef.current) await waitRaf();
      bakeBusyRef.current = true;
      try {
        if (!isAliveRef.current) return null;
        return await new Promise<string | null>((resolve) => {
          pendingBakeResolveRef.current = resolve;
          setBakeJob({
            uri: bakeUri, w: bakeW, h: bakeH, matrix,
            overlayColor: opts?.overlayColor,
            overlayOpacity: opts?.overlayOpacity,
            resolve,
          });
        });
      } finally {
        pendingBakeResolveRef.current = null;
        bakeBusyRef.current = false;
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!bakeJob) return;

      const finish = (out: string | null) => {
        if (cancelled) return;
        try { bakeJob.resolve(out); } catch { }
        setBakeJob(null);
      };

      if (!isAliveRef.current) return finish(null);

      for (let i = 0; i < 10; i++) {
        if (cancelled || !isAliveRef.current) return finish(null);

        const snapshot = filteredCanvasRef.current?.snapshot();

        if (snapshot) {
          try {
            const result = await bakeFilterFromCanvasSnapshot(snapshot);
            if (result) return finish(result);
          } catch (e) {
            console.warn("Bake attempt failed", e);
          }
        }
        await sleep(100);
      }
      return finish(null);
    };

    run();
    return () => { cancelled = true; };
  }, [bakeJob]);

  useEffect(() => {
    if (!isSwitchingPhoto) return;
    if (!incomingResolved) return;
    if (!outgoingRef.current) return;
    if (!isAliveRef.current) return;

    setIsProcessing(false);

    cancelAnimation(outgoingOpacity);
    cancelAnimation(incomingOpacity);

    outgoingOpacity.value = 1;
    incomingOpacity.value = 0;

    incomingOpacity.value = withTiming(1, { duration: 180 });
    outgoingOpacity.value = withTiming(0, { duration: 180 }, (finished) => {
      if (finished) runOnJS(commitCrossfade)();
    });
  }, [incomingResolved, isSwitchingPhoto, commitCrossfade, outgoingOpacity, incomingOpacity]);


  const handleNext = async () => {
    if (!photos || photos.length === 0 || isExporting.current) return;
    if (isSwitchingPhoto || isProcessing) return;

    const currentPhotoUri = displayResolved?.uri || (photos[currentIndex] as any).uri;
    const currentCrop = cropRef.current?.getLatestCrop() || currentUi.crop;
    const activeFilter = activeFilterObj;
    const matrix = activeMatrix;

    if (!currentPhotoUri) return;

    setIsProcessing(true);
    isExporting.current = true;

    setFrozenSnapshot({
      uri: currentPhotoUri,
      crop: currentCrop,
      matrix: matrix,
      overlayColor: activeFilter.overlayColor,
      overlayOpacity: activeFilter.overlayOpacity,
    });

    await sleep(16);

    const idx = currentIndex;

    try {
      const photo = { ...photos[idx] } as any;
      const vp = viewportDim;

      if (idx < photos.length - 1) {
        outgoingRef.current = {
          index: idx,
          resolved: { uri: currentPhotoUri, width: 0, height: 0 },
          ui: { crop: currentCrop, filterId: currentUi.filterId },
          matrix,
        };
      }

      if (!vp) {
        setFrozenSnapshot(null);
        setIsProcessing(false);
        isExporting.current = false;
        return;
      }

      let uiW = displayResolved?.width ?? photo.width;
      let uiH = displayResolved?.height ?? photo.height;

      try {
        const real = await getImageSizeAsync(currentPhotoUri);
        if (real?.width && real?.height) { uiW = real.width; uiH = real.height; }
      } catch { }

      const rawCropUI = calculatePrecisionCrop({
        sourceSize: { width: uiW, height: uiH },
        containerSize: { width: vp.width, height: vp.height },
        frameRect: cropRef.current?.getFrameRect() || { x: 0, y: 0, width: vp.width, height: vp.height },
        transform: { scale: currentCrop.scale, translateX: currentCrop.x, translateY: currentCrop.y },
      });

      const safeUI = sanitizeCropRect(rawCropUI, uiW, uiH);
      const finalCropUI = { x: Math.floor(safeUI.x), y: Math.floor(safeUI.y), width: Math.floor(safeUI.width), height: Math.floor(safeUI.width) };

      const realSrcW = photo.originalWidth || photo.width;
      const realSrcH = photo.originalHeight || photo.height;
      const scale = realSrcW / (uiW || 1);
      const sx = Math.floor(finalCropUI.x * scale);
      const sy = Math.floor(finalCropUI.y * scale);
      const sSize = Math.floor(finalCropUI.width * scale);
      const finalCropSRC = { x: Math.max(0, Math.min(sx, realSrcW - 1)), y: Math.max(0, Math.min(sy, realSrcH - 1)), width: sSize, height: sSize };

      const previewRes = await generatePreviewExport(currentPhotoUri, finalCropUI);
      let finalPreviewUri = previewRes.uri;

      if (currentUi.filterId !== "original") {
        const bakedPreview = await requestSkiaBake(
          finalPreviewUri, previewRes.width, previewRes.height, matrix,
          { maxSide: 768, overlayColor: activeFilter.overlayColor, overlayOpacity: activeFilter.overlayOpacity }
        );
        if (bakedPreview) finalPreviewUri = bakedPreview;
      }

      await updatePhoto(idx, {
        edits: {
          crop: finalCropUI,
          filterId: currentUi.filterId,
          filterParams: { matrix, overlayColor: activeFilter.overlayColor, overlayOpacity: activeFilter.overlayOpacity },
          ui: { ...currentUi, crop: currentCrop },
          committed: { cropPx: finalCropSRC as any, filterId: currentUi.filterId, filterParams: { matrix } },
        } as any,
        output: { ...(photo.output || {}), previewUri: finalPreviewUri, viewUri: "" },
      });

      const myToken = bgTokenRef.current;
      exportQueue.enqueue(async () => {
        if (!isAliveRef.current || bgPausedRef.current || myToken !== bgTokenRef.current) return;
        try {
          const fileInfo = await manipulateAsync(photo.uri, [], { format: SaveFormat.JPEG });
          const fW = fileInfo.width; const fH = fileInfo.height;
          const sX = fW / (uiW || 1); const sY = fH / (uiH || 1);
          let cX = Math.floor(finalCropUI.x * sX); let cY = Math.floor(finalCropUI.y * sY);
          let cW = Math.floor(finalCropUI.width * sX); let cH = Math.floor(finalCropUI.height * sY);
          cX = Math.max(0, Math.min(cX, fW - 1)); cY = Math.max(0, Math.min(cY, fH - 1));
          const cSz = Math.min(cW, cH, fW - cX, fH - cY);

          const viewTarget = 1200;
          const viewRes = await manipulateAsync(
            photo.uri,
            [{ crop: { originX: cX, originY: cY, width: cSz, height: cSz } }, { resize: { width: viewTarget, height: viewTarget } }],
            { compress: 0.90, format: SaveFormat.JPEG }
          );

          let finalView = viewRes.uri;

          if (currentUi.filterId !== "original") {
            const bakedView = await requestSkiaBake(finalView, viewRes.width || viewTarget, viewRes.height || viewTarget, matrix,
              { maxSide: 1200, overlayColor: activeFilter.overlayColor, overlayOpacity: activeFilter.overlayOpacity });
            if (bakedView) finalView = bakedView;
          }

          const lPhoto = (photosRef.current?.[idx] as any) || {};
          await updatePhoto(idx, {
            output: {
              ...(lPhoto.output || {}),
              viewUri: finalView,
              printUri: finalView
            }
          });

        } catch (e) { console.error(e); }
      }, `View-${idx}`);

      // --- [페이지 전환 분기] ---

      if (idx < photos.length - 1) {
        // [CASE 1] 다음 사진으로 이동
        const nextIdx = idx + 1;

        cancelAnimation(outgoingOpacity); cancelAnimation(incomingOpacity);
        outgoingOpacity.value = 1; incomingOpacity.value = 0;

        setIsSwitchingPhoto(true);
        setIncomingResolved(null);
        setCurrentIndex(nextIdx);

        // 동결 해제
        setFrozenSnapshot(null);
        isExporting.current = false;
        return;
      }

      // ⭐️ 핵심: 마지막 장에서 기다리지 않고 바로 결제창으로 넘깁니다!
      // 여기서 딜레이를 주지 않아야 결제화면 진입 시 렉이 걸리지 않습니다.
      setFrozenSnapshot(null);
      setIsProcessing(false);
      isExporting.current = false;
      router.push("/create/checkout");

    } catch (e) {
      console.error(e);
      setFrozenSnapshot(null);
      setIsProcessing(false);
      isExporting.current = false;
      Alert.alert("Error", "Failed.");
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (isExporting.current) return;

      setIsProcessing(false);
      isExporting.current = false;

      const p = photos?.[currentIndex] as any;
      if (!p) return;

      const savedUi = p.edits?.ui;
      const savedFilterId = p.edits?.filterId ?? "original";

      if (savedUi) {
        setCurrentUi({ ...savedUi, filterId: savedFilterId });
      } else {
        setCurrentUi((prev) => ({ ...prev, filterId: savedFilterId }));
      }

      return () => {
        isExporting.current = false;
      };
    }, [currentIndex, photos])
  );

  const onSelectFilter = async (f: any) => {
    if (isSwitchingPhoto || isProcessing) return;
    const newId = f.id;
    setCurrentUi((prev) => ({ ...prev, filterId: newId }));
    const p = photos[currentIndex] as any;
    try {
      await updatePhoto(currentIndex, {
        edits: {
          ...p?.edits,
          filterId: newId,
          ui: { ...currentUi, filterId: newId },
        },
      });
    } catch (e) { console.warn("Failed to persist filter choice", e); }
  };

  const outgoing = outgoingRef.current;
  const incomingDisplayResolved = isSwitchingPhoto ? incomingResolved : activeResolved || initialInfo;

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
        <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>Photo Editing is App Exclusive</Text>
        <Text style={{ textAlign: 'center', color: '#666', marginBottom: 20 }}>
          The web version is for preview and checkout testing. Please download our mobile app for full photo editing features.
        </Text>
        <Pressable
          style={styles.primaryBtn}
          onPress={() => router.push("/create/checkout")}
        >
          <Text style={styles.primaryBtnText}>Skip to Checkout</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.container}>
      <View style={{ paddingTop: insets.top }}>
        <TopBarRN
          current={currentIndex + 1}
          total={photos.length}
          onBack={handleBack}
          onNext={handleNext}
        />
      </View>

      <View
        style={styles.editorArea}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          if (width > 0 && height > 0) setViewportDim({ width, height });
        }}
      >
        <View style={{ flex: 1, width: "100%", height: "100%" }}>
          {isSwitchingPhoto && outgoing && viewportDim && (
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, outgoingStyle]}>
              <CropFrameRN
                key={`out-${outgoing.index}`}
                imageSrc={outgoing.resolved.uri}
                imageWidth={outgoing.resolved.width || 1000}
                imageHeight={outgoing.resolved.height || 1000}
                containerWidth={viewportDim.width}
                containerHeight={viewportDim.height}
                crop={outgoing.ui.crop}
                onChange={() => { }}
                matrix={outgoing.matrix}
                overlayColor={FILTERS.find(f => f.id === outgoing.ui.filterId)?.overlayColor}
                overlayOpacity={FILTERS.find(f => f.id === outgoing.ui.filterId)?.overlayOpacity}
                photoIndex={outgoing.index}
              />
            </Animated.View>
          )}

          <Animated.View
            pointerEvents={isSwitchingPhoto ? "none" : "auto"}
            style={[StyleSheet.absoluteFill, incomingStyle]}
          >
            {viewportDim && (frozenSnapshot || incomingDisplayResolved) ? (
              <CropFrameRN
                key={frozenSnapshot ? `frozen-${currentIndex}` : `in-${currentIndex}`}
                ref={cropRef}

                imageSrc={frozenSnapshot?.uri || incomingDisplayResolved?.uri}
                imageWidth={incomingDisplayResolved?.width || 1000}
                imageHeight={incomingDisplayResolved?.height || 1000}
                containerWidth={viewportDim.width}
                containerHeight={viewportDim.height}

                crop={frozenSnapshot?.crop || currentUi.crop}
                matrix={frozenSnapshot?.matrix || activeMatrix}
                overlayColor={frozenSnapshot?.overlayColor || activeFilterObj.overlayColor}
                overlayOpacity={frozenSnapshot?.overlayOpacity || activeFilterObj.overlayOpacity}

                onChange={(newCrop: any) => {
                  if (frozenSnapshot) return;
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
            ) : isSwitchingPhoto ? null : (
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <ActivityIndicator size="large" color={colors.ink} />
              </View>
            )}
          </Animated.View>
        </View>

        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            width: 10,
            height: 10,
            top: '50%',
            left: '50%',
            opacity: 0.01,
            zIndex: -1,
          }}
        >
          {bakeJob?.uri ? (
            <FilteredImageSkia
              ref={filteredCanvasRef}
              uri={bakeJob.uri}
              width={bakeJob.w}
              height={bakeJob.h}
              matrix={bakeJob.matrix}
              overlayColor={bakeJob.overlayColor}
              overlayOpacity={bakeJob.overlayOpacity}
            />
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
        <FilterStripRN currentFilter={activeFilterObj} imageSrc={thumbnailUri} onSelect={onSelectFilter} />
        <View style={styles.primaryBtnContainer}>
          <Pressable
            style={[
              styles.primaryBtn,
              (!viewportDim || !activeResolved || isSwitchingPhoto || isProcessing) && { opacity: 0.5, backgroundColor: '#888' },
            ]}
            onPress={handleNext}
            disabled={!viewportDim || !activeResolved || isSwitchingPhoto || isExporting.current || isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {currentIndex === photos.length - 1
                  ? ((t as any).saveCheckout || "Save & Checkout")
                  : ((t as any).nextPhoto || "Next Photo")}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  editorArea: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F7F7F8" },
  bottomBar: { backgroundColor: "#F7F7F8", borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.05)" },
  primaryBtnContainer: { padding: 16, alignItems: "center" },
  primaryBtn: {
    width: "100%",
    maxWidth: 340,
    height: 52,
    backgroundColor: colors.ink,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  fullLoading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.8)",
    zIndex: 9999,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: { marginTop: 15, fontWeight: "700", color: "#111" }
});