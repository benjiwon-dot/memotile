// src/services/orders.ts
import {
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    query,
    where,
    orderBy,
    onSnapshot,
    serverTimestamp,
    DocumentReference,
    updateDoc,
    runTransaction,
} from "firebase/firestore";

import { onAuthStateChanged } from "firebase/auth";
import { Platform } from "react-native";

import { db, auth } from "../lib/firebase";
import { OrderDoc, OrderItem } from "../types/order";
import { uploadFileUriToStorage } from "./storageUpload";
import { stripUndefined } from "../utils/firestore";

function yyyymmdd(d = new Date()): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
}

function slugifyCustomer(input?: string): string {
    const s = (input || "").trim().toLowerCase();
    if (!s) return "customer";
    const cleaned = s
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9\-_]/g, "")
        .replace(/-+/g, "-")
        .slice(0, 32);
    return cleaned || "customer";
}

function safeCustomerFolder(shipping: any, uid: string) {
    const base = slugifyCustomer(shipping?.fullName);
    const phone = (shipping?.phone || "").replace(/\D/g, "");
    const tail4 = phone.length >= 4 ? phone.slice(-4) : "";
    const uid6 = (uid || "").slice(0, 6);
    if (base !== "customer") return tail4 ? `${base}-${tail4}` : `${base}-${uid6 || "u"}`;
    return tail4 ? `customer-${tail4}` : `customer-${uid6 || "u"}`;
}

function getSourceUri(p: any): string | null {
    const u = p?.output?.sourceUri || p?.originalUri || p?.uri || null;
    return typeof u === "string" && u.length > 0 ? u : null;
}

async function ensureAuthed(): Promise<string> {
    if (auth.currentUser?.uid) {
        await auth.currentUser.getIdToken(true);
        return auth.currentUser.uid;
    }
    const user = await new Promise<any>((resolve) => {
        const unsub = onAuthStateChanged(auth, (u) => {
            unsub();
            resolve(u);
        });
    });
    if (!user?.uid) throw new Error("Not signed in");
    await user.getIdToken(true);
    return user.uid;
}

async function reserveOrderCode(dateKey: string): Promise<string> {
    const counterRef = doc(db, "orderCounters", dateKey);
    const { seq } = await runTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef);
        if (!snap.exists()) {
            tx.set(counterRef, { nextSeq: 2 });
            return { seq: 1 };
        }
        const nextSeq = Number((snap.data() as any)?.nextSeq ?? 1);
        tx.update(counterRef, { nextSeq: nextSeq + 1 });
        return { seq: nextSeq };
    });
    return `${dateKey}-${String(seq).padStart(4, "0")}`;
}

