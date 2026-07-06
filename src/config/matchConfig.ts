// src/config/matchConfig.ts
//
// 매칭 임계값/파라미터. 전부 튜닝 가능한 상수.
// ✅ SFace(ArcFace 계열, L2 정규화 임베딩) 기준. OpenCV 권장: 같은 사람 = cosine ≥ 0.363.
//    centroid 평균과의 코사인이라 분포가 약간 달라질 수 있음 → 로그(centroid_sim/perAnchor) 보고 보정.

// ── 임계값 프리셋 (실기기 테스트용) ──
// 이 한 줄만 바꿔서 전환.
// 실측(SFace): 본인 centroid_sim 0.5~0.7+ / 타인·아기 0.1~0.2. 0.36~0.45 사이가 애매 구간이라
// OpenCV 기본 0.363보다 올려 잡음(애매 구간 컷). 본인이 너무 빠지면 0.42로 내릴 것.
export type ThresholdPreset = "loose" | "balanced" | "strict";
export const THRESHOLD_PRESET: ThresholdPreset = "balanced"; // loose=0.42 · balanced=0.47 · strict=0.50
const PRESET_VALUES: Record<ThresholdPreset, number> = { loose: 0.42, balanced: 0.47, strict: 0.50 };
const ACTIVE_THRESHOLD = PRESET_VALUES[THRESHOLD_PRESET];

export const matchConfig = {
    // ═══════════════════ 얼굴 게이트 4종 (한 곳에 모음) ═══════════════════
    // ⚠️ 이 4개(area_min·area_max·qual_min·threshold)는 "정상 얼굴만 매칭, 극단은 제외" 룰.
    //    각각 독립 튜닝 가능. gated 사유 로그(too_small/too_big/too_blurry/score_low)로 데이터 보며 조정.
    //
    // ⚠️⚠️ 현재 값 = **성인 Jiwon 기준 1차값**. 전 사용자에 kind 무관 공통 적용됨.
    //    핵심 타겟은 **아기**인데 아기는 얼굴 크기·비율·선명도 특성이 성인과 달라 이 값이 최적이 아닐 수 있음.
    //    → 아기 실데이터 확보 후 아래 4개를 반드시 재조정할 것.
    //    → 아기 특화하려면 thresholdFor()처럼 kind==="baby" 분기를 추가하면 됨(지금은 공통).
    matchMinArea: 0.05,    // area_min · <5%  = too_small (정렬 실패 노이즈)  ※ 본인 원거리 빠지면 0.04로 되돌리기
    matchMaxArea: 0.50,    // area_max · >50% = too_big   (왜곡/타인 클로즈업) ※ 본인 클로즈업 빠지면 0.55
    matchMinQuality: 0.30, // qual_min · 흐림  = too_blurry (Vision quality, null이면 통과)
    threshold: ACTIVE_THRESHOLD,    // score_low 컷 = preset(현재 balanced=0.45). 0.40 인하는 thumb 확인 후.
    // find more (b) 관대 패스: [findMoreThreshold, threshold) 구간을 near-miss로 모아 opt-in 추가.
    // 0.43 시작(0.42는 경계 타인 EDED259B 0.438이 들어와 살짝 보수적). threshold보다 낮아야 의미.
    findMoreThreshold: 0.43,
    // ═══════════════════════════════════════════════════════════════════

    babyThreshold: ACTIVE_THRESHOLD,
    // 앵커가 적어도(1장 등) 동일 컷 적용
    fewAnchorsCount: 2,
    fewAnchorsThreshold: ACTIVE_THRESHOLD,
    // 후보 상한(미리보기 폭주 방지). 점수순 상위만.
    maxCandidates: 300,
    // 임베딩 스킵 필터(게이트와 별개, 속도용): 아주 작거나 저품질이면 임베딩 자체를 스킵
    minFaceArea: 0.015,   // 정규화 w*h
    minQuality: 0.2,      // Vision faceCaptureQuality 하한 (null이면 통과)

    // ── 앵커 이상치 제거 ──
    // 앵커 3장+ 일 때, 나머지 앵커들과의 평균 코사인이 이 값 미만인 앵커는 "나쁜 앵커"로 보고
    // centroid에서 제외(품질 나쁜 사진/정렬 실패가 centroid를 흔드는 것 방지). 최소 2장은 유지.
    anchorMinMeanSim: 0.30,

    // ── 중복(연속 촬영) 묶기 ──
    // 촬영시각이 windowMs 이내 + 점수차가 scoreEps 이내면 "거의 동일 사진"으로 보고 대표 1장만 표시.
    // 둘 다 만족해야 묶이므로 다른 좋은 사진을 잘못 합칠 위험 낮음. windowMs=0이면 끔.
    dedupeBurstWindowMs: 3000, // 3초
    dedupeBurstScoreEps: 0.03,
};
