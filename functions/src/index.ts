import * as admin from "firebase-admin";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getStorage } from "firebase-admin/storage";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import sharp from "sharp";
const archiver = require("archiver");
admin.initializeApp();

setGlobalOptions({ region: "us-central1" });

type ColorMatrix = number[]; // length 20

function clamp255(v: number) {
    return Math.max(0, Math.min(255, v));
}

/**
 * Apply 4x5 color matrix to RGBA buffer (CPU).
 */
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

    return await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
        .jpeg({ quality: 92 })
        .toBuffer();
}

/**
 * Convert hex "#RRGGBB" or "#RRGGBBAA" to RGBA + alpha (0..1).
 */
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

/**
 * Clamp crop rect to source image bounds (prevents sharp extract crash).
 */
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

/**
 * ✅ (NEW) Reserve sequential orderCode by date using Firestore transaction
 * Returns: { orderCode, dateKey, seq }
 *
 * Firestore doc:
 *   orderCounters/{YYYYMMDD}  { nextSeq: number, updatedAt }
 *
 * Logic:
 *   seq = nextSeq (default 1)
 *   nextSeq = seq + 1
 *   orderCode = YYYYMMDD-#### (pad 4)
 */
export const reserveOrderCode = onCall(
    {
        region: "us-central1",
        cors: true,
    },
    async (req) => {
        // ✅ require auth
        if (!req.auth?.uid) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const dateKey = String(req.data?.dateKey || "").trim();

        if (!/^\d{8}$/.test(dateKey)) {
            throw new HttpsError("invalid-argument", "dateKey must be YYYYMMDD.");
        }

        const db = getFirestore();
        const ref = db.collection("orderCounters").doc(dateKey);

        const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const nextSeq = snap.exists ? Number(snap.data()?.nextSeq || 1) : 1;

            const seq = Number.isFinite(nextSeq) && nextSeq >= 1 ? nextSeq : 1;
            tx.set(
                ref,
                { nextSeq: seq + 1, updatedAt: FieldValue.serverTimestamp() },
                { merge: true }
            );

            const orderCode = `${dateKey}-${String(seq).padStart(4, "0")}`;
            return { orderCode, dateKey, seq };
        });

        return result;
    });

/**
 * ✅ buildPrint5000 (너가 올린 코드 기반)
 */
export const buildPrint5000OnItemCreated = onDocumentCreated("orders/{orderId}/items/{itemId}", async (event) => {
    const snap = event.data;
    if (!snap) return;

    const db = getFirestore();
    const bucket = getStorage().bucket();

    const { orderId, itemId } = event.params as any;

    const item = snap.data() as any;
    const index = item?.index ?? 0;

    const sourcePath: string | undefined = item?.assets?.sourcePath;

    const cropPx =
        item?.cropPx ||
        item?.edits?.committed?.cropPx ||
        null;

    const matrix: ColorMatrix | null = item?.filterParams?.matrix ?? null;

    const overlayColorHex: string | undefined =
        item?.filterParams?.overlayColor ?? item?.overlayColor;

    const overlayOpacityRaw: number | undefined =
        item?.filterParams?.overlayOpacity ?? item?.overlayOpacity;

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

        let buf = await pipeline
            .resize(5000, 5000, { fit: "cover" })
            .jpeg({ quality: 92 })
            .toBuffer();

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
                    width: 5000,
                    height: 5000,
                    channels: 4,
                    background: { r: overlay.r, g: overlay.g, b: overlay.b, alpha },
                },
            })
                .png()
                .toBuffer();

            buf = await sharp(buf)
                .composite([{ input: overlayPng, blend: "over" }])
                .jpeg({ quality: 92 })
                .toBuffer();
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

        console.log("[Print5000] generated", {
            orderId,
            itemId,
            index,
            sourcePath,
            printPath,
            signedUrl: !!printUrl,
        });
    } catch (err) {
        console.error("[Print5000] failed", { orderId, itemId, index, sourcePath }, err);
    }
});