export async function createDevOrder(params: {
    uid: string;
    shipping: OrderDoc["shipping"];
    photos: any[];
    totals: { subtotal: number; discount: number; shippingFee: number; total: number };
    promoCode?: { code: string; discountType: string; discountValue: number };
    locale?: string;
    currency?: string;
    instagram?: string;
}): Promise<string> {
    const { uid, shipping, photos, totals, promoCode, locale = "EN", currency = "THB", instagram } = params;

    if (!uid) throw new Error("User identifier (uid) is missing.");
    const authedUid = await ensureAuthed();

    const orderRef = doc(collection(db, "orders")) as DocumentReference;
    const orderId = orderRef.id;
    const dateKey = yyyymmdd();
    const orderCode = await reserveOrderCode(dateKey);

    const customerSlug = safeCustomerFolder(shipping, authedUid);
    const storageBasePath = `orders/${dateKey}/${orderCode}/${customerSlug}`;

    const safePhotosCount = Array.isArray(photos) && photos.length > 0 ? photos.length : 1;

    // 1. 공통 주문 데이터 구성
    const rawOrderData: any = {
        uid: authedUid,
        orderCode,
        itemsCount: safePhotosCount,
        storageBasePath,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: "paid",
        currency: currency,
        subtotal: totals.subtotal,
        discount: totals.discount,
        shippingFee: totals.shippingFee,
        total: totals.total,
        customer: { email: shipping.email, fullName: shipping.fullName, phone: shipping.phone },
        shipping,
        payment: {
            provider: totals.total === 0 ? "PROMO_FREE" : "CREDIT_CARD",
            transactionId: `SIM_${orderCode}`,
            method: "CARD",
            paidAt: serverTimestamp()
        },
        paymentMethod: "CARD",
        locale,
        instagram,
        previewImages: [] // 초기화
    };

    if (promoCode) rawOrderData.promo = promoCode;

    // 주문 메인 문서 생성
    await setDoc(orderRef, stripUndefined(rawOrderData));

    // 유저 프로필 업데이트
    const userProfileRef = doc(db, "users", authedUid);
    await setDoc(userProfileRef, {
        defaultAddress: shipping,
        instagram: instagram || "",
        updatedAt: serverTimestamp()
    }, { merge: true });

    // ⭐️ [수정 핵심] 웹/앱 통합 업로드 로직
    // 이제 웹에서도 placeholder가 아닌 진짜 Storage 업로드를 실행합니다.
    try {
        const safePhotos = Array.isArray(photos) && photos.length > 0 ? photos : [];

        const uploadTasks = safePhotos.map(async (p, i) => {
            const viewUri = p?.output?.viewUri || p?.uri;
            if (!viewUri) return null;

            const printUri = p?.output?.printUri || viewUri;
            const sourceUri = getSourceUri(p) || viewUri;

            const viewPath = `${storageBasePath}/items/${i}_view.jpg`;
            const sourcePath = `${storageBasePath}/items/${i}_source.jpg`;
            const printPath = `${storageBasePath}/items/${i}_print.jpg`;

            // Storage 업로드 실행 (storageUpload.ts 내 함수)
            const [sourceRes, viewRes, printRes] = await Promise.all([
                uploadFileUriToStorage(sourcePath, sourceUri),
                uploadFileUriToStorage(viewPath, viewUri),
                uploadFileUriToStorage(printPath, printUri),
            ]);

            const itemRef = doc(collection(db, "orders", orderId, "items"));
            const rawItemData: any = {
                index: i,
                quantity: p.quantity || 1,
                filterId: p.edits?.filterId || "original",
                unitPrice: totals.subtotal / safePhotosCount,
                lineTotal: (totals.subtotal / safePhotosCount) * (p.quantity || 1),
                size: "20x20",
                assets: {
                    sourcePath: sourceRes.path, sourceUrl: sourceRes.downloadUrl,
                    viewPath: viewRes.path, viewUrl: viewRes.downloadUrl,
                    printPath: printRes.path, printUrl: printRes.downloadUrl,
                },
                printUrl: printRes.downloadUrl,
                previewUrl: viewRes.downloadUrl,
                createdAt: serverTimestamp(),
            };

            await setDoc(itemRef, stripUndefined(rawItemData));
            return viewRes.downloadUrl; // 썸네일용 URL 반환
        });

        const results = await Promise.all(uploadTasks);
        const validUrls = results.filter((url): url is string => url !== null);
        const previewImages = validUrls.slice(0, 5);

        // 메인 주문 문서에 영구 사진 주소 리스트 저장 (이게 되어야 리스트에서 사진이 보임)
        if (previewImages.length > 0) {
            await updateDoc(orderRef, {
                previewImages,
                updatedAt: serverTimestamp()
            });
        }
    } catch (err) {
        console.error("Upload Error (Web/App):", err);
    }

    return orderId;
}

export async function getOrder(orderId: string): Promise<OrderDoc | null> {
    const docRef = doc(db, "orders", orderId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    const order = { id: snap.id, ...snap.data() } as OrderDoc;
    const itemsSnap = await getDocs(collection(db, "orders", orderId, "items"));
    if (!itemsSnap.empty) {
        order.items = itemsSnap.docs.map((d) => d.data() as OrderItem).sort((a, b) => a.index - b.index);
    }
    return order;
}

export async function listOrders(uid: string): Promise<OrderDoc[]> {
    const q = query(collection(db, "orders"), where("uid", "==", uid), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as OrderDoc));
}

export function subscribeOrder(orderId: string, onUpdate: (order: OrderDoc | null) => void) {
    const docRef = doc(db, "orders", orderId);
    return onSnapshot(docRef, async (snap) => {
        if (!snap.exists()) return onUpdate(null);
        const order = { id: snap.id, ...snap.data() } as OrderDoc;
        const itemsSnap = await getDocs(collection(db, "orders", orderId, "items"));
        if (!itemsSnap.empty) {
            order.items = itemsSnap.docs.map((d) => d.data() as OrderItem).sort((a, b) => a.index - b.index);
        }
        onUpdate(order);
    });
}