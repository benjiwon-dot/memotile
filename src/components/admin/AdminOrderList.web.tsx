"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
    Search,
    ChevronRight,
    RefreshCw,
    Download,
    CheckSquare,
    Square,
    FileSpreadsheet,
    AlertTriangle,
    Trash2,
} from "lucide-react";
// ✅ DB 직접 삭제를 위한 import
import { getFirestore, doc, deleteDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

import { OrderHeader, OrderStatus } from "@/lib/admin/types";
import { listOrders } from "@/lib/admin/orderRepo";
import StatusBadge from "./StatusBadge";
import { app } from "@/lib/firebase";

const isWeb = typeof window !== "undefined";

/* -------------------------------------------------------------------------- */
/* Utility Functions                                                          */
/* -------------------------------------------------------------------------- */

function norm(s: any) {
    return String(s || "").toLowerCase().trim();
}

function isMatch(target: string, query: string) {
    const t = norm(target).replace(/\s+/g, "");
    const q = norm(query).replace(/\s+/g, "");
    return t.includes(q);
}

const normStatus = (s: any) => String(s ?? "").trim().toUpperCase();

const ALLOWED_STATUSES = new Set([
    "PAID", "PROCESSING", "PRINTED", "SHIPPING", "DELIVERED", "CANCELED", "REFUNDED", "ARCHIVED",
]);

function toCsv(rows: Record<string, any>[]) {
    if (!rows.length) return "";
    const headers = Object.keys(rows[0] || {});
    const escape = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))];
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

function browserDownloadUrl(url: string, filename?: string) {
    if (!isWeb) return;
    try {
        const a = document.createElement("a");
        a.href = url;
        if (filename) a.download = filename;
        a.target = "_blank";
        a.rel = "noreferrer";
        document.body.appendChild(a);
        a.click();
        a.remove();
    } catch {
        window.open(url, "_blank", "noreferrer");
    }
}

function alertCallableError(prefix: string, e: any) {
    const code = e?.code || "unknown";
    const msg = e?.message || String(e);
    console.error(prefix, e);
    alert(`${prefix}\ncode: ${code}\nmessage: ${msg}`);
}

function getDeleteChallenge() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `delete${y}${m}${day}`;
}

/* -------------------------------------------------------------------------- */
/* Main Component                                                             */
/* -------------------------------------------------------------------------- */

