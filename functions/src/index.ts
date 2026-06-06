// functions/src/index.ts
import * as admin from "firebase-admin";

// ✅ Gen2 (v2) imports
import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, HttpsError, onRequest } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onObjectFinalized } from "firebase-functions/v2/storage";
import { onSchedule } from "firebase-functions/v2/scheduler";

// ✅ Firebase Admin SDK imports
import { getStorage } from "firebase-admin/storage";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// ✅ External Libraries
import sharp from "sharp";
const crypto = require("crypto");
const archiver = require("archiver");
const axios = require("axios");

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
   HELPER FUNCTIONS 
   ========================================================================= */

async function sendExpoPushNotification(userId: string, title: string, body: string) {
    if (!userId) return;
    try {
        const db = getFirestore();
        const userSnap = await db.collection("users").doc(String(userId)).get();
        if (!userSnap.exists) return;

        const pushToken = userSnap.data()?.expoPushToken || userSnap.data()?.pushToken;
        if (!pushToken) {
            console.log(`[Push Notification] 유저 ${userId}의 푸시 토큰이 없습니다.`);
            return;
        }

        await axios.post("https://exp.host/--/api/v2/push/send", {
            to: pushToken,
            sound: "default",
            title: title,
            body: body,
        });
        console.log(`[Push Notification] 성공적으로 발송됨: User ${userId}`);
    } catch (error) {
        console.error(`[Push Notification] 발송 실패: User ${userId}`, error);
    }
}

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
        .jpeg({ quality: 92, mozjpeg: true })
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
   CLOUD FUNCTIONS
   ========================================================================= */

// ✨ 신규: 새 주문 발생 시 대표님 슬랙으로 알림 보내기!
export const onNewOrderCreated = onDocumentCreated(
    { document: "orders/{orderId}", region: "us-central1" },
    async (event) => {
        const snap = event.data;
        if (!snap) return;

        const data = snap.data();
        const orderId = event.params.orderId;
        const orderCode = data.orderCode || orderId;

        // "pending" 이나 "paid" 상태 등으로 새로 들어온 주문만 필터링할 수 있지만,
        // 보통 문서가 '처음 생성'될 때 트리거되므로 장바구니 결제 시작 직후(pending)에 알림이 갑니다.

        const customerName = data.customer?.fullName || data.shipping?.fullName || "Guest";
        const itemsCount = data.itemsCount || 0;

        // 주소 조립
        const addressParts = [
            data.shipping?.address1,
            data.shipping?.address2,
            data.shipping?.city,
            data.shipping?.state
        ].filter(Boolean);
        const fullAddress = addressParts.join(" ") || "주소 미입력";

        // 한국 시간 기준으로 보기 편하게
        const orderDate = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

        const slackMessage = {
            text: `🔔 *[새 주문 도착]* 새로운 주문이 접수되었습니다!`,
            attachments: [
                {
                    color: "#36a64f", // 초록색 띠
                    fields: [
                        { title: "주문번호", value: orderCode, short: true },
                        { title: "고객명", value: customerName, short: true },
                        { title: "주문일자", value: orderDate, short: false },
                        { title: "타일 수량", value: `${itemsCount}개`, short: true },
                        { title: "배송지", value: fullAddress, short: false }
                    ]
                }
            ]
        };

        try {
            await axios.post(SLACK_WEBHOOK_URL, slackMessage);
        } catch (error) {
            console.error("[Slack Notification] 새 주문 알림 발송 실패:", error);
        }
    }
);


export const adminUpdateOrderOps = onCall({ region: "us-central1", cors: true }, async (req) => {
    try {
        if (!req.auth?.uid || req.auth.token.isAdmin !== true) {
            throw new HttpsError("permission-denied", "Admin only.");
        }

        const db = getFirestore();
        await db.collection("adminTasks").add({
            type: "UPDATE_ORDER_OPS",
            payload: {
                ...req.data,
                uid: req.auth.uid,
                email: req.auth.token.email || "unknown"
            },
            status: "pending",
            createdAt: FieldValue.serverTimestamp()
        });

        return { ok: true };
    } catch (e: any) {
        console.error("[adminUpdateOrderOps] failed", e);
        throw new HttpsError("internal", e?.message || "Update failed");
    }
});

