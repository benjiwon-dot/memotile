// app/admin/dashboard/index.tsx
import React, { useState, useEffect } from "react";
import {
    TrendingUp, Users, DollarSign, Calendar, ArrowRight, Loader2, CreditCard, Activity,
    Smartphone, Apple, RefreshCw, XCircle, FileSpreadsheet, Tag
} from "lucide-react";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import { app } from "@/lib/firebase";
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

// ✨ 날짜 데이터 꼬임 방지용 안전 파싱 함수
const getSafeDate = (val: any) => {
    if (!val) return new Date();
    if (typeof val.toDate === 'function') return val.toDate();
    return new Date(val);
};

export default function DashboardPage() {
    const [loading, setLoading] = useState(true);
    const [timeFilter, setTimeFilter] = useState("this_month");

    const todayStr = new Date().toISOString().split('T')[0];
    const [startDate, setStartDate] = useState(todayStr);
    const [endDate, setEndDate] = useState(todayStr);

    const [downloading, setDownloading] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

    const [stats, setStats] = useState({
        revenueTHB: 0,
        revenueUSD: 0,
        orders: 0,
        pendingRevenueTHB: 0,
        pendingRevenueUSD: 0,
        pendingOrders: 0,
        totalUsers: 0,
        iosUsers: 0,
        androidUsers: 0,
        repurchaseRate: 0,
        cancelRate: 0
    });

    const [chartData, setChartData] = useState([]);
    const [recentOrders, setRecentOrders] = useState<any[]>([]);
    const [statementRows, setStatementRows] = useState<any[]>([]);

    const db = getFirestore(app);

    const handleDownloadStatement = () => {
        if (statementRows.length === 0) {
            alert("선택하신 기간에 다운로드할 결제 내역이 없습니다.");
            return;
        }
        setDownloading(true);

        try {
            let totalTileCount = 0;
            let totalTHB = 0;
            let totalUSD = 0;

            const headers = ["주문 일시", "주문 번호", "고객 이름", "인스타그램 ID", "기기(OS)", "사용한 쿠폰", "타일 수량(EA)", "결제 통화", "결제 금액", "전화 번호", "배송지 주소", "비고"];
            const escape = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;

            const csvLines = [headers.join(",")];

            statementRows.forEach(r => {
                totalTileCount += (r.qty || 0);
                if (r.currency === 'USD') totalUSD += r.amount;
                else totalTHB += r.amount;

                csvLines.push([
                    escape(r.date),
                    escape(r.orderCode),
                    escape(r.name),
                    escape(r.insta),
                    escape(r.os),
                    escape(r.promo),
                    escape(r.qty),
                    escape(r.currency),
                    escape(r.amount),
                    escape(r.phone),
                    escape(r.address),
                    escape(r.note)
                ].join(","));
            });

            csvLines.push("");
            csvLines.push(`[기간 총합계 정산],,,,,,,,,,,`);
            csvLines.push(`총 주문 건수:,${statementRows.length} 건,,,,,,,,,,`);
            csvLines.push(`총 판매 타일수:,${totalTileCount} EA,,,,,,,,,,`);
            csvLines.push(`총 결제 합계 (바트 THB):,฿${totalTHB.toLocaleString()},,,,,,,,,,`);
            csvLines.push(`총 결제 합계 (달러 USD):,$${totalUSD.toLocaleString()},,,,,,,,,,`);

            const csvString = "\uFEFF" + csvLines.join("\n");

            const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            const fileDateStr = timeFilter === 'custom' ? `${startDate}_to_${endDate}` : timeFilter;
            a.href = url;
            a.download = `MemoTile_결제정산내역_${fileDateStr}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

        } catch (error) {
            console.error("내역서 다운로드 실패:", error);
            alert("다운로드 중 오류가 발생했습니다.");
        } finally {
            setDownloading(false);
        }
    };

    useEffect(() => {
        const fetchDashboardData = async () => {
            setLoading(true);
            try {
                const usersSnap = await getDocs(collection(db, "users"));
                let totalUsers = 0;
                let iosCount = 0;
                let androidCount = 0;

                usersSnap.forEach(doc => {
                    totalUsers++;
                    const platform = doc.data().platform?.toLowerCase();
                    if (platform === 'ios') iosCount++;
                    else if (platform === 'android') androidCount++;
                });

                // ✨ 파이어베이스 엔진에 정렬(orderBy)을 시키지 않고 가볍게 통째로 가져옵니다! (무한 로딩 원천 차단)
                const ordersSnap = await getDocs(collection(db, "orders"));

                const allOrdersList = ordersSnap.docs.map(doc => {
                    const data = doc.data();
                    return {
                        id: doc.id,
                        ...data,
                        orderDateSafe: getSafeDate(data.createdAt) // 안전한 날짜 객체 추출
                    };
                });

                // ✨ 브라우저 메모리에서 자바스크립트로 순식간에 최신순 완벽 정렬!
                allOrdersList.sort((a: any, b: any) => b.orderDateSafe.getTime() - a.orderDateSafe.getTime());

                let tempRevenueTHB = 0;
                let tempRevenueUSD = 0;
                let tempOrders = 0;
                let tempPendingTHB = 0;
                let tempPendingUSD = 0;
                let tempPendingOrders = 0;
                let tempCancelledOrders = 0;
                let totalFilteredOrders = 0;

                const dailyRevenue: Record<string, number> = {};
                const recentList: any[] = [];
                const userPurchaseCounts: Record<string, number> = {};
                const rowsForTable: any[] = [];

                const now = new Date();
                const currentMonth = now.getMonth();
                const currentYear = now.getFullYear();

                allOrdersList.forEach((order: any) => {
                    const orderDate = order.orderDateSafe;
                    let isIncluded = false;

                    if (timeFilter === 'all') {
                        isIncluded = true;
                    } else if (timeFilter === 'this_month') {
                        isIncluded = orderDate.getMonth() === currentMonth && orderDate.getFullYear() === currentYear;
                    } else if (timeFilter === 'last_month') {
                        const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
                        const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
                        isIncluded = orderDate.getMonth() === prevMonth && orderDate.getFullYear() === prevYear;
                    } else if (timeFilter === 'custom' && startDate && endDate) {
                        const start = new Date(`${startDate}T00:00:00`);
                        const end = new Date(`${endDate}T23:59:59`);
                        isIncluded = orderDate >= start && orderDate <= end;
                    }

                    if (!isIncluded) return;

                    // 🚨 시스템 자동삭제 처리된 쓰레기 데이터는 대시보드 통계에서 투명인간 취급
                    if (order.status === "deleted") return;

                    totalFilteredOrders++;

                    if (recentList.length < 5) {
                        recentList.push(order);
                    }

                    const amount = order.totalAmount !== undefined ? order.totalAmount : (order.total !== undefined ? order.total : 0);
                    const currency = (order.currency || 'THB').toUpperCase();

                    // ✨ [핵심 수정] 배송중, 배송완료, 보류, 아카이브 상태까지 모두 정상 결제 건으로 취급
                    const validStatuses = ["paid", "completed", "printing", "processing", "shipping", "delivered", "hold", "archived"];

                    if (validStatuses.includes(order.status?.toLowerCase())) {
                        if (currency === 'USD') tempRevenueUSD += amount;
                        else tempRevenueTHB += amount;

                        tempOrders++;

                        if (order.uid) {
                            userPurchaseCounts[order.uid] = (userPurchaseCounts[order.uid] || 0) + 1;
                        }

                        const dateStr = `${orderDate.getMonth() + 1}/${orderDate.getDate()}`;
                        if (currency !== 'USD') {
                            dailyRevenue[dateStr] = (dailyRevenue[dateStr] || 0) + amount;
                        }

                        const shipping = order.shipping || {};
                        const customer = order.customer || {};
                        const tileCount = order.itemsCount || (Array.isArray(order.items) ? order.items.length : 0) || 0;
                        const fullAddress = `${shipping.address1 || ""} ${shipping.address2 || ""} ${shipping.city || ""} ${shipping.state || ""}`.trim();
                        const insta = order.instagram || customer.instagram || order.instagramId || "-";

                        const promoCode = order.promoCode || order.pricing?.promoCode || "-";

                        const platformStr = String(order.platform || order.device || "-").toLowerCase();
                        let osDisplay = "-";
                        if (platformStr.includes('ios') || platformStr.includes('iphone') || platformStr.includes('ipad')) osDisplay = "iOS";
                        else if (platformStr.includes('android') || platformStr.includes('galaxy')) osDisplay = "Android";
                        else if (platformStr !== "-") osDisplay = order.platform;

                        rowsForTable.push({
                            id: order.id,
                            date: orderDate.toLocaleString('ko-KR'),
                            orderCode: order.orderCode || order.id,
                            name: shipping.fullName || customer.fullName || "Guest",
                            phone: shipping.phone || customer.phone || "",
                            insta: insta.startsWith('@') ? insta : (insta !== "-" ? `@${insta}` : "-"),
                            os: osDisplay,
                            promo: promoCode,
                            address: fullAddress,
                            qty: tileCount,
                            amount: amount,
                            currency: currency,
                            note: order.adminNote || ""
                        });
                    }
                    else if (order.status === "pending") {
                        if (currency === 'USD') tempPendingUSD += amount;
                        else tempPendingTHB += amount;
                        tempPendingOrders++;
                    }
                    else if (order.status === "cancelled" || order.status === "refunded" || order.status === "canceled") {
                        tempCancelledOrders++;
                    }
                });

                const buyersArray = Object.values(userPurchaseCounts);
                const repeatCustomers = buyersArray.filter(count => count > 1).length;
                const totalBuyers = buyersArray.length;

                const repurchaseRate = totalBuyers > 0 ? Math.round((repeatCustomers / totalBuyers) * 100) : 0;
                const cancelRate = totalFilteredOrders > 0 ? Math.round((tempCancelledOrders / totalFilteredOrders) * 100) : 0;

                const formattedChartData = Object.keys(dailyRevenue)
                    .map(date => ({ date, 매출액: dailyRevenue[date] }))
                    .reverse();

                setStats({
                    revenueTHB: tempRevenueTHB,
                    revenueUSD: tempRevenueUSD,
                    orders: tempOrders,
                    pendingRevenueTHB: tempPendingTHB,
                    pendingRevenueUSD: tempPendingUSD,
                    pendingOrders: tempPendingOrders,
                    totalUsers,
                    iosUsers: iosCount,
                    androidUsers: androidCount,
                    repurchaseRate,
                    cancelRate
                });

                setChartData(formattedChartData as any);
                setRecentOrders(recentList);
                setStatementRows(rowsForTable);

            } catch (error) {
                console.error("대시보드 데이터 로드 실패:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchDashboardData();
    }, [timeFilter, startDate, endDate, refreshKey]);

    const getStatusBadge = (status: string) => {
        const s = status ? status.toLowerCase() : "";
        switch (s) {
            case "paid": case "completed": case "printing":
                return <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-md">결제완료</span>;
            case "processing":
                return <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-md">처리중</span>;
            case "shipping":
                return <span className="px-2 py-1 bg-indigo-100 text-indigo-700 text-xs font-bold rounded-md">배송중</span>;
            case "delivered":
                return <span className="px-2 py-1 bg-teal-100 text-teal-700 text-xs font-bold rounded-md">배송완료</span>;
            case "hold":
                return <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs font-bold rounded-md">보류</span>;
            case "pending":
                return <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs font-bold rounded-md">결제대기</span>;
            case "cancelled": case "refunded": case "canceled":
                return <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-bold rounded-md">취소됨</span>;
            case "archived":
                return <span className="px-2 py-1 bg-zinc-200 text-zinc-600 text-xs font-bold rounded-md">아카이브</span>;
            case "deleted":
                return <span className="px-2 py-1 bg-zinc-200 text-zinc-500 text-xs font-black rounded-md line-through">자동삭제</span>;
            default:
                return <span className="px-2 py-1 bg-zinc-100 text-zinc-600 text-xs font-bold rounded-md">{status}</span>;
        }
    };

    if (loading && !chartData.length) {
        return (
            <div className="flex flex-col items-center justify-center h-[70vh]">
                <Loader2 className="w-12 h-12 animate-spin text-pink-500 mb-4" />
                <p className="text-zinc-500 font-bold">비즈니스 데이터를 분석 중입니다...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto p-4 lg:p-8 bg-zinc-50/50 min-h-screen mb-20 font-sans">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-black text-zinc-900 flex items-center gap-2">
                        <Activity className="text-pink-600" size={32} />
                        비즈니스 대시보드
                    </h1>
                    <p className="text-zinc-500 text-sm mt-1">실시간 매출 및 고객 행동 인사이트를 확인하세요.</p>
                </div>

                <button
                    onClick={() => setRefreshKey(prev => prev + 1)}
                    className="bg-white border border-zinc-200 text-zinc-700 hover:text-zinc-900 hover:bg-zinc-50 px-4 py-2.5 rounded-xl shadow-sm transition-all flex items-center gap-2 text-sm font-bold"
                >
                    <RefreshCw size={16} className={loading ? "animate-spin text-blue-500" : ""} />
                    데이터 동기화
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-gradient-to-br from-zinc-900 to-zinc-800 p-6 rounded-3xl shadow-lg border border-zinc-700 text-white relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-20"><DollarSign size={80} /></div>
                    <p className="text-sm font-semibold text-zinc-400 mb-4">총 매출액 (결제완료 {stats.orders}건)</p>
                    <div className="grid grid-cols-2 gap-4 items-center">
                        <div className="flex flex-col">
                            <span className="text-[10px] text-zinc-400 font-bold mb-1 uppercase tracking-wider">Thai Baht (THB)</span>
                            <p className="text-2xl lg:text-3xl font-black">฿{stats.revenueTHB.toLocaleString()}</p>
                        </div>
                        <div className="flex flex-col border-l border-zinc-700 pl-4">
                            <span className="text-[10px] text-blue-400 font-bold mb-1 uppercase tracking-wider">US Dollar (USD)</span>
                            <p className="text-2xl lg:text-3xl font-black text-blue-400">${stats.revenueUSD.toLocaleString()}</p>
                        </div>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-3xl shadow-sm border border-zinc-100 flex flex-col justify-center">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-3 bg-green-50 text-green-600 rounded-2xl"><RefreshCw size={20} /></div>
                        <p className="text-sm font-bold text-zinc-500">재구매율 (VIP)</p>
                    </div>
                    <p className="text-2xl font-black text-zinc-800 ml-1">{stats.repurchaseRate}%</p>
                    <p className="text-xs text-green-600 font-medium mt-1 ml-1 flex items-center gap-1">
                        {stats.repurchaseRate < 10 ? '리타겟팅 마케팅 필요' : '단골 고객 유입 양호'}
                    </p>
                </div>

                <div className="bg-white p-6 rounded-3xl shadow-sm border border-zinc-100 flex flex-col justify-center">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-3 bg-red-50 text-red-500 rounded-2xl"><XCircle size={20} /></div>
                        <p className="text-sm font-bold text-zinc-500">주문 취소율</p>
                    </div>
                    <p className="text-2xl font-black text-zinc-800 ml-1">{stats.cancelRate}%</p>
                    <p className="text-xs text-red-500 font-medium mt-1 ml-1 flex items-center gap-1">
                        이탈: ฿{stats.pendingRevenueTHB.toLocaleString()} / <span className="text-blue-500">${stats.pendingRevenueUSD.toLocaleString()}</span>
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="col-span-1 md:col-span-3 bg-white p-6 rounded-3xl shadow-sm border border-zinc-100 flex flex-col md:flex-row items-center justify-between">
                    <div className="flex items-center gap-4 mb-4 md:mb-0">
                        <div className="p-4 bg-blue-50 text-blue-600 rounded-2xl"><Users size={24} /></div>
                        <div>
                            <p className="text-sm font-bold text-zinc-500">전체 누적 가입자</p>
                            <p className="text-3xl font-black text-zinc-800">{stats.totalUsers}명</p>
                        </div>
                    </div>

                    <div className="flex gap-8 border-t md:border-t-0 md:border-l border-zinc-100 pt-4 md:pt-0 md:pl-8 w-full md:w-auto">
                        <div className="flex items-center gap-3">
                            <Apple size={32} className="text-zinc-800" />
                            <div>
                                <p className="text-xs text-zinc-400 font-bold">iOS 유저</p>
                                <p className="text-xl font-black text-zinc-800">{stats.iosUsers}명</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <Smartphone size={32} className="text-green-600" />
                            <div>
                                <p className="text-xs text-zinc-400 font-bold">AOS 유저</p>
                                <p className="text-xl font-black text-zinc-800">{stats.androidUsers}명</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                <div className="lg:col-span-2 bg-white p-6 lg:p-8 rounded-3xl shadow-sm border border-zinc-100">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-lg font-bold text-zinc-800 flex items-center gap-2">
                            <TrendingUp size={20} className="text-pink-500" /> 매출 추이 그래프
                        </h2>
                    </div>

                    <div className="h-[300px] w-full">
                        {chartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#ec4899" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#a1a1aa', fontSize: 12 }} dy={10} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#a1a1aa', fontSize: 12 }} />
                                    <Tooltip
                                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                        itemStyle={{ color: '#ec4899', fontWeight: 'bold' }}
                                    />
                                    <Area type="monotone" dataKey="매출액" stroke="#ec4899" strokeWidth={3} fillOpacity={1} fill="url(#colorRevenue)" activeDot={{ r: 6, fill: '#ec4899', strokeWidth: 0 }} />
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-zinc-400 bg-zinc-50 rounded-2xl border border-dashed border-zinc-200">
                                <Activity size={32} className="mb-2 text-zinc-300" />
                                <span className="font-bold">해당 기간 내 결제 데이터가 없습니다.</span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="lg:col-span-1 bg-white p-6 rounded-3xl shadow-sm border border-zinc-100 flex flex-col">
                    <h2 className="text-lg font-bold text-zinc-800 mb-6 flex items-center gap-2">
                        <CreditCard size={20} className="text-blue-500" /> 최근 접수된 주문
                    </h2>

                    <div className="flex-1 space-y-4">
                        {recentOrders.length > 0 ? (
                            recentOrders.map((order, index) => {
                                const promoCodeName = order.promoCode || order.pricing?.promoCode;

                                return (
                                    <div key={order.id || index} className="flex items-center justify-between p-3 rounded-2xl hover:bg-zinc-50 transition-colors border border-transparent hover:border-zinc-100">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-10 h-10 shrink-0 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-500 font-bold text-sm">
                                                {order.uid ? order.uid.substring(0, 2).toUpperCase() : 'US'}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <p className="text-sm font-bold text-zinc-800">
                                                        {order.currency === 'USD'
                                                            ? <span className="text-blue-600">${order.totalAmount !== undefined ? order.totalAmount.toLocaleString() : (order.total || 0)}</span>
                                                            : <span>฿{order.totalAmount !== undefined ? order.totalAmount.toLocaleString() : (order.total || 0)}</span>}
                                                    </p>
                                                    {promoCodeName && promoCodeName !== "-" && (
                                                        <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 flex items-center gap-1">
                                                            <Tag size={10} /> {promoCodeName}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-[10px] text-zinc-400 mt-0.5 truncate">
                                                    {order.orderDateSafe ? order.orderDateSafe.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '방금 전'}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="shrink-0">{getStatusBadge(order.status)}</div>
                                    </div>
                                );
                            })
                        ) : (
                            <p className="text-sm text-zinc-400 text-center py-10">최근 들어온 주문이 없습니다.</p>
                        )}
                    </div>

                    <button
                        onClick={() => window.location.href = '/admin/marketing'}
                        className="w-full mt-6 py-3 bg-zinc-900 hover:bg-black text-white rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
                    >
                        마케팅 푸시 보내러 가기 <ArrowRight size={16} />
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-3xl shadow-sm border border-zinc-100 overflow-hidden">
                <div className="p-6 border-b border-zinc-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-50/50">
                    <h2 className="text-lg font-bold text-zinc-800 flex items-center gap-2">
                        <FileSpreadsheet size={20} className="text-green-600" />
                        결제 내역서 미리보기 (엑셀 추출용)
                    </h2>

                    <div className="flex flex-wrap items-center gap-3">
                        {timeFilter === "custom" && (
                            <div className="flex items-center gap-2 bg-white p-2 rounded-xl border border-zinc-200 shadow-sm text-xs font-bold">
                                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="outline-none border-none bg-transparent" />
                                <span className="text-zinc-400">~</span>
                                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="outline-none border-none bg-transparent" />
                            </div>
                        )}

                        <div className="flex items-center gap-2 bg-white p-1.5 rounded-xl border border-zinc-200 shadow-sm">
                            <Calendar size={18} className="text-zinc-400 ml-2" />
                            <select
                                value={timeFilter}
                                onChange={(e) => setTimeFilter(e.target.value)}
                                className="bg-transparent border-none text-sm font-bold text-zinc-700 focus:ring-0 cursor-pointer outline-none py-2 pr-8"
                            >
                                <option value="this_month">이번 달</option>
                                <option value="last_month">지난달</option>
                                <option value="custom">📅 날짜 직접 선택</option>
                                <option value="all">전체 기간</option>
                            </select>
                        </div>

                        <button
                            onClick={() => setRefreshKey(prev => prev + 1)}
                            className="bg-white border border-zinc-200 text-zinc-500 hover:text-zinc-900 p-2.5 rounded-xl shadow-sm transition-all"
                            title="데이터 동기화"
                        >
                            <RefreshCw size={18} className={loading ? "animate-spin text-blue-500" : ""} />
                        </button>

                        <button
                            onClick={handleDownloadStatement}
                            disabled={downloading}
                            className="bg-green-600 hover:bg-green-700 disabled:bg-zinc-400 text-white font-black text-sm px-5 py-3 rounded-xl flex items-center gap-2 shadow-md transition-all"
                        >
                            {downloading ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
                            엑셀 다운로드 (CSV)
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-zinc-50 text-zinc-500 font-bold border-b border-zinc-100">
                            <tr>
                                <th className="px-4 py-4 whitespace-nowrap">주문 일시</th>
                                <th className="px-4 py-4 whitespace-nowrap">주문 번호</th>
                                <th className="px-4 py-4 whitespace-nowrap">고객 이름</th>
                                <th className="px-4 py-4 whitespace-nowrap">인스타 ID</th>
                                <th className="px-4 py-4 whitespace-nowrap text-center">어떤 쿠폰?</th>
                                <th className="px-4 py-4 whitespace-nowrap text-center">OS</th>
                                <th className="px-4 py-4 whitespace-nowrap">결제 금액</th>
                                <th className="px-4 py-4 whitespace-nowrap text-center">타일 수</th>
                                <th className="px-4 py-4 whitespace-nowrap">전화번호</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                            {statementRows.length > 0 ? statementRows.map((row) => (
                                <tr key={row.id} className="hover:bg-zinc-50 transition-colors">
                                    <td className="px-4 py-4 whitespace-nowrap text-[11px] text-zinc-500">{row.date}</td>
                                    <td className="px-4 py-4 whitespace-nowrap font-mono font-bold text-xs text-zinc-700">{row.orderCode}</td>
                                    <td className="px-4 py-4 whitespace-nowrap font-bold text-zinc-900">{row.name}</td>

                                    <td className="px-4 py-4 whitespace-nowrap">
                                        {row.insta !== "-" ? <span className="text-xs text-pink-500 font-bold bg-pink-50 px-1.5 py-0.5 rounded">{row.insta}</span> : <span className="text-zinc-300">-</span>}
                                    </td>

                                    <td className="px-4 py-4 whitespace-nowrap text-center">
                                        {row.promo !== "-" ? <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full border border-indigo-100 flex items-center justify-center gap-1 w-max mx-auto"><Tag size={12} /> {row.promo}</span> : <span className="text-zinc-300">-</span>}
                                    </td>

                                    <td className="px-4 py-4 whitespace-nowrap text-center text-zinc-500 flex items-center justify-center gap-1">
                                        {row.os === 'iOS' ? <Apple size={14} className="text-zinc-800" /> : (row.os === 'Android' ? <Smartphone size={14} className="text-green-600" /> : null)}
                                        <span className="text-[11px] font-bold">{row.os}</span>
                                    </td>

                                    <td className="px-4 py-4 whitespace-nowrap font-black text-sm">
                                        {row.currency === 'USD'
                                            ? <span className="text-blue-600">${row.amount.toLocaleString()}</span>
                                            : <span className="text-zinc-900">฿{row.amount.toLocaleString()}</span>}
                                    </td>

                                    <td className="px-4 py-4 whitespace-nowrap text-center text-zinc-700 font-black">{row.qty}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-xs text-zinc-500 font-mono">{row.phone}</td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan={9} className="px-4 py-16 text-center text-zinc-400 font-bold">
                                        선택하신 기간에 해당하는 결제 완료 내역이 없습니다.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}