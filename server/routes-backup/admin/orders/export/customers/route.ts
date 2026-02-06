import { NextResponse } from "next/server";
import { verifyAdmin } from "../../../../../server/requireAdmin";
import { listOrders } from "../../../../../server/orderRepo";

export async function GET(request: Request) {
    try {
        const authResult = await verifyAdmin(request.headers.get("authorization"));
        if (!authResult.ok) {
            return NextResponse.json({ error: authResult.message }, { status: authResult.status });
        }

        const { searchParams } = new URL(request.url);
        // Supports same filtering as list
        const q = searchParams.get("q") || undefined;
        const status = searchParams.get("status") || undefined;
        const from = searchParams.get("from") || undefined;
        const to = searchParams.get("to") || undefined;
        const sort = (searchParams.get("sort") as "asc" | "desc") || "desc";
        const mode = (searchParams.get("mode") as "queue" | "default") || undefined;

        // No limit for export, or set high limit?
        // For now set high limit 1000. For production might need cursor iteration.
        const limit = 1000;

        const { rows } = await listOrders({
            q,
            status,
            from,
            to,
            sort,
            mode,
            limit
        });

        const csvRows = [
            // Header
            [
                "Order Code",
                "Date",
                "Status",
                "Customer Name",
                "Email",
                "Phone",
                "Country",
                "Address",
                "City",
                "Postal",
                "Total",
                "Currency",
                "Tracking Number",
                "Admin Note"
            ].join(","),
            // Data
            ...rows.map(o => [
                o.orderCode,
                o.createdAt,
                o.status,
                `"${(o.customer.fullName || "").replace(/"/g, '""')}"`,
                o.customer.email,
                o.customer.phone,
                o.shipping.country,
                `"${(o.shipping.address1 + (o.shipping.address2 ? ' ' + o.shipping.address2 : '')).replace(/"/g, '""')}"`,
                o.shipping.city,
                o.shipping.postalCode,
                o.pricing.total,
                o.currency,
                `"${(o.trackingNumber || "").replace(/"/g, '""')}"`,
                `"${(o.adminNote || "").replace(/"/g, '""')}"`
            ].join(","))
        ];

        return new NextResponse(csvRows.join("\n"), {
            headers: {
                "Content-Type": "text/csv",
                "Content-Disposition": `attachment; filename="orders_export_${new Date().toISOString().split('T')[0]}.csv"`,
            }
        });

    } catch (error: any) {
        console.error("Admin export csv error:", error);
        return NextResponse.json(
            { error: error.message || "Unauthorized" },
            { status: error.status || 500 }
        );
    }
}
