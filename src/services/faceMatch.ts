// src/services/faceMatch.ts
//
// 매칭 엔진 (플러그블: 벡터만 다룸). 임베딩은 "후보 얼굴"에만 즉석 계산(embedFace).
//  - 멀티앵커 최대유사도(4) · 시간기반 폴백(5) · 조정 임계값(6) · kind 분기(7)
//  - 후보 필터(3): 작은/저품질 얼굴은 임베딩 스킵 → 속도↑
import * as FileSystem from "expo-file-system";
import { detectFaces, embedFace } from "../../modules/vision-face";
import { AiSubject } from "../types/aiSubject";
import { ScanItem, FaceBox } from "../types/scan";
import { matchConfig, THRESHOLD_PRESET } from "../config/matchConfig";

// 앵커 임베딩 캐시: 앵커 사진이 바뀌지 않으면 재계산(다운로드+검출+임베딩) 생략 → 재스캔 즉시.
const ANCHOR_CACHE = `${FileSystem.documentDirectory}photobook/anchor-cache.json`;
type AnchorCacheEntry = { key: string; embeddings: number[][] };
async function loadAnchorCache(): Promise<Record<string, AnchorCacheEntry>> {
    try {
        const info = await FileSystem.getInfoAsync(ANCHOR_CACHE);
        if (!info.exists) return {};
        return JSON.parse(await FileSystem.readAsStringAsync(ANCHOR_CACHE));
    } catch { return {}; }
}
async function saveAnchorCache(obj: Record<string, AnchorCacheEntry>): Promise<void> {
    try { await FileSystem.writeAsStringAsync(ANCHOR_CACHE, JSON.stringify(obj)); } catch { /* noop */ }
}

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

type GateReason = "too_small" | "too_big" | "too_blurry" | null;
/** 얼굴 게이트: 극단(너무 작음/큼/흐림)이면 사유, 정상이면 null. matchConfig 4종 룰. */
function gateReason(f: FaceBox): GateReason {
    const area = f.width * f.height;
    if (area < matchConfig.matchMinArea) return "too_small";
    if (area > matchConfig.matchMaxArea) return "too_big";
    if (f.quality != null && f.quality < matchConfig.matchMinQuality) return "too_blurry";
    return null;
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

    console.log(`[faceMatch] buildAnchorSet "${subject.name}": cover=${subject.cover ? "1" : "0"} anchors=${(subject.anchors || []).length} → ${urls.length} source photos`);

    // 캐시 히트: 앵커 사진이 그대로면 재사용(다운로드/검출/임베딩 34초 생략).
    const cacheKey = urls.join("|");
    const subjId = (subject as any).id ?? subject.name ?? cacheKey;
    const anchorCache = await loadAnchorCache();
    const hit = anchorCache[subjId];
    if (hit && hit.key === cacheKey && hit.embeddings?.length) {
        console.log(`[faceMatch] ✅ 앵커 캐시 히트 → 재사용 (${hit.embeddings.length}개, 다운로드/임베딩 생략)`);
        return { embeddings: hit.embeddings, centroid: centroidOf(hit.embeddings), birthDate: subject.birthDate, kind: subject.kind };
    }

    const collected: { idx: number; emb: number[] }[] = []; // 소스 인덱스 보존(로그용)
    for (let u = 0; u < urls.length; u++) {
        const url = urls[u];
        // 원격 URL을 로컬 임시파일로 1회만 다운로드 → detect/embed가 재다운로드 안 함(34초→절반).
        const tmp = `${FileSystem.cacheDirectory}anchor_tmp_${u}.jpg`;
        let src = url;
        try {
            const dl = await FileSystem.downloadAsync(url, tmp);
            if (dl.status === 200) src = dl.uri;
        } catch { /* 다운로드 실패 시 원격 URL 그대로 사용 */ }
        try {
            const faces = await detectFaces(src);
            let best: FaceBox | null = null, bestArea = -1;
            for (const f of faces as FaceBox[]) {
                const area = f.width * f.height;
                if (area > bestArea) { bestArea = area; best = f; }
            }
            if (!best) { console.warn(`[faceMatch] anchor#${u + 1}/${urls.length}: ⚠️ no face detected`); continue; }
            const emb = await embedFace(src, best.x, best.y, best.width, best.height);
            if (emb.length) {
                collected.push({ idx: u, emb });
                console.log(`[faceMatch] anchor#${u + 1}/${urls.length}: embedded ✓ (faces=${faces.length}, dim=${emb.length})`);
            } else {
                console.warn(`[faceMatch] anchor#${u + 1}/${urls.length}: ⚠️ embed returned empty`);
            }
        } catch (e) {
            console.warn(`[faceMatch] anchor#${u + 1}/${urls.length}: ⚠️ failed`, e);
        } finally {
            if (src !== url) FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => { });
        }
    }

    // 앵커끼리 서로 얼마나 닮았는지(같은 사람 기준점)
    const cross: string[] = [];
    for (let i = 0; i < collected.length; i++)
        for (let j = i + 1; j < collected.length; j++)
            cross.push(cosine(collected[i].emb, collected[j].emb).toFixed(2));
    console.log(`[faceMatch] anchors: ${collected.length} embeddings for "${subject.name}" | cross-sim=[${cross.join(", ")}]`);

    // ── 이상치 앵커 제거: 다른 앵커들과의 평균 코사인이 낮은 앵커는 centroid 오염원 → 제외 ──
    let survivors = collected;
    if (collected.length >= 3) {
        const meanSim = collected.map((c, i) => {
            let s = 0, n = 0;
            collected.forEach((o, j) => { if (i !== j) { s += cosine(c.emb, o.emb); n++; } });
            return n ? s / n : 1;
        });
        let kept = collected.filter((_, i) => meanSim[i] >= matchConfig.anchorMinMeanSim);
        if (kept.length < 2) {
            // 너무 많이 잘림 → 평균 유사도 상위 2개만 유지(완전 붕괴 방지)
            kept = collected
                .map((c, i) => ({ c, m: meanSim[i] }))
                .sort((a, b) => b.m - a.m)
                .slice(0, 2)
                .map((x) => x.c);
        }
        collected.forEach((c, i) => {
            if (!kept.includes(c)) {
                console.warn(`[faceMatch] anchor#${c.idx + 1}: ⚠️ 이상치 (meanSim=${meanSim[i].toFixed(2)} < ${matchConfig.anchorMinMeanSim}) → centroid 제외`);
            }
        });
        survivors = kept;
        if (survivors.length !== collected.length) {
            console.log(`[faceMatch] anchors pruned: ${collected.length} → ${survivors.length} (centroid 재계산)`);
        }
    }

    const embeddings = survivors.map((s) => s.emb);
    if (embeddings.length === 0) console.warn("[faceMatch] ⚠️ 앵커 임베딩 0개 — 매칭 불가.");
    else { anchorCache[subjId] = { key: cacheKey, embeddings }; saveAnchorCache(anchorCache); } // 다음 스캔 재사용
    return { embeddings, centroid: centroidOf(embeddings), birthDate: subject.birthDate, kind: subject.kind };
}

