import * as admin from "firebase-admin";

// ✅ Gen2 (v2) imports
import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onObjectFinalized } from "firebase-functions/v2/storage";
// ✨ 스케줄러 추가
import { onSchedule } from "firebase-functions/v2/scheduler";

// ✅ Firebase Admin SDK imports
import { getStorage } from "firebase-admin/storage";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// ✅ External Libraries
import sharp from "sharp";
const archiver = require("archiver");
const axios = require("axios"); // ✨ 슬랙 전송용 추가

// ✅ Initialize Firebase Admin
admin.initializeApp();

// ✅ Firestore 설정
getFirestore().settings({ ignoreUndefinedProperties: true });

// ✅ Gen2 기본 전역 설정 (Region 설정)
setGlobalOptions({ region: "us-central1" });

// ✨ 슬랙 Webhook 설정
const part1 = "https://hooks.slack.com/services/T0AEXFY3GFM";
const part2 = "/B0AFY664EJC/shdnJxZOJxJtzABgUyjjYUll";
const SLACK_WEBHOOK_URL = part1 + part2;
/* =========================================================================
   HELPER FUNCTIONS (원본 그대로 보존)
   ========================================================================= */

type ColorMatrix = number[]; // length 20

function clamp255(v: number) {
    return Math.max(0, Math.min(255, v));
}

async function applyColorMatrixRGBA(input: Buffer, matrix: ColorMatrix): Promise<Buffer> {
    const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const out = Buffer.alloc(data.length);

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        const nr = matrix[0] * r + matrix[1] * g + matrix[2] * b + matrix[3] * a + matrix[4] * 255;
        const ng = matrix[5] * r + matrix[6] * g + matrix[7] * b + matrix[8] * a + matrix[9] * 255;
        const nb = matrix[10] * r + matrix[11] * g + matrix[12] * b + matrix[13] * a + matrix[14] * 255;
        const na = matrix[15] * r + matrix[16] * g + matrix[17] * b + matrix[18] * a + matrix[19] * 255;

        out[i] = clamp255(nr);
        out[i + 1] = clamp255(ng);
        out[i + 2] = clamp255(nb);
        out[i + 3] = clamp255(na);
    }

    return await sharp(out, { raw: { width: info.width!, height: info.height!, channels: 4 } })
        .jpeg({ quality: 92 })
        .toBuffer();
}

function parseHexColor(hex?: string): { r: number; g: number; b: number; a: number } | null {
    if (!hex || typeof hex !== "string") return null;
    const s = hex.trim();
    if (!s.startsWith("#")) return null;

    const h = s.slice(1);
    if (!(h.length === 6 || h.length === 8)) return null;

    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;

    if ([r, g, b].some((v) => Number.isNaN(v))) return null;
    return { r, g, b, a };
}