export const adminBatchUpdateOrderStatus = onCall({ region: "us-central1", cors: true }, async (req) => {
    try {
        if (!req.auth?.uid || req.auth.token.isAdmin !== true) {
            throw new HttpsError("permission-denied", "Admin only.");
        }

        const db = getFirestore();
        await db.collection("adminTasks").add({
            type: "BATCH_UPDATE_STATUS",
            payload: {
                ...req.data,
                uid: req.auth.uid,
                email: req.auth.token.email || "unknown"
            },
            status: "pending",
            createdAt: FieldValue.serverTimestamp()
        });

        return { ok: true };
    } catch (e: any) {
        console.error("[adminBatchUpdateOrderStatus] failed", e);
        throw new HttpsError("internal", e?.message || "Batch update failed");
    }
});

export const adminBatchUpdate = onCall({ region: "us-central1", cors: true }, async (req) => {
    try {
        if (!req.auth?.uid || req.auth.token.isAdmin !== true) {
            throw new HttpsError("permission-denied", "Admin only.");
        }
        const db = getFirestore();
        await db.collection("adminTasks").add({
            type: "BATCH_UPDATE_STATUS",
            payload: { ...req.data, uid: req.auth.uid, email: req.auth.token.email },
            status: "pending",
            createdAt: FieldValue.serverTimestamp()
        });
        return { ok: true };
    } catch (e: any) {
        throw new HttpsError("internal", e?.message || "Batch update failed");
    }
});

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
        cpu: 2
    },
    async (event) => {
        const snap = event.data;
        if (!snap) return;

        const db = getFirestore();
        const bucket = getStorage().bucket();

        const { orderId } = event.params as any;

        const item = snap.data() as any;
        const index = item?.index ?? 0;

        const sourcePath: string | undefined = item?.assets?.sourcePath;
        const cropPx = item?.cropPx || item?.edits?.committed?.cropPx || null;
        const matrix: ColorMatrix | null = item?.filterParams?.matrix ?? null;

        const overlayColorHex: string | undefined = item?.filterParams?.overlayColor ?? item?.overlayColor;
        const overlayOpacityRaw: number | undefined = item?.filterParams?.overlayOpacity ?? item?.overlayOpacity;

        if (item?.assets?.printUrl) return;

        if (!sourcePath) return;

        try {
            const sourceFile = bucket.file(sourcePath);
            let fileExists = false;
            for (let i = 0; i < 10; i++) {
                const [exists] = await sourceFile.exists();
                if (exists) {
                    fileExists = true;
                    break;
                }
                await new Promise(r => setTimeout(r, 1500));
            }

            if (!fileExists) return;

            const [sourceBuf] = await sourceFile.download();
            let pipeline = sharp(sourceBuf).rotate();

            if (cropPx) {
                const rect = await clampCropToImage(sourceBuf, cropPx);
                pipeline = pipeline.extract(rect);
            }

            let buf = await pipeline
                .resize(4000, 4000, { fit: "cover", withoutEnlargement: false })
                .jpeg({ quality: 92, mozjpeg: true })
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
                        width: 4000, height: 4000, channels: 4,
                        background: { r: overlay.r, g: overlay.g, b: overlay.b, alpha },
                    },
                }).png().toBuffer();
                buf = await sharp(buf).composite([{ input: overlayPng, blend: "over" }]).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
            }

            const orderRef = db.collection("orders").doc(orderId);
            const orderSnap = await orderRef.get();
            const storageBasePath = orderSnap.data()?.storageBasePath;

            if (!storageBasePath) return;

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
                console.warn("[Print5000] getSignedUrl failed", e);
            }

            await snap.ref.update({
                "assets.printPath": printPath,
                "assets.printUrl": printUrl,
                printUrl,
            });
        } catch (err) {
            console.error("[Print5000] failed", err);
        }
    }
);

