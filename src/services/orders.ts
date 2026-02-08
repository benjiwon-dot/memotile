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
} from "firebase/firestore";
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
    // ⚠️ 실명 그대로 경로에 넣는 건 비추천
    // 하지만 요청대로 "가능하게" 만들되, 안전하게 슬러그 + 길이 제한
    const s = (input || "").trim().toLowerCase();
    if (!s) return "customer";

    // 영문/숫자/하이픈만 유지 (한글/태국어는 제거될 수 있음)
    const cleaned = s
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9\-]/g, "")
        .replace(/\-+/g, "-")
        .slice(0, 24);

    return cleaned || "customer";
}

/**
 * Order code: YYYYMMDD-#### (예: 20260208-0421)
 */
function generateOrderCode(): string {
    const dateKey = yyyymmdd();
    const rand = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    return `${dateKey}-${rand}`;
}

/**
 * Creates a "PAID" order and uploads photos to Storage.
 * Uses the subcollection structure: orders/{orderId}/items/{itemId}
 */
export async function createDevOrder(params: {
    uid: string;
    shipping: OrderDoc["shipping"];
    photos: any[]; // These are local photo objects from editor
    totals: {
        subtotal: number;
        discount: number;
        shippingFee: number;
        total: number;
    };
    promoCode?: {
        code: string;
        discountType: string;
        discountValue: number;
    };
    locale?: string;
}): Promise<string> {
    const { uid, shipping, photos, totals, promoCode, locale = "EN" } = params;

    if (!uid) throw new Error("User identifier (uid) is missing.");

    // 1. Generate IDs (New doc for every order)
    const orderRef = doc(collection(db, "orders")) as DocumentReference;
    const orderId = orderRef.id;
    const orderCode = generateOrderCode();

    // 2. Auth + base path (NEW)
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in");
    const uidAuth = user.uid;

    const dateKey = yyyymmdd();
    const customerSlug = slugifyCustomer(shipping?.fullName); // 원하면 나중에 nickname/phoneLast4로 교체 추천
    const storageBasePath = `orders/${dateKey}/${orderCode}/${uidAuth}/${customerSlug}/${orderId}`;
    console.log("[OrderService] storageBasePath:", storageBasePath);

    // ✅ For list preview (we'll store print urls here)
    const previewImages: string[] = [];

    // 3. Create Header document
    const rawOrderData: any = {
        uid,
        orderCode,
        itemsCount: photos.length,
        storageBasePath,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: "paid",
        currency: "THB",
        subtotal: totals.subtotal,
        discount: totals.discount,
        shippingFee: totals.shippingFee,
        total: totals.total,
        customer: {
            email: shipping.email,
            fullName: shipping.fullName,
            phone: shipping.phone,
        },
        shipping,
        payment: {
            provider: totals.total === 0 ? "PROMO_FREE" : "DEV_FREE",
            transactionId: `SIM_${orderCode}`,
            method: "FREE",
            paidAt: serverTimestamp(),
        },
        paymentMethod: "FREE",
        locale,
        promoCode: promoCode?.code,
        // previewImages will be updated after uploads
    };

    if (promoCode) {
        rawOrderData.promo = promoCode;
    }

    const orderData = stripUndefined(rawOrderData);
    if (__DEV__) console.log("order payload sanitized", orderData);

    try {
        await setDoc(orderRef, orderData);
        console.log(`[OrderService] Header ${orderId} created.`);
    } catch (e: any) {
        console.log("[OrderService] Firestore write failed", { step: "header create", code: e?.code, message: e?.message });
        throw e;
    }

    // 4. Upload PRINT assets only & Create Subcollection Items
    for (let i = 0; i < photos.length; i++) {
        const p = photos[i];

        // ✅ PRINT only
        const printUri = p.output?.printUri || p.uri;
        const printPath = `${storageBasePath}/items/${i}_print.jpg`;

        console.log(`[OrderService] Uploading PRINT item ${i}...`);

        const printRes = await uploadFileUriToStorage(printPath, printUri);

        // ✅ Use print URL as preview for UI compatibility
        if (printRes?.downloadUrl && previewImages.length < 5) {
            previewImages.push(printRes.downloadUrl);
        }

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
                printPath: printRes.path,
                printUrl: printRes.downloadUrl,
            },
            printUrl: printRes.downloadUrl,
            // ✅ keep existing UI working
            previewUrl: printRes.downloadUrl,
        };

        const itemData = stripUndefined({
            ...rawItemData,
            createdAt: serverTimestamp()
        });

        try {
            await setDoc(itemRef, itemData);
        } catch (e: any) {
            console.log("[OrderService] Firestore write failed", { step: "item create", code: e?.code, message: e?.message });
            throw e;
        }
    }

    // 5. Update header with previewImages (from print urls)
    try {
        if (previewImages.length > 0) {
            await updateDoc(orderRef, stripUndefined({
                previewImages,
                updatedAt: serverTimestamp(),
            }) as any);
            console.log(`[OrderService] Header ${orderId} updated with previewImages (${previewImages.length}).`);
        }
    } catch (e: any) {
        console.log("[OrderService] Header previewImages update failed", { orderId, code: e?.code, message: e?.message });
    }

    console.log(`[OrderService] All items for ${orderId} uploaded and saved.`);
    return orderId;
}

/**
 * Retrieves a single order by ID, with subcollection fallback.
 */
export async function getOrder(orderId: string): Promise<OrderDoc | null> {
    const docRef = doc(db, "orders", orderId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;

    const order = { id: snap.id, ...snap.data() } as OrderDoc;

    // Load subcollection items
    const itemsSnap = await getDocs(collection(db, "orders", orderId, "items"));
    if (!itemsSnap.empty) {
        order.items = itemsSnap.docs
            .map(d => d.data() as OrderItem)
            .sort((a, b) => a.index - b.index);
    }

    return order;
}

/**
 * Lists all orders for a specific user.
 * Note: Subcollection items are not loaded here for performance.
 */
export async function listOrders(uid: string): Promise<OrderDoc[]> {
    const q = query(
        collection(db, "orders"),
        where("uid", "==", uid),
        orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as OrderDoc));
}

/**
 * Subscribes to a specific order doc.
 */
export function subscribeOrder(orderId: string, onUpdate: (order: OrderDoc | null) => void) {
    const docRef = doc(db, "orders", orderId);
    return onSnapshot(docRef, async (snap) => {
        if (!snap.exists()) {
            onUpdate(null);
        } else {
            const order = { id: snap.id, ...snap.data() } as OrderDoc;
            const itemsSnap = await getDocs(collection(db, "orders", orderId, "items"));
            if (!itemsSnap.empty) {
                order.items = itemsSnap.docs
                    .map(d => d.data() as OrderItem)
                    .sort((a, b) => a.index - b.index);
            }
            onUpdate(order);
        }
    });
}
