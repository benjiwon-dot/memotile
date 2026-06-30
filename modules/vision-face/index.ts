import { requireNativeModule } from "expo-modules-core";
import type { DetectedFace } from "./src/VisionFace.types";

const VisionFace = requireNativeModule("VisionFace");

/** 얼굴 검출(빠름): bbox + 품질 + 선명도. 임베딩 없음. */
export async function detectFaces(uri: string): Promise<DetectedFace[]> {
    return (await VisionFace.detectFaces(uri)) as DetectedFace[];
}

/** 지정 얼굴 영역(정규화 좌상단 x,y,w,h)의 FeaturePrint 임베딩(무거움). 매칭 후보에만 호출. */
export async function embedFace(uri: string, x: number, y: number, w: number, h: number): Promise<number[]> {
    return (await VisionFace.embedFace(uri, x, y, w, h)) as number[];
}

export type { DetectedFace };
