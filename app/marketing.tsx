import React, { useState } from "react";
import { Send, Loader2, Users, Star, Zap, MessageSquare } from "lucide-react";
import { getFirestore, collection, addDoc } from "firebase/firestore";
import { app } from "@/lib/firebase";

export default function MarketingPage() {
    const [loading, setLoading] = useState(false);
    const [target, setTarget] = useState("test_token");

    // ✨ 핵심 마케팅 필터
    const [filters, setFilters] = useState({
        userGroup: "all",    // all, zero_order(첫구매유도), vip(2회이상), abandoned(결제이탈)
        joinPeriod: "all",   // all, recent_7, recent_30
    });

    const [testToken, setTestToken] = useState("ExponentPushToken[1M62-BNiaxIBwyBWA0iEOe]");

    // ✨ 통합된 텍스트 상태 관리 (언어 구분 제거)
    const [pushData, setPushData] = useState({
        title: "", body: "",
    });

    const db = getFirestore(app);

    const handleSendPush = async () => {
        if (!pushData.title || !pushData.body) {
            alert("푸시 제목과 내용을 모두 입력해주세요!");
            return;
        }

        const confirmMsg = `[대상: ${filters.userGroup}] 그룹에게 푸시를 발송할까요?`;
        if (!window.confirm(confirmMsg)) return;

        setLoading(true);

        try {
            await addDoc(collection(db, "adminTasks"), {
                type: "MARKETING_PUSH",
                payload: {
                    target: target,
                    filters: filters,
                    testToken: target === "test_token" ? testToken.trim() : null,
                    // ✨ 꿀팁: 기존 백엔드 에러 방지를 위해 작성한 텍스트를 en, th 양쪽에 동일하게 복사해서 전송합니다.
                    en: { title: pushData.title, body: pushData.body },
                    th: { title: pushData.title, body: pushData.body },
                    badge: 0, // 배지 숫자 안 올라가게 0으로 고정
                    uid: "admin",
                },
                createdAt: new Date(),
                status: "pending"
            });
            alert("마케팅 지시서가 전달되었습니다! (배지 제외)");
            setPushData({ title: "", body: "" });
        } catch (error) {
            alert("에러가 발생했습니다.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-6xl mx-auto p-6 bg-white rounded-2xl shadow-sm border border-zinc-100 mt-6 mb-20">
            <h1 className="text-2xl font-black mb-6 flex items-center gap-2">
                <Zap className="text-yellow-500" fill="currentColor" />
                스마트 마케팅 센터 (Smart CRM)
            </h1>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* 왼쪽: 필터 영역 (기존과 동일) */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-zinc-50 p-6 rounded-2xl border border-zinc-200">
                        <h2 className="text-sm font-bold mb-4 flex items-center gap-2"><Users size={16} /> 1. 발송 모드</h2>
                        <select value={target} onChange={(e) => setTarget(e.target.value)} className="w-full p-3 bg-white border rounded-xl mb-3 outline-none focus:border-pink-500">
                            <option value="test_token">나에게만 테스트 (Token)</option>
                            <option value="all_users">실제 고객 발송 (Live)</option>
                            <option value="admins">관리자 전용 테스트</option>
                        </select>
                        {target === "test_token" && (
                            <input type="text" value={testToken} onChange={(e) => setTestToken(e.target.value)} className="w-full p-2 border rounded-lg text-xs" />
                        )}
                    </div>

                    <div className="bg-zinc-900 p-6 rounded-2xl text-white shadow-xl">
                        <h2 className="text-sm font-bold mb-4 flex items-center gap-2"><Star size={16} className="text-yellow-400" /> 2. 타겟 세그먼트</h2>

                        <div className="space-y-4">
                            <div>
                                <label className="text-[10px] text-zinc-400 font-bold block mb-2">고객 그룹 (Behavior)</label>
                                <select name="userGroup" value={filters.userGroup} onChange={(e) => setFilters({ ...filters, userGroup: e.target.value })} className="w-full p-3 bg-zinc-800 border border-zinc-700 rounded-xl text-sm outline-none">
                                    <option value="all">전체 고객</option>
                                    <option value="zero_order">🎁 첫 구매 유도 (주문 0회)</option>
                                    <option value="vip">💎 VIP 고객 (주문 2회 이상)</option>
                                    <option value="abandoned">🛒 결제 이탈자 (결제대기 중)</option>
                                </select>
                            </div>

                            <div>
                                <label className="text-[10px] text-zinc-400 font-bold block mb-2">가입 시기 (Recency)</label>
                                <select name="joinPeriod" value={filters.joinPeriod} onChange={(e) => setFilters({ ...filters, joinPeriod: e.target.value })} className="w-full p-3 bg-zinc-800 border border-zinc-700 rounded-xl text-sm outline-none">
                                    <option value="all">전체 기간</option>
                                    <option value="recent_7">최근 7일 이내 가입자</option>
                                    <option value="recent_30">최근 30일 이내 가입자</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 오른쪽: 통합된 메시지 작성 영역 */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-purple-50/50 p-8 rounded-2xl border border-purple-100 shadow-sm">
                        <h2 className="font-bold text-purple-800 mb-2 flex items-center gap-2 text-lg">
                            <MessageSquare size={20} />
                            메시지 작성
                        </h2>
                        <p className="text-xs text-purple-600 mb-6">입력하신 언어 그대로 모든 타겟 고객에게 푸시 알림이 발송됩니다.</p>

                        <input
                            name="title"
                            value={pushData.title}
                            onChange={(e) => setPushData({ ...pushData, title: e.target.value })}
                            placeholder="푸시 제목 (예: 깜짝 할인 쿠폰 도착! 🎉)"
                            className="w-full p-4 border border-purple-200 rounded-xl mb-4 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-200 transition-all text-sm font-semibold bg-white"
                        />
                        <textarea
                            name="body"
                            value={pushData.body}
                            onChange={(e) => setPushData({ ...pushData, body: e.target.value })}
                            placeholder="푸시 내용 (예: 지금 바로 앱에 접속해서 혜택을 확인해보세요.)"
                            rows={5}
                            className="w-full p-4 border border-purple-200 rounded-xl outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-200 transition-all resize-none text-sm bg-white"
                        />
                    </div>

                    <button onClick={handleSendPush} disabled={loading} className="w-full bg-pink-600 hover:bg-pink-700 text-white font-black py-5 rounded-2xl text-xl shadow-lg transition-all flex items-center justify-center gap-2">
                        {loading ? <Loader2 className="animate-spin" /> : <><Send size={24} /> 푸시 발송 시작</>}
                    </button>
                </div>
            </div>
        </div>
    );
}