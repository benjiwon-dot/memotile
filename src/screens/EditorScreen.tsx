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

import { calculatePrecisionCrop, defaultCenterCrop, clampTransform } from "../utils/cropMath";
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

export default function EditorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { photos, currentIndex, setCurrentIndex, saveDraft, updatePhoto } = usePhoto();
  const { t } = useLanguage();

  const resolvedCache = useRef<Record<string, ResolvedInfo>>({});
  const currentPhoto = photos?.[currentIndex] as any;

  // ✅ crossfade용: 현재 프레임(active) / 다음 프레임(incoming) 분리
  const [activeResolved, setActiveResolved] = useState<ResolvedInfo | null>(null);
  const [incomingResolved, setIncomingResolved] = useState<ResolvedInfo | null>(null);

  const [currentUi, setCurrentUi] = useState<EditState>(makeDefaultEdit());
  const [viewportDim, setViewportDim] = useState<{ width: number; height: number } | null>(null);

  // ✅ Promise 기반 Skia bake job (preview/print 둘 다 이걸로)
  const [bakeJob, setBakeJob] = useState<BakeJob | null>(null);
  const bakeBusyRef = useRef(false);

  // UI transitions (prevent flicker)
  const [isSwitchingPhoto, setIsSwitchingPhoto] = useState(false);

  const isExporting = useRef(false);
  const cropRef = useRef<any>(null);
  const filteredCanvasRef = useRef<FilteredImageSkiaRef>(null);

  // ✅ outgoing 프레임을 ref로 유지 (unmount 방지)
  const outgoingRef = useRef<OutgoingFrame | null>(null);

  // ✅ opacity 애니메이션
  const outgoingOpacity = useSharedValue(0);
  const incomingOpacity = useSharedValue(1);

  const outgoingStyle = useAnimatedStyle(() => ({ opacity: outgoingOpacity.value }));
  const incomingStyle = useAnimatedStyle(() => ({ opacity: incomingOpacity.value }));

  const commitCrossfade = useCallback(() => {
    // incoming을 active로 승격
    if (incomingResolved) setActiveResolved(incomingResolved);
    setIncomingResolved(null);
    outgoingRef.current = null;
    setIsSwitchingPhoto(false);
  }, [incomingResolved]);

  // Always define initialInfo from currentPhoto
  const initialInfo = useMemo<ResolvedInfo | null>(() => {
    if (!currentPhoto) return null;
    return {
      uri: (currentPhoto as any).cachedPreviewUri || currentPhoto.uri,
      width: currentPhoto.width,
      height: currentPhoto.height,
    };
  }, [currentPhoto?.uri, (currentPhoto as any)?.cachedPreviewUri, currentPhoto?.width, currentPhoto?.height]);

  /**
   * ✅ Resolve + restore UI state
   * - switching 중이면: incomingResolved에만 채움 (active는 유지)
   * - switching 아니면: activeResolved 갱신
   */
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

      // ✅ switching 중이면 incoming만 채우고, active는 그대로 유지
      if (isSwitchingPhoto) {
        setIncomingResolved(info);
      } else {
        setActiveResolved(info);
        setIncomingResolved(null);
      }
    };

    const resolve = async () => {
      try {
        // cache
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

        const result = await manipulateAsync(
          inputUri,
          [{ resize: { width: 1000 } }],
          { compress: 0.9, format: SaveFormat.JPEG }
        );

        // ✅ width/height 방어 (좌표 틀어짐 방지)
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

  // ✅ 화면에 보여줄 URI는 "active" 기준 (전환 중에도 A 유지)
  const displayResolved = activeResolved || initialInfo;
  const displayUri = displayResolved?.uri || currentPhoto?.uri;

  const activeFilterId = currentUi.filterId;
  const activeFilterObj = useMemo(
    () => FILTERS.find((f) => f.id === activeFilterId) || FILTERS[0],
    [activeFilterId]
  );
  const activeMatrix = useMemo(() => (activeFilterObj.matrix ?? IDENTITY) as ColorMatrix, [activeFilterObj]);

  // Debounced draft save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveDraft("editor").catch(() => { });
    }, 500);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [currentUi, currentIndex, saveDraft]);

  const handleBack = () => {
    if (isSwitchingPhoto) return;
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
    else router.replace("/create/select");
  };

  /**
   * ✅ Promise 기반 Skia bake 호출
   * - preview/print 둘 다 동일 로직
   * - 동시에 여러 bake 요청이 오면 직렬화 (크래시/레퍼런스 꼬임 방지)
   */
  const requestSkiaBake = useCallback(
    async (uri: string, w: number, h: number, matrix: ColorMatrix): Promise<string | null> => {
      while (bakeBusyRef.current) await waitRaf();
      bakeBusyRef.current = true;

      try {
        return await new Promise<string | null>((resolve) => {
          setBakeJob({ uri, w, h, matrix, resolve });
        });
      } finally {
        bakeBusyRef.current = false;
      }
    },
    []
  );

  /**
   * ✅ bakeJob 수행 (컴포넌트 마운트 → 2 raf → snapshot → 파일)
   */
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!bakeJob) return;

      await wait2Raf();
      if (cancelled) return;

      const tryOnce = async () => {
        const snapshot = filteredCanvasRef.current?.snapshot();
        if (!snapshot) return null;
        const bakedUri = await bakeFilterFromCanvasSnapshot(snapshot);
        return bakedUri;
      };

      try {
        const first = await tryOnce();
        if (first && !cancelled) {
          bakeJob.resolve(first);
          setBakeJob(null);
          return;
        }
      } catch { }

      await waitRaf();
      try {
        const second = await tryOnce();
        if (second && !cancelled) {
          bakeJob.resolve(second);
          setBakeJob(null);
          return;
        }
      } catch (e) {
        console.warn("[Filter] Snapshot retry failed:", e);
      }

      if (!cancelled) {
        bakeJob.resolve(null);
        setBakeJob(null);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [bakeJob]);

  // ✅ incomingResolved가 준비되면 crossfade 시작
  useEffect(() => {
    if (!isSwitchingPhoto) return;
    if (!incomingResolved) return;
    if (!outgoingRef.current) return;

    // 시작 상태: outgoing 1, incoming 0
    outgoingOpacity.value = 1;
    incomingOpacity.value = 0;

    // crossfade
    incomingOpacity.value = withTiming(1, { duration: 180 });
    outgoingOpacity.value = withTiming(0, { duration: 180 }, (finished) => {
      if (finished) runOnJS(commitCrossfade)();
    });
  }, [incomingResolved, isSwitchingPhoto, commitCrossfade, outgoingOpacity, incomingOpacity]);

  const handleNext = async () => {
    if (!photos || photos.length === 0 || isExporting.current) return;
    if (isSwitchingPhoto) return;

    const idx = currentIndex;
    const photo = { ...photos[idx] } as any;
    const vp = viewportDim;
    const cropState = cropRef.current?.getLatestCrop();
    const frameRect = cropRef.current?.getFrameRect();
    const filterUi = { ...currentUi };
    const matrix = activeMatrix;
    const resolvedInfo = displayResolved; // ✅ 현재 보이는(active) 기준
    const activeFilter = activeFilterObj;

    if (!vp || !cropState || !frameRect || !resolvedInfo) {
      Alert.alert("Editor not ready", "Please wait for image to load.");
      return;
    }

    try {
      isExporting.current = true;

      const uiUri = resolvedInfo.uri || photo.uri;
      const uiW = resolvedInfo.width ?? photo.width;
      const uiH = resolvedInfo.height ?? photo.height;

      const cropRes = calculatePrecisionCrop({
        sourceSize: { width: uiW, height: uiH },
        containerSize: { width: vp.width, height: vp.height },
        frameRect,
        transform: { scale: cropState.scale, translateX: cropState.x, translateY: cropState.y },
      });

      if (!cropRes.isValid) throw new Error("[Editor] Invalid crop result");

      const previewRes = await generatePreviewExport(uiUri, cropRes);
      let finalPreviewUri = previewRes.uri;
      let finalPrintUri = "";

      if (filterUi.filterId !== "original") {
        const bakedPreview = await requestSkiaBake(
          finalPreviewUri,
          previewRes.width,
          previewRes.height,
          matrix
        );

        if (bakedPreview) {
          finalPreviewUri = bakedPreview;
        } else {
          console.warn("[Filter] Preview bake unavailable (keeping unbaked preview)");
        }
      }

      const filterParams = {
        matrix,
        overlayColor: activeFilter.overlayColor,
        overlayOpacity: activeFilter.overlayOpacity,
      };

      await updatePhoto(idx, {
        edits: {
          crop: cropRes,
          filterId: filterUi.filterId,
          filterParams,
          ui: { ...filterUi, crop: cropState },
          committed: { cropPx: cropRes as any, filterId: filterUi.filterId, filterParams },
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

      exportQueue.enqueue(async () => {
        try {
          let origW = photo.width;
          let origH = photo.height;

          if (!origW || !origH) {
            const s = await manipulateAsync(photo.uri, [], {});
            origW = s.width;
            origH = s.height;
          }

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

          const finalCrop = calculatePrecisionCrop({
            sourceSize: { width: origW, height: origH },
            containerSize: { width: vp.width, height: vp.height },
            frameRect: { ...frameRect },
            transform: { scale: clampedUi.scale, translateX: clampedUi.tx, translateY: clampedUi.ty },
          });

          const printRes = await generatePrintExport(photo.uri, finalCrop, {
            srcW: origW,
            srcH: origH,
            viewW: vp.width,
            viewH: vp.height,
            viewCrop: finalCrop,
          });

          let finalPrint = printRes.uri;

          if (filterUi.filterId !== "original") {
            const bakedPrint = await requestSkiaBake(
              printRes.uri,
              printRes.width,
              printRes.height,
              matrix
            );
            if (bakedPrint) {
              finalPrint = bakedPrint;
            } else {
              console.warn("[Filter] Print bake unavailable (keeping unbaked 5000 print)");
            }
          }

          await updatePhoto(idx, {
            output: { ...(photos[idx] as any).output, printUri: finalPrint },
          });
        } catch (err) {
          console.error(`[ExportQueue] High-res failed for ${idx}:`, err);
        }
      }, `Print-${idx}`);

      // ✅ Navigate (crossfade)
      if (idx < photos.length - 1) {
        const nextIdx = idx + 1;

        // outgoing 프레임 캡처 (이것이 A 유지의 핵심)
        const outResolved = displayResolved;
        outgoingRef.current = {
          index: idx,
          resolved: outResolved,
          ui: filterUi,
          matrix,
        };

        // 전환 시작: incoming을 로딩하기 위해 currentIndex만 넘김
        setIsSwitchingPhoto(true);
        setIncomingResolved(null);

        // 다음 사진 resolve가 끝나면 incomingResolved가 채워지고,
        // 그 순간 useEffect에서 crossfade가 자동 시작됨
        setCurrentIndex(nextIdx);
      } else {
        router.push("/create/checkout");
      }
    } catch (e) {
      console.error("[Next] HandleNext Error:", e);
      Alert.alert(t.failedTitle || "Error", t.failedBody || "Failed to process photo.");
      setIsSwitchingPhoto(false);
      setIncomingResolved(null);
      outgoingRef.current = null;
    } finally {
      isExporting.current = false;
    }
  };

  // Restore UI on focus / index
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
        {/* ✅ 레이어 2개 구조 (빈 프레임 없음) */}
        <View style={{ flex: 1, width: "100%", height: "100%" }}>
          {/* OUTGOING (A) */}
          {isSwitchingPhoto && outgoing && viewportDim && (
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, outgoingStyle]}
            >
              <CropFrameRN
                key={`out-${outgoing.index}-${outgoing.resolved.uri}`}
                ref={cropRef}
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
                onChange={(newCrop: any) => setCurrentUi((prev) => ({ ...prev, crop: newCrop }))}
                matrix={activeMatrix}
                photoIndex={currentIndex}
              />
            ) : (
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <ActivityIndicator size="large" color={colors.ink} />
              </View>
            )}
          </Animated.View>
        </View>

        {/* ✅ Hidden Skia Canvas for baking (preview OR print) */}
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
