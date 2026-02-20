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
    instagram?: string;
}): Promise<string> {
    const { uid, shipping, photos, totals, promoCode, locale = "EN", instagram } = params;

    if (!uid) throw new Error("User identifier (uid) is missing.");

    const authedUid = await ensureAuthed();

    const orderRef = doc(collection(db, "orders")) as DocumentReference;
    const orderId = orderRef.id;
    const dateKey = yyyymmdd();
    const orderCode = await reserveOrderCode(dateKey);

    const customerSlug = safeCustomerFolder(shipping, authedUid);
    const storageBasePath = `orders/${dateKey}/${orderCode}/${customerSlug}`;

    const safePhotosCount = Array.isArray(photos) && photos.length > 0 ? photos.length : 1;

    // 1. 공통 주문 데이터 구성 (앱/웹 모두 사용)
    const rawOrderData: any = {
        uid: authedUid,
        orderCode,
        itemsCount: safePhotosCount,
        storageBasePath,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: "paid",
        currency: "THB",
        subtotal: totals.subtotal,
        discount: totals.discount,
        shippingFee: totals.shippingFee,
        total: totals.total,
        customer: { email: shipping.email, fullName: shipping.fullName, phone: shipping.phone },
        shipping,
        payment: {
            provider: totals.total === 0 ? "PROMO_FREE" : "DEV_FREE",
            transactionId: `SIM_${orderCode}`,
            method: "FREE",
            paidAt: serverTimestamp()
        },
        paymentMethod: "FREE",
        locale,
        instagram,
    };

    if (promoCode) rawOrderData.promo = promoCode;

    // ⭐️ 주문을 가장 먼저 DB에 박아버립니다 (My Order 리스트 표시 보장)
    await setDoc(orderRef, stripUndefined(rawOrderData));

    const userProfileRef = doc(db, "users", authedUid);
    const today = new Date();
    const formattedDate = `${today.getFullYear()}. ${String(today.getMonth() + 1).padStart(2, '0')}. ${String(today.getDate()).padStart(2, '0')}`;
    await setDoc(userProfileRef, {
        defaultAddress: shipping,
        instagram: instagram || "",
        lastPayment: { method: totals.total === 0 ? "Promo Code" : "PromptPay", date: formattedDate },
        updatedAt: serverTimestamp()
    }, { merge: true });

    // ---------------------------------------------------------
    // 2. 플랫폼 분기: 웹(Paymentwall 심사) vs 앱(정상 서비스)
    // ---------------------------------------------------------

    if (Platform.OS === 'web') {
        // ✅ [웹 전용] 업로드 에러를 피하면서, 고객이 올린 원본 사진을 그대로 Success 페이지로 넘기기
        const previewImages: string[] = [];
        const safePhotos = Array.isArray(photos) && photos.length > 0 ? photos : [{ uri: "https://via.placeholder.com/300" }];

        for (let i = 0; i < safePhotos.length; i++) {
            const p = safePhotos[i];
            const fallbackUri = p.uri || p.originalUri || "https://via.placeholder.com/300";
            if (i < 5) previewImages.push(fallbackUri);

            const itemRef = doc(collection(db, "orders", orderId, "items"));
            await setDoc(itemRef, stripUndefined({
                index: i,
                quantity: p.quantity || 1,
                filterId: "original",
                unitPrice: totals.subtotal / safePhotosCount,
                lineTotal: (totals.subtotal / safePhotosCount) * (p.quantity || 1),
                size: "20x20",
                assets: {
                    sourceUrl: fallbackUri,
                    viewUrl: fallbackUri,
                    printUrl: fallbackUri
                },
                printUrl: fallbackUri,
                previewUrl: fallbackUri,
                uri: fallbackUri,
                createdAt: serverTimestamp(),
            }));
        }

        if (previewImages.length > 0) {
            await updateDoc(orderRef, stripUndefined({ previewImages, updatedAt: serverTimestamp() }) as any);
        }
        return orderId;
    }

    // 📱 [앱 전용] 모바일에서는 정상적으로 고화질 사진을 Storage에 3단계 업로드
    try {
        const uploadTasks = photos.map(async (p, i) => {
            const viewUri = p?.output?.viewUri || p?.uri; // fallback uri
            if (!viewUri) throw new Error(`VIEW URI missing at index ${i}`);

            const printUri = p?.output?.printUri || viewUri;
            const sourceUri = getSourceUri(p) || viewUri; // fallback uri

            const viewPath = `${storageBasePath}/items/${i}_view.jpg`;
            const sourcePath = `${storageBasePath}/items/${i}_source.jpg`;
            const printPath = `${storageBasePath}/items/${i}_print.jpg`;

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
                filterParams: p.edits?.committed?.filterParams || p.edits?.filterParams || null,
                cropPx: p.edits?.committed?.cropPx || null,
                unitPrice: totals.subtotal / photos.length || 0,
                lineTotal: (totals.subtotal / photos.length || 0) * (p.quantity || 1),
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
            return viewRes.downloadUrl;
        });

        const results = await Promise.all(uploadTasks);
        const previewImages = results.filter((url) => url !== null).slice(0, 5) as string[];

        if (previewImages.length > 0) {
            await updateDoc(orderRef, stripUndefined({ previewImages, updatedAt: serverTimestamp() }) as any);
        }
    } catch (err) {
        console.error("App Upload Error:", err);
        throw err;
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