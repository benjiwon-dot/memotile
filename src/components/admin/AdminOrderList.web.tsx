"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
    Search,
    ChevronRight,
    RefreshCw,
    CheckSquare,
    Square,
    FileSpreadsheet,
    AlertTriangle,
    Trash2,
    Link as LinkIcon,
    Loader2,
    Clock,
    Copy,
    Users,
    Package,
    X
} from "lucide-react";

import { getFirestore, doc, deleteDoc, getDoc, collection, addDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

import { OrderHeader, OrderStatus } from "@/lib/admin/types";
import { listOrders } from "@/lib/admin/orderRepo";
import StatusBadge from "./StatusBadge";
import { app } from "@/lib/firebase";

const isWeb = typeof window !== "undefined";

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

    // ✨ 팝업창 관리를 위한 State 추가
    const [showTrackingModal, setShowTrackingModal] = useState(false);
    const [trackingInputs, setTrackingInputs] = useState<Record<string, string>>({});

    const lastSigRef = useRef<string>("");

    const db = useMemo(() => getFirestore(app), []);
    const functions = useMemo(() => getFunctions(app, "us-central1"), []);

    const formatDate = (dateStr: string) =>
        new Date(dateStr).toLocaleDateString("en-US", {
            month: "short", day: "numeric", year: "numeric",
            hour: "2-digit", minute: "2-digit",
        });

    const formatShortDateTime = (dateStr: string) =>
        new Date(dateStr).toLocaleString("ko-KR", {
            month: "short", day: "numeric",
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
                (o as any).promoCode, (o.customer as any)?.instagram, (o as any).instagramId
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
        const targetStatus = newStatus.toLowerCase();
        if (isWeb && !window.confirm(`Update ${selectedIds.size} orders to ${newStatus}?`)) return;

        setBulkLoading(true);
        const ids = Array.from(selectedIds);

        try {
            await addDoc(collection(db, "adminTasks"), {
                type: "BATCH_UPDATE_STATUS",
                payload: {
                    orderIds: ids,
                    status: targetStatus,
                    uid: "admin",
                    email: "admin-web"
                },
                createdAt: new Date(),
                status: "pending"
            });

            setTimeout(() => {
                fetchOrders();
                alert("상태 변경 및 알림 발송을 요청했습니다!");
                setBulkLoading(false);
            }, 1500);

        } catch (e: any) {
            console.error("Bulk update failed:", e);
            alert("작업 요청 중 오류가 발생했습니다.");
            setBulkLoading(false);
        }
    };

    // ✨ 팝업창 띄우기 함수
    const openTrackingModal = () => {
        if (selectedIds.size === 0) return;
        const initialInputs: Record<string, string> = {};
        visibleOrders.forEach(o => {
            if (selectedIds.has(o.id)) {
                initialInputs[o.id] = o.trackingNumber || ""; // 기존 운송장 번호가 있으면 불러오기
            }
        });
        setTrackingInputs(initialInputs);
        setShowTrackingModal(true);
    };

    // ✨ 운송장 번호 일괄 저장 & Shipping 상태 변경 요청
    const handleSaveTracking = async () => {
        setBulkLoading(true);
        try {
            const promises = Array.from(selectedIds).map(id => {
                const trackingNum = trackingInputs[id];
                if (!trackingNum || trackingNum.trim() === "") return Promise.resolve();

                // 각각의 주문에 대해 운송장 번호 입력 및 'shipping' 상태 변경 지시서를 만듭니다.
                return addDoc(collection(db, "adminTasks"), {
                    type: "UPDATE_ORDER_OPS",
                    payload: {
                        orderId: id,
                        status: "shipping",
                        trackingNumber: trackingNum.trim(),
                        uid: "admin",
                        email: "admin-web"
                    },
                    createdAt: new Date(),
                    status: "pending"
                });
            });

            await Promise.all(promises);

            setTimeout(() => {
                fetchOrders();
                setShowTrackingModal(false);
                setBulkLoading(false);
                alert("운송장 번호가 저장되었으며 배송 시작(Shipping) 알림이 발송됩니다!");
            }, 1500);

        } catch (error) {
            console.error("Tracking update failed:", error);
            alert("오류가 발생했습니다.");
            setBulkLoading(false);
        }
    };

    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return;
        const count = selectedIds.size;
        const challenge = getDeleteChallenge();
        const userInput = prompt(`🚨 DANGER: Delete ${count} orders permanently.\nEnter code: ${challenge}`);
        if (userInput !== challenge) {
            alert("Code mismatch. Cancelled.");
            return;
        }
        setBulkLoading(true);
        try {
            const ids = Array.from(selectedIds);
            for (const id of ids) {
                await deleteDoc(doc(db, "orders", id));
            }
            await fetchOrders();
            alert("Deleted successfully.");
        } catch (e: any) {
            alertCallableError("Bulk delete error:", e);
        } finally {
            setBulkLoading(false);
        }
    };

    const handleBulkZipCopy = async () => {
        if (selectedIds.size === 0) return;
        setBulkLoading(true);
        try {
            const fn = httpsCallable(functions, "adminExportZipPrints");
            const res = await fn({ orderIds: Array.from(selectedIds), type: "print" });
            const { url } = (res.data as any) || {};
            if (url) {
                await navigator.clipboard.writeText(url);
                alert(`✅ Bulk ZIP URL copied!`);
            }
        } catch (e: any) {
            alertCallableError("ZIP export failed:", e);
        } finally {
            setBulkLoading(false);
        }
    };

    const handleExportCleanCSV = async () => {
        const targets = selectedIds.size > 0 ? visibleOrders.filter((o) => selectedIds.has(o.id)) : visibleOrders;
        if (targets.length === 0) return;
        setBulkLoading(true);
        try {
            const rows = [];
            for (const o of targets) {
                let zipUrl = "";
                try {
                    const fn = httpsCallable(functions, "adminExportZipPrints");
                    const res = await fn({ orderIds: [o.id], type: "print" });
                    zipUrl = (res.data as any)?.url || "";
                } catch { zipUrl = "Link Error"; }

                rows.push({
                    "Order Number": o.orderCode,
                    "Date": formatDate(o.createdAt),
                    "Name": o.shipping?.fullName || o.customer?.fullName || "Guest",
                    "Phone Number": o.shipping?.phone || o.customer?.phone || "",
                    "Address": `${o.shipping?.address1 || ""} ${o.shipping?.address2 || ""} ${o.shipping?.city || ""} ${o.shipping?.state || ""}`.trim(),
                    "Photo Qty": o.itemsCount || 0,
                    "Admin Note": (o as any).adminNote || "",
                    "Print URL": zipUrl,
                });
            }
            downloadTextFile(`Printer_Orders_${new Date().toISOString().slice(0, 10)}.csv`, "\uFEFF" + toCsv(rows));
        } catch (e: any) { alertCallableError("CSV Export failed", e); }
        finally { setBulkLoading(false); }
    };

    const handleExportInstaInfo = async () => {
        const targets = selectedIds.size > 0 ? visibleOrders.filter((o) => selectedIds.has(o.id)) : visibleOrders;
        if (targets.length === 0) {
            alert("No orders to export.");
            return;
        }
        setBulkLoading(true);
        try {
            const rows = targets.map(o => ({
                "Name": o.shipping?.fullName || o.customer?.fullName || "Guest",
                "Address": `${o.shipping?.address1 || ""} ${o.shipping?.address2 || ""} ${o.shipping?.city || ""} ${o.shipping?.state || ""}`.trim(),
                "Phone Number": o.shipping?.phone || o.customer?.phone || "",
                "Instagram": (o as any).instagramId || (o.customer as any)?.instagram || ""
            }));
            const csvString = "\uFEFF" + toCsv(rows);
            downloadTextFile(`Marketing_Insta_Info_${new Date().toISOString().slice(0, 10)}.csv`, csvString);
        } catch (e: any) {
            alertCallableError("Insta Export failed:", e);
        } finally {
            setBulkLoading(false);
        }
    };

    const handleResetView = () => { setFrom(""); setTo(""); fetchOrders(); };

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
                            placeholder="Search by name / email / orderCode / insta / address…"
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

                        {/* ✨ 운송장 일괄 입력 버튼 추가 */}
                        <button onClick={openTrackingModal} disabled={bulkLoading || selectedIds.size === 0} className="bg-blue-600 text-white hover:bg-blue-700 px-3 py-2 rounded text-xs font-black inline-flex items-center gap-2 shadow-sm">
                            <Package size={12} />
                            운송장 퀵입력
                        </button>

                        <button onClick={handleExportCleanCSV} disabled={bulkLoading} className="bg-zinc-700 text-white hover:bg-zinc-600 px-3 py-2 rounded text-xs font-black inline-flex items-center gap-2">
                            {bulkLoading ? <Loader2 size={12} className="animate-spin" /> : <FileSpreadsheet size={12} />}
                            Export CSV
                        </button>

                        <button onClick={handleExportInstaInfo} disabled={bulkLoading} className="bg-pink-600 text-white hover:bg-pink-700 px-3 py-2 rounded text-xs font-black inline-flex items-center gap-2 shadow-sm">
                            <Users size={12} />
                            Export Insta Info
                        </button>

                        <button onClick={handleBulkZipCopy} disabled={bulkLoading || selectedIds.size === 0} className="bg-white text-zinc-900 px-3 py-2 rounded text-xs font-black inline-flex items-center gap-2">
                            <LinkIcon size={12} /> Bulk ZIP Link
                        </button>
                        {selectedIds.size > 0 && (
                            <button onClick={handleBulkDelete} disabled={bulkLoading} className="bg-rose-600 text-white hover:bg-rose-700 px-3 py-2 rounded text-xs font-black inline-flex items-center gap-2 ml-2 border border-rose-800">
                                <Trash2 size={12} /> DELETE
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="w-full bg-white border border-zinc-200 rounded-lg shadow-sm overflow-x-auto">
                <table className="w-full relative border-collapse min-w-[1000px]">
                    <thead className="bg-zinc-50 border-b shadow-sm">
                        <tr>
                            <th className="p-4 w-10 text-center">
                                <button onClick={toggleSelectAll}>
                                    {isAllVisibleSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                                </button>
                            </th>
                            <th className="p-4 text-left text-xs font-black text-zinc-400 uppercase">Date</th>
                            <th className="p-4 text-left text-xs font-black text-zinc-400 uppercase">Order</th>
                            <th className="p-4 text-left text-xs font-black text-zinc-400 uppercase">Customer</th>
                            <th className="p-4 text-left text-xs font-black text-zinc-400 uppercase max-w-[200px]">Address</th>
                            <th className="p-4 text-center text-xs font-black text-zinc-400 uppercase">Qty</th>
                            <th className="p-4 text-left text-xs font-black text-zinc-400 uppercase">Total</th>
                            <th className="p-4 w-px text-left text-xs font-black text-zinc-400 uppercase whitespace-nowrap">Status</th>
                            <th className="p-4 w-10" />
                        </tr>
                    </thead>

                    <tbody>
                        {visibleOrders.map((order) => {
                            const abandoned = order.status === 'paid' && (new Date().getTime() - new Date(order.createdAt).getTime() > 24 * 60 * 60 * 1000);
                            const instaId = (order as any).instagramId || (order.customer as any)?.instagram;
                            const fullAddress = [order.shipping?.address1, order.shipping?.address2, order.shipping?.city, order.shipping?.state].filter(Boolean).join(" ");
                            const qty = order.itemsCount || 0;

                            return (
                                <tr key={order.id} className="border-b last:border-0 hover:bg-zinc-50 transition-colors h-[60px]">
                                    <td className="p-4 text-center">
                                        <button onClick={() => toggleSelect(order.id)}>
                                            {selectedIds.has(order.id) ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} />}
                                        </button>
                                    </td>
                                    <td className="p-4">
                                        <div className="text-xs text-zinc-500 font-medium whitespace-nowrap flex items-center gap-1.5">
                                            <Clock size={12} className="text-zinc-400" />
                                            {formatShortDateTime(order.createdAt)}
                                        </div>
                                    </td>
                                    <td className="p-4 font-mono font-bold text-sm whitespace-nowrap">{order.orderCode}</td>
                                    <td className="p-4 min-w-[140px]">
                                        <div className="font-bold text-sm">{order.customer?.fullName || "-"}</div>
                                        <div className="text-[11px] text-zinc-400">{order.customer?.email || order.customer?.phone}</div>
                                        {instaId && (
                                            <div
                                                onClick={() => {
                                                    navigator.clipboard.writeText(`@${instaId}`);
                                                    alert(`@${instaId} 복사 완료!`);
                                                }}
                                                className="text-[11px] text-pink-500 font-bold mt-0.5 inline-flex items-center gap-1 bg-pink-50 px-1.5 py-0.5 rounded border border-pink-100 cursor-pointer hover:bg-pink-100 transition-colors"
                                            >
                                                @{instaId} <Copy size={10} />
                                            </div>
                                        )}
                                    </td>
                                    <td className="p-4 max-w-[200px]">
                                        <div className="text-[12px] text-zinc-600 truncate" title={fullAddress}>
                                            {fullAddress || "-"}
                                        </div>
                                    </td>
                                    <td className="p-4 text-center">
                                        <div className="inline-flex items-center justify-center bg-zinc-100 px-2 py-1 rounded text-xs font-black text-zinc-700">
                                            {qty}
                                        </div>
                                    </td>
                                    <td className="p-4 font-black text-sm whitespace-nowrap">฿{order.pricing?.total?.toLocaleString()}</td>
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

            {/* ✨ 팝업 모달창 UI */}
            {showTrackingModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-xl w-[90%] max-w-2xl flex flex-col max-h-[85vh]">
                        <div className="flex items-center justify-between p-5 border-b">
                            <h2 className="text-lg font-black flex items-center gap-2">
                                <Package className="text-blue-600" />
                                퀵 운송장 입력 ({selectedIds.size}건)
                            </h2>
                            <button onClick={() => setShowTrackingModal(false)} className="p-2 hover:bg-zinc-100 rounded-full text-zinc-400">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-3">
                            {visibleOrders.filter(o => selectedIds.has(o.id)).map(o => (
                                <div key={o.id} className="flex items-center gap-4 bg-zinc-50 p-3 rounded-lg border border-zinc-100">
                                    <div className="flex-1">
                                        <div className="font-mono font-bold text-sm">{o.orderCode}</div>
                                        <div className="text-xs text-zinc-500">{o.customer?.fullName || "-"}</div>
                                    </div>
                                    <div className="w-1/2">
                                        <input
                                            type="text"
                                            placeholder="운송장 번호 입력 (Tracking Number)"
                                            className="w-full border border-zinc-300 rounded p-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                            value={trackingInputs[o.id] || ""}
                                            onChange={(e) => setTrackingInputs({ ...trackingInputs, [o.id]: e.target.value })}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="p-5 border-t bg-zinc-50 flex justify-end gap-3 rounded-b-2xl">
                            <button onClick={() => setShowTrackingModal(false)} className="px-4 py-2 font-bold text-zinc-500 hover:bg-zinc-200 rounded-lg">
                                취소
                            </button>
                            <button
                                onClick={handleSaveTracking}
                                disabled={bulkLoading}
                                className="bg-blue-600 text-white font-black px-6 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2"
                            >
                                {bulkLoading ? <Loader2 size={16} className="animate-spin" /> : "저장 및 발송"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {error && <div className="p-4 bg-rose-50 text-rose-600 font-bold rounded-lg border border-rose-200 flex items-center gap-2"><AlertTriangle size={18} />{error}</div>}
        </div>
    );
}