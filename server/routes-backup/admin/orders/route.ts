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
        const q = searchParams.get("q") || undefined;
        const status = searchParams.get("status") || undefined;
        const from = searchParams.get("from") || undefined;
        const to = searchParams.get("to") || undefined;
        const sort = (searchParams.get("sort") as "asc" | "desc") || "desc";
        const mode = (searchParams.get("mode") as "queue" | "default") || undefined;
        const limit = parseInt(searchParams.get("limit") || "50", 10);

        // mode=queue logic is handled in repo, just pass it through

        const result = await listOrders({
            q,
            status,
            from,
            to,
            sort,
            mode,
            limit
        });

        return NextResponse.json(result);
    } catch (error: any) {
        console.error("Admin list orders error:", error);
        return NextResponse.json(
            { error: error.message || "Unauthorized" },
            { status: error.status || 500 }
        );
    }
}
