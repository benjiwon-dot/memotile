// src/services/albumDraft.ts
//
// 앨범 빌더로 넘길 선택 사진 + 옵션. 메모리 store + AsyncStorage 영구저장(앱 종료 후 "이어서 하기").
// 세터가 바뀔 때마다 디바운스 저장 → 어느 시점에 앱이 죽어도 AI 앨범이 살아남음.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ScanItem } from "../types/scan";
import { AlbumSize, CoverType } from "../config/photobookPricing";

export type CoverStyle = "photo" | "style" | "logo" | "text"; // 풀사진 / 스타일프레임 / 미니멀로고 / 커스텀글
export interface AlbumOptions {
    size: AlbumSize;
    cover: CoverType;
    coverStyle: CoverStyle;
    coverPhotoId: string | null; // null이면 첫 사진
    coverFocusX: number;         // 표지 사진 크롭 초점 0~1 (기본 얼굴 중심)
    coverFocusY: number;
    coverZoom: number;           // 표지 크롭 확대 ≥1
    title: string;
    density?: string;            // 프리뷰 밀도 프리셋(relaxed/balanced/rich) — 주문 payload/서버 PDF 재현용
}

// 사진별 크롭 좌표 — 실제 픽셀을 자르지 않고 좌표만 저장(데이터 부담 ~0). 표지도 같은 구조(coverFocusX/Y/Zoom).
export interface PhotoCrop { fx: number; fy: number; zoom: number; } // 0~1 초점 + 확대(≥1)

const PB_DRAFT_KEY = "memotile_photobook_draft";
function defaultOptions(title: string): AlbumOptions {
    return { size: "A4", cover: "soft", coverStyle: "photo", coverPhotoId: null, coverFocusX: 0.5, coverFocusY: 0.5, coverZoom: 1, title };
}

let _items: ScanItem[] = [];
let _subjectName = "";
let _crops: Record<string, PhotoCrop> = {}; // assetId → crop (없으면 얼굴 자동중심 기본값 사용)
let _options: AlbumOptions = defaultOptions("");

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 이어서 하기 유효기간 = 24시간(하루 지나면 만료)

// ── 영구저장 (디바운스) ──
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
        try {
            if (!_items || _items.length === 0) { await AsyncStorage.removeItem(PB_DRAFT_KEY); return; }
            const payload = JSON.stringify({ items: _items, subjectName: _subjectName, crops: _crops, options: _options, savedAt: Date.now() });
            await AsyncStorage.setItem(PB_DRAFT_KEY, payload);
        } catch { /* 저장 실패는 무시(다음 세터에서 재시도) */ }
    }, 400);
}

// 만료(>24h)면 삭제하고 false. 유효하면 파싱된 draft 반환.
async function readFreshDraft(): Promise<any | null> {
    const raw = await AsyncStorage.getItem(PB_DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!Array.isArray(d?.items) || d.items.length === 0) return null;
    if (d.savedAt && Date.now() - d.savedAt > DRAFT_TTL_MS) { // 하루 지남 → 만료
        try { await AsyncStorage.removeItem(PB_DRAFT_KEY); } catch { /* 무시 */ }
        return null;
    }
    return d;
}

/** 저장된 포토북 draft가 있나 (홈 배너 표시 판단, 만료 반영) */
export async function hasAlbumDraft(): Promise<boolean> {
    try { return (await readFreshDraft()) != null; } catch { return false; }
}

/** 저장된 draft를 메모리 store로 복원 → 프리뷰로 이어서. 성공 시 true */
export async function loadAlbumDraft(): Promise<boolean> {
    try {
        const d = await readFreshDraft();
        if (!d) return false;
        _items = d.items;
        _subjectName = d.subjectName || "";
        _crops = d.crops || {};
        _options = { ...defaultOptions(_subjectName), ...(d.options || {}) };
        return true;
    } catch { return false; }
}

/** 주문 완료/새 앨범 시작 시 draft 비우기 */
export async function clearAlbumDraft(): Promise<void> {
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    _items = [];
    _crops = {};
    _subjectName = "";
    _options = defaultOptions("");
    try { await AsyncStorage.removeItem(PB_DRAFT_KEY); } catch { /* 무시 */ }
}

export function setAlbumDraft(items: ScanItem[], subjectName: string) {
    _items = items;
    _subjectName = subjectName;
    _crops = {};
    _options = defaultOptions(subjectName); // 제목 기본 = 프로필 이름
    persist();
}

// 사진별 크롭 (수동 조정 시 저장). 없으면 화면/인쇄에서 얼굴 자동중심 기본값 사용.
export function setPhotoCrop(assetId: string, crop: PhotoCrop) { _crops[assetId] = crop; persist(); }
export function getPhotoCrop(assetId: string): PhotoCrop | undefined { return _crops[assetId]; }
export function getAllCrops(): Record<string, PhotoCrop> { return _crops; }
export function replaceCrops(map: Record<string, PhotoCrop>) { _crops = { ...map }; persist(); } // undo/redo 동기화
export function setAlbumItems(items: ScanItem[]) { _items = items; persist(); } // 프리뷰에서 사진 제거/재배치 시 동기화
export function getAlbumDraft(): { items: ScanItem[]; subjectName: string } {
    return { items: _items, subjectName: _subjectName };
}
export function setAlbumOptions(o: Partial<AlbumOptions>) { _options = { ..._options, ...o }; persist(); }
export function getAlbumOptions(): AlbumOptions { return _options; }
