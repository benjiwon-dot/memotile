// src/services/aiSubjects.ts
//
// AI 포토북 프로필 CRUD. 별도 컬렉션 aiSubjects + Storage aiSubjects/{uid}/...
// 기존 orders / 결제 / 인쇄 파이프라인과 완전히 분리.
import { collection, doc, setDoc, updateDoc, getDoc, deleteDoc, serverTimestamp, getDocs, query, where } from "firebase/firestore";
import { ref as storageRef, listAll, deleteObject } from "firebase/storage";
import { db, auth, storage } from "../lib/firebase";
import { uploadFileUriToStorage } from "./storageUpload";
import {
    AiSubject,
    SubjectGender,
    SubjectKind,
    PhotoRef,
    SUBJECT_SCHEMA_VERSION,
} from "../types/aiSubject";

/** 화면에서 모아 넘기는 로컬 입력값 (업로드 전) */
export interface SubjectPhotoInput {
    uri: string;
    localId?: string | null;
    width?: number;
    height?: number;
    keepRef?: PhotoRef;   // 편집 시: 이미 업로드된 사진은 재업로드 없이 그대로 유지
}

export interface SubjectDraft {
    name: string;
    birthDate: string | null;
    gender: SubjectGender;
    kind?: SubjectKind;            // 기본 baby
    cover: SubjectPhotoInput | null;
    anchors: SubjectPhotoInput[];  // 자유 그리드
}

export interface CreateProgress {
    done: number;
    total: number;
}

async function uploadOne(path: string, input: SubjectPhotoInput): Promise<PhotoRef> {
    const { downloadUrl } = await uploadFileUriToStorage(path, input.uri);
    return {
        storagePath: path,
        url: downloadUrl,
        width: input.width,
        height: input.height,
        localId: input.localId ?? null,
    };
}

/** 프로필 생성: 사진 업로드 후 Firestore 문서 작성. subjectId 반환. */
export async function createSubject(
    draft: SubjectDraft,
    onProgress?: (p: CreateProgress) => void
): Promise<string> {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error("AUTH_REQUIRED");
    if (!draft.name?.trim()) throw new Error("NAME_REQUIRED");

    const subjectRef = doc(collection(db, "aiSubjects"));
    const subjectId = subjectRef.id;
    const base = `aiSubjects/${uid}/${subjectId}`;

    const total = (draft.cover ? 1 : 0) + draft.anchors.length;
    let done = 0;
    const tick = () => onProgress?.({ done: ++done, total });

    let cover: PhotoRef | null = null;
    if (draft.cover) {
        cover = await uploadOne(`${base}/cover.jpg`, draft.cover);
        tick();
    }

    const anchors: PhotoRef[] = [];
    for (let i = 0; i < draft.anchors.length; i++) {
        anchors.push(await uploadOne(`${base}/anchors/${i}.jpg`, draft.anchors[i]));
        tick();
    }

    const docData: AiSubject = {
        ownerUid: uid,
        kind: draft.kind ?? "baby",
        name: draft.name.trim(),
        birthDate: draft.birthDate || null,
        gender: draft.gender,
        cover,
        anchors,
        anchorCount: anchors.length,
        status: cover || anchors.length > 0 ? "ready" : "draft",
        schemaVersion: SUBJECT_SCHEMA_VERSION,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    };

    await setDoc(subjectRef, docData);
    return subjectId;
}

async function uploadOrKeep(path: string, input: SubjectPhotoInput): Promise<PhotoRef> {
    if (input.keepRef) return input.keepRef;
    return uploadOne(path, input);
}

/** 단일 프로필 조회 (편집 prefill용) */
export async function getSubject(id: string): Promise<AiSubject | null> {
    const snap = await getDoc(doc(db, "aiSubjects", id));
    return snap.exists() ? ({ id: snap.id, ...(snap.data() as AiSubject) }) : null;
}

/** 프로필 수정: 새로 고른 사진만 업로드, 유지 사진은 keepRef로 재사용. createdAt 보존(updateDoc). */
export async function updateSubject(
    id: string,
    draft: SubjectDraft,
    onProgress?: (p: CreateProgress) => void
): Promise<void> {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error("AUTH_REQUIRED");
    if (!draft.name?.trim()) throw new Error("NAME_REQUIRED");

    const base = `aiSubjects/${uid}/${id}`;
    const stamp = Date.now();
    const total = (draft.cover && !draft.cover.keepRef ? 1 : 0) + draft.anchors.filter((a) => !a.keepRef).length;
    let done = 0;
    const tick = () => onProgress?.({ done: ++done, total });

    let cover: PhotoRef | null = null;
    if (draft.cover) {
        cover = await uploadOrKeep(`${base}/cover_${stamp}.jpg`, draft.cover);
        if (!draft.cover.keepRef) tick();
    }

    const anchors: PhotoRef[] = [];
    for (let i = 0; i < draft.anchors.length; i++) {
        const a = draft.anchors[i];
        anchors.push(await uploadOrKeep(`${base}/anchors/${stamp}_${i}.jpg`, a));
        if (!a.keepRef) tick();
    }

    await updateDoc(doc(db, "aiSubjects", id), {
        name: draft.name.trim(),
        birthDate: draft.birthDate || null,
        gender: draft.gender,
        kind: draft.kind ?? "baby",
        cover,
        anchors,
        anchorCount: anchors.length,
        status: cover || anchors.length > 0 ? "ready" : "draft",
        updatedAt: serverTimestamp(),
    });
}

function toMs(ts: any): number {
    if (!ts) return 0;
    if (typeof ts.toMillis === "function") return ts.toMillis();
    if (typeof ts.seconds === "number") return ts.seconds * 1000;
    const n = Date.parse(ts);
    return isNaN(n) ? 0 : n;
}

/** 내 프로필 목록 (홈 AI 카드 / 프로필 화면에서 사용).
 *  단일 필드 where만 사용 → 복합 인덱스 불필요. 정렬은 클라이언트에서 createdAt 내림차순. */
export async function listMySubjects(): Promise<AiSubject[]> {
    const uid = auth.currentUser?.uid;
    if (!uid) return [];
    const q = query(collection(db, "aiSubjects"), where("ownerUid", "==", uid));
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as AiSubject) }));
    return list.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
}

/** Storage 폴더 재귀 삭제 (cover + anchors) */
async function deleteFolder(path: string): Promise<void> {
    const r = storageRef(storage, path);
    const res = await listAll(r);
    await Promise.all(res.items.map((it) => deleteObject(it).catch(() => { })));
    await Promise.all(res.prefixes.map((p) => deleteFolder(p.fullPath)));
}

/** 프로필 삭제: Storage 사진(재귀) + Firestore 문서. */
export async function deleteSubject(id: string): Promise<void> {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error("AUTH_REQUIRED");
    try {
        await deleteFolder(`aiSubjects/${uid}/${id}`);
    } catch (e) {
        console.warn("[aiSubjects] storage delete failed (continuing):", e);
    }
    await deleteDoc(doc(db, "aiSubjects", id));
}
