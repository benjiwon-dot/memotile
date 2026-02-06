// Server-only. Do not import in Expo client.
import { adminDb } from "./firebaseAdmin";
import {
    OrderHeader,
    OrderDetail,
    OrderItemAdmin,
    OrderStatus,
    ListOrdersParams
} from "../src/lib/admin/types";

/**
 * Normalizes Firestore timestamps to ISO strings.
 */
function toISO(ts: any): string {
    if (!ts) return new Date().toISOString();
    if (typeof ts.toDate === "function") return ts.toDate().toISOString();
    if (ts instanceof Date) return ts.toISOString();
    if (typeof ts === "string") return ts;
    if (typeof ts === "number") return new Date(ts).toISOString();
    return new Date().toISOString();
}

/**
 * Normalizes customer data from various legacy formats.
 */
function normalizeCustomer(data: any): any {
    return {
        fullName: data.customer?.fullName || data.customer?.name || data.shipping?.fullName || "Guest",
        email: data.customer?.email || data.uid || "no-email",
        phone: data.customer?.phone || data.shipping?.phone || "",
    };
}

export async function listOrders(params: ListOrdersParams): Promise<{ rows: OrderHeader[]; nextCursor?: string }> {
    const { q, status, country, limit = 20, from, to, sort = "desc", mode } = params;

    let query: FirebaseFirestore.Query = adminDb.collection("orders");

    // Queue mode: if mode=queue and no specific status, show PROCESSING + PRINTED
    if (mode === "queue" && (!status || status === "ALL")) {
        query = query.where("status", "in", ["processing", "printed"]);
    } else if (status && status !== "ALL") {
        query = query.where("status", "==", status);
    }

    // Exact match for orderCode
    if (q && q.trim().length > 0) {
        query = query.where("orderCode", "==", q.trim().toUpperCase());
    }

    // Date Filtering (createdAt)
    if (from || to) {
        if (from) {
            const fromDate = new Date(from);
            fromDate.setHours(0, 0, 0, 0);
            query = query.where("createdAt", ">=", fromDate);
        }
        if (to) {
            const toDate = new Date(to);
            toDate.setHours(23, 59, 59, 999);
            query = query.where("createdAt", "<=", toDate);
        }
    }

    // Sort
    query = query.orderBy("createdAt", sort);

    const snap = await query.limit(limit).get();

    let rows: OrderHeader[] = snap.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            orderCode: data.orderCode || doc.id.slice(-7).toUpperCase(),
            status: data.status as OrderStatus,
            createdAt: toISO(data.createdAt),
            updatedAt: toISO(data.updatedAt),
            uid: data.uid,
            currency: data.currency || "THB",
            pricing: data.pricing || {
                subtotal: data.subtotal || 0,
                shippingFee: data.shippingFee || 0,
                discount: data.discount || 0,
                total: data.total || 0,
            },
            customer: normalizeCustomer(data),
            shipping: data.shipping || {},
            payment: {
                provider: data.payment?.provider || data.paymentMethod || "UNKNOWN",
                transactionId: data.payment?.transactionId || "",
                method: data.payment?.method || "",
                paidAt: toISO(data.payment?.paidAt),
            },
            itemsCount: data.itemsCount || data.items?.length || 0,
            storageBasePath: data.storageBasePath,
            locale: data.locale || "EN",
            adminNote: data.adminNote,
            trackingNumber: data.trackingNumber,
            refundedAt: toISO(data.refundedAt),
            canceledAt: toISO(data.canceledAt),
        };
    });

    // Additional filter for country in memory (since Firestore doesn't support complex composite filters without index)
    if (country && country !== "ALL") {
        rows = rows.filter(r => r.shipping?.country === country);
    }

    return { rows };
}

export async function getOrderDetail(orderId: string): Promise<OrderDetail | null> {
    const docRef = adminDb.collection("orders").doc(orderId);
    const doc = await docRef.get();

    if (!doc.exists) return null;

    const data = doc.data()!;
    const header: OrderHeader = {
        id: doc.id,
        orderCode: data.orderCode || doc.id.slice(-7).toUpperCase(),
        status: data.status as OrderStatus,
        createdAt: toISO(data.createdAt),
        updatedAt: toISO(data.updatedAt),
        uid: data.uid,
        currency: data.currency || "THB",
        pricing: data.pricing || {
            subtotal: data.subtotal || 0,
            shippingFee: data.shippingFee || 0,
            discount: data.discount || 0,
            total: data.total || 0,
        },
        customer: normalizeCustomer(data),
        shipping: data.shipping || {},
        payment: {
            provider: data.payment?.provider || data.paymentMethod || "UNKNOWN",
            transactionId: data.payment?.transactionId || "",
            method: data.payment?.method || "",
            paidAt: toISO(data.payment?.paidAt),
        },
        itemsCount: data.itemsCount || data.items?.length || 0,
        storageBasePath: data.storageBasePath,
        locale: data.locale || "EN",
        adminNote: data.adminNote,
        trackingNumber: data.trackingNumber,
        refundedAt: toISO(data.refundedAt),
        canceledAt: toISO(data.canceledAt),
    };

    // Try subcollection first
    const itemsSnap = await docRef.collection("items").orderBy("index", "asc").get();
    let items: OrderItemAdmin[] = [];

    if (!itemsSnap.empty) {
        items = itemsSnap.docs.map(i => {
            const idata = i.data();
            return {
                index: idata.index,
                size: idata.size || "20x20",
                quantity: idata.quantity || 1,
                unitPrice: idata.unitPrice || 0,
                lineTotal: idata.lineTotal || 0,
                filterId: idata.filterId || "original",
                crop: idata.crop || idata.cropPx,
                assets: idata.assets || {
                    previewUrl: idata.previewUrl,
                    printUrl: idata.printUrl,
                    previewPath: idata.previewPath || idata.storagePath,
                    printPath: idata.printPath || idata.printStoragePath,
                },
            };
        });
    } else if (data.items && Array.isArray(data.items)) {
        // Fallback to legacy array
        items = data.items.map((idata: any, idx: number) => ({
            index: idata.index ?? idx,
            size: idata.size || "20x20",
            quantity: idata.quantity || 1,
            unitPrice: idata.unitPrice || 0,
            lineTotal: idata.lineTotal || 0,
            filterId: idata.filterId || "original",
            crop: idata.crop || idata.cropPx,
            assets: {
                previewUrl: idata.previewUrl,
                printUrl: idata.printUrl,
                previewPath: idata.storagePath,
                printPath: idata.printStoragePath,
            },
        }));
    }

    return { ...header, items };
}
