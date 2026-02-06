import { NextResponse } from "next/server";
import { verifyAdmin } from "../../../../../server/requireAdmin";
import { adminDb } from "../../../../../server/firebaseAdmin";

export async function POST(request: Request) {
    try {
        const authResult = await verifyAdmin(request.headers.get("authorization"));
        if (!authResult.ok) {
            return NextResponse.json({ error: authResult.message }, { status: authResult.status });
        }

        const body = await request.json();
        const { orderIds, trackingNumber } = body;

        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            return NextResponse.json({ error: "Invalid orderIds" }, { status: 400 });
        }
        if (trackingNumber === undefined) {
            return NextResponse.json({ error: "Missing trackingNumber" }, { status: 400 });
        }

        const batch = adminDb.batch();
        const now = new Date();
        const tracking = trackingNumber.trim();

        // Note: For bulk tracking, we set the SAME tracking number for all. 
        // This is useful for grouping orders into one shipment.
        // Also auto-transitions to SHIPPING if status allows.

        // Since we can't read-then-write efficiently in a simple batch loop without multiple reads,
        // we will just blindly set status='shipping' IF tracking is present and status is NOT delivered/canceled/refunded?
        // Actually, the requirement says "Auto status transition to SHIPPING when tracking is saved if current status is PAID/PROCESSING/PRINTED".
        // To do this strictly in batch, we'd need to read each doc.
        // For efficiency, we will fetch all docs first.

        const refs = orderIds.map(id => adminDb.collection("orders").doc(id));
        const snapshots = await adminDb.getAll(...refs);

        snapshots.forEach(doc => {
            if (!doc.exists) return;
            const data = doc.data()!;
            const updates: any = {
                trackingNumber: tracking,
                updatedAt: now
            };

            if (tracking.length > 0 && ['paid', 'processing', 'printed'].includes(data.status)) {
                updates.status = 'shipping';
            }

            batch.update(doc.ref, updates);
        });

        await batch.commit();

        return NextResponse.json({ success: true, count: orderIds.length });
    } catch (error: any) {
        console.error("Admin batch tracking error:", error);
        return NextResponse.json(
            { error: error.message || "Unauthorized" },
            { status: error.status || 500 }
        );
    }
}
