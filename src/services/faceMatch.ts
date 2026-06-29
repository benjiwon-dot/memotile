// src/services/faceMatch.ts
//
// 매칭 엔진 (플러그블: 벡터만 다룸 → 나중에 Core ML 임베딩으로 교체해도 이 로직 그대로).
//  - 멀티앵커 최대유사도 (4)
//  - 앵커 부족 시 시간기반 보조 (5)
//  - 조정 가능한 임계값 (6)
//  - kind 분기 (7): baby/사람 우선. dog는 best-effort(사람 얼굴모델 한계).
import { detectFaces } from "../../modules/vision-face";
import { AiSubject } from "../types/aiSubject";
import { ScanItem } from "../types/scan";
import { matchConfig } from "../config/matchConfig";

export interface AnchorSet {
    embeddings: number[][];   // cover + 앵커들의 얼굴 벡터
    birthDate: string | null;
    kind: AiSubject["kind"];
}

export interface MatchedItem extends ScanItem {
    score: number;
    ageMonths: number | null; // 그 사진 = 피사체 나이(개월). birthDate 없으면 null
}

export function cosine(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    if (n === 0) return -1;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < n; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return -1;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function ageMonthsAt(birthDate: string | null | undefined, atMs: number | undefined): number | null {
    if (!birthDate || !atMs) return null;
    const b = new Date(birthDate);
    const at = new Date(atMs);
    if (isNaN(b.getTime()) || isNaN(at.getTime())) return null;
    let m = (at.getFullYear() - b.getFullYear()) * 12 + (at.getMonth() - b.getMonth());
    if (at.getDate() < b.getDate()) m--;
    return m; // 음수면 출생 전(EXIF 오류 등) → 호출부에서 처리
}

function pickLargestFaceEmbedding(faces: { width: number; height: number; embedding?: number[] }[]): number[] | null {
    let best: number[] | null = null;
    let bestArea = -1;
    for (const f of faces) {
        if (f.embedding && f.embedding.length > 0) {
            const area = f.width * f.height;
            if (area > bestArea) { bestArea = area; best = f.embedding; }
        }
    }
    return best;
}

/** cover + 앵커 사진을 검출·임베딩해 앵커 벡터 집합을 만든다 (온디바이스, 업로드 0) */
export async function buildAnchorSet(subject: AiSubject): Promise<AnchorSet> {
    const urls: string[] = [];
    if (subject.cover?.url) urls.push(subject.cover.url);
    for (const a of subject.anchors || []) if (a?.url) urls.push(a.url);

    const embeddings: number[][] = [];
    for (const url of urls) {
        try {
            const faces = await detectFaces(url);
            const emb = pickLargestFaceEmbedding(faces);
            if (emb) embeddings.push(emb);
        } catch (e) {
            console.warn("[faceMatch] anchor embed failed:", e);
        }
    }
    return { embeddings, birthDate: subject.birthDate, kind: subject.kind };
}

function thresholdFor(anchorSet: AnchorSet): number {
    const few = anchorSet.embeddings.length <= matchConfig.fewAnchorsCount;
    if (few) return matchConfig.fewAnchorsThreshold;
    if (anchorSet.kind === "baby") return matchConfig.babyThreshold;
    return matchConfig.threshold;
}

/** 사진 1장이 이 subject인지 판정 + 점수 */
export function scoreItem(item: ScanItem, anchorSet: AnchorSet): number {
    let best = -1;
    for (const face of item.faces) {
        if (!face.embedding || face.embedding.length === 0) continue;
        for (const anchor of anchorSet.embeddings) {
            const s = cosine(face.embedding, anchor);
            if (s > best) best = s;
        }
    }
    return best; // 얼굴/앵커 임베딩 없으면 -1
}

/**
 * subject로 라이브러리 후보 필터.
 *  - 임베딩 매칭(멀티앵커 max)
 *  - 앵커 부족 시: 임계값 약간 아래여도 추정 나이 차가 window 이내면 후보(시간 보조)
 */
export function matchSubject(
    items: ScanItem[],
    anchorSet: AnchorSet,
    onProgress?: (done: number, total: number, matched: number) => void
): MatchedItem[] {
    const thr = thresholdFor(anchorSet);
    const few = anchorSet.embeddings.length <= matchConfig.fewAnchorsCount;
    const matched: MatchedItem[] = [];
    const total = items.length;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.faces.length === 0) { onProgress?.(i + 1, total, matched.length); continue; }

        const score = scoreItem(item, anchorSet);
        const age = ageMonthsAt(anchorSet.birthDate, item.creationTime);

        let pass = score >= thr;
        // 시간기반 보조 (앵커 부족 + 점수 근접 + 나이 그럴듯)
        if (!pass && few && score >= thr - 0.06 && age !== null && age >= 0 && age <= 18 * 12) {
            pass = true;
        }

        if (pass) matched.push({ ...item, score, ageMonths: age });
        onProgress?.(i + 1, total, matched.length);
    }

    matched.sort((a, b) => b.score - a.score);
    return matched.slice(0, matchConfig.maxCandidates);
}
