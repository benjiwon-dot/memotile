import React, {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
    ReactNode,
} from "react";
import { Platform } from "react-native"; // ✨ 추가됨: 웹 환경 판별용
import type { ImagePickerAsset } from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as FileSystem from "expo-file-system";

type DraftStep = "select" | "editor";

const DRAFT_KEY = "memotile_draft";

type SerializableAsset = Pick<
    ImagePickerAsset,
    | "uri"
    | "width"
    | "height"
    | "assetId"
    | "fileName"
    | "fileSize"
    | "mimeType"
    | "duration"
    | "exif"
> & {
    originalUri?: string;
    cachedPreviewUri?: string;   // 에디터 화면용 (1080px)
    cachedThumbnailUri?: string; // ✅ 필터 리스트용 (200px)

    edits?: {
        crop: { x: number; y: number; width: number; height: number };
        filterId: string;
        rotate?: number;

        ui?: {
            crop: { x: number; y: number; scale: number };
            filterId: string;
        };

        committed?: {
            cropPx: { x: number; y: number; width: number; height: number };
            filterId: string;
            filterParams?: any;
            overlayColor?: string;
            overlayOpacity?: number;
        };
    };

    output?: {
        printUri?: string;
        previewUri?: string;
        viewUri?: string;
        sourceUri?: string;
        quantity?: number;
        printWidth?: number;
        printHeight?: number;
    };

    frameRect?: { x: number; y: number; width: number; height: number };
    viewport?: { width: number; height: number };
};

type DraftPayload = {
    photos: SerializableAsset[];
    currentIndex: number;
    step: DraftStep;
    timestamp: number;
};

interface PhotoContextType {
    photos: ImagePickerAsset[];
    currentIndex: number;
    hasDraft: boolean;

    setPhotos: (photos: ImagePickerAsset[], opts?: { persist?: boolean; step?: DraftStep }) => Promise<void>;
    addPhotos: (newPhotos: ImagePickerAsset[], opts?: { persist?: boolean; step?: DraftStep }) => Promise<void>;
    updatePhoto: (index: number, updates: Partial<SerializableAsset>) => Promise<void>;

    clearPhotos: () => void;
    setCurrentIndex: (index: number, opts?: { persist?: boolean; step?: DraftStep }) => Promise<void>;

    saveDraft: (step: DraftStep, override?: { photos?: ImagePickerAsset[]; currentIndex?: number }) => Promise<void>;
    loadDraft: () => Promise<boolean>;
    clearDraft: () => Promise<void>; // ✅ 결제 완료 시 흔적을 지우는 핵심 함수
}

const PhotoContext = createContext<PhotoContextType | undefined>(undefined);

export const usePhoto = () => {
    const ctx = useContext(PhotoContext);
    if (!ctx) throw new Error("usePhoto must be used within a PhotoProvider");
    return ctx;
};

function normalizeAsset(a: ImagePickerAsset): ImagePickerAsset {
    const anyA = a as any;
    const originalUri = anyA.originalUri || anyA.output?.sourceUri || a.uri;
    return { ...a, originalUri } as any;
}

function toSerializableAsset(a: ImagePickerAsset): SerializableAsset {
    const anyA = a as any;
    return {
        uri: a.uri,
        originalUri: anyA.originalUri || anyA.output?.sourceUri || a.uri,
        width: a.width,
        height: a.height,
        assetId: a.assetId,
        fileName: a.fileName,
        fileSize: a.fileSize,
        mimeType: a.mimeType,
        duration: anyA.duration,
        exif: anyA.exif,
        cachedPreviewUri: anyA.cachedPreviewUri,
        cachedThumbnailUri: anyA.cachedThumbnailUri,
        edits: anyA.edits,
        output: anyA.output,
        frameRect: anyA.frameRect,
        viewport: anyA.viewport,
    };
}

