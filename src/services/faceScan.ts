// src/services/faceScan.ts
//
// STEP 4 오케스트레이터: 카메라롤 페이지네이션 → 다운스케일 썸네일 → 온디바이스 얼굴 검출 → 캐시.
// 원본 업로드 없음. 증분(이미 처리한 assetId는 skip).
import * as MediaLibrary from "expo-media-library";
import * as FileSystem from "expo-file-system";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { detectFaces } from "../../modules/vision-face";
import { ScanItem, ScanProgress, ScanSummary, FaceBox } from "../types/scan";
import { loadCache, saveCache, thumbPath, ScanCache } from "./scanCache";

const THUMB_SIZE = 512;
const PAGE = 100;
const SAVE_EVERY = 15;

export async function requestLibraryPermission(): Promise<MediaLibrary.PermissionResponse> {
    return await MediaLibrary.requestPermissionsAsync();
}

export interface ScanOptions {
    maxAssets?: number; // 데모/안전 상한
}

export async function scanLibrary(
    onProgress?: (p: ScanProgress) => void,
    opts: ScanOptions = {}
): Promise<{ summary: ScanSummary; items: ScanItem[] }> {
    const cache: ScanCache = await loadCache();

    let after: string | undefined = undefined;
    let hasNext = true;
    let scanned = 0;
    let withFaces = 0;
    let faceCount = 0;
    let sinceSave = 0;
    const limit = opts.maxAssets ?? Infinity;

    const firstPage = await MediaLibrary.getAssetsAsync({ mediaType: "photo", first: 1 });
    const total = Math.min(firstPage.totalCount, limit);

    while (hasNext && scanned < limit) {
        const page = await MediaLibrary.getAssetsAsync({
            mediaType: "photo",
            first: PAGE,
            after,
            sortBy: [MediaLibrary.SortBy.creationTime],
        });
        after = page.endCursor;
        hasNext = page.hasNextPage;

        for (const asset of page.assets) {
            if (scanned >= limit) break;
            const id = asset.id;

            // 증분: 이미 처리된 사진은 결과만 합산하고 skip
            if (cache[id]) {
                scanned++;
                if (cache[id].faces.length > 0) {
                    withFaces++;
                    faceCount += cache[id].faces.length;
                }
                onProgress?.({ scanned, total, withFaces });
                continue;
            }

            try {
                const info = await MediaLibrary.getAssetInfoAsync(asset);
                const srcUri = info.localUri || asset.uri;

                const manipulated = await manipulateAsync(
                    srcUri,
                    [{ resize: { width: THUMB_SIZE } }],
                    { compress: 0.8, format: SaveFormat.JPEG }
                );
                const dest = thumbPath(id);
                await FileSystem.copyAsync({ from: manipulated.uri, to: dest });

                const faces = (await detectFaces(dest)) as FaceBox[];

                cache[id] = {
                    assetId: id,
                    thumbUri: dest,
                    width: manipulated.width,
                    height: manipulated.height,
                    faces,
                    processedAt: Date.now(),
                };
                scanned++;
                if (faces.length > 0) {
                    withFaces++;
                    faceCount += faces.length;
                }
            } catch (e) {
                // 개별 실패는 빈 결과로 캐시해 재시도 폭주를 막는다.
                cache[id] = { assetId: id, thumbUri: "", width: 0, height: 0, faces: [], processedAt: Date.now() };
                scanned++;
            }

            onProgress?.({ scanned, total, withFaces });
            if (++sinceSave >= SAVE_EVERY) {
                await saveCache(cache);
                sinceSave = 0;
            }
        }
    }

    await saveCache(cache);

    const items = Object.values(cache);
    return { summary: { total: scanned, withFaces, faceCount }, items };
}

export async function getCachedItems(): Promise<ScanItem[]> {
    const cache = await loadCache();
    return Object.values(cache);
}
