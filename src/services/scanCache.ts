// src/services/scanCache.ts
//
// 스캔 결과 로컬 캐시 (expo-file-system JSON). assetId 키로 증분 저장.
// Phase 1(수백 장)엔 충분. 1만 장 스케일(Phase 2)에서 expo-sqlite로 이전.
import * as FileSystem from "expo-file-system";
import { ScanItem } from "../types/scan";

const BASE = `${FileSystem.documentDirectory}photobook/`;
const THUMBS = `${BASE}thumbs/`;
const INDEX = `${BASE}scan-index.json`;

export type ScanCache = Record<string, ScanItem>;

async function ensureDirs() {
    for (const d of [BASE, THUMBS]) {
        const info = await FileSystem.getInfoAsync(d);
        if (!info.exists) await FileSystem.makeDirectoryAsync(d, { intermediates: true });
    }
}

export async function loadCache(): Promise<ScanCache> {
    await ensureDirs();
    const info = await FileSystem.getInfoAsync(INDEX);
    if (!info.exists) return {};
    try {
        const raw = await FileSystem.readAsStringAsync(INDEX);
        return JSON.parse(raw) as ScanCache;
    } catch {
        return {};
    }
}

export async function saveCache(cache: ScanCache): Promise<void> {
    await ensureDirs();
    await FileSystem.writeAsStringAsync(INDEX, JSON.stringify(cache));
}

export function thumbPath(assetId: string): string {
    const safe = assetId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `${THUMBS}${safe}.jpg`;
}

export async function clearCache(): Promise<void> {
    const info = await FileSystem.getInfoAsync(BASE);
    if (info.exists) await FileSystem.deleteAsync(BASE, { idempotent: true });
}