export const processAdminTask = onDocumentCreated(
    { document: "adminTasks/{taskId}", region: "us-central1", timeoutSeconds: 300, memory: "1GiB" },
    async (event) => {
        const snap = event.data;
        if (!snap) return;

        const task = snap.data();
        const db = getFirestore();
        const timestamp = FieldValue.serverTimestamp();

        try {
            if (task.type === "BATCH_UPDATE_STATUS" || task.type === "UPDATE_ORDER_OPS") {
                const isBatch = task.type === "BATCH_UPDATE_STATUS";
                const { orderIds, orderId, status, trackingNumber, adminNote, uid, email } = task.payload || {};

                const targetIds = isBatch ? orderIds : (orderId ? [orderId] : []);
                if (!Array.isArray(targetIds) || targetIds.length === 0) {
                    throw new Error("No target order IDs provided.");
                }

                const batch = db.batch();
                const notifications: { userId: string, title: string, body: string }[] = [];

                for (const id of targetIds) {
                    if (!id) continue;
                    const ref = db.collection("orders").doc(String(id));
                    const docSnap = await ref.get();
                    const orderData = docSnap.data();

                    if (!orderData) continue;

                    const userId = orderData?.userId || orderData?.uid || orderData?.customer?.uid || orderData?.customer?.id || orderData?.createdBy;

                    const updates: any = { updatedAt: timestamp };
                    if (status !== undefined) {
                        updates.status = status;
                        updates.statusUpdatedAt = timestamp; // ✨ 자동화를 위한 시간 기록
                    }
                    if (trackingNumber !== undefined) updates.trackingNumber = trackingNumber;
                    if (adminNote !== undefined) updates.adminNote = adminNote;

                    batch.set(ref, updates, { merge: true });

                    batch.set(ref.collection("events").doc(), {
                        type: status ? "STATUS_CHANGED" : "OPS_UPDATE",
                        to: status || undefined,
                        changes: { trackingNumber, adminNote },
                        byUid: uid || "admin",
                        byEmail: email || "unknown",
                        createdAt: timestamp,
                    });

                    // 100% 태국어 알림 로직
                    if (userId) {
                        let pushTitle = "";
                        let pushBody = "";

                        if (status) {
                            const s = status.toLowerCase();
                            if (s === "processing") {
                                pushTitle = "🎨 เราเริ่มทำ MemoTile ของคุณแล้ว!";
                                pushBody = "ทีมงานของเรากำลังพิมพ์ภาพถ่ายของคุณอย่างละเอียด";
                            } else if (s === "printed") {
                                pushTitle = "📸 พิมพ์ภาพเสร็จเรียบร้อย!";
                                pushBody = "ภาพของคุณถูกพิมพ์อย่างสวยงามและกำลังเตรียมจัดส่งค่ะ";
                            } else if (s === "shipping") {
                                pushTitle = "🚚 ความทรงจำของคุณกำลังเดินทางไปหา!";
                                pushBody = "ข่าวดี! MemoTile ของคุณถูกจัดส่งเรียบร้อยแล้ว เตรียมรับพัสดุได้เลยค่ะ";
                            } else if (s === "delivered") {
                                pushTitle = "🎁 พัสดุจัดส่งสำเร็จ!";
                                pushBody = "หวังว่าคุณจะชอบ MemoTile ของคุณนะคะ ขอบคุณที่ใช้บริการค่ะ!";
                            } else {
                                pushTitle = "อัปเดตสถานะการสั่งซื้อ";
                                pushBody = `คำสั่งซื้อของคุณได้รับการเปลี่ยนสถานะเป็น [${status.toUpperCase()}] แล้วค่ะ`;
                            }
                        }

                        if (trackingNumber && trackingNumber !== orderData.trackingNumber) {
                            pushTitle = "🚚 อัปเดตข้อมูลการจัดส่ง";
                            pushBody = `หมายเลขพัสดุของคุณคือ: ${trackingNumber} สามารถตรวจสอบสถานะได้เลยค่ะ!`;
                        }

                        if (pushTitle) {
                            notifications.push({ userId, title: pushTitle, body: pushBody });
                        }
                    }
                }

                await batch.commit();

                for (const noti of notifications) {
                    await sendExpoPushNotification(noti.userId, noti.title, noti.body);
                }
            }
            else if (task.type === "MARKETING_PUSH") {
                const { target, filters, testToken, en, th } = task.payload || {};
                const titleTh = th?.title;
                const bodyTh = th?.body;
                const titleEn = en?.title;
                const bodyEn = en?.body;

                if (!titleEn && !titleTh) throw new Error("No message content provided.");

                if (target === "test_token" && testToken) {
                    const finalTitle = titleTh || titleEn;
                    const finalBody = bodyTh || bodyEn;

                    await axios.post("https://exp.host/--/api/v2/push/send", {
                        to: testToken,
                        sound: "default",
                        title: finalTitle,
                        body: finalBody,
                    });
                }
                else {
                    const usersSnap = await db.collection("users").get();
                    const notifications: { userId: string, title: string, body: string }[] = [];

                    const uniqueTokens = new Set<string>();

                    for (const userDoc of usersSnap.docs) {
                        const userData = userDoc.data();
                        const pushToken = userData?.expoPushToken || userData?.pushToken;

                        if (!pushToken || uniqueTokens.has(pushToken)) continue;

                        const userId = userDoc.id;

                        if (target === "admins" && userData.isAdmin !== true) continue;

                        if (filters?.joinPeriod && filters.joinPeriod !== "all") {
                            const createdAt = userData.createdAt?.toDate ? userData.createdAt.toDate() : new Date();
                            const diffDays = (new Date().getTime() - createdAt.getTime()) / (1000 * 3600 * 24);
                            if (filters.joinPeriod === "recent_7" && diffDays > 7) continue;
                            if (filters.joinPeriod === "recent_30" && diffDays > 30) continue;
                        }

                        if (filters?.userGroup && filters.userGroup !== "all") {
                            const ordersSnap = await db.collection("orders").where("userId", "==", userId).get();
                            const orderCount = ordersSnap.size;
                            const hasAbandoned = ordersSnap.docs.some(d => ["pending", "payment_pending"].includes(d.data().status));

                            if (filters.userGroup === "zero_order" && orderCount > 0) continue;
                            if (filters.userGroup === "vip" && orderCount < 2) continue;
                            if (filters.userGroup === "abandoned" && !hasAbandoned) continue;
                        }

                        const finalTitle = titleTh || titleEn;
                        const finalBody = bodyTh || bodyEn;

                        if (finalTitle && finalBody) {
                            uniqueTokens.add(pushToken);
                            notifications.push({ userId, title: finalTitle, body: finalBody });
                        }
                    }

                    for (const noti of notifications) {
                        await sendExpoPushNotification(noti.userId, noti.title, noti.body);
                    }
                }
            }

            await snap.ref.update({ status: "completed", completedAt: timestamp });

        } catch (error) {
            console.error("Task error:", error);
            await snap.ref.update({ status: "error", error: String(error) });
        }
    }
);

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
            await file.save(Buffer.from(jsonText, "utf8"), { contentType: "application/json; charset=utf-8", resumable: false });

            const filename = `memotile_printer_${Date.now()}.json`;
            const [url] = await file.getSignedUrl({
                action: "read", expires: Date.now() + 1000 * 60 * 60 * 24 * 7, responseDisposition: `attachment; filename="${filename}"`, responseType: "application/json",
            });
            return { ok: true, url };
        } catch (e: any) {
            throw new HttpsError("internal", e?.message || "Export printer JSON failed");
        }
    }
);

