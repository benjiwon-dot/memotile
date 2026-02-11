// src/components/admin/AdminOrderList.web.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
    Search,
    ChevronRight,
    RefreshCw,
    Calendar,
    Package,
    Download,
    CheckSquare,
    Square,
    FileSpreadsheet,
} from "lucide-react";
import { getFunctions, httpsCallable } from "firebase/functions";

import { OrderHeader, OrderStatus } from "@/lib/admin/types";
import { listOrders } from "@/lib/admin/orderRepo";
import StatusBadge from "./StatusBadge";

const isWeb = typeof window !== "undefined";

function norm(s: any) {
    return String(s || "").toLowerCase().trim();
}

function toCsv(rows: Record<string, any>[]) {
    if (!rows.length) return "";
    const headers = Object.keys(rows[0] || {});
    const escape = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
        headers.join(","),
        ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
    ];
    return lines.join("\n");
}

function downloadTextFile(filename: string, text: string, mime = "text/csv;charset=utf-8") {
    if (!isWeb) return;
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

async function downloadFromUrl(url: string, filename = "prints.zip") {
    if (!isWeb) return;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Download failed");
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
    } catch (e) {
        console.error("Download error:", e);
        throw e;
    }
}

export default function AdminOrderList() {
    const router = useRouter();

    const [orders, setOrders] = useState<OrderHeader[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [q, setQ] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("ALL");
    const [from, setFrom] = useState<string>("");
    const [to, setTo] = useState<string>("");

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [bulkLoading, setBulkLoading] = useState(false);

    const lastSigRef = useRef<string>("");

    const fetchOrders = async () => {
        setLoading(true);
        setError(null);
        setSelectedIds(new Set());

        try {
            // ✅ IMPORTANT: Firestore "contains" 검색 불가 → repo는 recent fetch 후, 여기서 부분검색
            const data: any = await listOrders({
                status: statusFilter !== "ALL" ? (statusFilter as OrderStatus) : undefined,
                from: from || undefined,
                to: to || undefined,
                sort: "desc",
                limit: 500, // ✅ 운영 초기: 300~500 정도면 충분
            } as any);

            const rows: OrderHeader[] = Array.isArray(data) ? data : (data?.rows ?? []);
            setOrders(rows);
        } catch (e: any) {
            setError(e?.message || String(e));
        } finally {
            setLoading(false);
        }
    };

    const toggleSelect = (id: string) => {
        const next = new Set(selectedIds);
        next.has(id) ? next.delete(id) : next.add(id);
        setSelectedIds(next);
    };

    const toggleSelectAll = () => {
        if (visibleOrders.length === 0) return;
        if (selectedIds.size === visibleOrders.length) setSelectedIds(new Set());
        else setSelectedIds(new Set(visibleOrders.map((o) => o.id)));
    };

    const handleBulkStatus = async (newStatus: string) => {
        if (selectedIds.size === 0) return;
        if (isWeb && !confirm(`Update ${selectedIds.size} orders to ${newStatus}?`)) return;

        setBulkLoading(true);
        try {
            const fn = httpsCallable(getFunctions(undefined, "us-central1"), "adminBatchUpdateStatus");
            await fn({ orderIds: Array.from(selectedIds), status: newStatus });
            await fetchOrders();
        } catch (e: any) {
            alert("Bulk update failed: " + (e?.message || String(e)));
        } finally {
            setBulkLoading(false);
        }
    };

    const handleBulkZip = async () => {
        if (selectedIds.size === 0) return;

        setBulkLoading(true);
        try {
            const fn = httpsCallable(getFunctions(undefined, "us-central1"), "adminExportZipPrints");
            const res = await fn({ orderIds: Array.from(selectedIds), type: "print" });
            const { url } = (res.data as any) || {};

            if (url) {
                await downloadFromUrl(url, `Memotile_Print_${new Date().toISOString().slice(0, 10)}.zip`);
            } else {
                alert("ZIP generation returned no URL.");
            }
        } catch (e: any) {
            alert("ZIP export failed: " + (e?.message || String(e)));
        } finally {
            setBulkLoading(false);
        }
    };

    const handleExportCSV = async () => {
        // Use selected items if any, otherwise all visible items
        const targets = selectedIds.size > 0
            ? visibleOrders.filter(o => selectedIds.has(o.id))
            : visibleOrders;

        if (targets.length === 0) {
            alert("No orders to export.");
            return;
        }

        const rows = targets.map(o => ({
            Date: formatDate(o.createdAt),
            Name: o.customer?.fullName || o.shipping?.fullName || "Guest",
            Address: [o.shipping?.address1, o.shipping?.address2, o.shipping?.city, o.shipping?.state, o.shipping?.postalCode, o.shipping?.country].filter(Boolean).join(" "),
            Phone: o.customer?.phone || o.shipping?.phone || "",
            OrderNo: o.orderCode,
            Email: o.customer?.email || o.shipping?.email || "",
            TileCount: o.itemsCount,
            Status: o.status
        }));

        const csv = toCsv(rows);
        downloadTextFile(`orders_${new Date().toISOString().slice(0, 10)}.csv`, csv);
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            const sig = JSON.stringify({ status: statusFilter, from, to });
            if (lastSigRef.current === sig) return;
            lastSigRef.current = sig;
            fetchOrders();
        }, 200);

        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter, from, to]);

    const visibleOrders = useMemo(() => {
        const qq = norm(q);
        if (!qq) return orders;

        return orders.filter((o) => {
            const hay = [
                o.orderCode,
                o.id,
                o.customer?.fullName,
                o.customer?.email,
                o.customer?.phone,
                o.shipping?.fullName,
                o.shipping?.phone,
                o.shipping?.email,
                o.shipping?.address1,
                o.shipping?.address2,
                o.shipping?.city,
                o.shipping?.state,
                o.shipping?.postalCode,
            ]
                .map(norm)
                .join(" | ");

            return hay.includes(qq);
        });
    }, [orders, q]);

    const formatDate = (dateStr: string) =>
        new Date(dateStr).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });

    return (
        <div className="space-y-6">
            {/* Status Tabs */}
            <div className="flex gap-2 overflow-x-auto border-b pb-2">
                {["ALL", "paid", "processing", "printed", "shipping", "delivered", "canceled", "refunded"].map((st) => (
                    <button
                        key={st}
                        onClick={() => setStatusFilter(st)}
                        className={`px-4 py-2 rounded-full text-xs font-black uppercase ${statusFilter === st ? "bg-zinc-900 text-white" : "bg-white text-zinc-400 border"
                            }`}
                    >
                        {st}
                    </button>
                ))}
            </div>

            {/* Search + Date */}
            <div className="flex flex-col md:flex-row gap-4">
                <div className="relative flex-1">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                        className="admin-input pl-10 w-full"
                        placeholder="Search by name / email / phone / orderCode / address… (1 char ok)"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                    />
                </div>

                <div className="flex gap-2 items-center">
                    <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                    <span>-</span>
                    <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                    <button onClick={fetchOrders} className="admin-btn admin-btn-secondary !p-2" disabled={loading}>
                        <RefreshCw size={16} />
                    </button>
                </div>
            </div>

            {/* Bulk Bar */}
            {selectedIds.size > 0 && (
                <div className="bg-zinc-900 text-white p-3 rounded-xl flex flex-col md:flex-row gap-3 md:justify-between md:items-center">
                    <span className="font-bold">{selectedIds.size} selected</span>
                    <div className="flex flex-wrap gap-2 items-center">
                        <select
                            disabled={bulkLoading}
                            onChange={(e) => {
                                if (e.target.value) handleBulkStatus(e.target.value);
                                e.target.value = "";
                            }}
                            className="bg-zinc-800 text-xs px-2 py-2 rounded"
                        >
                            <option value="">Set Status</option>
                            <option value="paid">Paid</option>
                            <option value="processing">Processing</option>
                            <option value="printed">Printed</option>
                            <option value="shipping">Shipping</option>
                            <option value="delivered">Delivered</option>
                            <option value="canceled">Canceled</option>
                        </select>

                        <button
                            onClick={handleBulkZip}
                            disabled={bulkLoading}
                            className="bg-white text-zinc-900 px-3 py-2 rounded text-xs font-black inline-flex items-center gap-2"
                        >
                            <Download size={12} /> ZIP (Print)
                        </button>
                    </div>
                </div>
            )}

            <div className="flex justify-between items-center">
                <div className="text-xs text-zinc-500 font-bold">
                    Showing <span className="text-zinc-900">{visibleOrders.length}</span> / {orders.length}
                </div>

                <button
                    onClick={handleExportCSV}
                    disabled={bulkLoading}
                    className="text-xs font-bold text-zinc-500 inline-flex items-center gap-2"
                >
                    <FileSpreadsheet size={14} /> Export CSV
                </button>
            </div>

            {/* Table */}
            <div className="admin-card overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="bg-zinc-50">
                            <th className="p-4">
                                <button onClick={toggleSelectAll}>
                                    {selectedIds.size === visibleOrders.length && visibleOrders.length > 0 ? (
                                        <CheckSquare size={16} />
                                    ) : (
                                        <Square size={16} />
                                    )}
                                </button>
                            </th>
                            <th>Order</th>
                            <th>Date</th>
                            <th>Customer</th>
                            <th>Items</th>
                            <th>Total</th>
                            <th>Status</th>
                            <th />
                        </tr>
                    </thead>

                    <tbody>
                        {visibleOrders.map((order) => (
                            <tr key={order.id} className={selectedIds.has(order.id) ? "bg-blue-50" : ""}>
                                <td className="p-4">
                                    <button onClick={() => toggleSelect(order.id)}>
                                        {selectedIds.has(order.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                                    </button>
                                </td>

                                <td className="font-mono font-bold whitespace-nowrap">{order.orderCode}</td>

                                <td className="whitespace-nowrap">
                                    <span className="inline-flex items-center gap-2 text-sm">
                                        <Calendar size={14} /> {formatDate(order.createdAt)}
                                    </span>
                                </td>

                                <td>
                                    <div className="font-bold">{order.customer?.fullName || "-"}</div>
                                    <div className="text-xs text-zinc-400">{order.customer?.email || "-"}</div>
                                    {order.customer?.phone ? <div className="text-xs text-zinc-400">{order.customer.phone}</div> : null}
                                </td>

                                <td className="whitespace-nowrap">
                                    <span className="inline-flex items-center gap-2 text-sm">
                                        <Package size={14} /> {order.itemsCount}
                                    </span>
                                </td>

                                <td className="font-black whitespace-nowrap">฿{order.pricing?.total?.toLocaleString?.() ?? "-"}</td>

                                <td>
                                    <StatusBadge status={order.status} />
                                    {order.hasPrintWarning && (
                                        <div className="mt-1 inline-flex items-center gap-1 text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-bold border border-rose-200">
                                            <span>⚠</span> Print issue
                                        </div>
                                    )}
                                </td>

                                <td>
                                    <button
                                        onClick={() => router.push(`/admin/orders/${order.id}`)}
                                        className="inline-flex items-center"
                                        aria-label="Open order detail"
                                    >
                                        <ChevronRight size={20} />
                                    </button>
                                </td>
                            </tr>
                        ))}

                        {!loading && visibleOrders.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="p-8 text-center text-zinc-400">
                                    No orders found.
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>

            {error && <p className="text-red-500 font-bold">{error}</p>}
        </div>
    );
}
