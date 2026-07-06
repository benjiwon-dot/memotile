// src/services/faceScan.ts
//
// 배치 스캔(검출 전용). 최근 사진부터 batchSize씩 → 썸네일 + 얼굴검출(임베딩 X, 빠름).
// 임베딩은 매칭 후보에만(faceMatch.embedFace). 증분 캐시(처리한 assetId skip).
import * as MediaLibrary from "expo-media-library";
import * as FileSystem from "expo-file-system";
import { scanAsset } from "../../modules/vision-face";
import { ScanItem, FaceBox } from "../types/scan";
import { loadCache, saveCache, thumbPath, ScanCache } from "./scanCache";

const THUMB_SIZE = 256; // 320→256: 검출 충분 + 인코딩/파일↓ (b)
const CONCURRENCY = 6; // 4→6 병렬 상향(발열↔속도 트레이드오프, 로그 보고 조정)

export async function requestLibraryPermission(): Promise<MediaLibrary.PermissionResponse> {
    return await MediaLibrary.requestPermissionsAsync();
}

/** 전체/좁힌(기간) 사진 수. 로딩 연출용 실제 값. sinceMs~untilMs 범위. */
export async function getLibraryCounts(sinceMs?: number, untilMs?: number): Promise<{ total: number; narrowed: number }> {
    const all = await MediaLibrary.getAssetsAsync({ mediaType: "photo", first: 1 });
    let narrowed = all.totalCount;
    if (sinceMs || untilMs) {
        const n = await MediaLibrary.getAssetsAsync({
            mediaType: "photo", first: 1,
            ...(sinceMs ? { createdAfter: sinceMs } : {}),
            ...(untilMs ? { createdBefore: untilMs } : {}),
        });
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
    untilMs?: number;
    batchSize?: number;
    onProgress?: (delta: number) => void; // 처리한 사진 수 증분(카운트업 부드럽게)
}

// 캐시를 매 배치 통째로 load/save하면 배치 경계마다 멈칫(카운트 끊김)+O(n²).
// → 세션당 1회만 로드해 메모리 유지, 저장은 throttle. 스캔 끝나면 flushScanCache().
let memCache: ScanCache | null = null;
let saveTick = 0;
let saving = false; // 백그라운드 저장 중복 방지
export async function flushScanCache(): Promise<void> {
    if (memCache && !saving) { saving = true; try { await saveCache(memCache); } finally { saving = false; } }
}

/** 한 배치(최근순) 검출. 결과 즉시 반환 → 점진적 표시. */
export async function scanBatch(opts: ScanBatchOptions): Promise<BatchResult> {
    if (!memCache) memCache = await loadCache();
    const cache: ScanCache = memCache;
    const range = {
        ...(opts.sinceMs ? { createdAfter: opts.sinceMs } : {}),
        ...(opts.untilMs ? { createdBefore: opts.untilMs } : {}),
    };
    const batchSize = opts.batchSize ?? 200;

    const page = await MediaLibrary.getAssetsAsync({
        mediaType: "photo",
        first: batchSize,
        after: opts.after,
        sortBy: [[MediaLibrary.SortBy.creationTime, false]], // 최근 사진부터
        ...range,
    });

    let tScan = 0, processedNew = 0;

    type ProcResult = ScanItem & { icloud?: boolean };
    async function processOne(asset: MediaLibrary.Asset): Promise<ProcResult> {
        const empty = { assetId: asset.id, thumbUri: "", width: 0, height: 0, faces: [] as FaceBox[], creationTime: asset.creationTime, processedAt: Date.now() };
        try {
            // PHImageManager 직접 요청: getAssetInfoAsync 불필요. iCloud-only면 unavailable → 즉시 스킵.
            const a = Date.now();
            const dest = thumbPath(asset.id);
            const r = await scanAsset(asset.id, THUMB_SIZE, dest);
            const dScan = Date.now() - a; tScan += dScan;
            if (r.unavailable) return { ...empty, icloud: true }; // iCloud/없음 → 스킵(캐시 안 함)
            processedNew++;
            if (dScan > 800) console.log(`[perf] slow photo ${asset.id.slice(0, 8)}: scan=${dScan}ms`);
            return {
                assetId: asset.id,
                thumbUri: r.thumbWritten ? dest : "", // 얼굴 없으면 디스크에 안 씀
                width: r.width, height: r.height,
                faces: r.faces as FaceBox[],
                creationTime: asset.creationTime, processedAt: Date.now(),
            };
        } catch (e) {
            return empty;
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
        if (cached.faces.length === 0) { opts.onProgress?.(1); continue; } // 얼굴 없는 캐시 재사용
        const ok = cached.thumbUri ? (await FileSystem.getInfoAsync(cached.thumbUri)).exists : false;
        if (ok) { collect(cached); opts.onProgress?.(1); }
        else uncached.push(a); // 썸네일 유실 → 재생성
    }

    let iCloudSkipped = 0;
    for (const group of chunk(uncached, CONCURRENCY)) {
        const results = await Promise.all(group.map(processOne));
        for (const it of results) {
            if (it.icloud) { iCloudSkipped++; continue; } // 캐시 안 함(나중 로컬 다운로드 시 재시도)
            cache[it.assetId] = it; collect(it);
        }
        opts.onProgress?.(group.length); // 청크(4)마다 → 카운트업 촘촘히 (iCloud 스킵 포함)
    }

    // 50배치(=5000장)마다 비블로킹 저장 → 전체 캐시 재직렬화(메모리압박→ANE 축출 스파이크) 빈도 최소화.
    // 저장은 크래시 안전용 중간저장일 뿐, 최종은 flushScanCache. (근본 완화=SFace .cpuAndGPU 재빌드)
    if (++saveTick % 50 === 0 && !saving) {
        saving = true;
        saveCache(cache).finally(() => { saving = false; });
    }

    const denom = processedNew || 1;
    console.log(
        `[faceScan] batch: ${page.assets.length} photos (new=${processedNew}, faces=${withFacesDelta}, iCloud건너뜀=${iCloudSkipped}) | ` +
        `scan=${(tScan / denom).toFixed(0)}ms /photo (PHImageManager 검출+저장) | 동시성=${CONCURRENCY}`
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