/**
 * ✅ (NEW) Admin: Batch Update Status
 * Input: { orderIds: string[], status: OrderStatus }
 */
export const adminBatchUpdateStatus = onCall(
    { region: "us-central1", cors: true },
    async (req) => {
        if (!req.auth?.uid || req.auth.token.isAdmin !== true) {
            throw new HttpsError("permission-denied", "Admin only.");
        }

        const { orderIds, status } = req.data;
        if (!Array.isArray(orderIds) || orderIds.length === 0 || orderIds.length > 200) {
            throw new HttpsError("invalid-argument", "orderIds must be 1..200.");
        }
        if (!status) {
            throw new HttpsError("invalid-argument", "status required.");
        }

        const db = getFirestore();
        const batch = db.batch();
        const timestamp = FieldValue.serverTimestamp();
        let count = 0;

        for (const orderId of orderIds) {
            const ref = db.collection("orders").doc(orderId);
            batch.update(ref, {
                status,
                updatedAt: timestamp,
                statusUpdatedAt: timestamp, // track last status change
            });

            // Log event
            const eventRef = ref.collection("events").doc();
            batch.set(eventRef, {
                type: "STATUS_CHANGED",
                to: status,
                byUid: req.auth.uid,
                byEmail: req.auth.token.email || "unknown",
                createdAt: timestamp,
            });
            count++;
        }

        await batch.commit();
        return { ok: true, updatedCount: count };
    }
);

/**
 * ✅ (NEW) Admin: Update Order Ops (Single)
 * Input: { orderId, status?, trackingNumber?, adminNote? }
 */
export const adminUpdateOrderOps = onCall(
    { region: "us-central1", cors: true },
    async (req) => {
        if (!req.auth?.uid || req.auth.token.isAdmin !== true) {
            throw new HttpsError("permission-denied", "Admin only.");
        }

        const { orderId, status, trackingNumber, adminNote } = req.data;
        if (!orderId) throw new HttpsError("invalid-argument", "orderId required.");

        const db = getFirestore();
        const ref = db.collection("orders").doc(orderId);
        const timestamp = FieldValue.serverTimestamp();
        const updates: any = { updatedAt: timestamp };

        if (status) {
            updates.status = status;
            updates.statusUpdatedAt = timestamp;
        }
        if (trackingNumber !== undefined) updates.trackingNumber = trackingNumber;
        if (adminNote !== undefined) updates.adminNote = adminNote;

        await ref.update(updates);

        // Log event
        const eventRef = ref.collection("events").doc();
        await eventRef.set({
            type: status ? "STATUS_CHANGED" : "OPS_UPDATE",
            to: status || undefined,
            changes: { trackingNumber, adminNote },
            byUid: req.auth.uid,
            byEmail: req.auth.token.email || "unknown",
            createdAt: timestamp,
        });

        return { ok: true };
    }
);

/**
 * ✅ (NEW) Admin: Cancel Order
 */
export const adminCancelOrder = onCall(
    { region: "us-central1", cors: true },
    async (req) => {
        if (!req.auth?.uid || req.auth.token.isAdmin !== true) {
            throw new HttpsError("permission-denied", "Admin only.");
        }
        const { orderId, reason } = req.data;
        if (!orderId) throw new HttpsError("invalid-argument", "orderId required.");

        const db = getFirestore();
        const ref = db.collection("orders").doc(orderId);
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
    }
);

/**
 * ✅ (NEW) Admin: Refund Order
 * Note: Just updates status, DOES NOT process actual payment refund.
 */
export const adminRefundOrder = onCall(
    { region: "us-central1", cors: true },
    async (req) => {
        if (!req.auth?.uid || req.auth.token.isAdmin !== true) {
            throw new HttpsError("permission-denied", "Admin only.");
        }
        const { orderId, reason } = req.data;
        if (!orderId) throw new HttpsError("invalid-argument", "orderId required.");

        const db = getFirestore();
        const ref = db.collection("orders").doc(orderId);
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
    }
);