/**
 * 한 배치의 검출 결과를 매칭. 후보 얼굴만 즉석 임베딩(embedFace) → 코사인.
 * embed 시간 계측 로그 출력.
 */
export interface MatchBatchResult {
    matched: MatchedItem[];   // score ≥ threshold
    nearMiss: MatchedItem[];  // findMoreThreshold ≤ score < threshold (find more (b) 관대 패스용)
}

export async function matchItemsBatch(items: ScanItem[], anchorSet: AnchorSet): Promise<MatchBatchResult> {
    if (anchorSet.embeddings.length === 0) {
        console.warn("[faceMatch] 앵커 0개 → 매칭 0건 (전부 통과 안 함)");
        return { matched: [], nearMiss: [] };
    }
    const thr = thresholdFor(anchorSet);
    const nearThr = matchConfig.findMoreThreshold;
    console.log(`[faceMatch] preset=${THRESHOLD_PRESET} threshold=${thr.toFixed(2)} nearMiss≥${nearThr.toFixed(2)}`);
    const matched: MatchedItem[] = [];
    const nearMiss: MatchedItem[] = [];
    let tEmbed = 0, nEmbed = 0;

    for (const item of items) {
        if (!item.thumbUri) continue; // 썸네일 없는(실패) 항목은 임베딩 불가 → 건너뜀
        let best = -1;
        let bestPer: number[] = []; // 가장 닮은 얼굴의 앵커별 유사도
        let bestFaceIdx = -1;       // 진단: 사진 내 몇 번째 얼굴이 걸렸나
        let bestFace: FaceBox | null = null;
        let candCount = 0;          // 진단: isCandidate 통과(속도 필터) 얼굴 수
        let trustedCount = 0;       // 진단: 게이트 통과(임베딩한) 정상 얼굴 수
        let gatedCount = 0;         // 진단: 게이트(too_small/big/blurry)로 제외된 얼굴 수
        let gatedTop: { face: FaceBox; reason: GateReason } | null = null; // 통째로 빠진 사진의 최대 얼굴(로그용)
        for (let fi = 0; fi < item.faces.length; fi++) {
            const face = item.faces[fi];
            if (!isCandidate(face)) continue;
            candCount++;
            // 얼굴 게이트: 극단(작음/큼/흐림)은 best 경쟁에서 제외(임베딩 스킵). 사유 기록.
            const reason = gateReason(face);
            if (reason) {
                gatedCount++;
                const a2 = face.width * face.height;
                if (!gatedTop || a2 > gatedTop.face.width * gatedTop.face.height) gatedTop = { face, reason };
                continue;
            }
            trustedCount++;
            const a = Date.now();
            let emb: number[] = [];
            try {
                emb = await embedFace(item.thumbUri, face.x, face.y, face.width, face.height);
            } catch (e) {
                continue; // 개별 실패는 그 얼굴만 건너뜀(배치 안 죽음)
            }
            tEmbed += Date.now() - a; nEmbed++;
            if (emb.length) {
                const cs = cosine(emb, anchorSet.centroid); // centroid(앵커 평균) 유사도 = 판정 기준
                if (cs > best) {
                    best = cs;
                    bestPer = anchorSet.embeddings.map((anc) => cosine(emb, anc)); // 앵커별 유사도(로그용)
                    bestFaceIdx = fi;
                    bestFace = face;
                }
            }
        }
        const age = ageMonthsAt(anchorSet.birthDate, item.creationTime);
        const pass = best >= thr;              // 순수 임계값 컷
        const near = !pass && best >= nearThr; // near-miss (find more (b))
        if (best > -1) {
            // 게이트 통과 얼굴이 임베딩됨 → matched / near_miss / score_low.
            const areaPct = bestFace ? (bestFace.width * bestFace.height * 100).toFixed(1) : "?";
            const qual = bestFace?.quality != null ? bestFace.quality.toFixed(2) : "n/a";
            // 매칭된 얼굴 위치(정규화 좌상단). 사진 열어 "그 위치의 얼굴이 나냐 옆사람이냐" 대조용.
            const bbox = bestFace
                ? `[x${bestFace.x.toFixed(2)} y${bestFace.y.toFixed(2)} w${bestFace.width.toFixed(2)} h${bestFace.height.toFixed(2)}]`
                : "[?]";
            const verdict = pass ? "matched" : near ? "near_miss" : "rejected:score_low";
            console.log(
                `[faceMatch] candidate ${item.assetId.slice(0, 8)}: centroid_sim=${best.toFixed(3)} ` +
                `perAnchor=[${bestPer.map((s) => s.toFixed(2)).join(", ")}] anchors=${anchorSet.embeddings.length} ` +
                `| facesInPhoto=${item.faces.length} candidates=${candCount} trusted=${trustedCount} gated=${gatedCount} ` +
                `matchedFace=#${bestFaceIdx} bbox=${bbox} area=${areaPct}% qual=${qual} ` +
                `(thr=${thr.toFixed(2)}) → ${verdict} | thumb=${item.thumbUri}`
            );
        } else if (gatedTop) {
            // 정상 얼굴이 하나도 없어 통째로 빠진 사진 → 최대 얼굴의 게이트 사유로 1줄(thumb 포함).
            const f = gatedTop.face;
            const areaPct = (f.width * f.height * 100).toFixed(1);
            const qual = f.quality != null ? f.quality.toFixed(2) : "n/a";
            console.log(
                `[faceMatch] gated ${item.assetId.slice(0, 8)}: ${gatedTop.reason} ` +
                `(area=${areaPct}% qual=${qual}, faces=${item.faces.length} gated=${gatedCount}) ` +
                `→ skipped | thumb=${item.thumbUri}`
            );
        }
        if (pass) matched.push({ ...item, score: best, ageMonths: age });
        else if (near) nearMiss.push({ ...item, score: best, ageMonths: age });
    }

    console.log(`[faceMatch] batch embed: ${nEmbed} faces | embed=${nEmbed ? (tEmbed / nEmbed).toFixed(0) : 0}ms /face | matched ${matched.length}/${items.length} · nearMiss ${nearMiss.length}`);
    matched.sort((a, b) => b.score - a.score);
    nearMiss.sort((a, b) => b.score - a.score);
    return { matched, nearMiss };
}
