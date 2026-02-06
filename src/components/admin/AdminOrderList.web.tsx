"use client";

import React, { useState, useEffect } from 'react';
import { Link, useRouter } from 'expo-router';
import {
    Search,
    Filter,
    ChevronRight,
    RefreshCw,
    Calendar,
    Package,
    ArrowUpDown,
    Printer,
    CheckSquare,
    Square,
    Download,
    FileText,
    Truck,
    Edit3
} from 'lucide-react-native';
import { OrderHeader } from '@/lib/admin/types';
import StatusBadge from './StatusBadge';
import { auth } from '@/lib/firebase';

export default function AdminOrderList() {
    const router = useRouter();
    const [orders, setOrders] = useState<OrderHeader[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filters
    const [q, setQ] = useState('');
    const [status, setStatus] = useState<string>('ALL');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [sort, setSort] = useState<'asc' | 'desc'>('desc');
    const [mode, setMode] = useState<'default' | 'queue'>('default');

    // Selection
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [bulkStatus, setBulkStatus] = useState<string>('');
    const [bulkLoading, setBulkLoading] = useState(false);

    // Bulk Ops State
    const [showBulkNote, setShowBulkNote] = useState(false);
    const [bulkNoteText, setBulkNoteText] = useState('');
    const [showBulkTracking, setShowBulkTracking] = useState(false);
    const [bulkTrackingText, setBulkTrackingText] = useState('');

    const fetchOrders = async () => {
        setLoading(true);
        setError(null);
        try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) throw new Error("No admin token available");

            const params = new URLSearchParams();
            if (q.trim()) params.append('q', q.trim());
            if (status !== 'ALL') params.append('status', status);
            if (from) params.append('from', from);
            if (to) params.append('to', to);
            if (sort) params.append('sort', sort);
            if (mode === 'queue') params.append('mode', 'queue');


            const API_BASE = process.env.EXPO_PUBLIC_ADMIN_API_BASE || 'http://localhost:4000';
            const res = await fetch(`${API_BASE}/api/admin/orders?${params.toString()}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Failed to fetch orders");
            }

            const data = await res.json();
            setOrders(data.rows || []);
            setSelectedIds(new Set());
        } catch (err: any) {
            console.error(err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            fetchOrders();
        }, 500);
        return () => clearTimeout(timer);
    }, [q, status, from, to, sort, mode]);

    const handleSelectAll = () => {
        if (selectedIds.size === orders.length && orders.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(orders.map(o => o.id)));
        }
    };

    const toggleSelect = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const handleBulkUpdate = async () => {
        if (selectedIds.size === 0 || !bulkStatus) return;
        if (!confirm(`Update ${selectedIds.size} orders to ${bulkStatus}?`)) return;

        setBulkLoading(true);
        try {
            const token = await auth.currentUser?.getIdToken();
            const API_BASE = process.env.EXPO_PUBLIC_ADMIN_API_BASE || 'http://localhost:4000';
            const res = await fetch(`${API_BASE}/api/admin/orders/batch/status`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    orderIds: Array.from(selectedIds),
                    status: bulkStatus
                })
            });

            if (!res.ok) throw new Error("Bulk update failed");

            alert("Orders updated");
            setBulkStatus('');
            fetchOrders();
        } catch (err: any) {
            alert(err.message);
        } finally {
            setBulkLoading(false);
        }
    };

    const handleBulkNote = async () => {
        if (selectedIds.size === 0 || !bulkNoteText.trim()) return;
        setBulkLoading(true);
        try {
            const token = await auth.currentUser?.getIdToken();
            const API_BASE = process.env.EXPO_PUBLIC_ADMIN_API_BASE || 'http://localhost:4000';
            const res = await fetch(`${API_BASE}/api/admin/orders/batch/notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ orderIds: Array.from(selectedIds), adminNote: bulkNoteText })
            });
            if (!res.ok) throw new Error("Batch note update failed");
            alert("Notes updated");
            setShowBulkNote(false);
            setBulkNoteText('');
            fetchOrders();
        } catch (err: any) { alert(err.message); } finally { setBulkLoading(false); }
    };

    const handleBulkTracking = async () => {
        if (selectedIds.size === 0 || !bulkTrackingText.trim()) return;
        setBulkLoading(true);
        try {
            const token = await auth.currentUser?.getIdToken();
            const API_BASE = process.env.EXPO_PUBLIC_ADMIN_API_BASE || 'http://localhost:4000';
            const res = await fetch(`${API_BASE}/api/admin/orders/batch/tracking`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ orderIds: Array.from(selectedIds), trackingNumber: bulkTrackingText })
            });
            if (!res.ok) throw new Error("Batch tracking update failed");
            alert("Tracking numbers updated");
            setShowBulkTracking(false);
            setBulkTrackingText('');
            fetchOrders();
        } catch (err: any) { alert(err.message); } finally { setBulkLoading(false); }
    };

    const handleExportCSV = async () => {
        try {
            const token = await auth.currentUser?.getIdToken();
            const params = new URLSearchParams();
            if (q.trim()) params.append('q', q.trim());
            if (status !== 'ALL') params.append('status', status);
            if (from) params.append('from', from);
            if (to) params.append('to', to);
            // etc...

            const API_BASE = process.env.EXPO_PUBLIC_ADMIN_API_BASE || 'http://localhost:4000';
            const res = await fetch(`${API_BASE}/api/admin/orders/export/customers?${params.toString()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error("Export failed");

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `orders_${new Date().toISOString()}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (err: any) { alert(err.message); }
    };

    const handleDownloadZIP = async (type: 'preview' | 'print') => {
        if (selectedIds.size === 0) return;
        try {
            // Note: In real app, might want to show clearer loading state for large downloads
            const token = await auth.currentUser?.getIdToken();
            const API_BASE = process.env.EXPO_PUBLIC_ADMIN_API_BASE || 'http://localhost:4000';
            const res = await fetch(`${API_BASE}/api/admin/orders/export/zip`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ orderIds: Array.from(selectedIds), type })
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "ZIP generation failed");
            }

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `orders_${type}_${new Date().getTime()}.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (err: any) { alert("ZIP Error: " + err.message); }
    };

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    const isAllSelected = orders.length > 0 && selectedIds.size === orders.length;

    return (
        <div className="space-y-6">
            {/* Controls Bar */}
            <div className="flex flex-col gap-4">
                {/* Search & Main Filters */}
                <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                    <div className="relative flex-1 w-full max-w-md">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
                            <Search size={18} />
                        </div>
                        <input
                            type="text"
                            placeholder="Search by Order Code..."
                            className="admin-input pl-10 w-full"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                        />
                    </div>

                    <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                        <button
                            onClick={handleExportCSV}
                            className="px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 border bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50"
                        >
                            <FileText size={14} /> Export CSV
                        </button>

                        <button
                            onClick={() => setMode(mode === 'queue' ? 'default' : 'queue')}
                            className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 border transition-colors ${mode === 'queue'
                                ? 'bg-purple-50 text-purple-600 border-purple-200 shadow-sm'
                                : 'bg-white text-zinc-500 border-zinc-200 hover:border-zinc-300'
                                }`}
                        >
                            <Printer size={14} />
                            {mode === 'queue' ? 'Printing Queue' : 'All Orders'}
                        </button>

                        <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-xl px-3 py-1.5 shadow-sm">
                            <Filter size={16} color="#71717a" />
                            <select
                                className="bg-transparent text-sm font-bold text-zinc-600 focus:outline-none cursor-pointer"
                                value={status}
                                onChange={(e) => setStatus(e.target.value)}
                            >
                                <option value="ALL">All Status</option>
                                <option value="paid">Paid</option>
                                <option value="processing">Processing</option>
                                <option value="printed">Printed</option>
                                <option value="shipping">Shipping</option>
                                <option value="delivered">Delivered</option>
                                <option value="canceled">Canceled</option>
                            </select>
                        </div>

                        <div className="flex items-center gap-2">
                            <input type="date" className="admin-input py-1.5 px-2 text-xs w-32" value={from} onChange={(e) => setFrom(e.target.value)} />
                            <span className="text-zinc-400">-</span>
                            <input type="date" className="admin-input py-1.5 px-2 text-xs w-32" value={to} onChange={(e) => setTo(e.target.value)} />
                        </div>

                        <button
                            onClick={() => setSort(sort === 'desc' ? 'asc' : 'desc')}
                            className="p-2 bg-white border border-zinc-200 rounded-xl text-zinc-500 hover:text-zinc-900"
                        >
                            <ArrowUpDown size={16} className={sort === 'asc' ? 'rotate-180' : ''} />
                        </button>

                        <button onClick={() => fetchOrders()} className="admin-btn admin-btn-secondary h-10 w-10 !p-0 justify-center">
                            <RefreshCw size={18} color={loading ? '#007AFF' : '#71717a'} />
                        </button>
                    </div>
                </div>

                {/* Bulk Actions Bar */}
                {selectedIds.size > 0 && (
                    <div className="bg-accent/5 border border-accent/20 p-3 rounded-xl flex items-center justify-between flex-wrap gap-4 animate-in fade-in slide-in-from-top-2">
                        <div className="flex items-center gap-4">
                            <span className="text-sm font-bold text-accent px-2 border-r border-accent/20 pr-4">
                                {selectedIds.size} selected
                            </span>

                            {/* Standard Status Update */}
                            <div className="flex items-center gap-2">
                                <select
                                    className="admin-input py-1.5 px-3 text-sm border-accent/20 w-32"
                                    value={bulkStatus}
                                    onChange={(e) => setBulkStatus(e.target.value)}
                                >
                                    <option value="">Status...</option>
                                    <option value="processing">Processing</option>
                                    <option value="printed">Printed</option>
                                    <option value="shipping">Shipping</option>
                                    <option value="delivered">Delivered</option>
                                </select>
                                <button
                                    onClick={handleBulkUpdate}
                                    disabled={!bulkStatus || bulkLoading}
                                    className="bg-accent text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm hover:brightness-110 disabled:opacity-50"
                                >
                                    Apply
                                </button>
                            </div>

                            {/* Custom Bulk Buttons */}
                            <button
                                onClick={() => setShowBulkNote(!showBulkNote)}
                                className="bg-white border border-accent/20 text-accent px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-accent/5 flex items-center gap-1"
                            >
                                <Edit3 size={12} /> Note
                            </button>
                            <button
                                onClick={() => setShowBulkTracking(!showBulkTracking)}
                                className="bg-white border border-accent/20 text-accent px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-accent/5 flex items-center gap-1"
                            >
                                <Truck size={12} /> Track
                            </button>

                            {/* ZIP Downloads */}
                            <button
                                onClick={() => handleDownloadZIP('preview')}
                                className="bg-white border border-accent/20 text-accent px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-accent/5 flex items-center gap-1"
                            >
                                <Download size={12} /> ZIP (Prev)
                            </button>
                            <button
                                onClick={() => handleDownloadZIP('print')}
                                className="bg-white border border-accent/20 text-accent px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-accent/5 flex items-center gap-1"
                            >
                                <Download size={12} /> ZIP (Print)
                            </button>
                        </div>
                    </div>
                )}

                {/* Inline Bulk Forms */}
                {selectedIds.size > 0 && showBulkNote && (
                    <div className="bg-white border border-dashed border-accent/30 p-4 rounded-xl flex gap-3 animate-in fade-in">
                        <input
                            placeholder="Add admin note to selected orders..."
                            className="admin-input flex-1"
                            value={bulkNoteText}
                            onChange={(e) => setBulkNoteText(e.target.value)}
                        />
                        <button
                            onClick={handleBulkNote}
                            disabled={!bulkNoteText || bulkLoading}
                            className="bg-accent text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm hover:brightness-110 disabled:opacity-50"
                        >
                            Save Notes
                        </button>
                    </div>
                )}
                {selectedIds.size > 0 && showBulkTracking && (
                    <div className="bg-white border border-dashed border-accent/30 p-4 rounded-xl flex gap-3 animate-in fade-in">
                        <input
                            placeholder="Set tracking # for selected orders..."
                            className="admin-input flex-1"
                            value={bulkTrackingText}
                            onChange={(e) => setBulkTrackingText(e.target.value)}
                        />
                        <button
                            onClick={handleBulkTracking}
                            disabled={!bulkTrackingText || bulkLoading}
                            className="bg-accent text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm hover:brightness-110 disabled:opacity-50"
                        >
                            Save Tracking
                        </button>
                    </div>
                )}
            </div>

            {/* Table */}
            <div className="admin-card">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-zinc-50 border-b border-zinc-100">
                                <th className="px-4 py-4 w-12">
                                    <button onClick={handleSelectAll} className="flex items-center justify-center text-zinc-400 hover:text-zinc-600">
                                        {isAllSelected ? <CheckSquare size={18} className="text-accent" /> : <Square size={18} />}
                                    </button>
                                </th>
                                <th className="px-6 py-4 text-xs font-black text-zinc-400 uppercase tracking-widest">Order</th>
                                <th className="px-6 py-4 text-xs font-black text-zinc-400 uppercase tracking-widest">Date</th>
                                <th className="px-6 py-4 text-xs font-black text-zinc-400 uppercase tracking-widest">Customer</th>
                                <th className="px-6 py-4 text-xs font-black text-zinc-400 uppercase tracking-widest">Items</th>
                                <th className="px-6 py-4 text-xs font-black text-zinc-400 uppercase tracking-widest">Total</th>
                                <th className="px-6 py-4 text-xs font-black text-zinc-400 uppercase tracking-widest text-center">Status</th>
                                <th className="px-6 py-4"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                            {loading && orders.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center text-zinc-500 font-medium">
                                        Loading records...
                                    </td>
                                </tr>
                            ) : orders.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center text-zinc-500 font-medium">
                                        No orders found matching your criteria.
                                    </td>
                                </tr>
                            ) : (
                                orders.map((order) => (
                                    <tr key={order.id} className={`hover:bg-zinc-50 transition-colors ${selectedIds.has(order.id) ? 'bg-accent/5' : ''}`}>
                                        <td className="px-4 py-4">
                                            <button
                                                onClick={() => toggleSelect(order.id)}
                                                className="flex items-center justify-center text-zinc-400 hover:text-zinc-600"
                                            >
                                                {selectedIds.has(order.id) ? <CheckSquare size={18} className="text-accent" /> : <Square size={18} />}
                                            </button>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-black text-zinc-900 font-mono">{order.orderCode}</span>
                                                <span className="text-[10px] text-zinc-400 font-mono uppercase">{order.id.slice(0, 8)}...</span>
                                                {order.trackingNumber ? (
                                                    <span className="text-[10px] text-zinc-500 mt-1 flex items-center gap-1">
                                                        <Truck size={10} /> {order.trackingNumber}
                                                    </span>
                                                ) : null}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-2 text-zinc-600">
                                                <Calendar size={14} color="#a1a1aa" />
                                                <span className="text-sm">{formatDate(order.createdAt)}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold text-zinc-800">{order.customer.fullName}</span>
                                                <span className="text-xs text-zinc-400">{order.customer.email}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-2 text-zinc-600">
                                                <Package size={14} color="#a1a1aa" />
                                                <span className="text-sm font-bold">{order.itemsCount} tiles</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="text-sm font-black text-zinc-900">
                                                {order.currency === 'USD' ? '$' : '฿'}{order.pricing.total.toLocaleString()}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-center">
                                            <StatusBadge status={order.status} />
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <Link href={`/admin/orders/${order.id}`} asChild>
                                                <button className="text-zinc-600 hover:text-accent transition-colors">
                                                    <ChevronRight size={20} />
                                                </button>
                                            </Link>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
