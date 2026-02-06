import express from 'express';
import cors from 'cors';
import { verifyAdmin } from './requireAdmin';
import { listOrders, getOrderDetail } from './orderRepo';
import { adminDb } from './firebaseAdmin';

// Initialize Express
const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());

// Auth Middleware
const requireAdmin = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    const authResult = await verifyAdmin(authHeader);
    if (!authResult.ok) {
        res.status(authResult.status).json({ error: authResult.message });
        return;
    }
    next();
};

// --- ROUTES ---

// 1. List Orders
app.get('/api/admin/orders', requireAdmin, async (req, res) => {
    try {
        const { q, status, from, to, sort, mode, limit } = req.query as any;

        const result = await listOrders({
            q: q as string,
            status: status as string,
            from: from as string,
            to: to as string,
            sort: sort as "asc" | "desc",
            mode: mode as "queue" | "default",
            limit: limit ? parseInt(limit) : undefined
        });
        res.json(result);
    } catch (error: any) {
        console.error("List orders error:", error);
        res.status(500).json({ error: error.message });
    }
});

// 2. Export Customers CSV
app.get('/api/admin/orders/export/customers', requireAdmin, async (req, res) => {
    try {
        const { q, status, from, to, sort, mode } = req.query as any;
        const limit = 1000; // High limit for export

        const { rows } = await listOrders({
            q, status: status as string, from: from as string, to: to as string,
            sort: sort as "asc" | "desc", mode: mode as "queue" | "default", limit
        });

        const csvRows = [
            ["Order Code", "Date", "Status", "Customer Name", "Email", "Phone", "Country", "Address", "City", "Postal", "Total", "Currency", "Tracking Number", "Admin Note"].join(","),
            ...rows.map(o => [
                o.orderCode, o.createdAt, o.status,
                `"${(o.customer.fullName || "").replace(/"/g, '""')}"`,
                o.customer.email, o.customer.phone,
                o.shipping.country,
                `"${(o.shipping.address1 + (o.shipping.address2 ? ' ' + o.shipping.address2 : '')).replace(/"/g, '""')}"`,
                o.shipping.city, o.shipping.postalCode, o.pricing.total, o.currency,
                `"${(o.trackingNumber || "").replace(/"/g, '""')}"`,
                `"${(o.adminNote || "").replace(/"/g, '""')}"`
            ].join(","))
        ];

        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', `attachment; filename="orders_export_${new Date().toISOString().split('T')[0]}.csv"`);
        res.send(csvRows.join("\n"));
    } catch (error: any) {
        console.error("Export CSV error:", error);
        res.status(500).json({ error: error.message });
    }
});

// 3. Get Order Detail
app.get('/api/admin/orders/:orderId', requireAdmin, async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await getOrderDetail(orderId);
        if (!order) {
            res.status(404).json({ error: "Order not found" });
            return;
        }
        res.json(order);
    } catch (error: any) {
        console.error(`Get order ${req.params.orderId} error:`, error);
        res.status(500).json({ error: error.message });
    }
});

// 4. Update Order (PATCH)
app.patch('/api/admin/orders/:orderId', requireAdmin, async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status, adminNote, trackingNumber } = req.body;
        const updates: any = { updatedAt: new Date() };

        if (status) updates.status = status;
        if (adminNote !== undefined) updates.adminNote = adminNote;

        if (trackingNumber !== undefined) {
            updates.trackingNumber = trackingNumber;
            if (trackingNumber && trackingNumber.trim().length > 0) {
                const docSnap = await adminDb.collection("orders").doc(orderId).get();
                const currentStatus = docSnap.data()?.status;
                if (['paid', 'processing', 'printed'].includes(currentStatus)) {
                    updates.status = 'shipping';
                }
            }
        }

        await adminDb.collection("orders").doc(orderId).update(updates);
        res.json({ success: true, updates });
    } catch (error: any) {
        console.error(`Update order ${req.params.orderId} error:`, error);
        res.status(500).json({ error: error.message });
    }
});

