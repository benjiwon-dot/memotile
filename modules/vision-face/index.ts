import { requireNativeModule } from "expo-modules-core";
import type { DetectedFace } from "./src/VisionFace.types";

// 네이티브 모듈 (Name("VisionFace"))
const VisionFace = requireNativeModule("VisionFace");

/** 로컬 이미지(보통 썸네일)에서 얼굴 검출. iOS 전용. */
export async function detectFaces(uri: string): Promise<DetectedFace[]> {
    return (await VisionFace.detectFaces(uri)) as DetectedFace[];
}

export type { DetectedFace };
