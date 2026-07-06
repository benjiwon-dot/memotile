// src/services/coverImage.ts
//
// 표지용 고해상도 이미지 URI 해석. 스캔 썸네일(thumbUri, 256px)은 표지 크기로 확대·크롭하면
// 모자이크처럼 깨지므로, 표지 1장에 한해 원본 asset의 로컬 풀해상도 URI를 로드해 쓴다.
// (내지 콜라주는 장수가 많아 썸네일 유지 — 성능)
import { useEffect, useState } from "react";
import * as MediaLibrary from "expo-media-library";

const cache = new Map<string, string>();

async function resolveHiRes(assetId: string, fallback: string): Promise<string> {
    if (cache.has(assetId)) return cache.get(assetId)!;
    try {
        const info = await MediaLibrary.getAssetInfoAsync(assetId, { shouldDownloadFromNetwork: false });
        const uri = info?.localUri || info?.uri || fallback; // 로컬 풀해상도 우선
        cache.set(assetId, uri);
        return uri;
    } catch {
        return fallback;
    }
}

/** 표지 asset의 고해상도 URI (해석 전에는 fallback 썸네일) */
export function useHiResCover(assetId: string | undefined, fallback: string | undefined): string | undefined {
    const [uri, setUri] = useState(fallback);
    useEffect(() => {
        let alive = true;
        setUri(fallback);
        if (!assetId) return;
        resolveHiRes(assetId, fallback ?? "").then((u) => { if (alive && u) setUri(u); });
        return () => { alive = false; };
    }, [assetId, fallback]);
    return uri;
}