/**
 * ✅ (NEW) Admin: Export ZIP
 * Compresses print assets (or preview) for selected orders into a ZIP.
 * Input: { orderIds: string[], type: "print" | "preview" }
 */
export const adminExportZipPrints = onCall(
    { region: "us-central1", cors: true, memory: "1GiB", timeoutSeconds: 300 },
    async (req) => {
        if (!req.auth?.uid || req.auth.token.isAdmin !== true) {
            throw new HttpsError("permission-denied", "Admin only.");
        }

        const { orderIds, type = "print" } = req.data;
        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            throw new HttpsError("invalid-argument", "orderIds required.");
        }
        if (orderIds.length > 200) {
            throw new HttpsError("invalid-argument", "orderIds max 200.");
        }

        const db = getFirestore();
        const bucket = getStorage().bucket();

        // ✅ file name in storage
        const zipName = `exports/zip/${type}_${orderIds.length}orders_${Date.now()}.zip`;
        const zipFile = bucket.file(zipName);

        const archive = archiver("zip", { zlib: { level: 9 } });
        const stream = zipFile.createWriteStream({ contentType: "application/zip" });

        const safeFolder = (s: any) =>
            String(s || "")
                .trim()
                .replace(/[\/\\:*?"<>|]/g, "_")
                .replace(/\s+/g, " ")
                .slice(0, 60) || "Guest";

        const yyyymmdd = (ts: any) => {
            const d =
                ts?.toDate ? ts.toDate() :
                    ts instanceof Date ? ts :
                        typeof ts === "string" ? new Date(ts) :
                            typeof ts === "number" ? new Date(ts) :
                                null;

            if (!d || Number.isNaN(d.getTime())) return "unknown_date";
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const day = String(d.getDate()).padStart(2, "0");
            return `${y}${m}${day}`;
        };

        return new Promise((resolve, reject) => {
            stream.on("finish", async () => {
                try {
                    const [url] = await zipFile.getSignedUrl({
                        action: "read",
                        expires: Date.now() + 1000 * 60 * 60, // 1 hour
                    });
                    resolve({ ok: true, url });
                } catch (e) {
                    reject(e);
                }
            });

            stream.on("error", reject);
            archive.on("error", (err: any) => reject(err));
            archive.pipe(stream);

            // Process strictly sequentially to avoid memory spikes
            (async () => {
                for (const orderId of orderIds) {
                    const orderSnap = await db.collection("orders").doc(orderId).get();
                    if (!orderSnap.exists) continue;

                    const orderData: any = orderSnap.data() || {};
                    const orderCode = orderData?.orderCode || orderId;

                    const dateKey = yyyymmdd(orderData?.createdAt);

                    const customerName = safeFolder(
                        orderData?.customer?.fullName ||
                        orderData?.customer?.name ||
                        orderData?.shipping?.fullName ||
                        "Guest"
                    );

                    // ✅ desired folder structure
                    // YYYYMMDD/customer/이름/ORDER_CODE/01.jpg ...
                    const baseFolder = `${dateKey}/customer/${customerName}/${orderCode}`;

                    // Fetch items (prefer subcollection)
                    const itemsSnap = await orderSnap.ref.collection("items").orderBy("index").get();
                    const items = itemsSnap.empty ? (orderData?.items || []) : itemsSnap.docs.map((d) => d.data());

                    for (const item of items) {
                        const index = Number.isFinite(item?.index) ? Number(item.index) : 0;
                        const fileIndex = String(index + 1).padStart(2, "0");

                        // ✅ pick print vs preview
                        const path =
                            type === "print"
                                ? (item?.assets?.printPath || item?.printPath || item?.printStoragePath || item?.storagePath)
                                : (item?.assets?.previewPath || item?.previewPath || item?.storagePath);

                        if (!path) continue;

                        try {
                            const file = bucket.file(path);
                            const [exists] = await file.exists();
                            if (!exists) continue;

                            const [buf] = await file.download();
                            const ext = (String(path).split(".").pop() || "jpg").toLowerCase();

                            // ✅ final zip entry name
                            const entryName = `${baseFolder}/${fileIndex}.${ext}`;

                            archive.append(buf, { name: entryName });
                        } catch (e) {
                            console.warn(`[ZIP] Failed to add ${path}`, e);
                        }
                    }
                }

                archive.finalize();
            })().catch(reject);
        });
    }
);

/**
 * ✅ (NEW) Print File Finalize Trigger
 * Checks if a new print file is 5000x5000, and updates order item metadata.
 */
import { onObjectFinalized } from "firebase-functions/v2/storage";

export const onPrintFileFinalized = onObjectFinalized(
    { region: "us-central1", cpu: 2, memory: "1GiB" },
    async (event) => {
        const filePath = event.data.name; // e.g. "users/.../items/0_print.jpg"
        if (!filePath || !filePath.endsWith("_print.jpg")) return;

        // Pattern check: we need to find which order this belongs to.
        // The storageBasePath is usually: `users/{uid}/orders/{orderId}`
        // So print path is: `users/{uid}/orders/{orderId}/items/{index}_print.jpg`
        // Let's try to extract orderId and index from path.
        // Regex: .../orders/([^/]+)/items/(\d+)_print\.jpg
        const match = filePath.match(/\/orders\/([^/]+)\/items\/(\d+)_print\.jpg$/);
        if (!match) return;

        const [, orderId, indexStr] = match;
        const index = parseInt(indexStr, 10);
        if (Number.isNaN(index)) return;

        const bucket = getStorage().bucket(event.data.bucket);
        const file = bucket.file(filePath);

        try {
            // 1. Download & Measure
            const [buf] = await file.download();
            const meta = await sharp(buf).metadata();
            const width = meta.width || 0;
            const height = meta.height || 0;
            const ok5000 = width >= 5000 && height >= 5000;

            console.log(`[PrintAudit] ${filePath} => ${width}x${height}, ok=${ok5000}`);

            // 2. Update Firestore Order
            const db = getFirestore();
            const orderRef = db.collection("orders").doc(orderId);

            // We need to update the specific item in the array or subcollection.
            // Check if items are in subcollection "items" OR array "items".
            // Implementation logic in 'buildPrint5000' suggests: "orders/{orderId}/items/{itemId}" triggers,
            // but 'getOrderDetail' checks both. We should try both or prioritize based on 'itemsCount'.

            // A. Try Subcollection 'items' first (query by index)
            const itemsRef = orderRef.collection("items");
            const q = itemsRef.where("index", "==", index).limit(1);
            const snap = await q.get();

            const printMeta = {
                width: width,
                height: height,
                ok5000: ok5000,
                checkedAt: new Date().toISOString(), // store as string in object for simplicity
                source: "storage_finalize",
            };

            if (!snap.empty) {
                // It's a subcollection item
                await snap.docs[0].ref.update({
                    "assets.printMeta": printMeta
                });
                console.log(`[PrintAudit] Updated subcollection item ${snap.docs[0].id}`);
            } else {
                // B. Try main doc 'items' array
                // We have to read the doc, find the item, and update it.
                // Using runTransaction to be safe with array updates.
                await db.runTransaction(async (t) => {
                    const docSnap = await t.get(orderRef);
                    if (!docSnap.exists) return;
                    const data = docSnap.data();
                    const items = data?.items;

                    if (Array.isArray(items)) {
                        let found = false;
                        const newItems = items.map((it: any) => {
                            // Match by index (ensure it matches the file path index)
                            if (it.index === index) {
                                found = true;
                                return {
                                    ...it,
                                    assets: {
                                        ...(it.assets || {}),
                                        printMeta
                                    }
                                };
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
