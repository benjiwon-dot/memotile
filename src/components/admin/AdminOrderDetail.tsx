// src/lib/admin/adminOrderDetail.tsx (또는 해당 파일 경로)
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";

import {
    ChevronLeft,
    Download,
    FileJson,
    ExternalLink,
    Loader2,
    Image as ImageIcon,
    CheckCircle2,
    AlertCircle,
    Copy,
    Phone,
    Mail,
    MapPin,
    StickyNote,
    Truck,
    Tag,
    Trash2,
    Clock,
} from "lucide-react";

import { getFirestore, doc, deleteDoc } from "firebase/firestore";
import { getStorage, ref, getDownloadURL } from "firebase/storage";
import { getFunctions, httpsCallable } from "firebase/functions";

import { OrderDetail } from "@/lib/admin/types";
import { getOrderDetail } from "@/lib/admin/orderRepo";
import StatusBadge from "./StatusBadge";
import { app } from "@/lib/firebase";

const isWeb = typeof window !== "undefined";

function pickAdminThumb(item: any): string | null {
    const uri =
        item?.assets?.previewUrl ||
        item?.assets?.viewUrl ||
        item?.output?.viewUrl ||
        item?.output?.viewUri ||
        item?.previewUrl ||
        item?.previewUri ||
        null;

    return typeof uri === "string" && uri.length > 8 ? uri : null;
}

