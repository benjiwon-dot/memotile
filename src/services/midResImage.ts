// src/services/midResImage.ts
//
// 프리뷰/뷰어 "보이는 펼침면" 셀만 선명하게 — 원본에서 1280px 중간해상도 캐시본을 lazy 생성.
// 스캔 썸네일(256px)을 크게 늘리면 뭉개지므로, 화면에 보이는 셀만 이 중간본으로 스왑.
// ⚠️ 스캔/얼굴검출과 무관(표시용). 48~112장 전부가 아니라 호출부가 넘긴 "보이는 윈도우"만 처리.
import { useEffect, useState } from "react";
import * as MediaLibrary from "expo-media-library";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

const MID_WIDTH = 1280; // 가로모드 히어로 셀(~1170px)까지 커버. 파일 수백 KB, 디코드 가벼움.

const midCache = new Map<string, string>();          // assetId → 캐시된 1280px 파일 uri
const inflight = new Map<string, Promise<string | null>>(); // 중복 생성 방지

// 원본 localUri에서 1280px JPEG 생성(캐시). iCloud-only(로컬 없음)면 null → 호출부가 썸네일 폴백.
async function resolveMidRes(assetId: string): Promise<string | null> {
    if (midCache.has(assetId)) return midCache.get(assetId)!;
    if (inflight.has(assetId)) return inflight.get(assetId)!;
    const p = (async () => {
        try {
            // shouldDownloadFromNetwork:false → iCloud 다운로드 안 함(느린 대기 방지)
            const info = await MediaLibrary.getAssetInfoAsync(assetId, { shouldDownloadFromNetwork: false });
            const src = (info as any)?.localUri || (info as any)?.uri;
            if (!src) return null; // 로컬 원본 없음 → 썸네일 유지
            const out = await manipulateAsync(src, [{ resize: { width: MID_WIDTH } }], { compress: 0.82, format: SaveFormat.JPEG });
            midCache.set(assetId, out.uri);
            return out.uri;
        } catch {
            return null;
        } finally {
            inflight.delete(assetId);
        }
    })();
    inflight.set(assetId, p);
    return p;
}

/**
 * 보이는 윈도우의 assetId들 → 중간해상도 uri 맵. 준비 전/실패 시 해당 id는 맵에 없음(호출부가 썸네일 폴백).
 * 누적 맵(한 번 선명해진 셀은 유지) — 실제 디코드 메모리는 마운트된 셀(FlatList windowSize)로 한정됨.
 */
export function useMidResMap(assetIds: string[]): Record<string, string> {
    const [map, setMap] = useState<Record<string, string>>({});
    const key = assetIds.join(",");
    useEffect(() => {
        let alive = true;
        assetIds.forEach((id) => {
            if (!id) return;
            resolveMidRes(id).then((uri) => {
                if (alive && uri) setMap((prev) => (prev[id] === uri ? prev : { ...prev, [id]: uri }));
            });
        });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    return map;
}
