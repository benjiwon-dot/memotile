import React from "react";

export default function StatusBadge({ status }: { status?: string | null }) {
    const s = String(status || "unknown").toLowerCase().trim();

    let bg = "bg-zinc-100";
    let text = "text-zinc-600";
    let border = "border-transparent";
    let extraClass = "";

    switch (s) {
        case "paid":
            bg = "bg-blue-100"; text = "text-blue-700"; border = "border-blue-200";
            break;
        case "processing":
            bg = "bg-purple-100"; text = "text-purple-700"; border = "border-purple-200";
            break;
        case "printed":
            bg = "bg-fuchsia-100"; text = "text-fuchsia-700"; border = "border-fuchsia-200";
            break;
        case "shipping":
            bg = "bg-indigo-100"; text = "text-indigo-700"; border = "border-indigo-200";
            break;
        case "delivered":
            bg = "bg-emerald-100"; text = "text-emerald-700"; border = "border-emerald-200";
            break;
        case "hold":
            // ✨ HOLD 상태일 때 눈에 띄는 주황색 + 약간의 애니메이션 효과 추가
            bg = "bg-orange-500"; text = "text-white"; border = "border-orange-600";
            extraClass = "animate-pulse shadow-md shadow-orange-200";
            break;
        case "canceled":
        case "refunded":
            bg = "bg-rose-100"; text = "text-rose-700"; border = "border-rose-200";
            break;
        case "archived":
            bg = "bg-amber-100"; text = "text-amber-700"; border = "border-amber-200";
            break;
        default:
            break;
    }

    return (
        <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full text-[10px] font-black tracking-wider uppercase border ${bg} ${text} ${extraClass}`}>
            {s}
        </span>
    );
}