function safeName(s: string) {
    return (s || "")
        .trim()
        .replace(/[\/\\:*?"<>|]/g, "_")
        .replace(/\s+/g, " ")
        .slice(0, 60);
}

function yyyymmddFromISO(iso?: string) {
    if (!iso) return "unknown_date";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "unknown_date";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
}

// ✅ 오늘 날짜 챌린지 코드 생성
function getDeleteChallenge() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `delete${y}${m}${day}`;
}

async function resolveStorageUrl(
    storage: ReturnType<typeof getStorage>,
    maybeUrl?: string | null,
    maybePath?: string | null
) {
    if (maybeUrl && typeof maybeUrl === "string" && maybeUrl.startsWith("http")) return maybeUrl;
    if (maybePath && typeof maybePath === "string" && maybePath.length > 3) {
        return await getDownloadURL(ref(storage, maybePath));
    }
    return null;
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

export default function AdminOrderDetail({ orderId }: { orderId: string }) {
    const router = useRouter();

    const [order, setOrder] = useState<OrderDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [resolved, setResolved] = useState<
        Record<number, { previewUrl?: string | null; printUrl?: string | null }>
    >({});

    const [printDims, setPrintDims] = useState<Record<number, { w: number; h: number }>>({});

    const storage = useMemo(() => getStorage(app), []);
    // ✅ Firestore 인스턴스
    const db = useMemo(() => getFirestore(app), []);
    const functions = useMemo(() => getFunctions(app, "us-central1"), []);

    const aliveRef = useRef(true);

    useEffect(() => {
        aliveRef.current = true;
        return () => {
            aliveRef.current = false;
        };
    }, []);

    const copyText = async (text: string) => {
        if (!isWeb) return;
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // ignore
        }
    };

    const openUrl = (url?: string | null) => {
        if (!isWeb || !url) return;
        window.open(url, "_blank", "noreferrer");
    };

    const openStoragePath = async (path?: string) => {
        if (!path) {
            alert("No file path available");
            return;
        }
        try {
            const url = await getDownloadURL(ref(storage, path));
            openUrl(url);
        } catch (e: any) {
            console.error("[Admin] openStoragePath failed", e);
            alert("Failed to open file");
        }
    };

    const safeBack = () => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace("/admin/orders");
        }
    };

    const refetch = async () => {
        setLoading(true);
        setError(null);
        setOrder(null);
        setResolved({});
        setPrintDims({});

        try {
            const data = await getOrderDetail(orderId);
            if (!aliveRef.current) return;

            if (!data) {
                setError("Order not found.");
                setOrder(null);
                return;
            }

            setOrder(data);

            if (isWeb && data?.items?.length) {
                const next: Record<number, { previewUrl?: string | null; printUrl?: string | null }> = {};
                await Promise.all(
                    data.items.map(async (item, idx) => {
                        try {
                            const previewUrl = await resolveStorageUrl(
                                storage,
                                pickAdminThumb(item),
                                (item as any)?.assets?.previewPath ||
                                (item as any)?.previewPath ||
                                (item as any)?.storagePath
                            );

                            const printUrl = await resolveStorageUrl(
                                storage,
                                (item as any)?.assets?.printUrl || (item as any)?.printUrl,
                                (item as any)?.assets?.printPath ||
                                (item as any)?.printPath ||
                                (item as any)?.printStoragePath
                            );

                            next[idx] = { previewUrl, printUrl };

                            if (printUrl) {
                                const img = new Image();
                                img.onload = () => {
                                    if (!aliveRef.current) return;
                                    setPrintDims((prev) => ({
                                        ...prev,
                                        [idx]: { w: img.naturalWidth, h: img.naturalHeight },
                                    }));
                                };
                                img.src = printUrl;
                            }
                        } catch {
                            next[idx] = { previewUrl: null, printUrl: null };
                        }
                    })
                );

                if (!aliveRef.current) return;
                setResolved(next);
            }
        } catch (e: any) {
            if (!aliveRef.current) return;
            setError(e?.message || "Failed to load order.");
        } finally {
            if (!aliveRef.current) return;
            setLoading(false);
        }
    };

    useEffect(() => {
        refetch();
    }, [orderId]);

    /* ---------- Actions ---------- */

    const handleDownloadZip = async () => {
        setBusy(true);
        try {
            const fn = httpsCallable(functions, "adminExportZipPrints");
            const res = await fn({ orderIds: [orderId], type: "print" });
            const { url } = res.data as any;

            if (url) {
                browserDownloadUrl(url, `Memotile_Print_${orderId}_${new Date().toISOString().slice(0, 10)}.zip`);
            } else {
                alert("ZIP generation returned no URL.");
            }
        } catch (e: any) {
            alertCallableError("ZIP Download error:", e);
        } finally {
            setBusy(false);
        }
    };

    const handleExportJson = async () => {
        if (!isWeb) return;

        setBusy(true);
        try {
            const fn = httpsCallable(functions, "adminExportPrinterJSON");
            const res = await fn({ orderIds: [orderId] });
            const { url } = res.data as any;

            if (url) {
                browserDownloadUrl(url, `order_${orderId}.json`);
            } else {
                alert("JSON export returned no URL");
            }
        } catch (e: any) {
            alertCallableError("JSON Export error:", e);
        } finally {
            setBusy(false);
        }
    };

    const handleUpdateStatus = async (status: string) => {
        if (!order) return;

        setBusy(true);
        try {
            const fn = httpsCallable(functions, "adminUpdateOrderOps");
            await fn({ orderId, status });
            await refetch();
        } catch (e: any) {
            alertCallableError("Update failed:", e);
        } finally {
            setBusy(false);
        }
    };

    const handleSaveOps = async (patch: { trackingNumber?: string; adminNote?: string }) => {
        setBusy(true);
        try {
            const fn = httpsCallable(functions, "adminUpdateOrderOps");
            await fn({ orderId, ...patch });
            await refetch();
        } catch (e: any) {
            alertCallableError("Save failed:", e);
        } finally {
            setBusy(false);
        }
    };

    const handleCancel = async () => {
        if (!order || !isWeb) return;

        if (!confirm("Are you sure you want to CANCEL this order?")) return;
        const reason = prompt("Reason for cancellation:");
        if (reason === null) return;

        setBusy(true);
        try {
            const fn = httpsCallable(functions, "adminCancelOrder");
            await fn({ orderId, reason });
            await refetch();
        } catch (e: any) {
            alertCallableError("Cancel failed:", e);
        } finally {
            setBusy(false);
        }
    };

    // ✅ 영구 삭제 핸들러 (DB 직접 삭제)
    const handleDeleteOrder = async () => {
        if (!order || !isWeb) return;

        if (!confirm("🚨 경고: 이 주문 데이터를 서버에서 영구적으로 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) return;

        const challenge = getDeleteChallenge();
        const userInput = prompt(`삭제를 확정하려면 다음 코드를 정확히 입력하세요: ${challenge}`);

        if (userInput !== challenge) {
            alert("코드가 일치하지 않습니다. 삭제가 취소되었습니다.");
            return;
        }

        setBusy(true);
        try {
            // DB에서 직접 문서를 삭제합니다.
            await deleteDoc(doc(db, "orders", orderId));

            alert("주문이 성공적으로 삭제되었습니다.");
            router.replace("/admin/orders");
        } catch (e: any) {
            console.error(e);
            alert(`영구 삭제 실패!\n오류 코드: ${e.code}\n\n[해결 방법]\nFirestore Rules에서 'allow delete' 권한이 켜져 있는지 확인하세요.`);
        } finally {
            setBusy(false);
        }
    };

    /* ---------- States ---------- */

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
                <Loader2 size={40} className="animate-spin" />
                <p className="text-zinc-500">Fetching order operations data…</p>
            </div>
        );
    }

    if (error || !order) {
        return (
            <div className="text-center py-20">
                <p className="text-rose-500 font-bold text-xl">Error loading order</p>
                <p className="text-zinc-500">{error || "Order not found"}</p>
                <button onClick={safeBack} className="admin-btn admin-btn-secondary mt-6">
                    Go Back
                </button>
            </div>
        );
    }

    const customerName = safeName(order.customer?.fullName || order.shipping?.fullName || "Guest");
    const dateKey = yyyymmddFromISO(order.createdAt);
    const orderOps = order as any;

    const promoCode = orderOps.promoCode || orderOps.promo?.code || "";
    const discountAmount = orderOps.discount ?? orderOps.pricing?.discount ?? 0;
    const totalPaid = orderOps.total ?? orderOps.pricing?.total ?? 0;

    const shipFullName = order.shipping?.fullName || customerName;
    const shipAddress1 = order.shipping?.address1 || "";
    const shipAddress2 = order.shipping?.address2 || "";
    const shipCityState = [order.shipping?.city, order.shipping?.state].filter(Boolean).join(", ");
    const shipPostal = order.shipping?.postalCode || "";
    const shipCountry = order.shipping?.country || "";
    const shipPhone = order.shipping?.phone || order.customer?.phone || "";

    const customerEmail = order.customer?.email || order.shipping?.email || "-";
    const customerPhone = order.customer?.phone || order.shipping?.phone || "-";

    const deviceInfo = orderOps.deviceInfo;
    const isIos = deviceInfo?.os === "ios";

    const isAbandoned = order.status === 'paid' && (new Date().getTime() - new Date(order.createdAt).getTime() > 24 * 60 * 60 * 1000);
    const isArchived = order.status === 'archived';

    return (
        // ✅ [수정] Spacer div를 제거하고 pb-[200px] 추가하여 하단 여백 확보
        <div className="flex flex-col gap-8 pb-[1000px]">
            {/* 아카이브 안내 */}
            {isArchived && (
                <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-center gap-3 text-amber-700 font-bold shrink-0">
                    <Clock size={20} />
                    이 주문은 오래되어 아카이브(보관) 처리되었습니다. 데이터만 조회 가능합니다.
                </div>
            )}

            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between gap-6 shrink-0">
                <div className="flex items-center gap-4">
                    <button onClick={safeBack} className="admin-btn admin-btn-secondary !p-2">
                        <ChevronLeft size={24} />
                    </button>

                    <div>
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-3xl font-black font-mono">{order.orderCode}</h1>
                            <StatusBadge status={order.status} />

                            {isAbandoned && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs bg-rose-600 text-white font-black animate-pulse shadow-lg shadow-rose-200">
                                    <AlertCircle size={14} />
                                    🚨 24H ABANDONED
                                </span>
                            )}

                            {promoCode && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-indigo-100 text-indigo-700 font-bold border border-indigo-200">
                                    <Tag size={12} />
                                    (P)
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-zinc-400 font-mono flex items-center gap-2 mt-1">
                            {order.id}
                            <button
                                className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-800"
                                onClick={() => copyText(order.id)}
                            >
                                <Copy size={12} /> copy
                            </button>
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <select
                        value={order.status}
                        onChange={(e) => handleUpdateStatus(e.target.value)}
                        className="border px-3 py-2 rounded-lg text-sm font-bold"
                        disabled={busy}
                    >
                        {["paid", "processing", "printed", "shipping", "delivered", "canceled", "refunded", "archived"].map((s) => (
                            <option key={s} value={s}>
                                {s.toUpperCase()}
                            </option>
                        ))}
                    </select>

                    {order.status !== "canceled" && (
                        <button onClick={handleCancel} disabled={busy} className="admin-btn bg-rose-50 text-rose-600">
                            Cancel Order
                        </button>
                    )}

                    {/* ✅ 영구 삭제 버튼 */}
                    <button onClick={handleDeleteOrder} disabled={busy} className="admin-btn bg-rose-600 text-white hover:bg-rose-700 border-none shadow-md shadow-rose-100">
                        <Trash2 size={16} />
                        Delete Permanently
                    </button>

                    <button onClick={handleExportJson} disabled={busy} className="admin-btn admin-btn-secondary">
                        <FileJson size={16} /> JSON
                    </button>

                    <button onClick={handleDownloadZip} disabled={busy} className="admin-btn admin-btn-primary">
                        {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                        ZIP
                    </button>
                </div>
            </div>

            {/* Customer / Shipping / Ops */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 shrink-0">
                {/* Customer */}
                <div className="admin-card p-4 space-y-2">
                    <div className="text-xs font-black text-zinc-400 uppercase">Customer</div>
                    <div>
                        <div className="text-lg font-black">{customerName}</div>

                        {deviceInfo && (
                            <div
                                className={`mt-1 inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold border ${isIos ? "bg-zinc-100 text-zinc-800 border-zinc-200" : "bg-green-50 text-green-700 border-green-200"
                                    }`}
                            >
                                <span className="text-xs">{isIos ? "🍎" : "🤖"}</span>
                                <span className="truncate max-w-[150px]">{deviceInfo.model || deviceInfo.os}</span>
                            </div>
                        )}
                    </div>

                    <div className="text-sm text-zinc-600 flex items-center gap-2 mt-2">
                        <Mail size={14} />
                        <span className="truncate">{customerEmail}</span>
                        {customerEmail && customerEmail !== "-" && (
                            <button className="ml-auto text-zinc-400 hover:text-zinc-800" onClick={() => copyText(customerEmail)}>
                                <Copy size={14} />
                            </button>
                        )}
                    </div>

                    <div className="text-sm text-zinc-600 flex items-center gap-2">
                        <Phone size={14} />
                        <span>{customerPhone}</span>
                        {customerPhone && customerPhone !== "-" && (
                            <button
                                className="ml-auto text-zinc-400 hover:text-zinc-800"
                                onClick={() => copyText(String(customerPhone))}
                            >
                                <Copy size={14} />
                            </button>
                        )}
                    </div>

                    <div className="mt-4 pt-4 border-t border-zinc-100 space-y-2">
                        {promoCode && (
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-zinc-500 font-bold flex items-center gap-1">
                                    <Tag size={12} /> Promo Code
                                </span>
                                <span className="text-indigo-600 font-bold">{promoCode}</span>
                            </div>
                        )}

                        {discountAmount > 0 && (
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-zinc-500 font-bold">Discount</span>
                                <span className="text-green-600 font-bold">-฿{discountAmount.toLocaleString()}</span>
                            </div>
                        )}

                        <div className="flex justify-between items-center text-base mt-1">
                            <span className="text-zinc-900 font-black">Total Paid</span>
                            <span className="text-zinc-900 font-black">฿{totalPaid.toLocaleString()}</span>
                        </div>
                    </div>
                </div>

                {/* Shipping */}
                <div className="admin-card p-4 space-y-3">
                    <div className="text-xs font-black text-zinc-400 uppercase flex items-center gap-2">
                        <MapPin size={14} />
                        Shipping
                    </div>

                    <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
                        <div className="text-zinc-400 font-bold">Full name</div>
                        <div className="font-bold">{shipFullName || "-"}</div>

                        <div className="text-zinc-400 font-bold">Address</div>
                        <div className="text-zinc-700">{shipAddress1 || "-"}</div>

                        <div className="text-zinc-400 font-bold">Address2</div>
                        <div className="text-zinc-700">{shipAddress2 || "-"}</div>

                        <div className="text-zinc-400 font-bold">City/State</div>
                        <div className="text-zinc-700">{shipCityState || "-"}</div>

                        <div className="text-zinc-400 font-bold">Postal</div>
                        <div className="text-zinc-700">{shipPostal || "-"}</div>

                        <div className="text-zinc-400 font-bold">Country</div>
                        <div className="text-zinc-700">{shipCountry || "-"}</div>

                        <div className="text-zinc-400 font-bold">Phone</div>
                        <div className="text-zinc-700">{shipPhone || "-"}</div>
                    </div>

                    <div className="text-xs text-zinc-500 font-mono">
                        Folder hint: <span className="font-black">{dateKey}/customer/{customerName}/{order.orderCode}</span>
                    </div>
                </div>

                {/* Ops */}
                <div className="admin-card p-4 space-y-3">
                    <div className="text-xs font-black text-zinc-400 uppercase">Ops</div>

                    <div className="flex items-center gap-2">
                        <Truck size={16} />
                        <input
                            className="admin-input w-full"
                            placeholder="Tracking number"
                            defaultValue={orderOps?.trackingNumber || ""}
                            onBlur={(e) => handleSaveOps({ trackingNumber: e.target.value })}
                            disabled={busy}
                        />
                    </div>

                    <div className="flex items-start gap-2">
                        <StickyNote size={16} className="mt-2" />
                        <textarea
                            className="admin-input w-full"
                            rows={3}
                            placeholder="Admin note (internal)"
                            defaultValue={orderOps?.adminNote || ""}
                            onBlur={(e) => handleSaveOps({ adminNote: e.target.value })}
                            disabled={busy}
                        />
                    </div>
                </div>
            </div>

            {/* Items */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 shrink-0">
                {order.items.map((item, idx) => {
                    const meta = (item as any)?.assets?.printMeta as
                        | { width: number; height: number; ok5000?: boolean }
                        | undefined;

                    const client = printDims[idx];

                    // ✅ [수정됨] 4000px 이상이면 OK로 표시 (기존 5000px -> 4000px 완화)
                    const clientOk5000 = client ? client.w >= 4000 && client.h >= 4000 : false;

                    const previewUrl = resolved[idx]?.previewUrl || pickAdminThumb(item);
                    const printUrl = resolved[idx]?.printUrl || (item as any)?.assets?.printUrl || null;

                    const previewOk = !!previewUrl;
                    const printOk = !!printUrl;

                    return (
                        <div key={idx} className="admin-card p-3 flex flex-row gap-4 items-start">
                            <div className="w-32 h-32 shrink-0 bg-zinc-50 rounded overflow-hidden border border-zinc-100">
                                {previewOk ? (
                                    <img src={previewUrl as string} className="w-full h-full object-cover" alt={`Preview ${idx}`} />
                                ) : (
                                    <div className="h-full flex flex-col gap-1 items-center justify-center text-zinc-300">
                                        <ImageIcon size={24} />
                                        <div className="text-[10px] text-zinc-400 text-center leading-tight px-1">(썸네일 없음)</div>
                                    </div>
                                )}
                            </div>

                            <div className="flex-1 min-w-0 flex flex-col gap-2">
                                <div className="flex justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="font-bold truncate">{(item as any).filterId}</p>
                                        <p className="text-xs text-zinc-400">
                                            {(item as any).size} × {(item as any).quantity} · index {(item as any).index}
                                        </p>

                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {meta ? (
                                                meta.ok5000 ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-emerald-100 text-emerald-700 font-bold border border-emerald-200">
                                                        <CheckCircle2 size={10} />
                                                        PrintMeta OK: {meta.width}×{meta.height}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-rose-100 text-rose-700 font-bold border border-rose-200">
                                                        <AlertCircle size={10} />
                                                        PrintMeta NOT OK: {meta.width}×{meta.height}
                                                    </span>
                                                )
                                            ) : client ? (
                                                clientOk5000 ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-emerald-50 text-emerald-700 font-bold border border-emerald-200">
                                                        <CheckCircle2 size={10} />
                                                        Client audit OK: {client.w}×{client.h}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-rose-50 text-rose-700 font-bold border border-rose-200">
                                                        <AlertCircle size={10} />
                                                        Client audit: {client.w}×{client.h}
                                                    </span>
                                                )
                                            ) : (
                                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-zinc-100 text-zinc-500 font-bold border border-zinc-200">
                                                    Pending audit
                                                </span>
                                            )}

                                            {!printOk ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-amber-100 text-amber-700 font-bold border border-amber-200">
                                                    <AlertCircle size={10} />
                                                    Print file not ready
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>

                                    <p className="font-black whitespace-nowrap">฿{(item as any).lineTotal.toLocaleString()}</p>
                                </div>

                                <div className="mt-2 grid grid-cols-2 gap-2">
                                    <button
                                        onClick={() => (previewUrl ? openUrl(previewUrl) : openStoragePath((item as any)?.assets?.previewPath))}
                                        className="admin-btn admin-btn-secondary w-full"
                                        disabled={!previewOk && !(item as any)?.assets?.previewPath}
                                    >
                                        <ExternalLink size={12} /> View Preview
                                    </button>

                                    <button
                                        onClick={() => (printUrl ? openUrl(printUrl) : openStoragePath((item as any)?.assets?.printPath))}
                                        className="admin-btn admin-btn-secondary w-full"
                                        disabled={!printOk && !(item as any)?.assets?.assets?.printPath && !(item as any)?.assets?.printPath}
                                    >
                                        <ExternalLink size={12} /> View Print
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}