function safeNum(n: any, fallback = 0) {
    return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function safeFolderName(s: any) {
    return (
        String(s || "")
            .trim()
            .replace(/[\/\\:*?"<>|]/g, "_")
            .replace(/\s+/g, " ")
            .slice(0, 60) || "Guest"
    );
}

function toYYYYMMDD(ts: any) {
    const d =
        ts?.toDate
            ? ts.toDate()
            : ts instanceof Date
                ? ts
                : typeof ts === "string"
                    ? new Date(ts)
                    : typeof ts === "number"
                        ? new Date(ts)
                        : null;

    if (!d || Number.isNaN(d.getTime())) return "unknown_date";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
}

async function clampCropToImage(
    sourceBuf: Buffer,
    cropPx: { x: number; y: number; width: number; height: number }
) {
    const meta = await sharp(sourceBuf).metadata();
    const srcW = meta.width ?? 0;
    const srcH = meta.height ?? 0;

    if (!srcW || !srcH) {
        return {
            left: Math.max(0, Math.floor(cropPx.x)),
            top: Math.max(0, Math.floor(cropPx.y)),
            width: Math.max(1, Math.floor(cropPx.width)),
            height: Math.max(1, Math.floor(cropPx.height)),
        };
    }

    let left = Math.floor(safeNum(cropPx.x, 0));
    let top = Math.floor(safeNum(cropPx.y, 0));
    let width = Math.floor(Math.max(1, safeNum(cropPx.width, 1)));
    let height = Math.floor(Math.max(1, safeNum(cropPx.height, 1)));

    left = Math.max(0, Math.min(left, srcW - 1));
    top = Math.max(0, Math.min(top, srcH - 1));
    width = Math.max(1, Math.min(width, srcW - left));
    height = Math.max(1, Math.min(height, srcH - top));

    return { left, top, width, height };
}

/* =========================================================================
   CLOUD FUNCTIONS (GEN 2 - 원본 보존)
   ========================================================================= */

export const reserveOrderCode = onCall({ region: "us-central1", cors: true }, async (req) => {
    if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Must be signed in.");

    const dateKey = String(req.data?.dateKey || "").trim();
    if (!/^\d{8}$/.test(dateKey)) throw new HttpsError("invalid-argument", "dateKey must be YYYYMMDD.");

    const db = getFirestore();
    const ref = db.collection("orderCounters").doc(dateKey);

    const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const nextSeq = snap.exists ? Number(snap.data()?.nextSeq || 1) : 1;

        const seq = Number.isFinite(nextSeq) && nextSeq >= 1 ? nextSeq : 1;
        tx.set(ref, { nextSeq: seq + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

        const orderCode = `${dateKey}-${String(seq).padStart(4, "0")}`;
        return { orderCode, dateKey, seq };
    });

    return result;
});

export const buildPrint5000OnItemCreated = onDocumentCreated(
    {
        document: "orders/{orderId}/items/{itemId}",
        region: "us-central1",
        memory: "2GiB",
        timeoutSeconds: 300,
        cpu: 1
    },
    async (event) => {
        const snap = event.data;
        if (!snap) return;

        const db = getFirestore();
        const bucket = getStorage().bucket();

        const { orderId, itemId } = event.params as any;

        const item = snap.data() as any;
        const index = item?.index ?? 0;

        const sourcePath: string | undefined = item?.assets?.sourcePath;
        const cropPx = item?.cropPx || item?.edits?.committed?.cropPx || null;
        const matrix: ColorMatrix | null = item?.filterParams?.matrix ?? null;

        const overlayColorHex: string | undefined = item?.filterParams?.overlayColor ?? item?.overlayColor;
        const overlayOpacityRaw: number | undefined = item?.filterParams?.overlayOpacity ?? item?.overlayOpacity;

        if (item?.assets?.printUrl) return;

        if (!sourcePath) {
            console.warn("[Print5000] missing sourcePath", { orderId, itemId, index });
            return;
        }

        try {
            const sourceFile = bucket.file(sourcePath);
            const [sourceBuf] = await sourceFile.download();

            let pipeline = sharp(sourceBuf).rotate();

            if (
                cropPx &&
                Number.isFinite(cropPx.x) &&
                Number.isFinite(cropPx.y) &&
                Number.isFinite(cropPx.width) &&
                Number.isFinite(cropPx.height)
            ) {
                const rect = await clampCropToImage(sourceBuf, cropPx);
                pipeline = pipeline.extract(rect);
            }

            let buf = await pipeline.resize(4096, 4096, { fit: "cover" }).jpeg({ quality: 92 }).toBuffer();

            if (matrix && Array.isArray(matrix) && matrix.length === 20) {
                buf = await applyColorMatrixRGBA(buf, matrix);
            }

            const overlay = parseHexColor(overlayColorHex);
            const overlayOpacity =
                typeof overlayOpacityRaw === "number" && Number.isFinite(overlayOpacityRaw)
                    ? Math.max(0, Math.min(1, overlayOpacityRaw))
                    : 0;

            if (overlay && overlayOpacity > 0) {
                const alpha = overlayOpacity * overlay.a;

                const overlayPng = await sharp({
                    create: {
                        width: 4096,
                        height: 4096,
                        channels: 4,
                        background: { r: overlay.r, g: overlay.g, b: overlay.b, alpha },
                    },
                })
                    .png()
                    .toBuffer();

                buf = await sharp(buf).composite([{ input: overlayPng, blend: "over" }]).jpeg({ quality: 92 }).toBuffer();
            }

            const orderRef = db.collection("orders").doc(orderId);
            const orderSnap = await orderRef.get();
            const storageBasePath = orderSnap.data()?.storageBasePath;

            if (!storageBasePath) {
                console.warn("[Print5000] missing storageBasePath", { orderId, itemId });
                return;
            }

            const printPath = `${storageBasePath}/items/${index}_print.jpg`;

            const printFile = bucket.file(printPath);
            await printFile.save(buf, { contentType: "image/jpeg", resumable: false });

            let printUrl: string | null = null;
            try {
                const [url] = await printFile.getSignedUrl({
                    action: "read",
                    expires: Date.now() + 1000 * 60 * 60 * 24 * 365,
                    responseDisposition: `inline; filename="${String(orderId).slice(0, 8)}_${index + 1}_print.jpg"`,
                    responseType: "image/jpeg",
                });
                printUrl = url;
            } catch (e) {
                console.warn("[Print5000] getSignedUrl failed (printPath saved only)", { orderId, itemId, printPath }, e);
            }

            await snap.ref.update({
                "assets.printPath": printPath,
                "assets.printUrl": printUrl,
                printUrl,
            });

            console.log("[Print5000] generated", { orderId, itemId, index, sourcePath, printPath, signedUrl: !!printUrl });
        } catch (err) {
            console.error("[Print5000] failed", { orderId, itemId, index, sourcePath }, err);
        }
    }
);

export const adminBatchUpdateStatus = onCall(
    {
        region: "us-central1",
        cors: true,
        timeoutSeconds: 60
    },
    async (req) => {
        console.log(`[BatchUpdate] Request by UID: ${req.auth?.uid}, isAdmin: ${req.auth?.token?.isAdmin}`);

        try {
            if (!req.auth?.uid || req.auth.token.isAdmin !== true) {
                console.warn("[BatchUpdate] Permission Denied");
                throw new HttpsError("permission-denied", "Admin only. Please Logout & Login again.");
            }

            const { orderIds, status } = (req.data || {}) as any;

            if (!Array.isArray(orderIds) || orderIds.length === 0) {
                throw new HttpsError("invalid-argument", "No orderIds provided.");
            }
            if (!status) {
                throw new HttpsError("invalid-argument", "Status is required.");
            }

            const db = getFirestore();
            const batch = db.batch();
            const timestamp = FieldValue.serverTimestamp();

            console.log(`[BatchUpdate] Target: ${orderIds.length} orders -> ${status}`);

            for (const orderId of orderIds) {
                if (!orderId) continue;
                const ref = db.collection("orders").doc(String(orderId));

                batch.set(ref, {
                    status,
                    updatedAt: timestamp,
                    statusUpdatedAt: timestamp,
                }, { merge: true });

                const eventRef = ref.collection("events").doc();
                batch.set(eventRef, {
                    type: "STATUS_CHANGED",
                    to: status,
                    byUid: req.auth.uid,
                    byEmail: req.auth.token.email || "unknown",
                    createdAt: timestamp,
                });
            }

            await batch.commit();
            console.log("[BatchUpdate] Successfully committed.");

            return { ok: true, updatedCount: orderIds.length };

        } catch (e: any) {
            console.error("[BatchUpdate] CRITICAL ERROR:", e);
            if (e instanceof HttpsError) throw e;
            throw new HttpsError("internal", `Server Error: ${e?.message || "Unknown"}`);
        }
    }
);

export const adminUpdateOrderOps = onCall({ region: "us-central1", cors: true }, async (req) => {
    try {
        if (!req.auth?.uid || req.auth.token.isAdmin !== true) {
            throw new HttpsError("permission-denied", "Admin only.");
        }

        const { orderId, status, trackingNumber, adminNote } = req.data || {};
        if (!orderId) throw new HttpsError("invalid-argument", "orderId required.");

        const db = getFirestore();
        const ref = db.collection("orders").doc(String(orderId));
        const timestamp = FieldValue.serverTimestamp();

        const updates: any = { updatedAt: timestamp };
        if (status !== undefined) {
            updates.status = status;
            updates.statusUpdatedAt = timestamp;
        }
        if (trackingNumber !== undefined) updates.trackingNumber = trackingNumber;
        if (adminNote !== undefined) updates.adminNote = adminNote;

        await ref.update(updates);

        await ref.collection("events").doc().set({
            type: status ? "STATUS_CHANGED" : "OPS_UPDATE",
            to: status || undefined,
            changes: { trackingNumber, adminNote },
            byUid: req.auth.uid,
            byEmail: req.auth.token.email || "unknown",
            createdAt: timestamp,
        });

        return { ok: true };
    } catch (e: any) {
        console.error("[adminUpdateOrderOps] failed", e);
        if (e instanceof HttpsError) throw e;
        throw new HttpsError("internal", e?.message || "Update ops failed");
    }
});

export const adminCancelOrder = onCall({ region: "us-central1", cors: true }, async (req) => {
    try {
        if (!req.auth?.uid || req.auth.token.isAdmin !== true) {
            throw new HttpsError("permission-denied", "Admin only.");
        }
        const { orderId, reason } = req.data || {};
        if (!orderId) throw new HttpsError("invalid-argument", "orderId required.");

        const db = getFirestore();
        const ref = db.collection("orders").doc(String(orderId));
        const timestamp = FieldValue.serverTimestamp();

        await ref.update({
            status: "canceled",
            canceledAt: timestamp,
            updatedAt: timestamp,
            cancelReason: reason || "",
        });

        await ref.collection("events").add({
            type: "STATUS_CHANGED",
            to: "canceled",
            reason,
            byUid: req.auth.uid,
            createdAt: timestamp,
        });

        return { ok: true };
    } catch (e: any) {
        console.error("[adminCancelOrder] failed", e);
        if (e instanceof HttpsError) throw e;
        throw new HttpsError("internal", e?.message || "Cancel failed");
    }
});

export const adminRefundOrder = onCall({ region: "us-central1", cors: true }, async (req) => {
    try {
        if (!req.auth?.uid || req.auth.token.isAdmin !== true) {
            throw new HttpsError("permission-denied", "Admin only.");
        }
        const { orderId, reason } = req.data || {};
        if (!orderId) throw new HttpsError("invalid-argument", "orderId required.");

        const db = getFirestore();
        const ref = db.collection("orders").doc(String(orderId));
        const timestamp = FieldValue.serverTimestamp();

        await ref.update({
            status: "refunded",
            refundedAt: timestamp,
            updatedAt: timestamp,
            refundReason: reason || "",
        });

        await ref.collection("events").add({
            type: "STATUS_CHANGED",
            to: "refunded",
            reason,
            byUid: req.auth.uid,
            createdAt: timestamp,
        });

        return { ok: true };
    } catch (e: any) {
        console.error("[adminRefundOrder] failed", e);
        if (e instanceof HttpsError) throw e;
        throw new HttpsError("internal", e?.message || "Refund failed");
    }
});

export const adminExportPrinterJSON = onCall(
    { region: "us-central1", cors: true, timeoutSeconds: 120, memory: "512MiB" },
    async (req) => {
        try {
            if (!req.auth?.uid || req.auth.token.isAdmin !== true) {
                throw new HttpsError("permission-denied", "Admin only.");
            }

            const { orderIds } = (req.data || {}) as any;
            if (!Array.isArray(orderIds) || orderIds.length === 0) {
                throw new HttpsError("invalid-argument", "orderIds required.");
            }
            if (orderIds.length > 200) {
                throw new HttpsError("invalid-argument", "orderIds max 200.");
            }

            const db = getFirestore();
            const bucket = getStorage().bucket();
            const payload: any[] = [];

            for (const orderId of orderIds) {
                const orderSnap = await db.collection("orders").doc(String(orderId)).get();
                if (!orderSnap.exists) continue;

                const orderData: any = orderSnap.data() || {};
                const orderCode = orderData?.orderCode || orderId;
                const dateKey = toYYYYMMDD(orderData?.createdAt);

                const shipping = orderData?.shipping || {};
                const customer = orderData?.customer || {};

                const itemsSnap = await orderSnap.ref.collection("items").orderBy("index").get();
                const items = itemsSnap.empty ? orderData?.items || [] : itemsSnap.docs.map((d) => d.data());

                const normalizedItems = (items || []).map((it: any) => {
                    const index = Number.isFinite(it?.index) ? Number(it.index) : 0;
                    const printPath = it?.assets?.printPath || it?.printPath || it?.printStoragePath || null;
                    const previewPath = it?.assets?.previewPath || it?.previewPath || it?.storagePath || null;

                    return {
                        index,
                        size: it?.size || "20x20",
                        quantity: it?.quantity || 1,
                        filterId: it?.filterId || "original",
                        cropPx: it?.cropPx || it?.crop || it?.edits?.committed?.cropPx || null,
                        assets: { printPath, previewPath },
                    };
                });

                payload.push({
                    orderId,
                    orderCode,
                    dateKey,
                    customer: {
                        fullName: customer?.fullName || customer?.name || shipping?.fullName || "Guest",
                        email: customer?.email || shipping?.email || "",
                        phone: customer?.phone || shipping?.phone || "",
                    },
                    shipping: {
                        fullName: shipping?.fullName || "",
                        address1: shipping?.address1 || "",
                        address2: shipping?.address2 || "",
                        city: shipping?.city || "",
                        state: shipping?.state || "",
                        postalCode: shipping?.postalCode || "",
                        country: shipping?.country || "",
                        phone: shipping?.phone || "",
                    },
                    pricing:
                        orderData?.pricing || {
                            subtotal: orderData?.subtotal || 0,
                            shippingFee: orderData?.shippingFee || 0,
                            discount: orderData?.discount || 0,
                            total: orderData?.total || 0,
                        },
                    items: normalizedItems,
                    notes: { storageBasePath: orderData?.storageBasePath || "" },
                });
            }

            const jsonText = JSON.stringify({ generatedAt: new Date().toISOString(), count: payload.length, orders: payload }, null, 2);

            const jsonName = `exports/json/printer_${orderIds.length}orders_${Date.now()}.json`;
            const file = bucket.file(jsonName);

            await file.save(Buffer.from(jsonText, "utf8"), {
                contentType: "application/json; charset=utf-8",
                resumable: false,
            });

            const filename = `memotile_printer_${Date.now()}.json`;
            const [url] = await file.getSignedUrl({
                action: "read",
                expires: Date.now() + 1000 * 60 * 60,
                responseDisposition: `attachment; filename="${filename}"`,
                responseType: "application/json",
            });

            return { ok: true, url };
        } catch (e: any) {
            console.error("[adminExportPrinterJSON] failed", e);
            if (e instanceof HttpsError) throw e;
            throw new HttpsError("internal", e?.message || "Export printer JSON failed");
        }
    }
);

export const adminExportZipPrints = onCall(
    {
        region: "us-central1",
        cors: true,
        memory: "2GiB",
        timeoutSeconds: 300
    },
    async (req) => {
        try {
            if (!req.auth?.uid || req.auth.token.isAdmin !== true) {
                throw new HttpsError("permission-denied", "Admin only.");
            }

            const { orderIds, type = "print" } = (req.data || {}) as any;
            if (!Array.isArray(orderIds) || orderIds.length === 0) {
                throw new HttpsError("invalid-argument", "orderIds required.");
            }

            const db = getFirestore();
            const bucket = getStorage().bucket();

            const zipName = `exports/zip/${type}_${orderIds.length}orders_${Date.now()}.zip`;
            const zipFile = bucket.file(zipName);

            const archive = archiver("zip", { zlib: { level: 9 } });
            const out = zipFile.createWriteStream({
                contentType: "application/zip",
                resumable: false,
            });

            const uploadPromise = new Promise<void>((resolve, reject) => {
                out.on("close", resolve);
                out.on("finish", resolve);
                out.on("error", reject);
            });

            archive.pipe(out);

            let addedCount = 0;

            for (const rawOrderId of orderIds) {
                const orderId = String(rawOrderId);
                const orderSnap = await db.collection("orders").doc(orderId).get();
                if (!orderSnap.exists) continue;

                const orderData: any = orderSnap.data() || {};
                const orderCode = orderData?.orderCode || orderId;
                const dateKey = toYYYYMMDD(orderData?.createdAt);

                const customerName = safeFolderName(
                    orderData?.customer?.fullName || orderData?.shipping?.fullName || "Guest"
                );

                const baseFolder = `${dateKey}/${orderCode}/${customerName}`;

                const itemsSnap = await orderSnap.ref.collection("items").orderBy("index").get();
                const items = itemsSnap.empty ? orderData?.items || [] : itemsSnap.docs.map((d) => d.data());

                const shipping = orderData?.shipping || {};
                const infoText = `
[ORDER INFO]
Order Code : ${orderCode}
Date       : ${dateKey}
Customer   : ${customerName}
Phone      : ${orderData?.customer?.phone || shipping?.phone || "-"}
Email      : ${orderData?.customer?.email || "-"}

[SHIPPING ADDRESS]
Name       : ${shipping?.fullName || "-"}
Address    : ${shipping?.address1 || ""} ${shipping?.address2 || ""}
City/State : ${shipping?.city || ""}, ${shipping?.state || ""}
Postal Code: ${shipping?.postalCode || ""}
Country    : ${shipping?.country || ""}
Phone      : ${shipping?.phone || "-"} (Required)

[ITEMS]
Total Items: ${items.length} EA
Note       : ${orderData?.adminNote || "-"}
`.trim();

                archive.append(infoText, { name: `${baseFolder}/order_info.txt` });

                for (const item of items) {
                    const index = Number.isFinite(item?.index) ? Number(item.index) : 0;
                    const fileIndex = String(index + 1).padStart(2, "0");

                    const path =
                        type === "print"
                            ? item?.assets?.printPath || item?.printPath
                            : item?.assets?.previewPath || item?.previewPath;

                    if (!path) continue;

                    const file = bucket.file(path);
                    const [exists] = await file.exists();

                    if (exists) {
                        const ext = (String(path).split(".").pop() || "jpg").toLowerCase();
                        const entryName = `${baseFolder}/${fileIndex}.${ext}`;
                        archive.append(file.createReadStream(), { name: entryName });
                        addedCount++;
                    } else {
                        console.warn(`[ZIP] Missing file: ${path}`);
                        archive.append(`Missing file: ${path}\n`, { name: `${baseFolder}/MISSING_${fileIndex}.txt` });
                    }
                }
            }

            if (addedCount === 0) {
                archive.append("No images found. Check if 'print.jpg' generation is complete.", { name: "WARNING_NO_IMAGES.txt" });
            }

            await archive.finalize();
            await uploadPromise;

            const filename = `Batch_${orderIds.length}orders_${new Date().toISOString().slice(0, 10)}.zip`;
            const [url] = await zipFile.getSignedUrl({
                action: "read",
                expires: Date.now() + 1000 * 60 * 60,
                responseDisposition: `attachment; filename="${filename}"`,
                responseType: "application/zip",
            });

            return { ok: true, url, addedCount };

        } catch (e: any) {
            console.error("[ZIP Error]", e);
            throw new HttpsError("internal", e.message || "ZIP creation failed");
        }
    }
);

export const onPrintFileFinalized = onObjectFinalized(
    { region: "us-central1", cpu: 2, memory: "1GiB" },
    async (event) => {
        const filePath = event.data.name;
        if (!filePath || !filePath.endsWith("_print.jpg")) return;

        const match = filePath.match(/\/orders\/([^/]+)\/items\/(\d+)_print\.jpg$/);
        if (!match) return;

        const [, orderId, indexStr] = match;
        const index = parseInt(indexStr, 10);
        if (Number.isNaN(index)) return;

        const bucket = getStorage().bucket(event.data.bucket);
        const file = bucket.file(filePath);

        try {
            const [buf] = await file.download();
            const meta = await sharp(buf).metadata();
            const width = meta.width || 0;
            const height = meta.height || 0;
            const ok5000 = width >= 4000 && height >= 4000;

            console.log(`[PrintAudit] ${filePath} => ${width}x${height}, ok=${ok5000}`);

            const db = getFirestore();
            const orderRef = db.collection("orders").doc(orderId);

            const itemsRef = orderRef.collection("items");
            const q = itemsRef.where("index", "==", index).limit(1);
            const snap = await q.get();

            const printMeta = {
                width,
                height,
                ok5000,
                checkedAt: new Date().toISOString(),
                source: "storage_finalize",
            };

            if (!snap.empty) {
                await snap.docs[0].ref.update({ "assets.printMeta": printMeta });
                console.log(`[PrintAudit] Updated subcollection item ${snap.docs[0].id}`);
            } else {
                await db.runTransaction(async (t) => {
                    const docSnap = await t.get(orderRef);
                    if (!docSnap.exists) return;
                    const data = docSnap.data();
                    const items = (data as any)?.items;

                    if (Array.isArray(items)) {
                        let found = false;
                        const newItems = items.map((it: any) => {
                            if (it.index === index) {
                                found = true;
                                return { ...it, assets: { ...(it.assets || {}), printMeta } };
                            }
                            return it;
                        });

                        if (found) {
                            t.update(orderRef, { items: newItems });
                            console.log(`[PrintAudit] Updated array item index ${index}`);
                        }
                    }
                });
            }
        } catch (e) {
            console.error(`[PrintAudit] Failed for ${filePath}`, e);
        }
    }
);

/* =========================================================================
   ✨ NEW: SCHEDULED FUNCTIONS (슬랙 알림 및 자동 아카이브)
   ========================================================================= */

/**
 * 🕒 1시간마다 실행: 24시간 방치 주문 체크 및 슬랙 알림
 */
/**
 * 🕒 1시간마다 실행: 24시간 방치 주문 체크 및 슬랙 알림
 */
export const alertAbandonedOrders = onSchedule("every 1 hours", async (event) => {
    const db = getFirestore();
    const now = new Date();
    // 24시간 전 시점 계산 (Timestamp 형식)
    const twentyFourHoursAgo = admin.firestore.Timestamp.fromDate(new Date(now.getTime() - (24 * 60 * 60 * 1000)));

    try {
        // 'paid' 상태인데 생성된 지 24시간이 지난 주문 조회
        // ⚠️ 주의: Firestore 콘솔에서 (status ASC, createdAt ASC) 복합 인덱스 생성이 필요할 수 있습니다.
        const snapshot = await db.collection("orders")
            .where("status", "==", "paid")
            .where("createdAt", "<=", twentyFourHoursAgo)
            .orderBy("createdAt", "asc") // 👈 정렬을 명시하여 인덱스 활용 및 안정적 결과 확보
            .get();

        if (snapshot.empty) {
            console.log("[Scheduler] No abandoned orders found.");
            return;
        }

        const count = snapshot.size;
        const orderDetails = snapshot.docs.map(doc => {
            const data = doc.data();
            // 데이터 누락 방지를 위한 기본값 처리
            const code = data.orderCode || doc.id;
            const name = data.customer?.fullName || data.shipping?.fullName || 'Guest';
            return `• 주문번호: ${code} (고객: ${name})`;
        }).join("\n");

        const message = {
            text: `🚨 *[방치 주문 알림]* 24시간 동안 '결제완료' 상태에서 변동이 없는 주문이 *${count}건* 있습니다.`,
            attachments: [{
                color: "#FF0000",
                title: "조치 필요 주문 목록",
                text: orderDetails,
                footer: "Memotile Admin Bot",
                ts: Math.floor(now.getTime() / 1000)
            }]
        };

        await axios.post(SLACK_WEBHOOK_URL, message);
        console.log(`[Scheduler] Slack alert sent for ${count} orders.`);
    } catch (e: any) {
        // 쿼리 에러(인덱스 미생성 등) 확인을 위해 로그 강화
        console.error("[Scheduler] Alert Failed:", e?.message);
    }
});
/**
 * 🕒 매일 새벽 3시 실행: 7일 지난 완료/취소 주문 자동 아카이브
 */
export const autoArchiveOldOrders = onSchedule("0 3 * * *", async (event) => {
    const db = getFirestore();
    const now = new Date();
    // 7일 전 시점 계산
    const sevenDaysAgo = admin.firestore.Timestamp.fromDate(new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)));

    const statusesToArchive = ["delivered", "canceled", "refunded"];

    let totalArchived = 0;

    for (const status of statusesToArchive) {
        // 해당 상태이면서 업데이트된 지 7일이 지난 주문 조회
        const snapshot = await db.collection("orders")
            .where("status", "==", status)
            .where("updatedAt", "<=", sevenDaysAgo)
            .limit(500)
            .get();

        if (snapshot.empty) continue;

        const batch = db.batch();
        snapshot.docs.forEach((doc) => {
            batch.update(doc.ref, {
                status: "archived",
                archivedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });
            totalArchived++;
        });

        await batch.commit();
    }

    if (totalArchived > 0) {
        console.log(`[Scheduler] Archived ${totalArchived} orders.`);
        try {
            await axios.post(SLACK_WEBHOOK_URL, {
                text: `📦 *[자동 아카이브 완료]* 7일 이상 경과된 완료/취소 주문 *${totalArchived}건*이 'archived' 상태로 변경되었습니다.`
            });
        } catch (e) { }
    }
});

/**
 * ✅ Admin: Delete Order (영구 삭제)
 * - 주문 문서와 items 서브컬렉션을 모두 삭제합니다.
 */
export const adminDeleteOrder = onCall({ region: "us-central1", cors: true }, async (req) => {
    try {
        if (!req.auth?.uid || req.auth.token.isAdmin !== true) {
            throw new HttpsError("permission-denied", "Admin 전용 기능입니다.");
        }
        const { orderId } = req.data || {};
        if (!orderId) throw new HttpsError("invalid-argument", "orderId가 필요합니다.");

        const db = getFirestore();
        const orderRef = db.collection("orders").doc(String(orderId));

        // 1. 하위 items 삭제
        const items = await orderRef.collection("items").get();
        const batch = db.batch();
        items.forEach(doc => batch.delete(doc.ref));

        // 2. 메인 주문 문서 삭제
        batch.delete(orderRef);

        await batch.commit();
        console.log(`[Delete] Order ${orderId} permanently deleted by admin.`);
        return { ok: true };
    } catch (e: any) {
        console.error("[adminDeleteOrder] failed", e);
        if (e instanceof HttpsError) throw e;
        throw new HttpsError("internal", e?.message || "Delete failed");
    }
});