"use client";

import React from 'react';
import { useLocalSearchParams, useRouter } from "expo-router";
import AdminOrderDetail from "@/components/admin/AdminOrderDetail.web";
import { useRequireAdmin } from "@/lib/admin/useRequireAdmin";

export default function OrderDetailPage() {
    const { orderId } = useLocalSearchParams<{ orderId: string }>();
    const { status, user, claims, deniedReason } = useRequireAdmin();
    const router = useRouter();

    if (status === 'loading') {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-accent"></div>
            </div>
        );
    }

    if (status === 'denied') {
        return (
            <div className="min-h-[60vh] flex items-center justify-center p-8">
                <div className="max-w-md w-full bg-white border border-zinc-200 shadow-xl rounded-2xl p-8 space-y-6">
                    <div className="space-y-2">
                        <h1 className="text-2xl font-black text-zinc-900">Access Denied</h1>
                        <p className="text-zinc-500">
                            {deniedReason === 'NO_USER' && 'You must be logged in to access the order details.'}
                            {deniedReason === 'NOT_ALLOWED_EMAIL' && 'This account is not authorized to view admin order details.'}
                            {deniedReason === 'NOT_ADMIN' && 'Your account lacks the isAdmin privilege.'}
                            {deniedReason === 'ERROR' && 'An unexpected error occurred during authorization.'}
                        </p>
                    </div>

                    <div className="bg-zinc-50 rounded-xl p-4 space-y-3 font-mono text-xs">
                        <div className="flex justify-between border-b border-zinc-200 pb-2">
                            <span className="text-zinc-400">User:</span>
                            <span className="text-zinc-600">{user?.email || 'Guest'}</span>
                        </div>
                        <div className="flex justify-between border-b border-zinc-200 pb-2">
                            <span className="text-zinc-400">Status:</span>
                            <span className="text-rose-600 font-bold">{deniedReason}</span>
                        </div>
                        <div className="pt-2">
                            <p className="text-zinc-400 mb-2 underline text-[10px]">Token Claims:</p>
                            <pre className="text-zinc-500 overflow-auto max-h-40 text-[10px]">
                                {JSON.stringify(claims || {}, null, 2)}
                            </pre>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3">
                        {deniedReason === 'NO_USER' ? (
                            <button
                                onClick={() => router.push('/auth/email')}
                                className="w-full bg-accent text-white font-bold py-3 rounded-xl transition-all hover:scale-[1.02] active:scale-95 shadow-lg shadow-accent/20"
                            >
                                Go to Login
                            </button>
                        ) : null}

                        <button
                            onClick={() => router.replace('/')}
                            className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-600 font-bold py-3 rounded-xl transition-colors"
                        >
                            Return Home
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (!orderId) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
                <p className="text-rose-500 font-bold">Invalid Order ID provided.</p>
                <button onClick={() => router.back()} className="text-zinc-600 hover:text-accent underline font-bold">Go Back</button>
            </div>
        );
    }

    return <AdminOrderDetail orderId={orderId} />;
}
