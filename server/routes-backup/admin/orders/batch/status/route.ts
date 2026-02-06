import { NextResponse } from "next/server";
import { verifyAdmin } from "../../../../../server/requireAdmin";
import { adminDb } from "../../../../../server/firebaseAdmin";
import * as admin from "firebase-admin";

export async function POST(request: Request) {
    try {
        const authResult = await verifyAdmin(request.headers.get("authorization"));
        if (!authResult.ok) {
            return NextResponse.json({ error: authResult.message }, { status: authResult.status });
        }

        const body = await request.json();
        const { orderIds, status } = body;

        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            return NextResponse.json({ error: "Invalid orderIds" }, { status: 400 });
        }
        if (!status) {
            return NextResponse.json({ error: "Missing status" }, { status: 400 });
        }

        const batch = adminDb.batch();
        const now = new Date();

        orderIds.forEach((id: string) => {
            const ref = adminDb.collection("orders").doc(id);
            batch.update(ref, {
                status,
                updatedAt: now
            });
        });

        await batch.commit();

        return NextResponse.json({ success: true, count: orderIds.length });
    } catch (error: any) {
        console.error("Admin batch status update error:", error);
        return NextResponse.json(
            { error: error.message || "Unauthorized" },
            { status: error.status || 500 }
        );
    }
}
