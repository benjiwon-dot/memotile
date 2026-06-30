// src/config/matchConfig.ts
//
// 매칭 임계값/파라미터. 전부 튜닝 가능한 상수.
// ⚠️ Vision FeaturePrint 벡터의 코사인 값 분포는 신원학습 임베딩과 달라
//    실기기에서 보정 필요. 아기는 정확도가 낮으니 느슨하게(후보 多) + 부모 최종선택.
export const matchConfig = {
    // 같은 사람 판정 코사인 컷. 실측: 본인 0.5~0.74 / 남 0.27~0.4 → 0.48로 분리.
    threshold: 0.48,
    babyThreshold: 0.48,
    // 앵커가 이 수 이하여도(1장 등) 동일 컷 적용 (이전 0.16이 전부 통과시킨 원인)
    fewAnchorsCount: 2,
    fewAnchorsThreshold: 0.48,
    // 후보 상한(미리보기 폭주 방지). 점수순 상위만.
    maxCandidates: 300,
    // 임베딩 스킵 필터: 너무 작거나 저품질인 얼굴은 임베딩 안 함(속도↑)
    minFaceArea: 0.015,   // 정규화 w*h (얼굴이 사진의 1.5% 미만이면 스킵)
    minQuality: 0.2,      // Vision faceCaptureQuality 하한 (null이면 통과)
};
