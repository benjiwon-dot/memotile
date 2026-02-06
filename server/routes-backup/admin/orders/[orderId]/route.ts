import { NextResponse } from "next/server";
import { verifyAdmin } from "../../../../../server/requireAdmin";
import { getOrderDetail } from "../../../../../server/orderRepo";

import { adminDb } from "../../../../../server/firebaseAdmin";

export async function GET(
    request: Request,
    { params }: { params: { orderId: string } }
) {
    try {
        const authResult = await verifyAdmin(request.headers.get("authorization"));
        if (!authResult.ok) {
            return NextResponse.json({ error: authResult.message }, { status: authResult.status });
        }

        const { orderId } = params;
        if (!orderId) {
            return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
        }

        const order = await getOrderDetail(orderId);

        if (!order) {
            return NextResponse.json({ error: "Order not found" }, { status: 404 });
        }

        return NextResponse.json(order);
    } catch (error: any) {
        console.error(`Admin get order ${params?.orderId} error:`, error);
        return NextResponse.json(
            { error: error.message || "Unauthorized" },
            { status: error.status || 500 }
        );
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: { orderId: string } }
) {
    try {
        const authResult = await verifyAdmin(request.headers.get("authorization"));
        if (!authResult.ok) {
            return NextResponse.json({ error: authResult.message }, { status: authResult.status });
        }

        const { orderId } = params;
        if (!orderId) {
            return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
        }

        const body = await request.json();
        const { status, adminNote, trackingNumber } = body;
        const updates: any = { updatedAt: new Date() };

        if (status) updates.status = status;
        if (adminNote !== undefined) updates.adminNote = adminNote;

        // Auto status to SHIPPING logic
        if (trackingNumber !== undefined) {
            updates.trackingNumber = trackingNumber;
            // If tracking is set, and status is acceptable, move to shipping
            if (trackingNumber && trackingNumber.trim().length > 0) {
                const docSnap = await adminDb.collection("orders").doc(orderId).get();
                const currentStatus = docSnap.data()?.status;
                if (['paid', 'processing', 'printed'].includes(currentStatus)) {
                    updates.status = 'shipping';
                }
            }
        }

        await adminDb.collection("orders").doc(orderId).update(updates);

        return NextResponse.json({ success: true, updates });
    } catch (error: any) {
        console.error(`Admin update order ${params?.orderId} error:`, error);
        return NextResponse.json(
            { error: error.message || "Unauthorized" },
            { status: error.status || 500 }
        );
    }
}
