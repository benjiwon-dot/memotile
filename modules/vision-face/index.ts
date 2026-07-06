import { requireNativeModule } from "expo-modules-core";
import type { DetectedFace } from "./src/VisionFace.types";

const VisionFace = requireNativeModule("VisionFace");

/** 얼굴 검출(빠름): bbox + 품질 + 선명도. 임베딩 없음. */
export async function detectFaces(uri: string): Promise<DetectedFace[]> {
    return (await VisionFace.detectFaces(uri)) as DetectedFace[];
}

export interface ScanImageResult {
    faces: DetectedFace[];
    width: number;
    height: number;
    thumbWritten: boolean; // 얼굴이 있어 thumbPath에 저장됨
}

/**
 * 스캔 고속 경로: 원본을 축소 디코드(풀 디코드 X) → 검출 → 얼굴 있으면 thumbPath에 JPEG 저장.
 * expo-image-manipulator + copyAsync 대체. 로컬 파일 uri만(iCloud는 상위에서 스킵). null=로드 실패.
 */
export async function scanImage(uri: string, maxPixel: number, thumbPath: string): Promise<ScanImageResult | null> {
    return (await VisionFace.scanImage(uri, maxPixel, thumbPath)) as ScanImageResult | null;
}

export interface ScanAssetResult extends ScanImageResult {
    unavailable: boolean; // iCloud-only/없음 → 로컬 처리 불가(스킵)
}

/**
 * 스캔 최고속: PHAsset localIdentifier로 PHImageManager 축소본 직접 요청(getAssetInfoAsync 불필요).
 * iCloud-only면 unavailable=true(즉시 스킵). iOS(Photos)만 지원.
 */
export async function scanAsset(localId: string, maxPixel: number, thumbPath: string): Promise<ScanAssetResult> {
    return (await VisionFace.scanAsset(localId, maxPixel, thumbPath)) as ScanAssetResult;
}

/** 스캔 시작 시 1회 호출: SFace+Vision 모델을 미리 로드/컴파일 → 초기/재로딩 스파이크 억제. */
export async function warmUpFace(): Promise<void> {
    try { await VisionFace.warmUpFace(); } catch { /* noop */ }
}

/** 지정 얼굴 영역(정규화 좌상단 x,y,w,h)의 FeaturePrint 임베딩(무거움). 매칭 후보에만 호출. */
export async function embedFace(uri: string, x: number, y: number, w: number, h: number): Promise<number[]> {
    return (await VisionFace.embedFace(uri, x, y, w, h)) as number[];
}

export type { DetectedFace };