export const PhotoProvider = ({ children }: { children: ReactNode }) => {
    const [photos, setPhotosState] = useState<ImagePickerAsset[]>([]);
    const [currentIndex, setCurrentIndexState] = useState<number>(0);
    const [hasDraft, setHasDraft] = useState<boolean>(false);

    const generationQueue = React.useRef<Set<string>>(new Set());
    const saveDraftTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const generatePreview = async (asset: ImagePickerAsset, index: number) => {
        const id = asset.assetId || asset.uri;
        if (generationQueue.current.has(id)) return;

        if ((asset as any).cachedPreviewUri && (asset as any).cachedThumbnailUri) return;

        generationQueue.current.add(id);
        try {
            let inputUri = (asset as any).originalUri || asset.uri;
            if (typeof inputUri === "string" && inputUri.startsWith("content://")) {
                const base = (FileSystem as any).cacheDirectory ?? (FileSystem as any).documentDirectory;
                const dest = `${base}cache_org_${Date.now()}.jpg`;
                await FileSystem.copyAsync({ from: inputUri, to: dest });
                inputUri = dest;
            }

            const previewResult = await manipulateAsync(
                inputUri,
                [{ resize: { width: 1280 } }],
                { compress: 0.9, format: SaveFormat.JPEG }
            );

            const thumbResult = await manipulateAsync(
                inputUri,
                [{ resize: { width: 200 } }],
                { compress: 0.7, format: SaveFormat.JPEG }
            );

            setPhotosState((prev) => {
                const newPhotos = [...prev];
                const cur = newPhotos[index] as any;
                if (!cur) return prev;

                const same = (cur.assetId && cur.assetId === asset.assetId) || cur.uri === asset.uri;
                if (!same) return prev;

                newPhotos[index] = {
                    ...cur,
                    cachedPreviewUri: previewResult.uri,
                    cachedThumbnailUri: thumbResult.uri
                } as any;
                return newPhotos;
            });
        } catch (e) {
            console.warn("Background preview generation failed", e);
        } finally {
            generationQueue.current.delete(id);
        }
    };

    useEffect(() => {
        (async () => {
            try {
                const data = await AsyncStorage.getItem(DRAFT_KEY);
                if (data) {
                    const draft: DraftPayload = JSON.parse(data);
                    const now = Date.now();
                    const age = now - (draft.timestamp || 0);
                    const TTL = 48 * 3600 * 1000;
                    if (age > TTL) {
                        await AsyncStorage.removeItem(DRAFT_KEY);
                        setHasDraft(false);
                    } else {
                        setHasDraft(true);
                    }
                } else {
                    setHasDraft(false);
                }
            } catch {
                setHasDraft(false);
            }
        })();
    }, []);

    const saveDraft: PhotoContextType["saveDraft"] = async (step, override) => {
        if (saveDraftTimer.current) clearTimeout(saveDraftTimer.current);

        return new Promise((resolve) => { // ✨ reject 제거 (웹에서 터지지 않게 방어)
            saveDraftTimer.current = setTimeout(async () => {
                try {
                    const usePhotos = override?.photos ?? photos;
                    const useIndex = override?.currentIndex ?? currentIndex;
                    const payload: DraftPayload = {
                        photos: usePhotos.map((p) => toSerializableAsset(normalizeAsset(p))),
                        currentIndex: Math.max(0, Math.min(useIndex, Math.max(0, usePhotos.length - 1))),
                        step,
                        timestamp: Date.now(),
                    };

                    // ✨ [핵심 수정] 웹 환경 예외 처리 및 용량 초과 방어 로직 추가
                    if (Platform.OS === 'web') {
                        console.warn("웹 브라우저 환경에서는 용량 초과 방지를 위해 AsyncStorage 저장을 생략합니다.");
                        setHasDraft(true);
                        resolve();
                        return;
                    }

                    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
                    setHasDraft(true);
                    resolve();
                } catch (e) {
                    console.warn("임시 저장 실패 (용량 초과 등):", e);
                    // 에러가 나더라도 앱이 죽지 않도록 부드럽게 완료 처리
                    resolve();
                }
            }, 250);
        });
    };

    // ✨ [핵심 수정] 결제 완료 시 완벽한 흔적 지우기
    const clearDraft: PhotoContextType["clearDraft"] = async () => {
        try {
            await AsyncStorage.removeItem(DRAFT_KEY);
            // 1. 배너 스위치 끄기
            setHasDraft(false);
            // 2. 들고 있던 사진 데이터 메모리에서 날리기
            setPhotosState([]);
            // 3. 인덱스 초기화
            setCurrentIndexState(0);
        } catch (e) {
            console.error("Failed to clear draft", e);
        }
    };

    const loadDraft: PhotoContextType["loadDraft"] = async () => {
        try {
            const data = await AsyncStorage.getItem(DRAFT_KEY);
            if (!data) {
                setHasDraft(false);
                return false;
            }
            const draft: DraftPayload = JSON.parse(data);
            if (!draft?.photos?.length) {
                setHasDraft(false);
                return false;
            }
            const now = Date.now();
            const age = now - (draft.timestamp || 0);
            const TTL = 48 * 3600 * 1000;
            if (age > TTL) {
                await clearDraft();
                return false;
            }
            const restored = (draft.photos as any[]).map((p) => normalizeAsset(p as any));
            setPhotosState(restored as any);
            setCurrentIndexState(draft.currentIndex || 0);
            setHasDraft(true);
            restored.slice(0, 5).forEach((p, i) => generatePreview(p as any, i));
            return true;
        } catch (e) {
            console.error("Failed to load draft", e);
            setHasDraft(false);
            return false;
        }
    };

    const setPhotos: PhotoContextType["setPhotos"] = async (newPhotos, opts) => {
        const normalized = newPhotos.map(normalizeAsset);
        setPhotosState(normalized);
        setCurrentIndexState(0);
        if (opts?.persist) {
            await saveDraft(opts.step ?? "select", { photos: normalized, currentIndex: 0 });
        }
        normalized.slice(0, 5).forEach((p, i) => generatePreview(p, i));
    };

    const addPhotos: PhotoContextType["addPhotos"] = async (newPhotos, opts) => {
        const normalizedNew = newPhotos.map(normalizeAsset);
        setPhotosState((prev) => {
            const existing = new Set(prev.map((p) => (p as any).originalUri || p.assetId || p.uri));
            const filtered = normalizedNew.filter((p) => !existing.has((p as any).originalUri || p.assetId || p.uri));
            const merged = [...prev, ...filtered];
            if (opts?.persist) {
                saveDraft(opts.step ?? "select", { photos: merged, currentIndex });
            }
            const startIdx = prev.length;
            filtered.forEach((p, i) => generatePreview(p, startIdx + i));
            return merged;
        });
    };

    const updatePhoto: PhotoContextType["updatePhoto"] = async (index, updates) => {
        return new Promise<void>((resolve) => {
            setPhotosState((prev) => {
                const newPhotos = [...prev];
                if (!newPhotos[index]) {
                    resolve();
                    return prev;
                }
                const cur = normalizeAsset(newPhotos[index]);
                newPhotos[index] = { ...cur, ...updates, originalUri: (cur as any).originalUri } as any;

                saveDraft("editor", { photos: newPhotos, currentIndex });
                setTimeout(resolve, 0);
                return newPhotos;
            });
        });
    };

    const clearPhotos = () => {
        // ✨ 여기서 clearDraft()를 호출하여 완벽하게 파기되도록 연결
        clearDraft();
    };

    const setCurrentIndex: PhotoContextType["setCurrentIndex"] = async (index, opts) => {
        const next = Math.max(0, Math.min(index, Math.max(0, photos.length - 1)));
        setCurrentIndexState(next);
        if (opts?.persist) {
            await saveDraft(opts.step ?? "editor", { currentIndex: next });
        }
    };

    const value = useMemo<PhotoContextType>(
        () => ({
            photos,
            currentIndex,
            hasDraft,
            setPhotos,
            addPhotos,
            updatePhoto,
            clearPhotos,
            setCurrentIndex,
            saveDraft,
            loadDraft,
            clearDraft,
        }),
        [photos, currentIndex, hasDraft]
    );

    return <PhotoContext.Provider value={value}>{children}</PhotoContext.Provider>;
};