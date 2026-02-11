// src/lib/admin/orderRepo.ts
import {
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    doc,
    getDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import {
    OrderHeader,
    OrderDetail,
    OrderItemAdmin,
    OrderStatus,
    ListOrdersParams,
} from "./types";

function toISO(ts: any): string {
    if (!ts) return new Date().toISOString();
    if (typeof ts.toDate === "function") return ts.toDate().toISOString();
    if (ts instanceof Date) return ts.toISOString();
    if (typeof ts === "string") return ts;
    if (typeof ts === "number") return new Date(ts).toISOString();
    if (ts.seconds !== undefined) return new Date(ts.seconds * 1000).toISOString();
    return new Date().toISOString();
}

function normalizeCustomer(data: any): any {
    return {
        fullName: data.customer?.fullName || data.customer?.name || data.shipping?.fullName || "Guest",
        email: data.customer?.email || data.shipping?.email || data.uid || "no-email",
        phone: data.customer?.phone || data.shipping?.phone || "",
    };
}

function inRange(iso: string, from?: string, to?: string) {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return true;

    if (from) {
        const s = new Date(from);
        s.setHours(0, 0, 0, 0);
        const st = s.getTime();
        if (!Number.isNaN(st) && t < st) return false;
    }

    if (to) {
        const e = new Date(to);
        e.setHours(23, 59, 59, 999);
        const et = e.getTime();
        if (!Number.isNaN(et) && t > et) return false;
    }

    return true;
}

export async function listOrders(
    params: ListOrdersParams = {}
): Promise<{ rows: OrderHeader[]; nextCursor?: string }> {
    const {
        status,
        country,
        limit: limitCount = 200,
        sort = "desc",
        from,
        to,
    } = params;

    // ✅ SAFE QUERY (avoid composite index explosions):
    // orderBy(createdAt) + optional where(status==)
    let qry = query(collection(db, "orders"), orderBy("createdAt", sort), limit(limitCount));

    if (status && status !== "ALL") {
        qry = query(collection(db, "orders"), where("status", "==", status), orderBy("createdAt", sort), limit(limitCount));
    }

    let snap;
    try {
        snap = await getDocs(qry);
    } catch (e) {
        console.error("[Admin listOrders] getDocs failed", e);
        throw e;
    }

    let rows: OrderHeader[] = snap.docs.map((d) => {
        const data = d.data();
        const createdAtISO = toISO(data.createdAt);

        return {
            id: d.id,
            orderCode: data.orderCode || d.id.slice(-7).toUpperCase(),
            status: data.status as OrderStatus,
            createdAt: createdAtISO,
            updatedAt: toISO(data.updatedAt),
            uid: data.uid,
            currency: data.currency || "THB",
            pricing:
                data.pricing || {
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

            // ✅ Best-effort warning (exact audit happens in detail)
            hasPrintWarning: Array.isArray(data.items)
                ? data.items.some((i: any) => i?.assets?.printMeta?.ok5000 === false)
                : false,
        };
    });

    // ✅ in-memory filters
    if (from || to) rows = rows.filter((r) => inRange(r.createdAt, from, to));
    if (country && country !== "ALL") rows = rows.filter((r) => r.shipping?.country === country);

    return { rows };
}

export async function getOrderDetail(orderId: string): Promise<OrderDetail | null> {
    const docRef = doc(db, "orders", orderId);
    const d = await getDoc(docRef);

    if (!d.exists()) return null;

    const data = d.data()!;
    const header: OrderHeader = {
        id: d.id,
        orderCode: data.orderCode || d.id.slice(-7).toUpperCase(),
        status: data.status as OrderStatus,
        createdAt: toISO(data.createdAt),
        updatedAt: toISO(data.updatedAt),
        uid: data.uid,
        currency: data.currency || "THB",
        pricing:
            data.pricing || {
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
    };

    // Subcollection items
    const itemsSnap = await getDocs(
        query(collection(db, "orders", orderId, "items"), orderBy("index", "asc"))
    );

    let items: OrderItemAdmin[] = [];

    if (!itemsSnap.empty) {
        items = itemsSnap.docs.map((i) => {
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
                printMeta: idata.assets?.printMeta,
            } as any,
        }));
    }

    return { ...header, items } as any;
}