// 5. Batch Status
app.post('/api/admin/orders/batch/status', requireAdmin, async (req, res) => {
    try {
        const { orderIds, status } = req.body;
        if (!Array.isArray(orderIds) || !status) {
            res.status(400).json({ error: "Invalid input" });
            return;
        }

        const batch = adminDb.batch();
        const now = new Date();
        orderIds.forEach((id: string) => {
            const ref = adminDb.collection("orders").doc(id);
            batch.update(ref, { status, updatedAt: now });
        });
        await batch.commit();
        res.json({ success: true, count: orderIds.length });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// 6. Batch Notes
app.post('/api/admin/orders/batch/notes', requireAdmin, async (req, res) => {
    try {
        const { orderIds, adminNote } = req.body;
        if (!Array.isArray(orderIds) || adminNote === undefined) {
            res.status(400).json({ error: "Invalid input" });
            return;
        }
        const batch = adminDb.batch();
        const now = new Date();
        orderIds.forEach((id: string) => {
            const ref = adminDb.collection("orders").doc(id);
            batch.update(ref, { adminNote, updatedAt: now });
        });
        await batch.commit();
        res.json({ success: true, count: orderIds.length });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// 7. Batch Tracking
app.post('/api/admin/orders/batch/tracking', requireAdmin, async (req, res) => {
    try {
        const { orderIds, trackingNumber } = req.body;
        if (!Array.isArray(orderIds) || trackingNumber === undefined) {
            res.status(400).json({ error: "Invalid input" });
            return;
        }
        const batch = adminDb.batch();
        const now = new Date();
        const tracking = trackingNumber.trim();

        // Fetch to check status for auto-shipping transition
        const refs = orderIds.map(id => adminDb.collection("orders").doc(id));
        const snapshots = await adminDb.getAll(...refs);

        snapshots.forEach(doc => {
            if (!doc.exists) return;
            const data = doc.data()!;
            const updates: any = { trackingNumber: tracking, updatedAt: now };
            if (tracking.length > 0 && ['paid', 'processing', 'printed'].includes(data.status)) {
                updates.status = 'shipping';
            }
            batch.update(doc.ref, updates);
        });
        await batch.commit();
        res.json({ success: true, count: orderIds.length });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// 8. Refund
app.post('/api/admin/orders/refund', requireAdmin, async (req, res) => {
    try {
        const { orderId, reason } = req.body;
        if (!orderId) { res.status(400).json({ error: "Missing orderId" }); return; }

        const ref = adminDb.collection("orders").doc(orderId);
        const doc = await ref.get();
        if (!doc.exists) { res.status(404).json({ error: "Order not found" }); return; }

        const data = doc.data()!;
        const now = new Date();
        const newNote = reason ? `${data.adminNote || ''}\n[REFUND: ${now.toISOString()}] ${reason}`.trim() : data.adminNote;

        await ref.update({ status: 'refunded', refundedAt: now, updatedAt: now, adminNote: newNote });
        res.json({ success: true, status: 'refunded' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// 9. Cancel
app.post('/api/admin/orders/cancel', requireAdmin, async (req, res) => {
    try {
        const { orderId, reason } = req.body;
        if (!orderId) { res.status(400).json({ error: "Missing orderId" }); return; }

        const ref = adminDb.collection("orders").doc(orderId);
        const doc = await ref.get();
        if (!doc.exists) { res.status(404).json({ error: "Order not found" }); return; }

        const data = doc.data()!;
        const now = new Date();
        const newNote = reason ? `${data.adminNote || ''}\n[CANCEL: ${now.toISOString()}] ${reason}`.trim() : data.adminNote;

        await ref.update({ status: 'canceled', canceledAt: now, updatedAt: now, adminNote: newNote });
        res.json({ success: true, status: 'canceled' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// 10. ZIP Export
app.post('/api/admin/orders/export/zip', requireAdmin, async (req, res) => {
    try {
        const { orderIds, type } = req.body;
        if (!Array.isArray(orderIds)) { res.status(400).json({ error: "Invalid input" }); return; }

        const JSZip = require("jszip");
        const zip = new JSZip();

        const refs = orderIds.map(id => adminDb.collection("orders").doc(id));
        const snapshots = await adminDb.getAll(...refs);

        for (const doc of snapshots) {
            if (!doc.exists) continue;
            const data = doc.data()!;
            const orderCode = data.orderCode || doc.id;
            const items = data.items || [];

            if (!Array.isArray(items)) continue;

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                let url = type === 'print' ? item.printUrl || item.assets?.printUrl : item.previewUrl || item.assets?.previewUrl;
                if (!url) continue;

                try {
                    const imgRes = await fetch(url);
                    if (!imgRes.ok) continue;
                    const arrayBuffer = await imgRes.arrayBuffer();
                    const ext = type === 'print' ? 'png' : 'jpg';
                    const filename = `${orderCode}_item${i + 1}_${type}.${ext}`;
                    zip.file(filename, arrayBuffer);
                } catch (e) {
                    console.error("Failed to fetch image", url, e);
                }
            }
        }

        if (Object.keys(zip.files).length === 0) {
            res.status(400).json({ error: "No images found to zip" });
            return;
        }

        const content = await zip.generateAsync({ type: "nodebuffer" });
        res.header('Content-Type', 'application/zip');
        res.header('Content-Disposition', `attachment; filename="orders_${type}_${new Date().getTime()}.zip"`);
        res.send(content);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// START
app.listen(PORT, () => {
    console.log(`Admin Server running on port ${PORT}`);
});
