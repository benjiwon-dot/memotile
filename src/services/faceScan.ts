// src/services/faceScan.ts
//
// 배치 스캔(검출 전용). 최근 사진부터 batchSize씩 → 썸네일 + 얼굴검출(임베딩 X, 빠름).
// 임베딩은 매칭 후보에만(faceMatch.embedFace). 증분 캐시(처리한 assetId skip).
import * as MediaLibrary from "expo-media-library";
import * as FileSystem from "expo-file-system";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { detectFaces } from "../../modules/vision-face";
import { ScanItem, FaceBox } from "../types/scan";
import { loadCache, saveCache, thumbPath, ScanCache } from "./scanCache";

const THUMB_SIZE = 320;
const CONCURRENCY = 4;

export async function requestLibraryPermission(): Promise<MediaLibrary.PermissionResponse> {
    return await MediaLibrary.requestPermissionsAsync();
}

/** 전체/좁힌(생일 이후) 사진 수. 로딩 연출용 실제 값. */
export async function getLibraryCounts(sinceMs?: number): Promise<{ total: number; narrowed: number }> {
    const all = await MediaLibrary.getAssetsAsync({ mediaType: "photo", first: 1 });
    let narrowed = all.totalCount;
    if (sinceMs) {
        const n = await MediaLibrary.getAssetsAsync({ mediaType: "photo", first: 1, createdAfter: sinceMs });
        narrowed = n.totalCount;
    }
    return { total: all.totalCount, narrowed };
}

function chunk<T>(arr: T[], n: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
}

export interface BatchResult {
    items: ScanItem[];      // 이 배치에서 얼굴이 검출된 사진 (매칭 대상)
    scannedDelta: number;   // 이 배치에서 본 사진 수
    withFacesDelta: number;
    nextAfter?: string;
    hasMore: boolean;
}

export interface ScanBatchOptions {
    after?: string;
    sinceMs?: number;
    batchSize?: number;
}

/** 한 배치(최근순) 검출. 결과 즉시 반환 → 점진적 표시. */
export async function scanBatch(opts: ScanBatchOptions): Promise<BatchResult> {
    const cache: ScanCache = await loadCache();
    const since = opts.sinceMs ? { createdAfter: opts.sinceMs } : {};
    const batchSize = opts.batchSize ?? 200;

    const page = await MediaLibrary.getAssetsAsync({
        mediaType: "photo",
        first: batchSize,
        after: opts.after,
        sortBy: [[MediaLibrary.SortBy.creationTime, false]], // 최근 사진부터
        ...since,
    });

    let tThumb = 0, tDetect = 0, processedNew = 0;

    async function processOne(asset: MediaLibrary.Asset): Promise<ScanItem> {
        try {
            const info = await MediaLibrary.getAssetInfoAsync(asset);
            const srcUri = info.localUri || asset.uri;
            const a = Date.now();
            const manipulated = await manipulateAsync(srcUri, [{ resize: { width: THUMB_SIZE } }], { compress: 0.7, format: SaveFormat.JPEG });
            const dest = thumbPath(asset.id);
            await FileSystem.copyAsync({ from: manipulated.uri, to: dest });
            const b = Date.now();
            const faces = (await detectFaces(dest)) as FaceBox[];
            const cc = Date.now();
            tThumb += b - a; tDetect += cc - b; processedNew++;
            return { assetId: asset.id, thumbUri: dest, width: manipulated.width, height: manipulated.height, faces, creationTime: asset.creationTime, processedAt: Date.now() };
        } catch (e) {
            return { assetId: asset.id, thumbUri: "", width: 0, height: 0, faces: [], creationTime: asset.creationTime, processedAt: Date.now() };
        }
    }

    const items: ScanItem[] = [];
    let withFacesDelta = 0;
    const collect = (it: ScanItem) => { if (it.faces.length > 0) { items.push(it); withFacesDelta++; } };

    // 캐시 항목: 얼굴 있으면 썸네일이 실제 존재해야 매칭(embed) 가능 → 없으면 재생성
    const uncached: MediaLibrary.Asset[] = [];
    for (const a of page.assets) {
        const cached = cache[a.id];
        if (!cached) { uncached.push(a); continue; }
        if (cached.faces.length === 0) continue; // 얼굴 없는 캐시는 재사용(썸네일 불필요)
        const ok = cached.thumbUri ? (await FileSystem.getInfoAsync(cached.thumbUri)).exists : false;
        if (ok) collect(cached);
        else uncached.push(a); // 썸네일 유실 → 재생성
    }

    for (const group of chunk(uncached, CONCURRENCY)) {
        const results = await Promise.all(group.map(processOne));
        for (const it of results) { cache[it.assetId] = it; collect(it); }
    }

    await saveCache(cache);

    console.log(
        `[faceScan] batch detect: ${page.assets.length} photos (new=${processedNew}, faces=${withFacesDelta}) | ` +
        `thumb=${processedNew ? (tThumb / processedNew).toFixed(0) : 0}ms detect=${processedNew ? (tDetect / processedNew).toFixed(0) : 0}ms /photo`
    );

    return {
        items,
        scannedDelta: page.assets.length,
        withFacesDelta,
        nextAfter: page.endCursor,
        hasMore: page.hasNextPage,
    };
}

export async function getCachedItems(): Promise<ScanItem[]> {
    const cache = await loadCache();
    return Object.values(cache);
}