export const adminExportZipPrints = onCall(
    { region: "us-central1", cors: true, memory: "2GiB", timeoutSeconds: 300 },
    async (req) => {
        try {
            if (!req.auth?.uid || req.auth.token.isAdmin !== true) throw new HttpsError("permission-denied", "Admin only.");
            const { orderIds, type = "print" } = (req.data || {}) as any;
            if (!Array.isArray(orderIds) || orderIds.length === 0) throw new HttpsError("invalid-argument", "orderIds required.");

            const db = getFirestore();
            const bucket = getStorage().bucket();
            const zipName = `exports/zip/${type}_${orderIds.length}orders_${Date.now()}.zip`;
            const zipFile = bucket.file(zipName);

            const archive = archiver("zip", { zlib: { level: 9 } });
            const out = zipFile.createWriteStream({ contentType: "application/zip", resumable: false });
            const uploadPromise = new Promise<void>((resolve, reject) => { out.on("close", resolve); out.on("finish", resolve); out.on("error", reject); });

            archive.pipe(out);
            let addedCount = 0;

            for (const rawOrderId of orderIds) {
                const orderId = String(rawOrderId);
                const orderSnap = await db.collection("orders").doc(orderId).get();
                if (!orderSnap.exists) continue;

                const orderData: any = orderSnap.data() || {};
                const orderCode = orderData?.orderCode || orderId;
                const dateKey = toYYYYMMDD(orderData?.createdAt);
                const customerName = safeFolderName(orderData?.customer?.fullName || orderData?.shipping?.fullName || "Guest");
                const baseFolder = `${dateKey}/${orderCode}/${customerName}`;

                const itemsSnap = await orderSnap.ref.collection("items").orderBy("index").get();
                const items = itemsSnap.empty ? orderData?.items || [] : itemsSnap.docs.map((d) => d.data());
                const shipping = orderData?.shipping || {};
                const infoText = `[ORDER INFO]\nOrder Code : ${orderCode}\nDate       : ${dateKey}\nCustomer   : ${customerName}\nPhone      : ${orderData?.customer?.phone || shipping?.phone || "-"}\nEmail      : ${orderData?.customer?.email || "-"}\n\n[SHIPPING ADDRESS]\nName       : ${shipping?.fullName || "-"}\nAddress    : ${shipping?.address1 || ""} ${shipping?.address2 || ""}\nCity/State : ${shipping?.city || ""}, ${shipping?.state || ""}\nPostal Code: ${shipping?.postalCode || ""}\nPhone      : ${shipping?.phone || "-"} (Required)\n\n[ITEMS]\nTotal Items: ${items.length} EA\nNote       : ${orderData?.adminNote || "-"}\n`.trim();

                archive.append(infoText, { name: `${baseFolder}/order_info.txt` });

                for (const item of items) {
                    const index = Number.isFinite(item?.index) ? Number(item.index) : 0;
                    const fileIndex = String(index + 1).padStart(2, "0");
                    const path = type === "print" ? item?.assets?.printPath || item?.printPath : item?.assets?.previewPath || item?.previewPath;

                    if (!path) continue;
                    const file = bucket.file(path);
                    const [exists] = await file.exists();

                    if (exists) {
                        const ext = (String(path).split(".").pop() || "jpg").toLowerCase();
                        archive.append(file.createReadStream(), { name: `${baseFolder}/${fileIndex}.${ext}` });
                        addedCount++;
                    } else {
                        archive.append(`Missing file: ${path}\n`, { name: `${baseFolder}/MISSING_${fileIndex}.txt` });
                    }
                }
            }

            if (addedCount === 0) archive.append("No images found.", { name: "WARNING_NO_IMAGES.txt" });

            await archive.finalize();
            await uploadPromise;

            const filename = `Batch_${orderIds.length}orders_${new Date().toISOString().slice(0, 10)}.zip`;
            const [url] = await zipFile.getSignedUrl({
                action: "read", expires: Date.now() + 1000 * 60 * 60, responseDisposition: `attachment; filename="${filename}"`, responseType: "application/zip",
            });
            return { ok: true, url, addedCount };
        } catch (e: any) {
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

            const db = getFirestore();
            const orderRef = db.collection("orders").doc(orderId);
            const itemsRef = orderRef.collection("items");
            const q = itemsRef.where("index", "==", index).limit(1);
            const snap = await q.get();

            const printMeta = { width, height, ok5000, checkedAt: new Date().toISOString(), source: "storage_finalize" };

            if (!snap.empty) {
                await snap.docs[0].ref.update({ "assets.printMeta": printMeta });
            } else {
                await db.runTransaction(async (t) => {
                    const docSnap = await t.get(orderRef);
                    if (!docSnap.exists) return;
                    const items = (docSnap.data() as any)?.items;
                    if (Array.isArray(items)) {
                        let found = false;
                        const newItems = items.map((it: any) => {
                            if (it.index === index) { found = true; return { ...it, assets: { ...(it.assets || {}), printMeta } }; }
                            return it;
                        });
                        if (found) t.update(orderRef, { items: newItems });
                    }
                });
            }
        } catch (e) {
            console.error(`[PrintAudit] Failed for ${filePath}`, e);
        }
    }
);

