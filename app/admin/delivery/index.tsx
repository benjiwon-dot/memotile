"use client";

import React, { useEffect, useState, useMemo } from "react";
import { Truck, Save, Loader2, CheckCircle2, RefreshCw, Search } from "lucide-react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { listOrders } from "@/lib/admin/orderRepo";
import { OrderHeader } from "@/lib/admin/types";
import { app } from "@/lib/firebase";

export default function AdminDeliveryPage() {
    const [orders, setOrders] = useState<OrderHeader[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [trackingInputs, setTrackingInputs] = useState<Record<string, string>>({});
    const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

    const functions = useMemo(() => getFunctions(app, "us-central1"), []);

    const fetchTargetOrders = async () => {
        setLoading(true);
        try {
            // 인쇄 완료(PRINTED) 혹은 결제 완료(PAID) 상태인 것만 가져와서 송장 작업 준비
            const res: any = await listOrders({ limit: 100, sort: "desc" } as any);
            const targetRows = (res.rows || []).filter((o: any) =>
                ["paid", "processing", "printed"].includes(o.status)
            );
            setOrders(targetRows);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchTargetOrders(); }, []);

    const handleSaveTracking = async (orderId: string) => {
        const num = trackingInputs[orderId]?.trim();
        if (!num) return;

        setBusyIds(prev => new Set(prev).add(orderId));
        try {
            const fn = httpsCallable(functions, "adminUpdateOrderOps");
            // 송장번호 저장 + 상태를 SHIPPING으로 변경
            await fn({ orderId, trackingNumber: num, status: "shipping" });

            // 성공하면 리스트에서 제거 (배송 처리 완료되었으므로)
            setOrders(prev => prev.filter(o => o.id !== orderId));
        } catch (e: any) {
            alert("저장 실패: " + e.message);
        } finally {
            setBusyIds(prev => {
                const next = new Set(prev);
                next.delete(orderId);
                return next;
            });
        }
    };

    const filtered = orders.filter(o =>
        o.orderCode.includes(search) ||
        o.shipping?.fullName?.includes(search)
    );

    return (
        <div className="p-8 max-w-5xl mx-auto">
            <div className="flex justify-between items-end mb-8">
                <div>
                    <h1 className="text-3xl font-black flex items-center gap-3">
                        <Truck size={32} className="text-indigo-600" /> 배송 송장 일괄 입력
                    </h1>
                    <p className="text-zinc-500 mt-2">송장을 입력하고 엔터를 치면 즉시 <b>SHIPPING</b> 상태로 변경됩니다.</p>
                </div>
                <button onClick={fetchTargetOrders} className="p-2 hover:rotate-180 transition-transform">
                    <RefreshCw size={20} />
                </button>
            </div>

            <div className="relative mb-6">
                <Search className="absolute left-3 top-3 text-zinc-400" size={18} />
                <input
                    className="w-full p-3 pl-10 border rounded-xl"
                    placeholder="주문번호 또는 이름 검색..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
            </div>

            <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-zinc-50 border-b text-xs font-bold text-zinc-400 uppercase">
                        <tr>
                            <th className="p-4">주문정보</th>
                            <th className="p-4">수령인 / 연락처</th>
                            <th className="p-4">송장 번호 입력</th>
                            <th className="p-4 w-20"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {filtered.map(o => (
                            <tr key={o.id} className="hover:bg-zinc-50">
                                <td className="p-4">
                                    <div className="font-mono font-bold text-indigo-600">{o.orderCode}</div>
                                    <div className="text-[10px] text-zinc-400 uppercase">{o.status}</div>
                                </td>
                                <td className="p-4">
                                    <div className="font-bold">{o.shipping?.fullName}</div>
                                    <div className="text-xs text-zinc-500">{o.shipping?.phone}</div>
                                </td>
                                <td className="p-4">
                                    <input
                                        className="w-full p-2 border rounded-lg font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                                        placeholder="송장번호 입력 후 Enter"
                                        value={trackingInputs[o.id] || ""}
                                        onChange={e => setTrackingInputs({ ...trackingInputs, [o.id]: e.target.value })}
                                        onKeyDown={e => e.key === 'Enter' && handleSaveTracking(o.id)}
                                        disabled={busyIds.has(o.id)}
                                    />
                                </td>
                                <td className="p-4 text-right">
                                    <button
                                        onClick={() => handleSaveTracking(o.id)}
                                        disabled={!trackingInputs[o.id] || busyIds.has(o.id)}
                                        className="p-2 bg-indigo-600 text-white rounded-lg disabled:bg-zinc-200"
                                    >
                                        {busyIds.has(o.id) ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {filtered.length === 0 && <div className="p-20 text-center text-zinc-400">대기 중인 주문이 없습니다.</div>}
            </div>
        </div>
    );
}