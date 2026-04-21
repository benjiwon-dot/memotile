"use client";

import React, { useState } from "react";
import { Send, AlertTriangle, CheckCircle2, Loader2, Users, Smartphone, Globe, Calendar, UserCheck } from "lucide-react";
import { getFirestore, collection, addDoc } from "firebase/firestore";
import { app } from "@/lib/firebase";

export default function MarketingPage() {
    const [loading, setLoading] = useState(false);
    const [target, setTarget] = useState("all"); // test_token, test_admin, all
    const [filters, setFilters] = useState({
        language: "all", // all, en, th
        gender: "all",   // all, male, female
        joinDate: "all", // all, recent_7 (최근 7일), recent_30 (최근 30일)
    });
    const [testToken, setTestToken] = useState("ExponentPushToken[1M62-BNiaxIBwyBWA0iEOe]");
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

    const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setFilters({ ...filters, [e.target.name]: e.target.value });
    };

    const handleSendPush = async () => {
        // 유효성 검사: 선택한 언어 타겟에 메시지가 있는지 확인
        const isEnRequired = filters.language === "all" || filters.language === "en";
        const isThRequired = filters.language === "th";

        if (isEnRequired && (!pushData.enTitle || !pushData.enBody)) {
            alert("영문 메시지 타겟팅에 제목과 본문이 필요합니다.");
            return;
        }
        if (isThRequired && (!pushData.thTitle || !pushData.thBody)) {
            alert("태국어 메시지 타겟팅에 제목과 본문이 필요합니다.");
            return;
        }

        if (target === "test_token" && !testToken.trim()) {
            alert("테스트할 기기의 Push Token을 입력해주세요!");
            return;
        }

        const confirmMsg = `정말 [${target === 'all' ? '필터링된 전체 고객' : (target === 'test_token' ? '특정 기기' : '관리자')}]에게 마케팅 푸시를 발송하시겠습니까?`;
        if (!window.confirm(confirmMsg)) return;

        setLoading(true);

        try {
            await addDoc(collection(db, "adminTasks"), {
                type: "MARKETING_PUSH",
                payload: {
                    target: target,
                    filters: filters, // ✨ 언어, 성별, 가입시기 필터 데이터 포함
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

        } catch (error) {
            console.error("Marketing Push Error:", error);
            alert("발송 지시 중 에러가 발생했습니다.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-5xl mx-auto p-6 bg-white rounded-2xl shadow-sm border border-zinc-100 mt-6 mb-10">
            <h1 className="text-2xl font-black mb-2 flex items-center gap-2">
                <Send className="text-pink-600" />
                마케팅 푸시 발송 (Targeted Marketing)
            </h1>
            <p className="text-zinc-500 text-sm mb-8">
                특정 세그먼트의 고객들을 분류하여 맞춤형 알림을 발송합니다.
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* 왼쪽: 필터 및 설정 영역 */}
                <div className="lg:col-span-1 flex flex-col gap-6">
                    {/* 1. 기본 타겟 */}
                    <div className="bg-zinc-50 p-5 rounded-xl border border-zinc-200">
                        <h2 className="text-sm font-bold text-zinc-800 mb-3 flex items-center gap-2">
                            <Users size={16} /> 기본 그룹
                        </h2>
                        <select
                            value={target}
                            onChange={(e) => setTarget(e.target.value)}
                            className="w-full p-3 border border-zinc-300 rounded-lg outline-none focus:border-pink-500 mb-3"
                        >
                            <option value="test_token">특정 기기 테스트</option>
                            <option value="test_admin">관리자 그룹 (Admin Only)</option>
                            <option value="all">실제 유저 발송 (Users)</option>
                        </select>

                        {target === "test_token" && (
                            <div className="flex items-center gap-2">
                                <Smartphone className="text-zinc-400" size={18} />
                                <input
                                    type="text"
                                    value={testToken}
                                    onChange={(e) => setTestToken(e.target.value)}
                                    placeholder="Push Token 입력"
                                    className="flex-1 p-2 border border-zinc-300 rounded-lg text-xs outline-none focus:border-pink-500"
                                />
                            </div>
                        )}
                    </div>

                    {/* 2. 세부 필터 (분류) */}
                    <div className="bg-zinc-50 p-5 rounded-xl border border-zinc-200 flex flex-col gap-4">
                        <h2 className="text-sm font-bold text-zinc-800 mb-1 flex items-center gap-2">
                            <UserCheck size={16} /> 상세 분류 (Segmentation)
                        </h2>

                        <div>
                            <label className="text-[10px] uppercase text-zinc-400 font-bold mb-1 block">Language</label>
                            <select name="language" value={filters.language} onChange={handleFilterChange} className="w-full p-2 border border-zinc-300 rounded-lg text-sm">
                                <option value="all">모든 언어</option>
                                <option value="en">영어 사용자</option>
                                <option value="th">태국어 사용자</option>
                            </select>
                        </div>

                        <div>
                            <label className="text-[10px] uppercase text-zinc-400 font-bold mb-1 block">Gender</label>
                            <select name="gender" value={filters.gender} onChange={handleFilterChange} className="w-full p-2 border border-zinc-300 rounded-lg text-sm">
                                <option value="all">성별 무관</option>
                                <option value="male">남성 고객</option>
                                <option value="female">여성 고객</option>
                            </select>
                        </div>

                        <div>
                            <label className="text-[10px] uppercase text-zinc-400 font-bold mb-1 block">Join Period</label>
                            <select name="joinDate" value={filters.joinDate} onChange={handleFilterChange} className="w-full p-2 border border-zinc-300 rounded-lg text-sm">
                                <option value="all">가입시기 전체</option>
                                <option value="recent_7">최근 7일 이내 가입</option>
                                <option value="recent_30">최근 30일 이내 가입</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* 오른쪽: 메시지 작성 영역 */}
                <div className="lg:col-span-2 flex flex-col gap-6">
                    {/* 영문 메시지 */}
                    <div className={`p-5 rounded-xl border ${filters.language === 'th' ? 'bg-zinc-100 opacity-50' : 'bg-blue-50/30 border-blue-100'}`}>
                        <h2 className="text-sm font-bold text-blue-600 mb-4 flex items-center gap-2">
                            <Globe size={16} /> 🇺🇸 English Message
                        </h2>
                        <div className="flex flex-col gap-3">
                            <input
                                type="text"
                                name="enTitle"
                                placeholder="Push Title"
                                value={pushData.enTitle}
                                onChange={handleChange}
                                disabled={filters.language === 'th'}
                                className="w-full p-3 border border-zinc-300 rounded-lg outline-none focus:border-blue-500"
                            />
                            <textarea
                                name="enBody"
                                rows={3}
                                placeholder="Push Message Body"
                                value={pushData.enBody}
                                onChange={handleChange}
                                disabled={filters.language === 'th'}
                                className="w-full p-3 border border-zinc-300 rounded-lg outline-none focus:border-blue-500 resize-none"
                            />
                        </div>
                    </div>

                    {/* 태국어 메시지 */}
                    <div className={`p-5 rounded-xl border ${filters.language === 'en' ? 'bg-zinc-100 opacity-50' : 'bg-orange-50/30 border-orange-100'}`}>
                        <h2 className="text-sm font-bold text-orange-600 mb-4 flex items-center gap-2">
                            <Globe size={16} /> 🇹🇭 Thai Message
                        </h2>
                        <div className="flex flex-col gap-3">
                            <input
                                type="text"
                                name="thTitle"
                                placeholder="หัวข้อพ시 (Title)"
                                value={pushData.thTitle}
                                onChange={handleChange}
                                disabled={filters.language === 'en'}
                                className="w-full p-3 border border-zinc-300 rounded-lg outline-none focus:border-orange-500"
                            />
                            <textarea
                                name="thBody"
                                rows={3}
                                placeholder="ข้อความ (Body)"
                                value={pushData.thBody}
                                onChange={handleChange}
                                disabled={filters.language === 'en'}
                                className="w-full p-3 border border-zinc-300 rounded-lg outline-none focus:border-orange-500 resize-none"
                            />
                        </div>
                    </div>

                    <div className="mt-4 flex flex-col md:flex-row gap-4 justify-between items-center bg-zinc-900 p-6 rounded-2xl shadow-xl">
                        <div className="flex items-center gap-3 text-white/70 text-sm">
                            <AlertTriangle className="text-yellow-400" size={20} />
                            <div>
                                <p className="font-bold text-white">발송 전 필터 확인</p>
                                <p className="text-xs">선택된 조건의 고객에게만 푸시가 발송됩니다.</p>
                            </div>
                        </div>

                        <button
                            onClick={handleSendPush}
                            disabled={loading}
                            className="w-full md:w-auto bg-pink-600 text-white font-black px-12 py-4 rounded-xl hover:bg-pink-700 transition flex justify-center items-center gap-2 text-lg"
                        >
                            {loading ? <Loader2 size={24} className="animate-spin" /> : <><CheckCircle2 size={24} /> Send Now</>}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}