/* =========================================================================
   SCHEDULED FUNCTIONS
   ========================================================================= */

// ✨ 신규: 매일 오전 4시에 돌면서 '배송중(shipping)'으로 바뀐 지 3일 된 주문을 '배송완료(delivered)'로 자동 변경!
export const autoCompleteDeliveredOrders = onSchedule(
    {
        schedule: "0 4 * * *", // 매일 새벽 4시 실행 (태국 시간 기준 오전 11시)
        timeZone: "Asia/Bangkok",
        region: "us-central1"
    },
    async (event) => {
        const db = getFirestore();
        const now = new Date();
        // 딱 3일(72시간) 전 시간 계산
        const threeDaysAgo = admin.firestore.Timestamp.fromDate(new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000)));

        try {
            // 상태가 shipping이고, 업데이트된 지 3일이 넘은 주문 검색
            const snapshot = await db.collection("orders")
                .where("status", "==", "shipping")
                .where("statusUpdatedAt", "<=", threeDaysAgo) // 상태가 바뀐 지 3일!
                .get();

            if (snapshot.empty) return;

            const batch = db.batch();
            let processedCount = 0;
            const notifications: { userId: string, title: string, body: string }[] = [];

            for (const docSnap of snapshot.docs) {
                const data = docSnap.data();
                const orderRef = docSnap.ref;
                const userId = data.userId || data.uid || data.customer?.uid || data.customer?.id || data.createdBy;

                // 1. 상태를 Delivered로 덮어쓰기
                batch.update(orderRef, {
                    status: "delivered",
                    deliveredAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                    statusUpdatedAt: FieldValue.serverTimestamp(), // 이것도 업데이트
                    adminNote: (data.adminNote ? data.adminNote + "\n" : "") + "🚚 시스템 자동 배송완료 처리 (발송 후 3일 경과)"
                });

                // 2. 이벤트 히스토리에 기록
                batch.set(orderRef.collection("events").doc(), {
                    type: "STATUS_CHANGED",
                    to: "delivered",
                    reason: "3일 경과 자동 배송완료 처리",
                    byUid: "system",
                    createdAt: FieldValue.serverTimestamp(),
                });

                // 3. 고객에게 보낼 알림 장전 (태국어)
                if (userId) {
                    notifications.push({
                        userId,
                        title: "🎁 พัสดุจัดส่งสำเร็จ!",
                        body: "หวังว่าคุณจะชอบ MemoTile ของคุณนะคะ ขอบคุณที่ใช้บริการค่ะ!"
                    });
                }
                processedCount++;
            }

            await batch.commit();

            // 고객에게 실제 푸시 알림 쏘기
            for (const noti of notifications) {
                await sendExpoPushNotification(noti.userId, noti.title, noti.body);
            }

            // 대표님 슬랙으로 자동화 결과 보고 쏘기
            try {
                await axios.post(SLACK_WEBHOOK_URL, {
                    text: `🚚 *[배송완료 자동처리 성공]* 발송 후 3일이 경과된 주문 *${processedCount}건*이 자동으로 'Delivered' 상태로 변경되고 고객에게 앱 알림이 발송되었습니다.`
                });
            } catch (e) { }

        } catch (error) {
            console.error("autoCompleteDeliveredOrders 실행 중 오류 발생:", error);
        }
    }
);

