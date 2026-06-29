// 정규화(0~1) 좌상단 기준 얼굴 박스 + 캡처 품질
export interface DetectedFace {
    x: number;
    y: number;
    width: number;
    height: number;
    quality: number | null; // 0~1 (Vision faceCaptureQuality), 없으면 null
}
