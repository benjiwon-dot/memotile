// app/admin/dashboard/index.tsx
import React, { useState, useEffect } from "react";
import {
    TrendingUp, Users, ShoppingBag, DollarSign,
    Calendar, AlertCircle, ArrowRight, Loader2, CreditCard, Activity,
    Smartphone, Apple, RefreshCw, XCircle, FileSpreadsheet, Download
} from "lucide-react";
import { getFirestore, collection, getDocs, query, orderBy, where } from "firebase/firestore";
import { app } from "@/lib/firebase";
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

export default function DashboardPage() {
    const [loading, setLoading] = useState(true);
    // 💡 기간 필터: 'this_month'(이번 달), 'last_month'(지난달), 'custom'(날짜 지정), 'all'(전체)
    const [timeFilter, setTimeFilter] = useState("this_month");

    // ✨ 날짜 지정 필터용 State 추가
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");

    // ✨ 엑셀 다운로드 로딩 스피너용 State
    const [downloading, setDownloading] = useState(false);

    const [stats, setStats] = useState({
        revenue: 0,
        orders: 0,
        aov: 0,
        pendingRevenue: 0,
        pendingOrders: 0,
        totalUsers: 0,
        iosUsers: 0,
        androidUsers: 0,
        repurchaseRate: 0,
        cancelRate: 0
    });

    const [chartData, setChartData] = useState([]);
    const [recentOrders, setRecentOrders] = useState<any[]>([]);

    const db = getFirestore(app);

    // ✨ [핵심 기능] 지정된 기간의 상세 내역서를 추출하여 CSV(엑셀) 파일로 다운로드하는 함수
    const handleDownloadStatement = async () => {
        setDownloading(true);
        try {
            const ordersQuery = query(collection(db, "orders"), orderBy("createdAt", "desc"));
            const ordersSnap = await getDocs(ordersQuery);

            const now = new Date();
            const currentMonth = now.getMonth();
            const currentYear = now.getFullYear();

            const rows: any[] = [];
            let totalTileCount = 0;
            let totalAmountSum = 0;

            ordersSnap.forEach((doc) => {
                const data = doc.data();
                if (!data.createdAt) return;

                const orderDate = data.createdAt.toDate();
                let isIncluded = false;

                // 대시보드와 동일한 날짜 필터링 적용
                if (timeFilter === 'all') {
                    isIncluded = true;
                } else if (timeFilter === 'this_month') {
                    isIncluded = orderDate.getMonth() === currentMonth && orderDate.getFullYear() === currentYear;
                } else if (timeFilter === 'last_month') {
                    const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
                    const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
                    isIncluded = orderDate.getMonth() === prevMonth && orderDate.getFullYear() === prevYear;
                } else if (timeFilter === 'custom' && startDate && endDate) {
                    const start = new Date(startDate + "T00:00:00");
                    const end = new Date(endDate + "T23:59:59");
                    isIncluded = orderDate >= start && orderDate <= end;
                }

                // 조건에 맞고 결제가 완료된 내역만 엑셀에 포함
                if (isIncluded && (data.status === "paid" || data.status === "completed" || data.status === "printing")) {
                    const shipping = data.shipping || {};
                    const customer = data.customer || {};

                    const name = shipping.fullName || customer.fullName || "Guest";
                    const phone = shipping.phone || customer.phone || "";
                    const fullAddress = `${shipping.address1 || ""} ${shipping.address2 || ""} ${shipping.city || ""} ${shipping.state || ""}`.trim();
                    const insta = data.instagram || customer.instagram || (data.instagramId || "");
                    const tileCount = data.itemsCount || (Array.isArray(data.items) ? data.items.length : 0) || 0;
                    const amount = data.totalAmount || data.total || 0;

                    totalTileCount += tileCount;
                    totalAmountSum += amount;

                    rows.push({
                        "주문 일시": orderDate.toLocaleString('ko-KR'),
                        "주문 번호": data.orderCode || doc.id,
                        "고객 이름": name,
                        "전화 번호": phone,
                        "인스타그램 ID": insta ? `@${insta.replace('@', '')}` : "",
                        "배송지 주소": fullAddress,
                        "타일 수량(EA)": tileCount,
                        "결제 금액": `฿${amount.toLocaleString()}`,
                        "비고": data.adminNote || ""
                    });
                }
            });

            if (rows.length === 0) {
                alert("선택하신 기간에 결제 완료된 내역이 없습니다.");
                setDownloading(false);
                return;
            }

            // CSV 데이터 변환 로직 (한글 깨짐 방지 BOM 추가)
            const headers = ["주문 일시", "주문 번호", "고객 이름", "전화 번호", "인스타그램 ID", "배송지 주소", "타일 수량(EA)", "결제 금액", "비고"];
            const escape = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;

            const csvLines = [headers.join(",")];
            rows.forEach(r => {
                csvLines.push(headers.map(h => escape(r[h])).join(","));
            });

            // ✨ 은행 명세서처럼 맨 아랫줄에 총합계 라인 추가 구현
            csvLines.push(""); // 한 줄 띄우기
            csvLines.push(`[총합계],,,,,,,`);
            csvLines.push(`총 주문 건수:,${rows.length} 건,,,,,,`);
            csvLines.push(`총 판매 타일수:,${totalTileCount} EA,,,,,,`);
            csvLines.push(`총 결제 합계액:,฿${totalAmountSum.toLocaleString()},,,,,,`);

            const csvString = "\uFEFF" + csvLines.join("\n");

            // 파일 다운로드 발사
            const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            const fileDateStr = timeFilter === 'custom' ? `${startDate}_to_${endDate}` : timeFilter;
            a.href = url;
            a.download = `MemoTile_결제내역서_${fileDateStr}.csv`;
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
                // 1. 유저 데이터 분석
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

                // 2. 주문 데이터 분석
                const ordersQuery = query(collection(db, "orders"), orderBy("createdAt", "desc"));
                const ordersSnap = await getDocs(ordersQuery);

                let tempRevenue = 0;
                let tempOrders = 0;
                let tempPendingRevenue = 0;
                let tempPendingOrders = 0;
                let tempCancelledOrders = 0;
                let totalFilteredOrders = 0;

                const dailyRevenue: Record<string, number> = {};
                const recentList: any[] = [];
                const userPurchaseCounts: Record<string, number> = {};

                const now = new Date();
                const currentMonth = now.getMonth();
                const currentYear = now.getFullYear();

                ordersSnap.forEach(doc => {
                    const data = doc.data();
                    if (!data.createdAt) return;

                    const orderDate = data.createdAt.toDate();
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
                        const start = new Date(startDate + "T00:00:00");
                        const end = new Date(endDate + "T23:59:59");
                        isIncluded = orderDate >= start && orderDate <= end;
                    }

                    if (!isIncluded) return;

                    totalFilteredOrders++;

                    if (recentList.length < 5) {
                        recentList.push({ id: doc.id, ...data });
                    }

                    const amount = data.totalAmount || data.total || 0;

                    if (data.status === "paid" || data.status === "completed" || data.status === "printing") {
                        tempRevenue += amount;
                        tempOrders++;

                        if (data.uid) {
                            userPurchaseCounts[data.uid] = (userPurchaseCounts[data.uid] || 0) + 1;
                        }

                        const dateStr = `${orderDate.getMonth() + 1}/${orderDate.getDate()}`;
                        dailyRevenue[dateStr] = (dailyRevenue[dateStr] || 0) + amount;
                    }
                    else if (data.status === "pending") {
                        tempPendingRevenue += amount;
                        tempPendingOrders++;
                    }
                    else if (data.status === "cancelled" || data.status === "refunded") {
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
                    revenue: tempRevenue,
                    orders: tempOrders,
                    aov: tempOrders > 0 ? Math.round(tempRevenue / tempOrders) : 0,
                    pendingRevenue: tempPendingRevenue,
                    pendingOrders: tempPendingOrders,
                    totalUsers,
                    iosUsers: iosCount,
                    androidUsers: androidCount,
                    repurchaseRate,
                    cancelRate
                });

                setChartData(formattedChartData as any);
                setRecentOrders(recentList);

            } catch (error) {
                console.error("대시보드 데이터 로드 실패:", error);
            } finally {
                setLoading(false);
            }
        };

        // 날짜지정 분기 예외처리
        if (timeFilter === 'custom' && (!startDate || !endDate)) return;

        fetchDashboardData();
    }, [timeFilter, startDate, endDate]);

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "paid": case "completed": case "printing":
                return <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-md">결제완료</span>;
            case "pending":
                return <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs font-bold rounded-md">결제대기</span>;
            case "cancelled": case "refunded":
                return <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-bold rounded-md">취소됨</span>;
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

                {/* 💡 기간 필터 & 엑셀 다운로드 컨트롤 영역 */}
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

                    {/* ✨ [핵심 버튼] 은행 스타일 결제 내역서 일괄 내보내기 버튼 */}
                    <button
                        onClick={handleDownloadStatement}
                        disabled={downloading}
                        className="bg-zinc-900 hover:bg-black disabled:bg-zinc-400 text-white font-bold text-sm px-4 py-3 rounded-xl flex items-center gap-2 shadow-sm transition-all"
                    >
                        {downloading ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
                        내역서 엑셀 다운로드
                    </button>
                </div>
            </div>

            {/* KPI 그리드 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="bg-gradient-to-br from-zinc-900 to-zinc-800 p-6 rounded-3xl shadow-lg border border-zinc-700 text-white relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-20"><DollarSign size={80} /></div>
                    <p className="text-sm font-semibold text-zinc-400 mb-1">총 매출액</p>
                    <p className="text-3xl font-black mb-1">฿{stats.revenue.toLocaleString()}</p>
                    <p className="text-xs text-zinc-400">결제 완료 기준 ({stats.orders}건)</p>
                </div>

                <div className="bg-white p-6 rounded-3xl shadow-sm border border-zinc-100 flex flex-col justify-center">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-3 bg-pink-50 text-pink-600 rounded-2xl"><ShoppingBag size={20} /></div>
                        <p className="text-sm font-bold text-zinc-500">객단가 (AOV)</p>
                    </div>
                    <p className="text-2xl font-black text-zinc-800 ml-1">฿{stats.aov.toLocaleString()}</p>
                    <p className="text-xs text-zinc-400 mt-1 ml-1">고객 1인당 평균 결제액</p>
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
                        결제 대기이탈: ฿{stats.pendingRevenue.toLocaleString()}
                    </p>
                </div>
            </div>

            {/* 가입자 현황 */}
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

            {/* 차트 및 최신 주문 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
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
                            recentOrders.map((order, index) => (
                                <div key={order.id || index} className="flex items-center justify-between p-3 rounded-2xl hover:bg-zinc-50 transition-colors border border-transparent hover:border-zinc-100">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-500 font-bold text-sm">
                                            {order.uid ? order.uid.substring(0, 2).toUpperCase() : 'US'}
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-zinc-800">
                                                ฿{order.totalAmount ? order.totalAmount.toLocaleString() : (order.total ? order.total.toLocaleString() : 0)}
                                            </p>
                                            <p className="text-[10px] text-zinc-400 mt-0.5">
                                                {order.createdAt ? order.createdAt.toDate().toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '방금 전'}
                                            </p>
                                        </div>
                                    </div>
                                    <div>{getStatusBadge(order.status)}</div>
                                </div>
                            ))
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
        </div>
    );
}