export const cleanupAbandonedPendingOrders = onSchedule({ schedule: "every 1 hours", timeZone: "Asia/Bangkok", region: "us-central1" }, async (event) => {
    const db = getFirestore(); const bucket = getStorage().bucket(); const now = new Date();
    try {
        const snapshot = await db.collection("orders").where("status", "==", "pending").get();
        if (snapshot.empty) return;

        const batch = db.batch(); let processedCount = 0;
        for (const docSnap of snapshot.docs) {
            const data = docSnap.data(); const orderRef = docSnap.ref;
            if (!data.createdAt) continue;
            const createdAt = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
            const diffHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);

            if (diffHours < 24) continue;
            if (data.storageBasePath) { try { await bucket.deleteFiles({ prefix: data.storageBasePath }); } catch (storageErr) { } }

            const itemsSnap = await orderRef.collection("items").get();
            itemsSnap.forEach(item => batch.delete(item.ref));

            batch.update(orderRef, { status: "deleted", adminNote: "24시간 결제 미완료로 인한 시스템 자동 삭제 (사진 파기 완료)", deletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
            processedCount++;
        }

        if (processedCount === 0) return;
        await batch.commit();
        try { await axios.post(SLACK_WEBHOOK_URL, { text: `🧹 *[팬딩 주문 자동 삭제 완료]* 24시간이 지난 결제 미완료 주문 *${processedCount}건*이 '자동 삭제' 처리되었습니다.` }); } catch (e) { }
    } catch (e) { console.error("cleanupAbandonedPendingOrders 에러:", e); }
});

export const alertAbandonedOrders = onSchedule("every 1 hours", async (event) => {
    const db = getFirestore(); const now = new Date();
    const twentyFourHoursAgo = admin.firestore.Timestamp.fromDate(new Date(now.getTime() - (24 * 60 * 60 * 1000)));
    try {
        const snapshot = await db.collection("orders").where("status", "==", "paid").where("createdAt", "<=", twentyFourHoursAgo).orderBy("createdAt", "asc").get();
        if (snapshot.empty) return;
        const count = snapshot.size;
        const orderDetails = snapshot.docs.map(doc => `• 주문번호: ${doc.data().orderCode || doc.id} (고객: ${doc.data().customer?.fullName || 'Guest'})`).join("\n");
        await axios.post(SLACK_WEBHOOK_URL, {
            text: `🚨 *[방치 주문 알림]* 24시간 동안 '결제완료' 상태에서 변동이 없는 주문이 *${count}건* 있습니다.`,
            attachments: [{ color: "#FF0000", title: "조치 필요 주문 목록", text: orderDetails, footer: "Memotile Admin Bot", ts: Math.floor(now.getTime() / 1000) }]
        });
    } catch (e: any) { }
});

export const autoArchiveOldOrders = onSchedule("0 3 * * *", async (event) => {
    const db = getFirestore(); const now = new Date();
    const sevenDaysAgo = admin.firestore.Timestamp.fromDate(new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)));
    const statusesToArchive = ["delivered", "canceled", "refunded"];
    let totalArchived = 0;

    for (const status of statusesToArchive) {
        const snapshot = await db.collection("orders").where("status", "==", status).where("updatedAt", "<=", sevenDaysAgo).limit(500).get();
        if (snapshot.empty) continue;
        const batch = db.batch();
        snapshot.docs.forEach((doc) => { batch.update(doc.ref, { status: "archived", archivedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }); totalArchived++; });
        await batch.commit();
    }
    if (totalArchived > 0) {
        try { await axios.post(SLACK_WEBHOOK_URL, { text: `📦 *[자동 아카이브 완료]* 7일 이상 경과된 주문 *${totalArchived}건*이 'archived' 상태로 변경되었습니다.` }); } catch (e) { }
    }
});

