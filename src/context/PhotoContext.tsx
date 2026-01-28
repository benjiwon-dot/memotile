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
>;

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

function toSerializableAsset(a: ImagePickerAsset): SerializableAsset {
    // 안전하게 JSON 저장 가능한 필드만 유지
    return {
        uri: a.uri,
        width: a.width,
        height: a.height,
        assetId: a.assetId,
        fileName: a.fileName,
        fileSize: a.fileSize,
        mimeType: a.mimeType,
        duration: a.duration,
        exif: a.exif,
    };
}

export const PhotoProvider = ({ children }: { children: ReactNode }) => {
    const [photos, setPhotosState] = useState<ImagePickerAsset[]>([]);
    const [currentIndex, setCurrentIndexState] = useState<number>(0);
    const [hasDraft, setHasDraft] = useState<boolean>(false);

    // 앱 시작 시 draft 존재 여부만 빠르게 체크 (배너용)
    useEffect(() => {
        (async () => {
            try {
                const data = await AsyncStorage.getItem(DRAFT_KEY);
                setHasDraft(!!data);
            } catch {
                setHasDraft(false);
            }
        })();
    }, []);

    const saveDraft: PhotoContextType["saveDraft"] = async (step, override) => {
        try {
            const usePhotos = override?.photos ?? photos;
            const useIndex = override?.currentIndex ?? currentIndex;

            const payload: DraftPayload = {
                photos: usePhotos.map(toSerializableAsset),
                currentIndex: Math.max(0, Math.min(useIndex, Math.max(0, usePhotos.length - 1))),
                step,
                timestamp: Date.now(),
            };

            await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
            setHasDraft(true);
        } catch (e) {
            console.error("Failed to save draft", e);
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

            // draft.photos는 SerializableAsset[] 이지만, ImagePickerAsset과 호환되는 필드들이라 그대로 사용 가능
            setPhotosState(draft.photos as unknown as ImagePickerAsset[]);
            setCurrentIndexState(draft.currentIndex || 0);
            setHasDraft(true);
            return true;
        } catch (e) {
            console.error("Failed to load draft", e);
            setHasDraft(false);
            return false;
        }
    };

    const clearDraft: PhotoContextType["clearDraft"] = async () => {
        try {
            await AsyncStorage.removeItem(DRAFT_KEY);
            setHasDraft(false);
        } catch (e) {
            console.error("Failed to clear draft", e);
        }
    };

    const setPhotos: PhotoContextType["setPhotos"] = async (newPhotos, opts) => {
        setPhotosState(newPhotos);
        setCurrentIndexState(0);

        if (opts?.persist) {
            await saveDraft(opts.step ?? "select", { photos: newPhotos, currentIndex: 0 });
        }
    };

    const addPhotos: PhotoContextType["addPhotos"] = async (newPhotos, opts) => {
        setPhotosState((prev) => {
            const existing = new Set(prev.map((p) => p.assetId || p.uri));
            const filtered = newPhotos.filter((p) => !existing.has(p.assetId || p.uri));
            const merged = [...prev, ...filtered];

            if (opts?.persist) {
                // setState 내부라 즉시 저장을 위해 merged를 override로 전달
                saveDraft(opts.step ?? "select", { photos: merged, currentIndex });
            }
            return merged;
        });
    };

    const clearPhotos = () => {
        setPhotosState([]);
        setCurrentIndexState(0);
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
