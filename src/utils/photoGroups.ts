// src/utils/photoGroups.ts
//
// 매칭 사진을 촬영일(creationTime) 기준 년/월 그룹(오래된→최신)으로 묶는다.
import { ScanItem } from "../types/scan";

export interface MonthSection {
    key: string;
    title: string;            // "2024.05"
    ageMonths: number | null; // 생일 기준 그 달의 나이(개월), 없으면 null
    data: ScanItem[][];       // 행 단위(그리드 cols개씩)
}

function pad2(n: number) { return n < 10 ? `0${n}` : `${n}`; }

function ageMonthsAt(birth: string | null, atMs: number): number | null {
    if (!birth) return null;
    const b = new Date(birth), at = new Date(atMs);
    if (isNaN(b.getTime()) || isNaN(at.getTime())) return null;
    let m = (at.getFullYear() - b.getFullYear()) * 12 + (at.getMonth() - b.getMonth());
    if (m < 0) m = 0;
    return m;
}

function chunk<T>(arr: T[], n: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
}

/** 중복 묶기용 최소 형태 (MatchedItem이 만족) */
interface BurstItem {
    assetId: string;
    creationTime?: number;
    score: number;
    faces?: { sharpness?: number }[];
}

/**
 * 연속 촬영/거의 동일 사진을 묶어 대표 1장만 남긴다.
 * 인접(시간순) 항목이 |Δt| ≤ windowMs AND |Δscore| ≤ scoreEps 면 같은 버스트.
 * 대표 = 점수 최고(동점이면 가장 선명한 얼굴). windowMs ≤ 0 이면 원본 그대로.
 */
export function dedupeBursts<T extends BurstItem>(items: T[], windowMs: number, scoreEps: number): T[] {
    if (windowMs <= 0 || items.length < 2) return items;
    const sharp = (it: T) => it.faces?.[0]?.sharpness ?? 0;
    const sorted = [...items].sort((a, b) => (a.creationTime || 0) - (b.creationTime || 0));
    const out: T[] = [];
    let group: T[] = [];
    const flush = () => {
        if (group.length === 0) return;
        const rep = group.reduce((best, x) => {
            if (x.score > best.score + 1e-9) return x;
            if (Math.abs(x.score - best.score) <= 1e-9 && sharp(x) > sharp(best)) return x;
            return best;
        }, group[0]);
        out.push(rep);
        group = [];
    };
    for (const it of sorted) {
        if (group.length === 0) { group.push(it); continue; }
        const prev = group[group.length - 1];
        const sameBurst =
            it.creationTime != null && prev.creationTime != null &&
            Math.abs(it.creationTime - prev.creationTime) <= windowMs &&
            Math.abs(it.score - prev.score) <= scoreEps;
        if (sameBurst) group.push(it);
        else { flush(); group.push(it); }
    }
    flush();
    return out;
}

/** 오래된→최신 정렬 + 월별 섹션. ordered는 미리보기용 평면 배열(같은 순서). */
export function groupByMonth(
    items: ScanItem[],
    birthDate: string | null,
    cols: number
): { sections: MonthSection[]; ordered: ScanItem[] } {
    const withTime = items.filter((i) => !!i.creationTime);
    const noTime = items.filter((i) => !i.creationTime);
    withTime.sort((a, b) => (a.creationTime || 0) - (b.creationTime || 0));
    const ordered = [...withTime, ...noTime];

    const map = new Map<string, ScanItem[]>();
    for (const it of ordered) {
        const d = it.creationTime ? new Date(it.creationTime) : null;
        const key = d ? `${d.getFullYear()}.${pad2(d.getMonth() + 1)}` : "—";
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(it);
    }

    const sections: MonthSection[] = [];
    for (const [key, arr] of map) {
        const at = arr[0].creationTime || 0;
        sections.push({ key, title: key, ageMonths: ageMonthsAt(birthDate, at), data: chunk(arr, cols) });
    }
    return { sections, ordered };
}