export const adminDeleteOrder = onCall({ region: "us-central1", cors: true }, async (req) => {
    try {
        if (!req.auth?.uid || req.auth.token.isAdmin !== true) throw new HttpsError("permission-denied", "Admin 전용 기능입니다.");
        const { orderId } = req.data || {};
        if (!orderId) throw new HttpsError("invalid-argument", "orderId가 필요합니다.");
        const db = getFirestore(); const orderRef = db.collection("orders").doc(String(orderId));
        const items = await orderRef.collection("items").get();
        const batch = db.batch();
        items.forEach(doc => batch.delete(doc.ref)); batch.delete(orderRef);
        await batch.commit();
        return { ok: true };
    } catch (e: any) { throw new HttpsError("internal", e?.message || "Delete failed"); }
});

/* =========================================================================
   ✨ PAYLETTER 통합 결제 연동 (LIVE 운영 서버)
   ========================================================================= */

const PAYLETTER_API_KEY = "5955a60454daa331f178229f2337804f";
const PAYLETTER_CLIENT_ID = "memotile";
const PROJECT_REGION = "us-central1";
const PROJECT_ID = "memotile-app-anti-demo";
const BASE_URL = `https://${PROJECT_REGION}-${PROJECT_ID}.cloudfunctions.net`;
const PAYLETTER_URL = "https://api.payletter.com/api/payment/request";

