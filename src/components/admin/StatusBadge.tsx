import React from 'react';
import { OrderStatus } from '@/lib/admin/types';

const STATUS_COLORS: Record<OrderStatus, string> = {
    paid: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    processing: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    printed: "bg-purple-500/10 text-purple-500 border-purple-500/20",
    shipping: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    delivered: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
    canceled: "bg-rose-500/10 text-rose-500 border-rose-500/20",
    failed: "bg-rose-500/10 text-rose-500 border-rose-500/20",
};

export default function StatusBadge({ status }: { status: OrderStatus }) {
    const colorClass = STATUS_COLORS[status] || "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";

    return (
        <span className={`admin-badge border ${colorClass}`}>
            {status}
        </span>
    );
}
