"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import {
    ChevronLeft,
    Download,
    FileJson,
    MapPin,
    User,
    CreditCard,
    Image as ImageIcon,
    ExternalLink,
    Loader2,
    Package,
    Truck,
    Edit3,
    AlertOctagon,
    Save
} from 'lucide-react-native';
import { OrderDetail } from '@/lib/admin/types';
import StatusBadge from './StatusBadge';
import { auth } from '@/lib/firebase';

export default function AdminOrderDetail({ orderId }: { orderId: string }) {
    const router = useRouter();
    const [order, setOrder] = useState<OrderDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Editing State
    const [trackingNumber, setTrackingNumber] = useState('');
    const [adminNote, setAdminNote] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // Action State
    const [actionLoading, setActionLoading] = useState(false);

    useEffect(() => {
        const fetchDetail = async () => {
            try {
                const token = await auth.currentUser?.getIdToken();
                if (!token) throw new Error("No admin token available");

                const API_BASE = process.env.EXPO_PUBLIC_ADMIN_API_BASE || 'http://localhost:4000';
                const res = await fetch(`${API_BASE}/api/admin/orders/${orderId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.error || "Failed to fetch order details");
                }

                const data = await res.json();
                setOrder(data);
                setTrackingNumber(data.trackingNumber || '');
                setAdminNote(data.adminNote || '');
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchDetail();
    }, [orderId]);

    const handleSaveOps = async () => {
        setIsSaving(true);
        try {
            const token = await auth.currentUser?.getIdToken();
            const API_BASE = process.env.EXPO_PUBLIC_ADMIN_API_BASE || 'http://localhost:4000';
            const res = await fetch(`${API_BASE}/api/admin/orders/${orderId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    trackingNumber,
                    adminNote
                })
            });

            if (!res.ok) throw new Error("Update failed");

            // Re-fetch or just update local
            if (res.ok) {
                const data = await res.json();
                // If status changed to shipping automatically
                if (data.updates?.status) {
                    setOrder(prev => prev ? ({ ...prev, status: data.updates.status }) : null);
                }
                alert("Saved successfully");
            }

        } catch (err: any) {
            alert("Error saving: " + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleRefund = async () => {
        const reason = prompt("Enter refund reason (optional):");
        if (reason === null) return;

        setActionLoading(true);
        try {
            const token = await auth.currentUser?.getIdToken();
            const API_BASE = process.env.EXPO_PUBLIC_ADMIN_API_BASE || 'http://localhost:4000';
            const res = await fetch(`${API_BASE}/api/admin/orders/refund`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ orderId, reason })
            });
            if (!res.ok) throw new Error("Refund failed");
            alert("Order marked as REFUNDED");
            router.back();
        } catch (err: any) {
            alert(err.message);
        } finally {
            setActionLoading(false);
        }
    };

    const handleCancel = async () => {
        const reason = prompt("Enter cancellation reason (optional):");
        if (reason === null) return;

        setActionLoading(true);
        try {
            const token = await auth.currentUser?.getIdToken();
            const API_BASE = process.env.EXPO_PUBLIC_ADMIN_API_BASE || 'http://localhost:4000';
            const res = await fetch(`${API_BASE}/api/admin/orders/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ orderId, reason })
            });
            if (!res.ok) throw new Error("Cancel failed");
            alert("Order marked as CANCELED");
            router.back();
        } catch (err: any) {
            alert(err.message);
        } finally {
            setActionLoading(false);
        }
    };

    // ... handleExportJson, handleDownloadZip reuse ...
    const handleDownloadZip = async () => {
        // reuse fetch logic
        try {
            const token = await auth.currentUser?.getIdToken();
            const API_BASE = process.env.EXPO_PUBLIC_ADMIN_API_BASE || 'http://localhost:4000';
            const res = await fetch(`${API_BASE}/api/admin/orders/export/zip`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ orderIds: [orderId], type: 'print' })
            });
            if (!res.ok) throw new Error("ZIP Failed");
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `order_${order?.orderCode}_print.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (e) { alert("ZIP Error"); }
    };

    if (loading) return <div className="flex justify-center p-20"><Loader2 className="animate-spin" /></div>;
    if (error || !order) return <div className="p-20 text-center">Error: {error}</div>;

    return (
        <div className="space-y-8 pb-20">
            {/* Top Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                    <button onClick={() => router.back()} className="admin-btn admin-btn-secondary !p-2">
                        <ChevronLeft size={24} />
                    </button>
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <h1 className="text-3xl font-black text-zinc-900 font-mono">{order.orderCode}</h1>
                            <StatusBadge status={order.status} />
                        </div>
                        <p className="text-zinc-400 text-sm font-mono uppercase tracking-tighter">{order.id}</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button onClick={handleDownloadZip} className="admin-btn admin-btn-primary">
                        <Download size={18} />
                        <span>Download ZIP</span>
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* OPS PANEL (New) */}
                <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Ops: Tracking */}
                    <section className="admin-card p-6 bg-blue-50/50 border-blue-100">
                        <div className="flex items-center gap-2 text-blue-800 border-b border-blue-200 pb-3 mb-4">
                            <Truck size={18} />
                            <h3 className="text-xs font-black uppercase tracking-widest">Fulfillment</h3>
                        </div>
                        <div className="flex gap-2">
                            <input
                                className="admin-input flex-1 bg-white"
                                placeholder="Tracking Number"
                                value={trackingNumber}
                                onChange={e => setTrackingNumber(e.target.value)}
                            />
                            <button
                                onClick={handleSaveOps}
                                disabled={isSaving}
                                className="admin-btn bg-blue-600 text-white hover:bg-blue-700 border-transparent"
                            >
                                <Save size={14} /> Save
                            </button>
                        </div>
                        <p className="text-[10px] text-blue-400 mt-2">
                            * Saving a tracking number will automatically set status to SHIPPING.
                        </p>
                    </section>

                    {/* Ops: Admin Notes */}
                    <section className="admin-card p-6 bg-yellow-50/50 border-yellow-100">
                        <div className="flex items-center gap-2 text-yellow-800 border-b border-yellow-200 pb-3 mb-4">
                            <Edit3 size={18} />
                            <h3 className="text-xs font-black uppercase tracking-widest">Internal Notes</h3>
                        </div>
                        <div className="flex gap-2">
                            <textarea
                                className="admin-input flex-1 bg-white h-24 text-xs font-mono"
                                placeholder="Add internal notes here..."
                                value={adminNote}
                                onChange={e => setAdminNote(e.target.value)}
                            />
                        </div>
                        <div className="flex justify-end mt-2">
                            <button
                                onClick={handleSaveOps}
                                disabled={isSaving}
                                className="admin-btn bg-yellow-600 text-white hover:bg-yellow-700 border-transparent"
                            >
                                <Save size={14} /> Save Note
                            </button>
                        </div>
                    </section>
                </div>

                {/* Left Col: Info Cards */}
                <div className="space-y-6 lg:col-span-1">
                    {/* Customer */}
                    <section className="admin-card p-6 space-y-4">
                        <div className="flex items-center gap-2 text-zinc-400 border-b border-zinc-100 pb-3 mb-1">
                            <User size={18} />
                            <h3 className="text-xs font-black uppercase tracking-widest">Customer</h3>
                        </div>
                        <div>
                            <p className="text-lg font-bold text-zinc-900 leading-tight">{order.customer.fullName || 'Guest'}</p>
                            <p className="text-zinc-400 text-sm">{order.customer.email}</p>
                            <p className="text-zinc-400 text-sm">{order.customer.phone}</p>
                        </div>
                    </section>

                    {/* Shipping */}
                    <section className="admin-card p-6 space-y-4">
                        <div className="flex items-center gap-2 text-zinc-400 border-b border-zinc-100 pb-3 mb-1">
                            <MapPin size={18} />
                            <h3 className="text-xs font-black uppercase tracking-widest">Shipping Address</h3>
                        </div>
                        <div className="space-y-1">
                            <p className="text-zinc-800 font-bold">{order.shipping.fullName}</p>
                            <p className="text-zinc-500 text-sm whitespace-pre-wrap leading-relaxed">
                                {order.shipping.address1}{order.shipping.address2 ? `\n${order.shipping.address2}` : ''}
                            </p>
                            <p className="text-zinc-500 text-sm">{order.shipping.city}, {order.shipping.state} {order.shipping.postalCode}</p>
                            <p className="text-zinc-900 font-black pt-2 flex items-center gap-1">
                                <span className="text-xs text-zinc-400 uppercase tracking-tighter">Country:</span>
                                {order.shipping.country}
                            </p>
                        </div>
                    </section>
                </div>

                {/* Right Col: Items List */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                        <div className="flex items-center gap-2 text-zinc-400">
                            <Package size={18} />
                            <h3 className="text-xs font-black uppercase tracking-widest">Order Items ({order.items.length})</h3>
                        </div>
                        <div className="text-[10px] text-zinc-300 font-mono tracking-tighter">{order.storageBasePath || "legacy storage"}</div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {order.items.map((item, idx) => (
                            <div key={idx} className="admin-card border border-zinc-100 bg-white p-1 flex flex-col shadow-sm">
                                <div className="relative aspect-square rounded-t-[10px] overflow-hidden bg-zinc-50">
                                    {item.assets.previewUrl ? (
                                        <img
                                            src={item.assets.previewUrl}
                                            className="w-full h-full object-cover"
                                            alt={`Item ${idx}`}
                                        />
                                    ) : (
                                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-zinc-300">
                                            <ImageIcon size={40} strokeWidth={1} />
                                            <span className="text-[10px] uppercase font-bold">No Preview Available</span>
                                        </div>
                                    )}
                                    <div className="absolute top-2 left-2 bg-white/80 backdrop-blur px-2 py-1 rounded-lg text-[10px] font-black text-accent border border-accent/20">#{idx + 1}</div>
                                </div>
                                <div className="p-4 flex-1 flex flex-col justify-between">
                                    <div>
                                        <p className="text-sm font-black text-zinc-900 capitalize">{item.filterId} Filter</p>
                                        <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest leading-none mt-1">{item.size} // Qty: {item.quantity}</p>
                                    </div>
                                    <div className="flex gap-2 mt-4">
                                        {item.assets.printUrl && (
                                            <a href={item.assets.printUrl} target="_blank" rel="noreferrer" className="flex-1 admin-btn admin-btn-secondary !text-[10px] !py-1 justify-center">
                                                <ExternalLink size={12} /> Print
                                            </a>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Dangerous Zone */}
                    <div className="pt-12 border-t border-rose-100">
                        <h3 className="text-xs font-black uppercase tracking-widest text-rose-500 mb-4 flex items-center gap-2">
                            <AlertOctagon size={14} /> Dangerous Area
                        </h3>
                        <div className="flex gap-4">
                            <button
                                onClick={handleRefund}
                                disabled={actionLoading}
                                className="px-4 py-2 border border-rose-200 text-rose-600 rounded-lg text-sm font-bold hover:bg-rose-50"
                            >
                                Refund Order
                            </button>
                            <button
                                onClick={handleCancel}
                                disabled={actionLoading}
                                className="px-4 py-2 bg-rose-500 text-white rounded-lg text-sm font-bold hover:bg-rose-600"
                            >
                                Cancel Order
                            </button>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
