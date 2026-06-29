// 정규화(0~1) 좌상단 기준 얼굴 박스 + 캡처 품질 + 임베딩 + 선명도
export interface DetectedFace {
    x: number;
    y: number;
    width: number;
    height: number;
    quality: number | null;   // 0~1 (Vision faceCaptureQuality), 없으면 null
    embedding: number[];      // VNGenerateImageFeaturePrint 벡터 (빈 배열이면 추출 실패)
    sharpness: number;        // 라플라시안 분산 (클수록 선명)
}
