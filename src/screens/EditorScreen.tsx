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
  // ✅ overlay도 bake에 포함 (FilteredImageSkia가 지원하면 그대로 적용됨)
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

// ✅ manipulator crash 방지: crop이 이미지 밖으로 나가지 않게 강제 보정
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

// ✅ Editor 내에서만 가능한 Skia bake/queue가 끝났는지 기다리는 헬퍼
async function waitForQueueIdle(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!exportQueue.isBusy && exportQueue.pendingCount === 0) return true;
    await sleep(150);
  }
  return false;
}

// ✅ 모든 viewUri가 생길 때까지 기다림
async function waitForAllViewUris(getPhotos: () => any[], timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const arr = getPhotos() || [];
    const missing = arr
      .map((p: any, idx: number) => ({ idx, viewUri: p?.output?.viewUri }))
      .filter((x: any) => !x.viewUri);

    if (missing.length === 0) return true;
    await sleep(200);
  }
  return false;
}

export default function EditorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { photos, currentIndex, setCurrentIndex, saveDraft, updatePhoto } = usePhoto();
  const { t } = useLanguage();

  // ✅ 최신 photos ref (stale closure 방지)
  const photosRef = useRef<any[]>(photos as any[]);
  useEffect(() => {
    photosRef.current = photos as any[];
  }, [photos]);

  const resolvedCache = useRef<Record<string, ResolvedInfo>>({});
  const currentPhoto = photos?.[currentIndex] as any;

  const isAliveRef = useRef(true);

  // ✅ pause 토글은 쓰지만, 현재 로직상 pause를 실제로 켜지는 않음
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

      try {
        exportQueue.clear();
      } catch { }

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
  const [isFinalizing, setIsFinalizing] = useState(false);

  const isExporting = useRef(false);

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

      if (isSwitchingPhoto) setIncomingResolved(info);
      else {
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
          const baseDir = (FileSystem as any).cacheDirectory ?? (FileSystem as any).documentDirectory;
          const dest = `${baseDir}editor_import_${Date.now()}.jpg`;
          await FileSystem.copyAsync({ from: uri, to: dest });
          inputUri = dest;
        }

        const targetPreviewW = 2048;

        const result = await manipulateAsync(
          inputUri,
          [{ resize: { width: targetPreviewW } }],
          { compress: 0.85, format: SaveFormat.JPEG }
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
  }, [currentPhoto?.uri, currentIndex, photos, isSwitchingPhoto, viewportDim?.width, viewportDim?.height]);

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
      } catch {
      } finally {
        savingRef.current = false;
      }
    }, 700);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [currentUi, currentIndex, saveDraft, isSwitchingPhoto]);

  const handleBack = () => {
    if (isSwitchingPhoto || isFinalizing) return;
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
    else router.replace("/create/select");
  };

  const requestSkiaBake = useCallback(
    async (
      uri: string,
      w: number,
      h: number,
      matrix: ColorMatrix,
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
          bakeW = real.width;
          bakeH = real.height;
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
        } catch (e) {
          console.warn("[Filter] Pre-resize for bake failed, fallback to original", e);
        }
      }

      while (bakeBusyRef.current) await waitRaf();
      bakeBusyRef.current = true;

      try {
        if (!isAliveRef.current) return null;

        return await new Promise<string | null>((resolve) => {
          pendingBakeResolveRef.current = resolve;
          setBakeJob({
            uri: bakeUri,
            w: bakeW,
            h: bakeH,
            matrix,
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
    if (isSwitchingPhoto || isFinalizing) return;

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

      // ✅ 원본(서버 5000용 cropPx 계산에 사용할 URI)
      const srcUri = photo.originalUri || photo.uri;

      // --- 1) UI 기준(프리뷰/뷰 export용) crop 계산 ---
      let uiW = resolvedInfo.width ?? photo.width;
      let uiH = resolvedInfo.height ?? photo.height;
      try {
        const real = await getImageSizeAsync(uiUri);
        if (real?.width && real?.height) {
          uiW = real.width;
          uiH = real.height;
        }
      } catch { }

      const rawCropUI = calculatePrecisionCrop({
        sourceSize: { width: uiW, height: uiH },
        containerSize: { width: vp.width, height: vp.height },
        frameRect,
        transform: {
          scale: cropState.scale,
          translateX: cropState.x,
          translateY: cropState.y,
        },
      });

      const safeUI = sanitizeCropRect(rawCropUI, uiW, uiH);

      const uiX = Math.max(0, Math.min(Math.floor(safeUI.x), uiW - 1));
      const uiY = Math.max(0, Math.min(Math.floor(safeUI.y), uiH - 1));
      const uiMaxW = uiW - uiX;
      const uiMaxH = uiH - uiY;
      const uiSize = Math.max(1, Math.min(Math.floor(safeUI.width), uiMaxW, uiMaxH));

      const finalCropUI = { x: uiX, y: uiY, width: uiSize, height: uiSize };

      // --- 2) 원본 기준(서버 5000 생성용) cropPx 계산 ---
      let srcW = photo.width || 0;
      let srcH = photo.height || 0;

      try {
        const realSrc = await getImageSizeAsync(srcUri);
        if (realSrc?.width && realSrc?.height) {
          srcW = realSrc.width;
          srcH = realSrc.height;
        }
      } catch {
        // fallback: ui size라도 넣되, 서버 crop 정확도가 떨어질 수 있음
        srcW = srcW || uiW || 1;
        srcH = srcH || uiH || 1;
      }

      const rawCropSRC = calculatePrecisionCrop({
        sourceSize: { width: srcW, height: srcH },
        containerSize: { width: vp.width, height: vp.height },
        frameRect,
        transform: {
          scale: cropState.scale,
          translateX: cropState.x,
          translateY: cropState.y,
        },
      });

      const safeSRC = sanitizeCropRect(rawCropSRC, srcW, srcH);

      const sx = Math.max(0, Math.min(Math.floor(safeSRC.x), srcW - 1));
      const sy = Math.max(0, Math.min(Math.floor(safeSRC.y), srcH - 1));
      const sMaxW = srcW - sx;
      const sMaxH = srcH - sy;
      const sSize = Math.max(1, Math.min(Math.floor(safeSRC.width), sMaxW, sMaxH));

      const finalCropSRC = { x: sx, y: sy, width: sSize, height: sSize };

      // ✅ previewUri는 UI기준 crop으로 생성 (가볍게)
      const previewRes = await generatePreviewExport(uiUri, finalCropUI);
      let finalPreviewUri = previewRes.uri;

      if (filterUi.filterId !== "original") {
        const bakedPreview = await requestSkiaBake(
          finalPreviewUri,
          previewRes.width,
          previewRes.height,
          matrix,
          {
            maxSide: 768,
            overlayColor: activeFilter.overlayColor,
            overlayOpacity: activeFilter.overlayOpacity,
          }
        );
        if (bakedPreview) finalPreviewUri = bakedPreview;
      }

      const filterParams = {
        matrix,
        overlayColor: activeFilter.overlayColor,
        overlayOpacity: activeFilter.overlayOpacity,
      };

      await updatePhoto(idx, {
        edits: {
          // UI 편의용(에디터 복원/디버깅용)
          crop: finalCropUI,
          filterId: filterUi.filterId,
          filterParams,
          ui: { ...filterUi, crop: cropState },

          // ✅ 서버 5000용 cropPx는 "원본 기준"으로 저장해야 정확
          committed: {
            cropPx: finalCropSRC as any,
            filterId: filterUi.filterId,
            filterParams,
          },
        } as any,
        output: {
          ...(photo.output || {}),
          previewUri: finalPreviewUri,
          // ✅ viewUri는 큐에서 “필터 적용된 결과물”로 채움
          viewUri: "",
          printUri: photo.output?.printUri ?? "",
          quantity: photo.output?.quantity || 1,
        },
        frameRect,
        viewport: vp,
      });

      const myToken = bgTokenRef.current;

      // ✅ 여기서 “Firebase에 올라갈 최종 파일(viewUri)”을 만든다 = 필터 적용된 3000px
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

          const viewTarget = 2048;

          const rawFinal = calculatePrecisionCrop({
            sourceSize: { width: origW, height: origH },
            containerSize: { width: vp.width, height: vp.height },
            frameRect: { ...frameRect },
            transform: {
              scale: cropState.scale,
              translateX: cropState.x,
              translateY: cropState.y,
            },
          });
          const safeFinal = sanitizeCropRect(rawFinal, origW, origH);

          if (!isAliveRef.current || bgPausedRef.current) return;

          const viewRes = await manipulateAsync(
            photo.uri,
            [
              {
                crop: {
                  originX: safeFinal.x,
                  originY: safeFinal.y,
                  width: safeFinal.width,
                  height: safeFinal.height,
                },
              },
              { resize: { width: viewTarget, height: viewTarget } },
            ],
            { compress: 0.92, format: SaveFormat.JPEG }
          );

          if (!isAliveRef.current || bgPausedRef.current) return;

          let finalView = viewRes.uri;

          // ✅ 핵심: viewUri에도 필터 bake 적용 (이게 checkout/myorder/firebase 모두의 “정답 파일”)
          if (filterUi.filterId !== "original") {
            const bakedView = await requestSkiaBake(
              finalView,
              viewRes.width || viewTarget,
              viewRes.height || viewTarget,
              matrix,
              {
                maxSide: 3072,
                overlayColor: activeFilter.overlayColor,
                overlayOpacity: activeFilter.overlayOpacity,
              }
            );
            if (bakedView) finalView = bakedView;
          }

          const latestPhoto = (photosRef.current?.[idx] as any) || {};
          const latestOutput = (latestPhoto.output as any) || {};

          await updatePhoto(idx, {
            output: { ...latestOutput, viewUri: finalView },
          });
        } catch (err) {
          console.error(`[ExportQueue] View export failed for ${idx}:`, err);
        }
      }, `View-${idx}`);

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
        return;
      }

      setIsFinalizing(true);

      const idleOk = await waitForQueueIdle(60000);
      const viewsOk = await waitForAllViewUris(() => photosRef.current, 60000);

      if (!idleOk || !viewsOk) {
        Alert.alert("Preparing photos…", "Still generating view files. Please wait a moment and tap again.");
        return;
      }

      router.push("/create/checkout");
    } catch (e) {
      console.error("[Next] HandleNext Error:", e);
      Alert.alert((t as any).failedTitle || "Error", (t as any).failedBody || "Failed to process photo.");

      setIsSwitchingPhoto(false);
      setIncomingResolved(null);
      outgoingRef.current = null;

      cancelAnimation(outgoingOpacity);
      cancelAnimation(incomingOpacity);
      outgoingOpacity.value = 0;
      incomingOpacity.value = 1;
    } finally {
      isExporting.current = false;
      setIsFinalizing(false);
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
    if (isSwitchingPhoto || isFinalizing) return;

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
          {isSwitchingPhoto && outgoing && viewportDim && (
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, outgoingStyle]}>
              <CropFrameRN
                key={`out-${outgoing.index}-${outgoing.resolved.uri}`}
                imageSrc={outgoing.resolved.uri}
                imageWidth={outgoing.resolved.width}
                imageHeight={outgoing.resolved.height}
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
                overlayColor={activeFilterObj.overlayColor}
                overlayOpacity={activeFilterObj.overlayOpacity}
                photoIndex={currentIndex}
              />) : isSwitchingPhoto ? null : (
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
              // ✅ FilteredImageSkia가 지원하면 overlay까지 baked 됨
              overlayColor={bakeJob.overlayColor as any}
              overlayOpacity={bakeJob.overlayOpacity as any}
            />
          </View>
        )}

        {isFinalizing && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              top: 0,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(0,0,0,0.10)",
            }}
          >
            <View style={{ padding: 14, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.92)" }}>
              <ActivityIndicator />
              <Text style={{ marginTop: 10, fontWeight: "600" }}>Preparing photos…</Text>
            </View>
          </View>
        )}
      </View>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(20, insets.bottom) }]}>
        <FilterStripRN currentFilter={activeFilterObj} imageSrc={displayUri} onSelect={onSelectFilter} />
        <View style={styles.primaryBtnContainer}>
          <Pressable
            style={[
              styles.primaryBtn,
              (!viewportDim || !activeResolved || isSwitchingPhoto || isFinalizing) && { opacity: 0.5 },
            ]}
            onPress={handleNext}
            disabled={!viewportDim || !activeResolved || isSwitchingPhoto || isExporting.current || isFinalizing}
          >
            <Text style={styles.primaryBtnText}>
              {currentIndex === photos.length - 1
                ? ((t as any).saveCheckout || "Save & Checkout")
                : ((t as any).nextPhoto || "Next Photo")}
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
