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
} from "firebase/firestore";
import { db, auth } from "../lib/firebase";
import { OrderDoc, OrderItem } from "../types/order";
import { buildOrderStorageBasePath, buildItemPreviewPath, buildItemPrintPath } from "../utils/storagePaths";
import { uploadFileUriToStorage } from "./storageUpload";
import { stripUndefined } from "../utils/firestore";

/**
 * Generates a random 7-character alphanumeric string.
 */
function generateOrderCode(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < 7; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
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

    // 2. Storage base path
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in");
    const uidAuth = user.uid;
    const storageBasePath = `orders/${uidAuth}/${orderId}`;
    console.log("[OrderService] storageBasePath:", storageBasePath);

    // 3. Create Header document (No file:// URIs)
    const rawOrderData: Omit<OrderDoc, "id" | "items"> = {
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
    };

    if (promoCode) {
        (rawOrderData as any).promo = promoCode;
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

    // 4. Upload Assets & Create Subcollection Items
    for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        const previewUri = p.output?.previewUri || p.uri;
        const printUri = p.output?.printUri || p.uri;

        const previewPath = `${storageBasePath}/items/${i}_preview.jpg`;
        const printPath = `${storageBasePath}/items/${i}_print.jpg`;

        console.log(`[OrderService] Uploading item ${i}...`);

        const [previewRes, printRes] = await Promise.all([
            uploadFileUriToStorage(previewPath, previewUri),
            uploadFileUriToStorage(printPath, printUri)
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
                previewPath: previewRes.path,
                previewUrl: previewRes.downloadUrl,
                printPath: printRes.path,
                printUrl: printRes.downloadUrl
            },
            // Metadata for easy access (no local file:// URIs)
            previewUrl: previewRes.downloadUrl,
            printUrl: printRes.downloadUrl,
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
 * They should be fetched via getOrder on clinical detail view.
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
            // Async fetch items for subscription
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