export const payletterRequestPayment = onCall({ region: "us-central1", cors: true }, async (req) => {
    if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Must be signed in.");
    const { orderId, amount, email, fullName, pgcode, platform, webUrl, appScheme } = req.data || {};
    if (!orderId || !amount) throw new HttpsError("invalid-argument", "Missing required payment fields.");

    const returnQuery = `?platform=${platform || ''}&webUrl=${encodeURIComponent(webUrl || '')}&appScheme=${encodeURIComponent(appScheme || '')}`;
    const paymentData = {
        pginfo: pgcode || "PLCreditCard", storeid: PAYLETTER_CLIENT_ID, currency: "USD", storeorderno: orderId, amount: Number(amount).toFixed(2),
        payerid: req.auth.uid, payeremail: email || "", payername: fullName || "Guest", servicename: "MemoTile",
        returnurl: `${BASE_URL}/payletterReturn${returnQuery}`, notiurl: `${BASE_URL}/payletterWebhook`
    };

    try {
        const response = await axios.post(PAYLETTER_URL, paymentData, { headers: { "Content-Type": "application/json", "Authorization": `GPLKEY ${PAYLETTER_API_KEY}` } });
        if (response.data.mobile_url || response.data.online_url) return { ok: true, paymentUrl: response.data.mobile_url || response.data.online_url };
        else throw new Error(response.data.error?.message || "Failed to receive payment URL.");
    } catch (e: any) { throw new HttpsError("internal", "Payment server communication failed."); }
});

export const payletterWebhook = onRequest({ region: "us-central1" }, async (req, res) => {
    const data = req.body;
    const { storeid, currency, storeorderno, payamt, payerid, timestamp, hash, notifytype, paytoken, retcode } = data;
    const rawString = `${storeid}${currency}${storeorderno}${payamt}${payerid}${timestamp}${PAYLETTER_API_KEY}`;
    const generatedHash = crypto.createHash('sha256').update(rawString).digest('hex');

    if (hash !== generatedHash) { res.status(400).send("Hash mismatch"); return; }
    if (String(notifytype) === "1" && String(retcode) === "0") {
        const db = getFirestore();
        try {
            await db.collection("orders").doc(storeorderno).update({ status: "paid", payToken: paytoken, paidAt: FieldValue.serverTimestamp() });
            res.status(200).send("<RESULT>OK</RESULT>"); return;
        } catch (error) { res.status(500).send("DB Error"); return; }
    }
    res.status(200).send("<RESULT>OK</RESULT>");
});

export const payletterReturn = onRequest({ region: "us-central1" }, async (req, res) => {
    const platform = req.query.platform as string; const webUrl = req.query.webUrl as string; const appScheme = req.query.appScheme as string; const retcode = req.body?.retcode;

    if (platform === 'web' && webUrl) {
        if (String(retcode) === "0") res.redirect(302, webUrl);
        else res.redirect(302, webUrl.split('/myorder/success')[0] || "/");
        return;
    }

    const targetScheme = appScheme || "memotile://";
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1"><title>Payment Processed</title><style>body { text-align: center; padding-top: 60px; font-family: -apple-system, sans-serif; background: #fff; color: #111; } h2 { color: #111; font-size: 24px; margin-bottom: 12px; } p { color: #6B7280; font-size: 15px; margin-bottom: 30px; line-height: 1.5; padding: 0 20px; } .btn { display: inline-block; padding: 14px 28px; background: #111; color: #fff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 16px; }</style></head><body><h2>Payment Processed</h2><p>If the app doesn't open automatically, please tap <b>"Return to App"</b>.</p><a href="${targetScheme}" class="btn">Return to App</a><script>setTimeout(() => { window.location.href = "${targetScheme}"; }, 500);</script></body></html>`;
    res.status(200).send(html);
});