export default function AdminOrderList() {
    const router = useRouter();

    const [orders, setOrders] = useState<OrderHeader[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [q, setQ] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("ALL");
    const [from, setFrom] = useState<string>("");
    const [to, setTo] = useState<string>("");

    const [bulkLoading, setBulkLoading] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const lastSigRef = useRef<string>("");

    const db = useMemo(() => getFirestore(app), []);
    const functions = useMemo(() => getFunctions(app, "us-central1"), []);

    const formatDate = (dateStr: string) =>
        new Date(dateStr).toLocaleDateString("en-US", {
            month: "short", day: "numeric", year: "numeric",
            hour: "2-digit", minute: "2-digit",
        });

    const fetchOrders = async () => {
        setLoading(true);
        setError(null);
        setSelectedIds(new Set());

        try {
            const data: any = await listOrders({
                status: statusFilter !== "ALL" ? (statusFilter as OrderStatus) : undefined,
                from: from || undefined,
                to: to || undefined,
                sort: "desc",
                limit: 500,
            } as any);

            const rows: OrderHeader[] = Array.isArray(data) ? data : data?.rows ?? [];
            setOrders(rows);
        } catch (e: any) {
            console.error(e);
            setError(e?.message || String(e));
        } finally {
            setLoading(false);
        }
    };

    const visibleOrders = useMemo(() => {
        const query = q.trim();
        const tab = normStatus(statusFilter);

        const statusFiltered = orders.filter((o) => {
            if (tab === "ALL") return true;
            const s = normStatus(o.status);
            return ALLOWED_STATUSES.has(tab) && s === tab;
        });

        if (!query) return statusFiltered;

        return statusFiltered.filter((o) => {
            const targets = [
                o.orderCode, o.id,
                o.customer?.fullName, o.customer?.email, o.customer?.phone,
                o.shipping?.fullName, o.shipping?.phone, o.shipping?.email,
                o.shipping?.address1, o.shipping?.address2, o.shipping?.city,
                o.shipping?.state, o.shipping?.postalCode,
                (o as any).promoCode
            ];
            return targets.some(t => t && isMatch(String(t), query));
        });
    }, [orders, q, statusFilter]);

    const toggleSelect = (id: string) => {
        const next = new Set(selectedIds);
        next.has(id) ? next.delete(id) : next.add(id);
        setSelectedIds(next);
    };

    const toggleSelectAll = () => {
        if (visibleOrders.length === 0) return;
        const allVisibleSelected = visibleOrders.every(o => selectedIds.has(o.id));
        const next = new Set(selectedIds);
        if (allVisibleSelected) {
            visibleOrders.forEach(o => next.delete(o.id));
        } else {
            visibleOrders.forEach(o => next.add(o.id));
        }
        setSelectedIds(next);
    };

    const handleBulkStatus = async (newStatus: string) => {
        if (selectedIds.size === 0) return;
        if (isWeb && !window.confirm(`Update ${selectedIds.size} orders to ${newStatus}?`)) return;

        setBulkLoading(true);
        try {
            const fn = httpsCallable(functions, "adminBatchUpdateStatus");
            await fn({ orderIds: Array.from(selectedIds), status: newStatus });
            await fetchOrders();
            alert("Status updated successfully!");
        } catch (e: any) {
            alertCallableError("Bulk update failed:", e);
        } finally {
            setBulkLoading(false);
        }
    };

    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return;
        const count = selectedIds.size;
        const challenge = getDeleteChallenge();

        const userInput = prompt(
            `🚨 DANGER: ${count}개의 주문을 영구 삭제합니다.\n삭제하려면 코드를 입력하세요: ${challenge}`
        );

        if (userInput !== challenge) {
            alert("코드가 일치하지 않습니다.");
            return;
        }

        setBulkLoading(true);

        let successCount = 0;
        let failCount = 0;

        try {
            const ids = Array.from(selectedIds);
            for (const id of ids) {
                try {
                    await deleteDoc(doc(db, "orders", id));
                    successCount++;
                } catch (innerE) {
                    console.error(`Failed to delete ${id}`, innerE);
                    failCount++;
                }
            }
            await fetchOrders();
            if (failCount === 0) {
                alert(`✅ ${successCount}개의 주문이 DB에서 삭제되었습니다.`);
            } else {
                alert(`⚠️ 성공: ${successCount}건 / 실패: ${failCount}건`);
            }
        } catch (e: any) {
            alertCallableError("Bulk delete critical error:", e);
        } finally {
            setBulkLoading(false);
        }
    };

    const handleBulkZip = async () => {
        if (selectedIds.size === 0) return;
        if (selectedIds.size > 50) {
            alert(`⚠️ ZIP Download limit is 50.`);
            return;
        }
        setBulkLoading(true);
        try {
            const fn = httpsCallable(functions, "adminExportZipPrints");
            const res = await fn({ orderIds: Array.from(selectedIds), type: "print" });
            const { url } = (res.data as any) || {};
            if (url) {
                browserDownloadUrl(url, `Memotile_Print_${new Date().toISOString().slice(0, 10)}.zip`);
            } else {
                alert("ZIP generation returned no URL.");
            }
        } catch (e: any) {
            alertCallableError("ZIP export failed:", e);
        } finally {
            setBulkLoading(false);
        }
    };

    const handleExportCSV = async () => {
        const targets = selectedIds.size > 0 ? visibleOrders.filter((o) => selectedIds.has(o.id)) : visibleOrders;
        if (targets.length === 0) {
            alert("No orders to export.");
            return;
        }
        const rows = targets.map((o) => ({
            Date: formatDate(o.createdAt),
            OrderNo: o.orderCode,
            OrderId: o.id,
            Status: o.status,
            TileCount: o.itemsCount,
            CustomerName: o.customer?.fullName || o.shipping?.fullName || "Guest",
            Email: o.customer?.email || o.shipping?.email || "",
            Phone: o.customer?.phone || o.shipping?.phone || "",
            Total: o.pricing?.total ?? 0,
        }));
        const csv = toCsv(rows);
        downloadTextFile(`orders.csv`, csv);
    };

    const handleResetView = () => {
        setFrom("");
        setTo("");
        fetchOrders();
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            const sig = JSON.stringify({ status: statusFilter, from, to });
            if (lastSigRef.current === sig) return;
            lastSigRef.current = sig;
            fetchOrders();
        }, 200);
        return () => clearTimeout(timer);
    }, [statusFilter, from, to]);

    const isAllVisibleSelected = visibleOrders.length > 0 && visibleOrders.every(o => selectedIds.has(o.id));

    return (
        <div className="flex flex-col gap-4 w-full pb-32">
            {/* 상단 필터 / 헤더 영역 */}
            {/* ✅ sticky, top-0, z-20, bg-white 추가하여 상단 고정 */}
            <div className="shrink-0 flex flex-col gap-4 sticky top-0 z-20 bg-white py-4 -mt-4">
                <div className="flex gap-2 overflow-x-auto border-b pb-2">
                    {["ALL", "PAID", "PROCESSING", "PRINTED", "SHIPPING", "DELIVERED", "CANCELED", "REFUNDED", "ARCHIVED"].map((st) => (
                        <button
                            key={st}
                            onClick={() => setStatusFilter(st)}
                            className={`px-4 py-2 rounded-full text-xs font-black uppercase whitespace-nowrap ${statusFilter === st ? "bg-zinc-900 text-white" : "bg-white text-zinc-400 border"}`}
                        >
                            {st}
                        </button>
                    ))}
                </div>

                <div className="flex flex-col md:flex-row gap-4">
                    <div className="relative flex-1">
                        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                        <input
                            className="admin-input pl-10 w-full"
                            placeholder="Search by name / email / orderCode / address…"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                        />
                    </div>
                    <div className="flex gap-2 items-center bg-zinc-50 p-1.5 rounded-lg border border-zinc-200">
                        <input type="date" className="bg-transparent text-xs" value={from} onChange={(e) => setFrom(e.target.value)} />
                        <span className="text-zinc-400">-</span>
                        <input type="date" className="bg-transparent text-xs" value={to} onChange={(e) => setTo(e.target.value)} />
                        <button onClick={handleResetView} className="admin-btn admin-btn-secondary !p-1.5" disabled={loading}>
                            <RefreshCw size={14} />
                        </button>
                    </div>
                </div>

                <div className="bg-zinc-900 text-white p-3 rounded-xl flex flex-col md:flex-row gap-3 md:justify-between md:items-center">
                    <span className="font-bold">{selectedIds.size} selected</span>
                    <div className="flex flex-wrap gap-2 items-center">
                        <select
                            disabled={bulkLoading || selectedIds.size === 0}
                            onChange={(e) => {
                                const val = e.target.value;
                                if (val) setTimeout(() => handleBulkStatus(val), 100);
                                e.target.value = "";
                            }}
                            className="bg-zinc-800 text-xs px-2 py-2 rounded"
                        >
                            <option value="">Set Status</option>
                            {["PAID", "PROCESSING", "PRINTED", "SHIPPING", "DELIVERED", "CANCELED", "REFUNDED", "ARCHIVED"].map(s => <option key={s} value={s}>{s}</option>)}
                        </select>

                        <button onClick={handleExportCSV} disabled={bulkLoading} className="bg-zinc-700 text-white hover:bg-zinc-600 px-3 py-2 rounded text-xs font-black inline-flex items-center gap-2">
                            <FileSpreadsheet size={12} /> CSV
                        </button>
                        <button onClick={handleBulkZip} disabled={bulkLoading || selectedIds.size === 0} className="bg-white text-zinc-900 px-3 py-2 rounded text-xs font-black inline-flex items-center gap-2">
                            <Download size={12} /> ZIP (Max 50)
                        </button>
                        {selectedIds.size > 0 && (
                            <button onClick={handleBulkDelete} disabled={bulkLoading} className="bg-rose-600 text-white hover:bg-rose-700 px-3 py-2 rounded text-xs font-black inline-flex items-center gap-2 ml-2 border border-rose-800">
                                <Trash2 size={12} /> DELETE
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* ✅ 테이블 컨테이너 */}
            {/* 고정 높이 제거, overflow 제거 -> 내용만큼 쭉 늘어남 */}
            <div className="w-full bg-white border border-zinc-200 rounded-lg shadow-sm">
                <table className="w-full relative border-collapse">
                    {/* ✅ 테이블 헤더의 top 위치를 헤더 높이만큼 내려줘야 함. 
                       위의 헤더 높이가 가변적일 수 있으므로 일단 top-[200px] 정도로 설정하거나, 
                       더 깔끔하게는 sticky 헤더와 분리해서 스크롤을 처리할 수도 있습니다.
                       하지만 간단히 처리하기 위해 여기서는 thead의 sticky를 제거하고(상단 헤더가 sticky이므로),
                       상단 헤더 아래로 자연스럽게 스크롤되도록 두는 것이 좋습니다.
                       만약 테이블 헤더(Order, Customer 등)도 고정하고 싶다면 top 값을 상단 헤더 높이만큼 줘야 합니다.
                    */}
                    <thead className="bg-zinc-50 border-b shadow-sm">
                        <tr>
                            <th className="p-4 w-10 text-center">
                                <button onClick={toggleSelectAll}>
                                    {isAllVisibleSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                                </button>
                            </th>
                            <th className="p-4 text-left text-xs font-black text-zinc-400 uppercase">Order</th>
                            <th className="p-4 text-left text-xs font-black text-zinc-400 uppercase">Customer</th>
                            <th className="p-4 text-left text-xs font-black text-zinc-400 uppercase">Total</th>
                            <th className="p-4 w-px text-left text-xs font-black text-zinc-400 uppercase whitespace-nowrap">Status</th>
                            <th className="p-4 w-10" />
                        </tr>
                    </thead>

                    <tbody>
                        {visibleOrders.map((order) => {
                            const abandoned = order.status === 'paid' && (new Date().getTime() - new Date(order.createdAt).getTime() > 24 * 60 * 60 * 1000);
                            return (
                                <tr key={order.id} className="border-b last:border-0 hover:bg-zinc-50 transition-colors h-[55px]">
                                    <td className="p-4 text-center">
                                        <button onClick={() => toggleSelect(order.id)}>
                                            {selectedIds.has(order.id) ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} />}
                                        </button>
                                    </td>
                                    <td className="p-4 font-mono font-bold text-sm whitespace-nowrap">{order.orderCode}</td>
                                    <td className="p-4">
                                        <div className="font-bold text-sm">{order.customer?.fullName || "-"}</div>
                                        <div className="text-[11px] text-zinc-400">{order.customer?.email}</div>
                                    </td>
                                    <td className="p-4 font-black text-sm">฿{order.pricing?.total?.toLocaleString()}</td>
                                    <td className="p-4 w-px whitespace-nowrap">
                                        <div className="flex flex-col gap-1 items-start">
                                            <StatusBadge status={order.status} />
                                            {abandoned && <span className="text-[9px] font-black text-rose-600 uppercase animate-pulse">🚨 24H ABANDONED</span>}
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <button onClick={() => router.push(`/admin/orders/${order.id}`)} className="p-2 hover:bg-zinc-100 rounded-full">
                                            <ChevronRight size={18} className="text-zinc-400" />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {error && <div className="p-4 bg-rose-50 text-rose-600 font-bold rounded-lg border border-rose-200 flex items-center gap-2"><AlertTriangle size={18} />{error}</div>}
        </div>
    );
}