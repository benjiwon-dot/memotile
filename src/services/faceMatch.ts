// src/services/faceMatch.ts
//
// 매칭 엔진 (플러그블: 벡터만 다룸). 임베딩은 "후보 얼굴"에만 즉석 계산(embedFace).
//  - 멀티앵커 최대유사도(4) · 시간기반 폴백(5) · 조정 임계값(6) · kind 분기(7)
//  - 후보 필터(3): 작은/저품질 얼굴은 임베딩 스킵 → 속도↑
import { detectFaces, embedFace } from "../../modules/vision-face";
import { AiSubject } from "../types/aiSubject";
import { ScanItem, FaceBox } from "../types/scan";
import { matchConfig } from "../config/matchConfig";

export interface AnchorSet {
    embeddings: number[][];
    centroid: number[];   // 앵커 평균 임베딩 (판정 기준)
    birthDate: string | null;
    kind: AiSubject["kind"];
}

function centroidOf(embs: number[][]): number[] {
    if (embs.length === 0) return [];
    const n = embs[0].length;
    const out = new Array(n).fill(0);
    for (const e of embs) for (let i = 0; i < n; i++) out[i] += e[i];
    for (let i = 0; i < n; i++) out[i] /= embs.length;
    return out;
}

export interface MatchedItem extends ScanItem {
    score: number;
    ageMonths: number | null;
}

export function cosine(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    if (n === 0) return -1;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    if (na === 0 || nb === 0) return -1;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function ageMonthsAt(birthDate: string | null | undefined, atMs: number | undefined): number | null {
    if (!birthDate || !atMs) return null;
    const b = new Date(birthDate), at = new Date(atMs);
    if (isNaN(b.getTime()) || isNaN(at.getTime())) return null;
    let m = (at.getFullYear() - b.getFullYear()) * 12 + (at.getMonth() - b.getMonth());
    if (at.getDate() < b.getDate()) m--;
    return m;
}

function isCandidate(f: FaceBox): boolean {
    const area = f.width * f.height;
    if (area < matchConfig.minFaceArea) return false;
    if (f.quality != null && f.quality < matchConfig.minQuality) return false;
    return true;
}

function thresholdFor(anchorSet: AnchorSet): number {
    const few = anchorSet.embeddings.length <= matchConfig.fewAnchorsCount;
    if (few) return matchConfig.fewAnchorsThreshold;
    if (anchorSet.kind === "baby") return matchConfig.babyThreshold;
    return matchConfig.threshold;
}

/** cover + 앵커를 검출·임베딩해 앵커 벡터 집합 생성 (온디바이스, 업로드 0) */
export async function buildAnchorSet(subject: AiSubject): Promise<AnchorSet> {
    const urls: string[] = [];
    if (subject.cover?.url) urls.push(subject.cover.url);
    for (const a of subject.anchors || []) if (a?.url) urls.push(a.url);

    const embeddings: number[][] = [];
    for (const url of urls) {
        try {
            const faces = await detectFaces(url);
            // 가장 큰 얼굴
            let best: FaceBox | null = null, bestArea = -1;
            for (const f of faces as FaceBox[]) {
                const area = f.width * f.height;
                if (area > bestArea) { bestArea = area; best = f; }
            }
            if (best) {
                const emb = await embedFace(url, best.x, best.y, best.width, best.height);
                if (emb.length) embeddings.push(emb);
            }
        } catch (e) {
            console.warn("[faceMatch] anchor embed failed:", e);
        }
    }
    console.log(`[faceMatch] anchors: ${embeddings.length} embeddings for "${subject.name}" (${subject.kind}, id=${(subject.id || "").slice(-6)})`);
    if (embeddings.length >= 2) {
        console.log(`[faceMatch] anchor self-check cos(a0,a1)=${cosine(embeddings[0], embeddings[1]).toFixed(3)} (같은 사람끼리 값 = 매칭 임계 기준점)`);
    }
    if (embeddings.length === 0) console.warn("[faceMatch] ⚠️ 앵커 임베딩 0개 — 프로필 사진에서 얼굴 검출 실패. 매칭 불가.");
    return { embeddings, centroid: centroidOf(embeddings), birthDate: subject.birthDate, kind: subject.kind };
}

/**
 * 한 배치의 검출 결과를 매칭. 후보 얼굴만 즉석 임베딩(embedFace) → 코사인.
 * embed 시간 계측 로그 출력.
 */
export async function matchItemsBatch(items: ScanItem[], anchorSet: AnchorSet): Promise<MatchedItem[]> {
    if (anchorSet.embeddings.length === 0) {
        console.warn("[faceMatch] 앵커 0개 → 매칭 0건 (전부 통과 안 함)");
        return [];
    }
    const thr = thresholdFor(anchorSet);
    const matched: MatchedItem[] = [];
    let tEmbed = 0, nEmbed = 0;

    for (const item of items) {
        if (!item.thumbUri) continue; // 썸네일 없는(실패) 항목은 임베딩 불가 → 건너뜀
        let best = -1;
        for (const face of item.faces) {
            if (!isCandidate(face)) continue;
            const a = Date.now();
            let emb: number[] = [];
            try {
                emb = await embedFace(item.thumbUri, face.x, face.y, face.width, face.height);
            } catch (e) {
                // 개별 이미지 로드/임베딩 실패는 그 얼굴만 건너뛴다 (배치 전체를 죽이지 않음)
                continue;
            }
            tEmbed += Date.now() - a; nEmbed++;
            if (emb.length) {
                // 앵커 평균(centroid)과의 유사도
                const s = cosine(emb, anchorSet.centroid);
                if (s > best) best = s;
            }
        }
        const age = ageMonthsAt(anchorSet.birthDate, item.creationTime);
        const pass = best >= thr; // 순수 임계값 컷 (시간보조는 STEP6에서 재도입 가능)
        // 각 후보의 실제 유사도 로그 (임계값 보정용)
        if (best > -1) {
            console.log(`[faceMatch] candidate ${item.assetId.slice(-8)}: similarity=${best.toFixed(3)} (threshold=${thr.toFixed(2)}) → ${pass ? "matched" : "rejected"}`);
        }
        if (pass) matched.push({ ...item, score: best, ageMonths: age });
    }

    console.log(`[faceMatch] batch embed: ${nEmbed} faces | embed=${nEmbed ? (tEmbed / nEmbed).toFixed(0) : 0}ms /face | matched ${matched.length}/${items.length}`);
    matched.sort((a, b) => b.score - a.score);
    return matched;
}
