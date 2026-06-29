// src/types/aiSubject.ts
//
// AI 포토북 대상(프로필) 데이터 모델. 기존 orders 스키마와 분리된 aiSubjects 컬렉션.
// v2: 딱딱한 연령 버킷 제거 → 기준(앵커) 사진은 자유 평면 배열.

export type SubjectGender = "boy" | "girl" | "unspecified";

// 엔진은 넓게 설계. Phase 1 출시는 baby. (향후 pet/couple)
export type SubjectKind = "baby" | "pet" | "couple";

export type SubjectStatus = "draft" | "ready";

/** Storage 업로드된 사진 1장에 대한 참조 */
export interface PhotoRef {
    storagePath: string;
    url: string;
    width?: number;
    height?: number;
    localId?: string | null;
}

export interface AiSubject {
    id?: string;
    ownerUid: string;
    kind: SubjectKind;
    name: string;
    birthDate: string | null;   // ISO "YYYY-MM-DD" (선택)
    gender: SubjectGender;
    cover: PhotoRef | null;     // 프로필(대표) 사진
    anchors: PhotoRef[];        // 기준 사진(자유 그리드)
    anchorCount: number;
    status: SubjectStatus;
    schemaVersion: number;
    createdAt?: any;
    updatedAt?: any;
}

export const SUBJECT_SCHEMA_VERSION = 2;
