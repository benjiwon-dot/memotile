// src/types/aiSubject.ts
//
// AI 포토북: 대상(아이) 프로필 데이터 모델.
// 기존 orders 스키마와 완전히 분리된 별도 컬렉션 aiSubjects 에 저장된다.

export type AgeBucketId = "0-3m" | "3-12m" | "1-2y" | "2-3y";

export type SubjectGender = "boy" | "girl" | "unspecified";

export type SubjectStatus = "draft" | "ready";

/** Storage 업로드된 사진 1장에 대한 참조 */
export interface PhotoRef {
    storagePath: string;        // "aiSubjects/{uid}/{subjectId}/..."
    url: string;                // download URL
    width?: number;
    height?: number;
    localId?: string | null;    // PhotoKit localIdentifier (STEP4 온디바이스 재사용용)
}

/** 연령 구간별 기준(앵커) 사진 모음 — 있는 구간만 채운다 */
export type SubjectAnchors = Record<AgeBucketId, PhotoRef[]>;

export interface AiSubject {
    id?: string;
    ownerUid: string;           // == auth.uid (보안규칙 키)
    kind: "baby";               // 엔진은 넓게 설계, 향후 "pet" | "couple"
    name: string;
    birthDate: string | null;   // ISO "YYYY-MM-DD" (선택)
    gender: SubjectGender;
    cover: PhotoRef | null;
    anchors: SubjectAnchors;
    anchorCount: number;        // 채워진 기준사진 총 개수(비정규화, UI/검증용)
    status: SubjectStatus;
    schemaVersion: number;
    createdAt?: any;
    updatedAt?: any;
}

/** 연령 구간 정의 (UI 슬롯 순서 = 이 배열 순서) */
export const AGE_BUCKETS: { id: AgeBucketId; labelKey: string; maxSlots: number }[] = [
    { id: "0-3m", labelKey: "ageBucket_0_3m", maxSlots: 3 },
    { id: "3-12m", labelKey: "ageBucket_3_12m", maxSlots: 3 },
    { id: "1-2y", labelKey: "ageBucket_1_2y", maxSlots: 3 },
    { id: "2-3y", labelKey: "ageBucket_2_3y", maxSlots: 3 },
];

export const EMPTY_ANCHORS: SubjectAnchors = {
    "0-3m": [],
    "3-12m": [],
    "1-2y": [],
    "2-3y": [],
};

export const SUBJECT_SCHEMA_VERSION = 1;
