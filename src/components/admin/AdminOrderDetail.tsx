// src/components/admin/AdminOrderDetail.tsx
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
} from "lucide-react";

import { getStorage, ref, getDownloadURL } from "firebase/storage";
import { getFunctions, httpsCallable } from "firebase/functions";

import { OrderDetail } from "@/lib/admin/types";
import { getOrderDetail } from "@/lib/admin/orderRepo";
import StatusBadge from "./StatusBadge";

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

async function resolveStorageUrl(storage: ReturnType<typeof getStorage>, maybeUrl?: string | null, maybePath?: string | null) {
    if (maybeUrl && typeof maybeUrl === "string" && maybeUrl.startsWith("http")) return maybeUrl;
    if (maybePath && typeof maybePath === "string" && maybePath.length > 3) {
        return await getDownloadURL(ref(storage, maybePath));
    }
    return null;
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

export default function AdminOrderDetail({ orderId }: { orderId: string }) {
    const router = useRouter();

    const [order, setOrder] = useState<OrderDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // resolved urls per item index
    const [resolved, setResolved] = useState<Record<number, { previewUrl?: string | null; printUrl?: string | null }>>(
        {}
    );

    // client-side audit fallback (web only)
    const [printDims, setPrintDims] = useState<Record<number, { w: number; h: number }>>({});

    const storage = useMemo(() => getStorage(), []);
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

            // resolve preview/print URLs safely (web admin)
            if (isWeb && data?.items?.length) {
                const next: Record<number, { previewUrl?: string | null; printUrl?: string | null }> = {};
                await Promise.all(
                    data.items.map(async (item, idx) => {
                        try {
                            const previewUrl = await resolveStorageUrl(
                                storage,
                                pickAdminThumb(item),
                                (item as any)?.assets?.previewPath || (item as any)?.previewPath || (item as any)?.storagePath
                            );

                            const printUrl = await resolveStorageUrl(
                                storage,
                                (item as any)?.assets?.printUrl || (item as any)?.printUrl,
                                (item as any)?.assets?.printPath || (item as any)?.printPath || (item as any)?.printStoragePath
                            );

                            next[idx] = { previewUrl, printUrl };

                            // fallback audit: load naturalWidth/Height from print url
                            if (printUrl) {
                                const img = new Image();
                                img.onload = () => {
                                    if (!aliveRef.current) return;
                                    setPrintDims((prev) => ({ ...prev, [idx]: { w: img.naturalWidth, h: img.naturalHeight } }));
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orderId]);

    /* ---------- Actions ---------- */

    const handleDownloadZip = async () => {
        setBusy(true);
        try {
            const fn = httpsCallable(getFunctions(undefined, "us-central1"), "adminExportZipPrints");
            const res = await fn({ orderIds: [orderId], type: "print" });
            const { url } = res.data as any;

            if (url) {
                await downloadFromUrl(url, `Memotile_Print_${orderId}_${new Date().toISOString().slice(0, 10)}.zip`);
            } else {
                alert("ZIP generation returned no URL.");
            }
        } catch (e: any) {
            alert("ZIP Download error: " + (e?.message || String(e)));
        } finally {
            setBusy(false);
        }
    };

    const handleExportJson = async () => {
        if (!isWeb) return;

        setBusy(true);
        try {
            const fn = httpsCallable(getFunctions(undefined, "us-central1"), "adminExportPrinterJSON");
            const res = await fn({ orderIds: [orderId] });
            const { url } = res.data as any;
            if (url) {
                await downloadFromUrl(url, `order_${orderId}.json`);
            } else {
                alert("JSON export returned no URL");
            }
        } catch (e: any) {
            alert("JSON Export error: " + (e?.message || String(e)));
        } finally {
            setBusy(false);
        }
    };

    const handleUpdateStatus = async (status: string) => {
        if (!order) return;

        setBusy(true);
        try {
            const fn = httpsCallable(getFunctions(undefined, "us-central1"), "adminUpdateOrderOps");
            await fn({ orderId, status });

            // safest: refresh
            await refetch();
        } catch (e: any) {
            alert("Update failed: " + (e?.message || String(e)));
        } finally {
            setBusy(false);
        }
    };

    const handleSaveOps = async (patch: { trackingNumber?: string; adminNote?: string }) => {
        setBusy(true);
        try {
            const fn = httpsCallable(getFunctions(undefined, "us-central1"), "adminUpdateOrderOps");
            await fn({ orderId, ...patch });
            await refetch();
        } catch (e: any) {
            alert("Save failed: " + (e?.message || String(e)));
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
            const fn = httpsCallable(getFunctions(undefined, "us-central1"), "adminCancelOrder");
            await fn({ orderId, reason });
            await refetch();
        } catch (e: any) {
            alert("Cancel failed: " + (e?.message || String(e)));
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
                <button onClick={() => router.back()} className="admin-btn admin-btn-secondary mt-6">
                    Go Back
                </button>
            </div>
        );
    }

    const customerName = safeName(order.customer?.fullName || order.shipping?.fullName || "Guest");
    const dateKey = yyyymmddFromISO(order.createdAt);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderOps = order as any;

    const fullAddress = [
        order.shipping?.address1,
        order.shipping?.address2,
        [order.shipping?.city, order.shipping?.state].filter(Boolean).join(", "),
        order.shipping?.postalCode,
        order.shipping?.country,
    ]
        .filter(Boolean)
        .join(" · ");

    return (
        <div className="space-y-8 pb-20">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between gap-6">
                <div className="flex items-center gap-4">
                    <button onClick={() => router.back()} className="admin-btn admin-btn-secondary !p-2">
                        <ChevronLeft size={24} />
                    </button>

                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-3xl font-black font-mono">{order.orderCode}</h1>
                            <StatusBadge status={order.status} />
                        </div>
                        <p className="text-xs text-zinc-400 font-mono flex items-center gap-2">
                            {order.id}
                            <button className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-800" onClick={() => copyText(order.id)}>
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
                        {["paid", "processing", "printed", "shipping", "delivered", "canceled", "refunded"].map((s) => (
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
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="admin-card p-4 space-y-2">
                    <div className="text-xs font-black text-zinc-400 uppercase">Customer</div>
                    <div className="text-lg font-black">{customerName}</div>

                    <div className="text-sm text-zinc-600 flex items-center gap-2">
                        <Mail size={14} />
                        <span>{order.customer?.email || order.shipping?.email || "-"}</span>
                        {order.customer?.email && (
                            <button className="ml-auto text-zinc-400 hover:text-zinc-800" onClick={() => copyText(order.customer?.email || "")}>
                                <Copy size={14} />
                            </button>
                        )}
                    </div>

                    <div className="text-sm text-zinc-600 flex items-center gap-2">
                        <Phone size={14} />
                        <span>{order.customer?.phone || order.shipping?.phone || "-"}</span>
                        {(order.customer?.phone || order.shipping?.phone) && (
                            <button className="ml-auto text-zinc-400 hover:text-zinc-800" onClick={() => copyText(String(order.customer?.phone || order.shipping?.phone || ""))}>
                                <Copy size={14} />
                            </button>
                        )}
                    </div>
                </div>

                <div className="admin-card p-4 space-y-2">
                    <div className="text-xs font-black text-zinc-400 uppercase">Shipping</div>
                    <div className="text-sm text-zinc-800 flex items-start gap-2">
                        <MapPin size={16} className="mt-0.5" />
                        <div className="flex-1">
                            <div className="font-bold">{order.shipping?.fullName || customerName}</div>
                            <div className="text-zinc-600">{fullAddress || "-"}</div>
                        </div>
                        {fullAddress && (
                            <button className="text-zinc-400 hover:text-zinc-800" onClick={() => copyText(fullAddress)}>
                                <Copy size={14} />
                            </button>
                        )}
                    </div>

                    <div className="text-xs text-zinc-500 font-mono">
                        Folder hint: <span className="font-black">{dateKey}/customer/{customerName}/{order.orderCode}</span>
                    </div>
                </div>

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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {order.items.map((item, idx) => {
                    const meta = (item as any)?.assets?.printMeta as
                        | { width: number; height: number; ok5000?: boolean }
                        | undefined;

                    const client = printDims[idx];
                    const clientOk5000 = client ? client.w >= 5000 && client.h >= 5000 : false;

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
                                        <p className="font-bold truncate">{item.filterId}</p>
                                        <p className="text-xs text-zinc-400">
                                            {item.size} × {item.quantity} · index {item.index}
                                        </p>

                                        {/* 5000 audit */}
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
                                                    Print file not ready (no printUrl/printPath)
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>

                                    <p className="font-black whitespace-nowrap">฿{item.lineTotal.toLocaleString()}</p>
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
                                        disabled={!printOk && !(item as any)?.assets?.printPath}
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
