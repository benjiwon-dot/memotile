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
  clampTransform,
  type Rect as CropRect,
} from "../utils/cropMath";
import {
  generatePreviewExport,
  generatePrintExport,
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
    RNImage.getSize(
      uri,
      (w, h) => resolve({ width: w, height: h }),
      (err) => reject(err)
    );
  });

const waitRaf = () => new Promise<void>((res) => requestAnimationFrame(() => res()));
const wait2Raf = async () => {
  await waitRaf();
  await waitRaf();
};
const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

type BakeJob = {
  uri: string;
  w: number;
  h: number;
  matrix: ColorMatrix;
  resolve: (out: string | null) => void;
};

type OutgoingFrame = {
  index: number;
  resolved: ResolvedInfo;
  ui: EditState;
  matrix: ColorMatrix;
};

// ✅ manipulator crash 방지: 어떤 경우에도 이미지 밖으로 crop이 나가지 않게 강제 보정
const sanitizeCropRect = (r: any, srcW: number, srcH: number) => {
  const w = Math.max(1, Math.floor(Number.isFinite(r?.width) ? r.width : 1));
  const h = Math.max(1, Math.floor(Number.isFinite(r?.height) ? r.height : 1));
  let x = Math.floor(Number.isFinite(r?.x) ? r.x : 0);
  let y = Math.floor(Number.isFinite(r?.y) ? r.y : 0);

  // clamp origin first
  x = Math.max(0, Math.min(x, Math.max(0, srcW - 1)));
  y = Math.max(0, Math.min(y, Math.max(0, srcH - 1)));

  // clamp size to fit
  const maxSizeW = Math.max(1, srcW - x);
  const maxSizeH = Math.max(1, srcH - y);
  const size = Math.max(1, Math.min(Math.max(w, h), maxSizeW, maxSizeH)); // enforce square style

  // ensure inside (again)
  if (x + size > srcW) x = Math.max(0, srcW - size);
  if (y + size > srcH) y = Math.max(0, srcH - size);

  const out = { x, y, width: size, height: size, isValid: true };
  return out;
};

