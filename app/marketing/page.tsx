"use client";

import React, { useState } from "react";
import { Send, AlertTriangle, CheckCircle2, Loader2, Users, Smartphone } from "lucide-react";
import { getFirestore, collection, addDoc } from "firebase/firestore";
import { app } from "@/lib/firebase";

export default function MarketingPage() {
    const [loading, setLoading] = useState(false);
    const [target, setTarget] = useState("all");
    const [testToken, setTestToken] = useState("ExponentPushToken[1M62-BNiaxIBwyBWA0iEOe]"); // ✨ 대표님 토큰을 기본값으로 셋팅
    const [pushData, setPushData] = useState({
        enTitle: "",
        enBody: "",
        thTitle: "",
        thBody: "",
    });

    const db = getFirestore(app);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setPushData({ ...pushData, [e.target.name]: e.target.value });
    };

    const handleSendPush = async () => {
        if (!pushData.enTitle || !pushData.enBody) {
            alert("영문 메인 메시지는 필수입니다!");
            return;
        }

        if (target === "test_token" && !testToken.trim()) {
            alert("테스트할 기기의 Push Token을 입력해주세요!");
            return;
        }

        const confirmMsg = `정말 [${target === 'all' ? '전체 고객' : (target === 'test_token' ? '특정 기기' : '관리자')}]에게 마케팅 푸시를 발송하시겠습니까?\n발송 후에는 취소할 수 없습니다.`;
        if (!window.confirm(confirmMsg)) return;

        setLoading(true);

        try {
            // ✨ 지시서에 testToken 데이터도 같이 넘겨줍니다.
            await addDoc(collection(db, "adminTasks"), {
                type: "MARKETING_PUSH",
                payload: {
                    target: target,
                    testToken: target === "test_token" ? testToken.trim() : null,
                    en: { title: pushData.enTitle, body: pushData.enBody },
                    th: { title: pushData.thTitle, body: pushData.thBody },
                    uid: "admin",
                },
                createdAt: new Date(),
                status: "pending"
            });

            alert("성공적으로 마케팅 알림 발송 지시를 내렸습니다!");

            setPushData({ enTitle: "", enBody: "", thTitle: "", thBody: "" });
            setTarget("all");

        } catch (error) {
            console.error("Marketing Push Error:", error);
            alert("발송 지시 중 에러가 발생했습니다.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto p-6 bg-white rounded-2xl shadow-sm border border-zinc-100 mt-6">
            <h1 className="text-2xl font-black mb-2 flex items-center gap-2">
                <Send className="text-pink-600" />
                마케팅 푸시 발송 (Marketing Push)
            </h1>
            <p className="text-zinc-500 text-sm mb-8">
                고객들에게 이벤트, 할인 등의 프로모션 알림을 발송합니다. 영문/태국어 다국어를 지원합니다.
            </p>

            <div className="flex flex-col gap-8">
                {/* 1. 타겟 설정 */}
                <div className="bg-zinc-50 p-5 rounded-xl border border-zinc-200">
                    <h2 className="text-sm font-bold text-zinc-800 mb-3 flex items-center gap-2">
                        <Users size={16} /> 1. 타겟 선택
                    </h2>
                    <select
                        value={target}
                        onChange={(e) => setTarget(e.target.value)}
                        className="w-full md:w-1/2 p-3 border border-zinc-300 rounded-lg outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 mb-3"
                    >
                        <option value="test_token">특정 기기로 테스트 (Token 직접 입력)</option>
                        <option value="test_admin">관리자 그룹에게 테스트 (DB 기준)</option>
                        <option value="all">전체 고객 (All Users)</option>
                    </select>

                    {/* ✨ 특정 기기 테스트 선택 시에만 나타나는 토큰 입력창 */}
                    {target === "test_token" && (
                        <div className="mt-2 flex items-center gap-2">
                            <Smartphone className="text-zinc-400" size={20} />
                            <input
                                type="text"
                                value={testToken}
                                onChange={(e) => setTestToken(e.target.value)}
                                placeholder="ExponentPushToken[...]"
                                className="flex-1 p-2 border border-zinc-300 rounded-lg text-sm outline-none focus:border-pink-500"
                            />
                        </div>
                    )}
                </div>

                {/* 2. 메시지 입력 (영어) */}
                <div>
                    <h2 className="text-sm font-bold text-blue-600 mb-3 flex items-center gap-2">
                        🇺🇸 English Message (Default)
                    </h2>
                    <div className="flex flex-col gap-3">
                        <input
                            type="text"
                            name="enTitle"
                            placeholder="Push Title (e.g., 🚀 50% Flash Sale!)"
                            value={pushData.enTitle}
                            onChange={handleChange}
                            className="w-full p-3 border border-zinc-300 rounded-lg outline-none focus:border-blue-500"
                        />
                        <textarea
                            name="enBody"
                            rows={3}
                            placeholder="Push Message Body"
                            value={pushData.enBody}
                            onChange={handleChange}
                            className="w-full p-3 border border-zinc-300 rounded-lg outline-none focus:border-blue-500 resize-none"
                        />
                    </div>
                </div>

                {/* 3. 메시지 입력 (태국어) */}
                <div>
                    <h2 className="text-sm font-bold text-orange-600 mb-3 flex items-center gap-2">
                        🇹🇭 Thai Message (Optional)
                    </h2>
                    <div className="flex flex-col gap-3">
                        <input
                            type="text"
                            name="thTitle"
                            placeholder="Push Title (e.g., 🚀 ลดกระหน่ำ 50%!)"
                            value={pushData.thTitle}
                            onChange={handleChange}
                            className="w-full p-3 border border-zinc-300 rounded-lg outline-none focus:border-orange-500"
                        />
                        <textarea
                            name="thBody"
                            rows={3}
                            placeholder="Push Message Body"
                            value={pushData.thBody}
                            onChange={handleChange}
                            className="w-full p-3 border border-zinc-300 rounded-lg outline-none focus:border-orange-500 resize-none"
                        />
                        <p className="text-xs text-zinc-400">
                            * 태국어 칸을 비워두면 태국인 고객에게도 영어(Default) 메시지가 발송됩니다.
                        </p>
                    </div>
                </div>

                {/* 주의사항 및 전송 버튼 */}
                <div className="mt-4 flex flex-col md:flex-row gap-4 justify-between items-center bg-rose-50 p-4 rounded-xl border border-rose-100">
                    <div className="flex items-center gap-2 text-rose-700 text-sm font-medium">
                        <AlertTriangle size={18} />
                        발송 전 오타가 없는지 반드시 확인하세요!
                    </div>

                    <button
                        onClick={handleSendPush}
                        disabled={loading}
                        className="w-full md:w-auto bg-pink-600 text-white font-black px-8 py-3 rounded-xl hover:bg-pink-700 transition shadow-md flex justify-center items-center gap-2"
                    >
                        {loading ? <Loader2 size={18} className="animate-spin" /> : <><CheckCircle2 size={18} /> Send Push</>}
                    </button>
                </div>
            </div>
        </div>
    );
}