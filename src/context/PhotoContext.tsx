import React, {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
    ReactNode,
} from "react";
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
    // ✅ ADD: always keep original/high-res source uri for server-side 5000px print
    originalUri?: string;

    cachedPreviewUri?: string;

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
            // ✅ optional: keep full filter params if you store them
            filterParams?: any;
            // ✅ optional: overlay in case you want exact parity
            overlayColor?: string;
            overlayOpacity?: number;
        };
    };

    output?: {
        printUri?: string;
        previewUri?: string;
        viewUri?: string; // ✅ you use this for checkout/myorder preview
        sourceUri?: string; // ✅ optional, if you explicitly store it

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
    clearDraft: () => Promise<void>;
}

const PhotoContext = createContext<PhotoContextType | undefined>(undefined);

export const usePhoto = () => {
    const ctx = useContext(PhotoContext);
    if (!ctx) throw new Error("usePhoto must be used within a PhotoProvider");
    return ctx;
};

// ✅ ensure originalUri is always set once and never lost
function normalizeAsset(a: ImagePickerAsset): ImagePickerAsset {
    const anyA = a as any;
    const originalUri = anyA.originalUri || anyA.output?.sourceUri || a.uri;
    return { ...a, originalUri } as any;
}

function toSerializableAsset(a: ImagePickerAsset): SerializableAsset {
    const anyA = a as any;
    return {
        uri: a.uri,
        originalUri: anyA.originalUri || anyA.output?.sourceUri || a.uri, // ✅ keep

        width: a.width,
        height: a.height,
        assetId: a.assetId,
        fileName: a.fileName,
        fileSize: a.fileSize,
        mimeType: a.mimeType,
        duration: anyA.duration,
        exif: anyA.exif,

        cachedPreviewUri: anyA.cachedPreviewUri,
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
        if ((asset as any).cachedPreviewUri) return;

        generationQueue.current.add(id);
        try {
            let inputUri = (asset as any).originalUri || asset.uri;

            // content:// -> file:// for manipulator stability
            if (typeof inputUri === "string" && inputUri.startsWith("content://")) {
                const base = (FileSystem as any).cacheDirectory ?? (FileSystem as any).documentDirectory;
                const dest = `${base}cache_pre_${Date.now()}.jpg`;
                await FileSystem.copyAsync({ from: inputUri, to: dest });
                inputUri = dest;
            }

            // ✅ keep background preview small (memory-safe)
            const result = await manipulateAsync(
                inputUri,
                [{ resize: { width: 1000 } }],
                { compress: 0.8, format: SaveFormat.JPEG }
            );

            setPhotosState((prev) => {
                const newPhotos = [...prev];
                const cur = newPhotos[index] as any;
                if (!cur) return prev;

                // guard: asset might be reordered/replaced
                const same = (cur.assetId && cur.assetId === asset.assetId) || cur.uri === asset.uri;
                if (!same) return prev;

                newPhotos[index] = { ...cur, cachedPreviewUri: result.uri } as any;
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
                        console.log("[Draft] Expired (48h+), clearing on start.");
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

        return new Promise((resolve, reject) => {
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

                    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
                    if (__DEV__) console.log("[Draft] Saved/Updated step (debounced):", step);
                    setHasDraft(true);
                    resolve();
                } catch (e) {
                    console.error("Failed to save draft", e);
                    reject(e);
                }
            }, 250);
        });
    };

    const clearDraft: PhotoContextType["clearDraft"] = async () => {
        try {
            await AsyncStorage.removeItem(DRAFT_KEY);
            setHasDraft(false);
            if (__DEV__) console.log("[Draft] Explicitly cleared.");
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
                console.log("[Draft] Load aborted: expired.");
                await clearDraft();
                return false;
            }

            // normalize again to ensure originalUri exists
            const restored = (draft.photos as any[]).map((p) => normalizeAsset(p as any));
            setPhotosState(restored as any);
            setCurrentIndexState(draft.currentIndex || 0);
            setHasDraft(true);

            // regenerate cached previews quickly for first few
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
        setPhotosState((prev) => {
            const newPhotos = [...prev];
            if (!newPhotos[index]) return prev;

            // keep originalUri even if caller doesn't include it
            const cur = normalizeAsset(newPhotos[index]);
            newPhotos[index] = { ...cur, ...updates, originalUri: (cur as any).originalUri } as any;

            saveDraft("editor", { photos: newPhotos, currentIndex });
            return newPhotos;
        });
    };

    const clearPhotos = () => {
        setPhotosState([]);
        setCurrentIndexState(0);
        clearDraft();
        if (__DEV__) console.log("[Draft] cleared because photos cleared");
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