export default function EditorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { photos, currentIndex, setCurrentIndex, saveDraft, updatePhoto } = usePhoto();
  const { t } = useLanguage();

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
    bgPausedRef.current = false;

    return () => {
      isAliveRef.current = false;
      bgPausedRef.current = true;
      bgTokenRef.current += 1;

      try {
        pendingBakeResolveRef.current?.(null);
      } catch { }
      pendingBakeResolveRef.current = null;
      setBakeJob(null);
    };
  }, []);

  const [activeResolved, setActiveResolved] = useState<ResolvedInfo | null>(null);
  const [incomingResolved, setIncomingResolved] = useState<ResolvedInfo | null>(null);

  const [currentUi, setCurrentUi] = useState<EditState>(makeDefaultEdit());
  const [viewportDim, setViewportDim] = useState<{ width: number; height: number } | null>(null);

  const [isSwitchingPhoto, setIsSwitchingPhoto] = useState(false);

  const isExporting = useRef(false);

  // ✅ IMPORTANT: incoming만 ref 보유 (outgoing이 ref 덮어쓰면 crop/frameRect 꼬임)
  const cropRef = useRef<any>(null);

  const outgoingRef = useRef<OutgoingFrame | null>(null);

  const outgoingOpacity = useSharedValue(0);
  const incomingOpacity = useSharedValue(1);

  const outgoingStyle = useAnimatedStyle(() => ({ opacity: outgoingOpacity.value }));
  const incomingStyle = useAnimatedStyle(() => ({ opacity: incomingOpacity.value }));

  const commitCrossfade = useCallback(() => {
    if (!isAliveRef.current) return;

    bgPausedRef.current = false; // 🔥 다시 허용

    if (incomingResolved) setActiveResolved(incomingResolved);
    setIncomingResolved(null);
    outgoingRef.current = null;

    outgoingOpacity.value = 0;
    incomingOpacity.value = 1;

    setIsSwitchingPhoto(false);
  }, [incomingResolved, outgoingOpacity, incomingOpacity]);

  const initialInfo = useMemo<ResolvedInfo | null>(() => {
    if (!currentPhoto) return null;
    return {
      uri: (currentPhoto as any).cachedPreviewUri || currentPhoto.uri,
      width: currentPhoto.width,
      height: currentPhoto.height,
    };
  }, [
    currentPhoto?.uri,
    (currentPhoto as any)?.cachedPreviewUri,
    currentPhoto?.width,
    currentPhoto?.height,
  ]);

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

      if (isSwitchingPhoto) {
        setIncomingResolved(info);
      } else {
        setActiveResolved(info);
        setIncomingResolved(null);
      }
    };

    const resolve = async () => {
      try {
        if (resolvedCache.current[uri]) {
          if (!alive) return;
          applyUiForIndex(resolvedCache.current[uri]);
          return;
        }

        const cachedPreview = (currentPhoto as any)?.cachedPreviewUri;
        if (cachedPreview && typeof cachedPreview === "string") {
          let w = currentPhoto?.width;
          let h = currentPhoto?.height;
          if (!w || !h) {
            try {
              const s = await getImageSizeAsync(cachedPreview);
              w = s.width;
              h = s.height;
            } catch {
              w = 1000;
              h = 1000;
            }
          }
          const info: ResolvedInfo = { uri: cachedPreview, width: w || 1000, height: h || 1000 };
          if (!alive) return;
          resolvedCache.current[uri] = info;
          applyUiForIndex(info);
          return;
        }

        let inputUri = uri;

        if (uri.startsWith("content://")) {
          const baseDir =
            (FileSystem as any).cacheDirectory ?? (FileSystem as any).documentDirectory;
          const dest = `${baseDir}editor_import_${Date.now()}.jpg`;
          await FileSystem.copyAsync({ from: uri, to: dest });
          inputUri = dest;
        }

        const result = await manipulateAsync(
          inputUri,
          [{ resize: { width: 1000 } }],
          { compress: 0.9, format: SaveFormat.JPEG }
        );

        let w = result.width;
        let h = result.height;
        if (!w || !h) {
          try {
            const s = await getImageSizeAsync(result.uri);
            w = s.width;
            h = s.height;
          } catch {
            w = 1000;
            h = 1000;
          }
        }

        const info: ResolvedInfo = { uri: result.uri, width: w, height: h };

        if (!alive) return;
        resolvedCache.current[uri] = info;
        applyUiForIndex(info);
      } catch (e) {
        console.warn("Resolution failed", e);
        try {
          const s = await getImageSizeAsync(uri);
          const info: ResolvedInfo = { uri, width: s.width, height: s.height };
          if (!alive) return;
          resolvedCache.current[uri] = info;
          applyUiForIndex(info);
        } catch {
          if (!alive) return;
          applyUiForIndex({ uri, width: 1, height: 1 });
        }
      }
    };

    resolve();
    return () => {
      alive = false;
    };
  }, [currentPhoto?.uri, currentIndex, photos, isSwitchingPhoto]);

  const displayResolved = activeResolved || initialInfo;
  const displayUri = displayResolved?.uri || currentPhoto?.uri;

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

  // ✅ 추가: 마지막 저장 시그니처(중복 저장 방지)
  const lastSavedSigRef = useRef<string>("");

  // ✅ 추가: 저장 중 플래그(경합 방지)
  const savingRef = useRef(false);

  const buildDraftSig = (ui: EditState, idx: number) => {
    const c = ui.crop;
    const cropSig = `${Math.round(c.x)}|${Math.round(c.y)}|${Math.round(c.scale * 1000)}`;
    return `${idx}|${ui.filterId}|${cropSig}`;
  };

  useEffect(() => {
    // ✅ 전환중/내보내기중이면 저장하지 않음
    if (isSwitchingPhoto || isExporting.current) return;

    const sig = buildDraftSig(currentUi, currentIndex);

    // ✅ 똑같은 상태면 저장 안 함
    if (sig === lastSavedSigRef.current) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(async () => {
      if (savingRef.current) return;

      savingRef.current = true;
      try {
        await saveDraft("editor");
        lastSavedSigRef.current = sig;
      } catch {
        // ignore
      } finally {
        savingRef.current = false;
      }
    }, 700);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [currentUi, currentIndex, saveDraft, isSwitchingPhoto]);

  const handleBack = () => {
    if (isSwitchingPhoto) return;
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
    else router.replace("/create/select");
  };

  const requestSkiaBake = useCallback(
    async (uri: string, w: number, h: number, matrix: ColorMatrix): Promise<string | null> => {
      if (!isAliveRef.current) return null;

      while (bakeBusyRef.current) await waitRaf();
      bakeBusyRef.current = true;

      try {
        if (!isAliveRef.current) return null;

        return await new Promise<string | null>((resolve) => {
          pendingBakeResolveRef.current = resolve;
          setBakeJob({ uri, w, h, matrix, resolve });
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
        try {
          bakeJob.resolve(out);
        } catch { }
        setBakeJob(null);
      };

      if (!isAliveRef.current) return finish(null);

      await wait2Raf();
      if (cancelled) return;
      if (!isAliveRef.current) return finish(null);

      const tryOnce = async () => {
        const snapshot = filteredCanvasRef.current?.snapshot();
        if (!snapshot) return null;
        const bakedUri = await bakeFilterFromCanvasSnapshot(snapshot);
        return bakedUri;
      };

      try {
        const first = await tryOnce();
        if (first) return finish(first);
      } catch { }

      await waitRaf();
      if (!isAliveRef.current) return finish(null);

      try {
        const second = await tryOnce();
        if (second) return finish(second);
      } catch (e) {
        console.warn("[Filter] Snapshot retry failed:", e);
      }

      await sleep(50);
      if (!isAliveRef.current) return finish(null);

      try {
        const third = await tryOnce();
        if (third) return finish(third);
      } catch (e) {
        console.warn("[Filter] Snapshot final retry failed:", e);
      }

      return finish(null);
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [bakeJob]);

  useEffect(() => {
    if (!isSwitchingPhoto) return;
    if (!incomingResolved) return;
    if (!outgoingRef.current) return;
    if (!isAliveRef.current) return;

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
    if (isSwitchingPhoto) return;

    // 🔥 여기 추가
    bgPausedRef.current = true;
    bgTokenRef.current += 1;

    const idx = currentIndex;
    const photo = { ...photos[idx] } as any;
    const vp = viewportDim;
    const cropState = cropRef.current?.getLatestCrop();
    const frameRect = cropRef.current?.getFrameRect();
    const filterUi = { ...currentUi };
    const matrix = activeMatrix;
    const resolvedInfo = displayResolved;
    const activeFilter = activeFilterObj;

    if (!vp || !cropState || !frameRect || !resolvedInfo) {
      Alert.alert("Editor not ready", "Please wait for image to load.");
      return;
    }

    try {
      isExporting.current = true;

      const uiUri = resolvedInfo.uri || photo.uri;

      // ✅ uiUri "실제 파일" 사이즈를 기준으로 export crop 계산/보정
      let uiW = resolvedInfo.width ?? photo.width;
      let uiH = resolvedInfo.height ?? photo.height;

      try {
        const real = await getImageSizeAsync(uiUri);
        if (real?.width && real?.height) {
          uiW = real.width;
          uiH = real.height;
        }
      } catch {
        // fallback: 기존 값 사용
      }

      // 🔥 UI crop을 export 전에 한 번 더 안전하게 clamp
      const safeUi = clampTransform(
        cropState.x,
        cropState.y,
        cropState.scale,
        uiW,
        uiH,
        frameRect.width,
        5.0
      );

      // 🔹 UI → source 좌표 계산
      // 🔹 UI → source 좌표 계산
      const rawCrop = calculatePrecisionCrop({
        sourceSize: { width: uiW, height: uiH },
        containerSize: { width: vp.width, height: vp.height },
        frameRect,
        transform: {
          scale: cropState.scale,
          translateX: cropState.x,
          translateY: cropState.y,
        },
      });

      // 🔹 1차 보정 (기존 유틸)
      const safe1 = sanitizeCropRect(rawCrop, uiW, uiH);

      // 🔹 2차 보정: expo-image-manipulator(renderAsync) 전용 "완전 엄격" 보정
      // - originX/originY/width/height 모두 정수
      // - x,y는 0..W-1 / 0..H-1
      // - width/height는 반드시 (W-x), (H-y) 안쪽
      const x = Math.max(0, Math.min(Math.floor(safe1.x), uiW - 1));
      const y = Math.max(0, Math.min(Math.floor(safe1.y), uiH - 1));

      const maxW = uiW - x;
      const maxH = uiH - y;

      // square 강제 + 내부 보장
      const size = Math.max(
        1,
        Math.min(Math.floor(safe1.width), maxW, maxH)
      );

      const finalCrop = {
        x,
        y,
        width: size,
        height: size,
      };

      // ✅ Preview export
      const previewRes = await generatePreviewExport(uiUri, finalCrop);
      let finalPreviewUri = previewRes.uri;
      let finalPrintUri = "";



      if (filterUi.filterId !== "original") {
        const bakedPreview = await requestSkiaBake(
          finalPreviewUri,
          previewRes.width,
          previewRes.height,
          matrix
        );

        if (bakedPreview) finalPreviewUri = bakedPreview;
        else console.warn("[Filter] Preview bake unavailable (keeping unbaked preview)");
      }

      const filterParams = {
        matrix,
        overlayColor: activeFilter.overlayColor,
        overlayOpacity: activeFilter.overlayOpacity,
      };

      await updatePhoto(idx, {
        edits: {
          crop: finalCrop,
          filterId: filterUi.filterId,
          filterParams,
          ui: { ...filterUi, crop: cropState },
          committed: { cropPx: finalCrop as any, filterId: filterUi.filterId, filterParams },
        } as any,
        output: {
          ...(photo.output || {}),
          previewUri: finalPreviewUri,
          printUri: finalPrintUri,
          quantity: photo.output?.quantity || 1,
        },
        frameRect,
        viewport: vp,
      });

      const myToken = bgTokenRef.current;

      exportQueue.enqueue(async () => {
        if (!isAliveRef.current) return;
        if (bgPausedRef.current) return;
        if (myToken !== bgTokenRef.current) return;

        try {
          let origW = photo.width;
          let origH = photo.height;

          if (!origW || !origH) {
            const s = await manipulateAsync(photo.uri, [], {});
            origW = s.width;
            origH = s.height;
          }

          if (!isAliveRef.current || bgPausedRef.current) return;

          const CROP_SIZE_PX = frameRect.width;

          const aspect = uiW / uiH;
          let baseW = 0;
          let baseH = 0;
          if (aspect >= 1) {
            baseH = CROP_SIZE_PX;
            baseW = CROP_SIZE_PX * aspect;
          } else {
            baseW = CROP_SIZE_PX;
            baseH = CROP_SIZE_PX / aspect;
          }

          const clampedUi = clampTransform(
            cropState.x,
            cropState.y,
            cropState.scale,
            baseW,
            baseH,
            CROP_SIZE_PX,
            5.0
          );

          const rawFinal = calculatePrecisionCrop({
            sourceSize: { width: origW, height: origH },
            containerSize: { width: vp.width, height: vp.height },
            frameRect: { ...frameRect },
            transform: { scale: clampedUi.scale, translateX: clampedUi.tx, translateY: clampedUi.ty },
          });

          const finalCrop = sanitizeCropRect(rawCrop, uiW, uiH);

          if (!isAliveRef.current || bgPausedRef.current) return;

          const printRes = await generatePrintExport(photo.uri, finalCrop, {
            srcW: origW,
            srcH: origH,
            viewW: vp.width,
            viewH: vp.height,
            viewCrop: finalCrop,
          });

          if (!isAliveRef.current || bgPausedRef.current) return;

          let finalPrint = printRes.uri;

          if (filterUi.filterId !== "original") {
            const bakedPrint = await requestSkiaBake(
              printRes.uri,
              printRes.width,
              printRes.height,
              matrix
            );

            if (!isAliveRef.current || bgPausedRef.current) return;

            if (bakedPrint) finalPrint = bakedPrint;
            else console.warn("[Filter] Print bake unavailable (keeping unbaked 5000 print)");
          }

          if (!isAliveRef.current || bgPausedRef.current) return;

          await updatePhoto(idx, {
            output: { ...(photos[idx] as any).output, printUri: finalPrint },
          });
        } catch (err) {
          console.error(`[ExportQueue] High-res failed for ${idx}:`, err);
        }
      }, `Print-${idx}`);

      if (idx < photos.length - 1) {
        const nextIdx = idx + 1;

        const outResolved = displayResolved!;
        outgoingRef.current = {
          index: idx,
          resolved: outResolved,
          ui: filterUi,
          matrix,
        };

        cancelAnimation(outgoingOpacity);
        cancelAnimation(incomingOpacity);
        outgoingOpacity.value = 1;
        incomingOpacity.value = 0;

        setIsSwitchingPhoto(true);
        setIncomingResolved(null);

        setCurrentIndex(nextIdx);
      } else {
        bgPausedRef.current = true;
        bgTokenRef.current += 1;

        try {
          pendingBakeResolveRef.current?.(null);
        } catch { }
        pendingBakeResolveRef.current = null;
        setBakeJob(null);

        router.push("/create/checkout");
      }
    } catch (e) {
      console.error("[Next] HandleNext Error:", e);
      Alert.alert(t.failedTitle || "Error", t.failedBody || "Failed to process photo.");

      setIsSwitchingPhoto(false);
      setIncomingResolved(null);
      outgoingRef.current = null;

      cancelAnimation(outgoingOpacity);
      cancelAnimation(incomingOpacity);
      outgoingOpacity.value = 0;
      incomingOpacity.value = 1;
    } finally {
      isExporting.current = false;
    }
  };

  useFocusEffect(
    useCallback(() => {
      const p = photos?.[currentIndex] as any;
      if (!p) return;

      const savedUi = p.edits?.ui;
      const savedFilterId = p.edits?.filterId ?? "original";

      if (savedUi) {
        setCurrentUi({ ...savedUi, filterId: savedFilterId });
      } else {
        setCurrentUi((prev) => ({ ...prev, filterId: "original" }));
      }
    }, [currentIndex, photos])
  );

  const onSelectFilter = async (f: any) => {
    if (isSwitchingPhoto) return;

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
    } catch (e) {
      console.warn("Failed to persist filter choice", e);
    }
  };

  const outgoing = outgoingRef.current;
  const incomingDisplayResolved = isSwitchingPhoto ? incomingResolved : activeResolved || initialInfo;

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
          {/* OUTGOING (A) */}
          {isSwitchingPhoto && outgoing && viewportDim && (
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, outgoingStyle]}>
              <CropFrameRN
                key={`out-${outgoing.index}-${outgoing.resolved.uri}`}
                // ✅ ref 제거 (outgoing이 ref 덮어쓰지 않게)
                imageSrc={outgoing.resolved.uri}
                imageWidth={outgoing.resolved.width}
                imageHeight={outgoing.resolved.height}
                containerWidth={viewportDim.width}
                containerHeight={viewportDim.height}
                crop={outgoing.ui.crop}
                onChange={() => { }}
                matrix={outgoing.matrix}
                photoIndex={outgoing.index}
              />
            </Animated.View>
          )}

          {/* INCOMING (B) */}
          <Animated.View
            pointerEvents={isSwitchingPhoto ? "none" : "auto"}
            style={[StyleSheet.absoluteFill, incomingStyle]}
          >
            {viewportDim && incomingDisplayResolved ? (
              <CropFrameRN
                key={`in-${currentIndex}-${incomingDisplayResolved.uri}`}
                ref={cropRef}
                imageSrc={incomingDisplayResolved.uri}
                imageWidth={incomingDisplayResolved.width}
                imageHeight={incomingDisplayResolved.height}
                containerWidth={viewportDim.width}
                containerHeight={viewportDim.height}
                crop={currentUi.crop}
                onChange={(newCrop: any) =>
                  setCurrentUi((prev) => {
                    const p = prev.crop;
                    const dx = Math.abs((newCrop?.x ?? 0) - p.x);
                    const dy = Math.abs((newCrop?.y ?? 0) - p.y);
                    const ds = Math.abs((newCrop?.scale ?? 1) - p.scale);

                    if (dx < 0.25 && dy < 0.25 && ds < 0.0005) return prev;
                    return { ...prev, crop: newCrop };
                  })
                }
                matrix={activeMatrix}
                photoIndex={currentIndex}
              />
            ) : isSwitchingPhoto ? null : (
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <ActivityIndicator size="large" color={colors.ink} />
              </View>
            )}
          </Animated.View>
        </View>

        {bakeJob && (
          <View
            collapsable={false}
            pointerEvents="none"
            style={{
              position: "absolute",
              opacity: 0.001,
              width: bakeJob.w,
              height: bakeJob.h,
              left: -9999,
              top: -9999,
            }}
          >
            <FilteredImageSkia
              ref={filteredCanvasRef}
              uri={bakeJob.uri}
              width={bakeJob.w}
              height={bakeJob.h}
              matrix={bakeJob.matrix}
            />
          </View>
        )}
      </View>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(20, insets.bottom) }]}>
        <FilterStripRN currentFilter={activeFilterObj} imageSrc={displayUri} onSelect={onSelectFilter} />
        <View style={styles.primaryBtnContainer}>
          <Pressable
            style={[styles.primaryBtn, (!viewportDim || !activeResolved || isSwitchingPhoto) && { opacity: 0.5 }]}
            onPress={handleNext}
            disabled={!viewportDim || !activeResolved || isSwitchingPhoto || isExporting.current}
          >
            <Text style={styles.primaryBtnText}>
              {currentIndex === photos.length - 1
                ? (t.saveCheckout || "Save & Checkout")
                : (t.nextPhoto || "Next Photo")}
            </Text>
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
});
