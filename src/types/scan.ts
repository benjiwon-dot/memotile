// src/types/scan.ts
//
// STEP 4: 카메라롤 스캔 + 온디바이스 얼굴 검출 결과 모델.
// 원본은 업로드하지 않고, 썸네일(로컬) + bbox 메타만 캐시한다.

/** 정규화(0~1) 좌상단 기준 얼굴 박스 */
export interface FaceBox {
    x: number;
    y: number;
    width: number;
    height: number;
    quality: number | null;   // 0~1 캡처 품질 (없으면 null)
    embedding?: number[];     // FeaturePrint 벡터 (STEP5 매칭용)
    sharpness?: number;       // 라플라시안 분산 (STEP6 베스트컷용)
}

/** 사진 1장 스캔 결과 (assetId 키로 캐시) */
export interface ScanItem {
    assetId: string;
    thumbUri: string;         // 로컬 캐시 썸네일 (file://)
    width: number;            // 썸네일 px
    height: number;
    faces: FaceBox[];
    creationTime?: number;    // 촬영(생성) 시각 epoch ms — 타임라인/나이계산용 (STEP6)
    processedAt: number;      // epoch ms
}

export interface ScanProgress {
    scanned: number;
    total: number;
    withFaces: number;
}

export interface ScanSummary {
    total: number;          // 스캔 완료 사진 수
    withFaces: number;      // 얼굴이 1개 이상 검출된 사진 수
    faceCount: number;      // 검출된 얼굴 총 개수
}

export const SCAN_SCHEMA_VERSION = 1;
