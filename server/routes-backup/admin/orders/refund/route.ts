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
        const { orderId, reason } = body;

        if (!orderId) {
            return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
        }

        const ref = adminDb.collection("orders").doc(orderId);
        const doc = await ref.get();
        if (!doc.exists) return NextResponse.json({ error: "Order not found" }, { status: 404 });

        const data = doc.data()!;
        const now = new Date();
        const newNote = reason
            ? `${data.adminNote || ''}\n[REFUND: ${now.toISOString()}] ${reason}`.trim()
            : data.adminNote;

        await ref.update({
            status: 'refunded',
            refundedAt: now,
            updatedAt: now,
            adminNote: newNote
        });

        return NextResponse.json({ success: true, status: 'refunded' });
    } catch (error: any) {
        console.error("Admin refund error:", error);
        return NextResponse.json(
            { error: error.message || "Unauthorized" },
            { status: error.status || 500 }
        );
    }
}
