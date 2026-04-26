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
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

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
    onProgress?: (current: number, total: number) => void;
}): Promise<string> {
    const { uid, shipping, photos, totals, promoCode, locale = "EN", currency = "THB", instagram, onProgress } = params;

    if (!uid) throw new Error("User identifier (uid) is missing.");

    const authedUid = await ensureAuthed();
    const orderRef = doc(collection(db, "orders")) as DocumentReference;
    const orderId = orderRef.id;
    const dateKey = yyyymmdd();
    const orderCode = await reserveOrderCode(dateKey);

    const customerSlug = safeCustomerFolder(shipping, authedUid);
    const storageBasePath = `orders/${dateKey}/${orderCode}/${customerSlug}`;

    const safePhotosCount = Array.isArray(photos) && photos.length > 0 ? photos.length : 1;

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
        previewImages: []
    };

    if (promoCode) rawOrderData.promo = promoCode;

    await setDoc(orderRef, stripUndefined(rawOrderData));

    const userProfileRef = doc(db, "users", authedUid);
    await setDoc(userProfileRef, {
        defaultAddress: shipping,
        instagram: instagram || "",
        updatedAt: serverTimestamp()
    }, { merge: true });

    try {
        if (Platform.OS === 'web') {
            const webPhotos = Array.isArray(photos) && photos.length > 0 ? photos : [{ uri: "https://via.placeholder.com/600x600.png?text=Test+Order" }];
            const results: string[] = [];

            for (let i = 0; i < webPhotos.length; i++) {
                const p = webPhotos[i];
                const targetUri = p.uri || p.originalUri || "https://via.placeholder.com/600";

                if (targetUri.startsWith("http")) {
                    const itemRef = doc(collection(db, "orders", orderId, "items"));
                    await setDoc(itemRef, stripUndefined({
                        index: i, quantity: p.quantity || 1, filterId: "original",
                        unitPrice: totals.subtotal / safePhotosCount, lineTotal: (totals.subtotal / safePhotosCount) * (p.quantity || 1),
                        size: "20x20", assets: { printUrl: targetUri },
                        printUrl: targetUri, previewUrl: targetUri, createdAt: serverTimestamp(),
                    }));
                    results.push(targetUri);
                    if (onProgress) onProgress(i + 1, webPhotos.length);
                    continue;
                }

                const printPath = `${storageBasePath}/items/${i}_print.jpg`;
                const uploadRes = await uploadFileUriToStorage(printPath, targetUri);

                const itemRef = doc(collection(db, "orders", orderId, "items"));
                await setDoc(itemRef, stripUndefined({
                    index: i, quantity: p.quantity || 1, filterId: "original",
                    unitPrice: totals.subtotal / safePhotosCount, lineTotal: (totals.subtotal / safePhotosCount) * (p.quantity || 1),
                    size: "20x20",
                    assets: { printPath: printPath, printUrl: uploadRes.downloadUrl },
                    printUrl: uploadRes.downloadUrl,
                    previewUrl: uploadRes.downloadUrl,
                    createdAt: serverTimestamp(),
                }));
                results.push(uploadRes.downloadUrl);
                if (onProgress) onProgress(i + 1, webPhotos.length);
            }

            const previewImages = results.filter((url): url is string => url !== null).slice(0, 5);
            if (previewImages.length > 0) await updateDoc(orderRef, { previewImages, updatedAt: serverTimestamp() });

        } else {
            // 📱 [APP 전용: 하이브리드 엔진]
            const appPhotos = Array.isArray(photos) && photos.length > 0 ? photos : [];
            const results: string[] = [];

            for (let i = 0; i < appPhotos.length; i++) {
                const p = appPhotos[i];

                // ⭐️ 1. 에디터가 필터를 2048px로 정성껏 구워서 보내줬는지 확인! (있으면 이거 그대로 씀)
                let targetPrintUri = p?.output?.printUri;

                const cropRatio = p?.edits?.committed?.cropRatio;
                const originalUri = p?.originalUri || p?.sourceUri || p?.uri;

                // ⭐️ 2. 에디터가 필터 안 구워줬네? (일반 사진임) -> 그럼 여기서 4K 쌩원본 불러와서 비율대로 자름!
                if (!targetPrintUri && cropRatio && originalUri) {
                    try {
                        const trueMeta = await manipulateAsync(originalUri, []);
                        let oX = Math.floor(trueMeta.width * cropRatio.x);
                        let oY = Math.floor(trueMeta.height * cropRatio.y);
                        let cW = Math.floor(trueMeta.width * cropRatio.w);
                        let cH = Math.floor(trueMeta.height * cropRatio.h);

                        oX = Math.max(0, Math.min(oX, trueMeta.width - 1));
                        oY = Math.max(0, Math.min(oY, trueMeta.height - 1));
                        cW = Math.max(1, Math.min(cW, trueMeta.width - oX));
                        cH = Math.max(1, Math.min(cH, trueMeta.height - oY));

                        const croppedRes = await manipulateAsync(
                            originalUri,
                            [{ crop: { originX: oX, originY: oY, width: cW, height: cH } }],
                            { compress: 0.98, format: SaveFormat.JPEG }
                        );
                        targetPrintUri = croppedRes.uri;
                    } catch (err) {
                        console.error(`[4K Crop Error] Index ${i}:`, err);
                        targetPrintUri = originalUri;
                    }
                } else if (!targetPrintUri) {
                    // 최후의 보루
                    targetPrintUri = originalUri;
                }

                // ⭐️ 3. 준비된 사진(필터 구워진 거 OR 방금 4K로 자른 거)을 Storage에 업로드!
                const printPath = `${storageBasePath}/items/${i}_print.jpg`;
                const printRes = await uploadFileUriToStorage(printPath, targetPrintUri);

                const itemRef = doc(collection(db, "orders", orderId, "items"));
                await setDoc(itemRef, stripUndefined({
                    index: i, quantity: p.quantity || 1, filterId: p.edits?.filterId || "original",
                    filterParams: p.edits?.committed?.filterParams || null,
                    unitPrice: totals.subtotal / safePhotosCount, lineTotal: (totals.subtotal / safePhotosCount) * (p.quantity || 1),
                    size: "20x20",
                    assets: { printPath: printRes.path, printUrl: printRes.downloadUrl },
                    printUrl: printRes.downloadUrl,
                    previewUrl: printRes.downloadUrl, // 엑박 방지: 인터넷 주소 그대로 삽입
                    createdAt: serverTimestamp(),
                }));
                results.push(printRes.downloadUrl);

                if (onProgress) onProgress(i + 1, appPhotos.length);
            }

            const previewImages = results.filter((url): url is string => url !== null).slice(0, 5);
            if (previewImages.length > 0) await updateDoc(orderRef, { previewImages, updatedAt: serverTimestamp() });
        }
    } catch (err) {
        console.error("Upload Error:", err);
        throw err;
    }

    // 3. 쿠폰 처리 로직
    if (promoCode && promoCode.code) {
        try {
            const promoRef = doc(db, 'promoCodes', promoCode.code.toUpperCase());
            const redemptionRef = doc(db, 'promoRedemptions', `${promoCode.code.toUpperCase()}_${authedUid}`);

            await runTransaction(db, async (tx) => {
                const promoSnap = await tx.get(promoRef);
                const redSnap = await tx.get(redemptionRef);

                if (promoSnap.exists()) {
                    const currentTotal = promoSnap.data().redeemedCount || 0;
                    tx.update(promoRef, { redeemedCount: currentTotal + 1 });
                }
                if (redSnap.exists()) {
                    const currentUsage = redSnap.data().usageCount || 0;
                    tx.update(redemptionRef, { usageCount: currentUsage + 1, lastUsedAt: serverTimestamp() });
                } else {
                    tx.set(redemptionRef, { code: promoCode.code.toUpperCase(), uid: authedUid, usageCount: 1, createdAt: serverTimestamp(), lastUsedAt: serverTimestamp() });
                }
            });
        } catch (e) {
            console.error("[Checkout] Failed to redeem promo code:", e);
        }
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