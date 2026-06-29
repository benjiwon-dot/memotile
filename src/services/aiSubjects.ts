// src/services/aiSubjects.ts
//
// AI 포토북 대상(아이) 프로필 CRUD. 별도 컬렉션 aiSubjects + Storage aiSubjects/{uid}/...
// 기존 orders / 결제 / 인쇄 파이프라인과 완전히 분리.
import { collection, doc, setDoc, serverTimestamp, getDocs, query, where, orderBy } from "firebase/firestore";
import { db, auth } from "../lib/firebase";
import { uploadFileUriToStorage } from "./storageUpload";
import {
    AiSubject,
    AgeBucketId,
    SubjectGender,
    PhotoRef,
    SubjectAnchors,
    AGE_BUCKETS,
    SUBJECT_SCHEMA_VERSION,
} from "../types/aiSubject";

/** 화면에서 모아 넘기는 로컬 입력값 (업로드 전) */
export interface SubjectPhotoInput {
    uri: string;
    localId?: string | null;
    width?: number;
    height?: number;
}

export interface SubjectDraft {
    name: string;
    birthDate: string | null;
    gender: SubjectGender;
    cover: SubjectPhotoInput | null;
    anchors: Record<AgeBucketId, SubjectPhotoInput[]>;
}

export interface CreateProgress {
    done: number;
    total: number;
}

function countPhotos(draft: SubjectDraft): number {
    let n = draft.cover ? 1 : 0;
    for (const b of AGE_BUCKETS) n += draft.anchors[b.id]?.length ?? 0;
    return n;
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

/**
 * 아이 프로필 생성: 사진 업로드 후 Firestore 문서 작성. subjectId 반환.
 */
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

    const total = countPhotos(draft);
    let done = 0;
    const tick = () => onProgress?.({ done: ++done, total });

    // 대표 사진
    let cover: PhotoRef | null = null;
    if (draft.cover) {
        cover = await uploadOne(`${base}/cover.jpg`, draft.cover);
        tick();
    }

    // 연령 구간별 앵커
    const anchors: SubjectAnchors = { "0-3m": [], "3-12m": [], "1-2y": [], "2-3y": [] };
    let anchorCount = 0;
    for (const bucket of AGE_BUCKETS) {
        const list = draft.anchors[bucket.id] ?? [];
        for (let i = 0; i < list.length; i++) {
            const ref = await uploadOne(`${base}/anchors/${bucket.id}/${i}.jpg`, list[i]);
            anchors[bucket.id].push(ref);
            anchorCount++;
            tick();
        }
    }

    const docData: AiSubject = {
        ownerUid: uid,
        kind: "baby",
        name: draft.name.trim(),
        birthDate: draft.birthDate || null,
        gender: draft.gender,
        cover,
        anchors,
        anchorCount,
        status: anchorCount > 0 ? "ready" : "draft",
        schemaVersion: SUBJECT_SCHEMA_VERSION,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    };

    await setDoc(subjectRef, docData);
    return subjectId;
}

/** 내 대상 목록 (향후 photobook 홈/스캔에서 사용) */
export async function listMySubjects(): Promise<AiSubject[]> {
    const uid = auth.currentUser?.uid;
    if (!uid) return [];
    const q = query(
        collection(db, "aiSubjects"),
        where("ownerUid", "==", uid),
        orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as AiSubject) }));
}
