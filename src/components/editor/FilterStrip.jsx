import React, { useRef, useEffect } from "react";
import { FILTERS } from "./filters";

export default function FilterStrip({ currentFilter, imageSrc, onSelect }) {
    const scrollRef = useRef(null);
    useEffect(() => { }, []);

    return (
        <div style={styles.scrollContainer} ref={scrollRef}>
            {FILTERS.map((f) => {
                const isActive = currentFilter.name === f.name;
                return (
                    <button
                        key={f.name}
                        type="button"
                        style={{
                            ...styles.item,
                            ...(isActive ? styles.itemActive : {}),
                        }}
                        onClick={() => onSelect(f)}
                    >
                        <div
                            style={{
                                ...styles.previewBox,
                                ...(isActive ? styles.activeBox : {}),
                            }}
                        >
                            <img src={imageSrc} alt={f.name} style={{ ...styles.thumb, ...f.style }} />
                        </div>

                        <span style={{ ...styles.label, ...(isActive ? styles.activeLabel : {}) }}>
                            {f.name}
                        </span>
                    </button>
                );
            })}
            <div style={{ minWidth: "1px" }} />
        </div>
    );
}

const styles = {
    scrollContainer: {
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start", // ✅ 상단 정렬로 떠보임 감소
        overflowX: "auto",
        gap: "6px", // ✅ item 간격을 margin이 아니라 gap으로 통제
        padding: "6px 16px", // ✅ 세로 padding 축소 (더 타이트)
        backgroundColor: "#F7F7F8",
        scrollbarWidth: "none",
        WebkitOverflowScrolling: "touch",

        // ✅ 흰 공간/높이 과다 제거
        minHeight: "78px",
    },

    // ✅ div 대신 button: 탭 영역은 유지하면서 간격 제어 쉬움
    item: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        cursor: "pointer",
        flexShrink: 0,
        width: "64px",

        // ✅ margin 제거 (gap으로만 간격 제어)
        marginRight: 0,

        // ✅ 탭 영역 확보 (44px rule)
        padding: "4px 2px",
        background: "transparent",
        border: "none",
    },

    itemActive: {
        // optional: active item이 살짝 더 또렷하게 (레이아웃 변화 없음)
    },

    previewBox: {
        width: "60px",
        height: "60px",
        marginBottom: "2px", // ✅ 라벨과의 간격 축소
        borderRadius: "10px", // ✅ 살짝 라운드가 더 고급 (원하면 0 유지 가능)
        overflow: "hidden",
        border: "1px solid rgba(0,0,0,0.10)",
        transition: "transform 0.15s ease, box-shadow 0.15s ease, border 0.15s ease",
        boxSizing: "border-box",
        backgroundColor: "#fff", // ✅ 이미지 로딩 순간 깔끔
    },

    activeBox: {
        border: "2px solid rgba(17,17,17,0.78)",
        boxShadow: "0 6px 16px rgba(0,0,0,0.10)",
        transform: "translateY(-1px)", // ✅ 스케일보다 고급스럽게 “살짝 떠오름”
    },

    thumb: {
        width: "100%",
        height: "100%",
        objectFit: "cover",
        display: "block",
    },

    label: {
        fontSize: "11px", // ✅ 줄여서 더 정돈
        color: "#9CA3AF",
        fontWeight: "500",
        textAlign: "center",
        whiteSpace: "nowrap",
        lineHeight: 1.1, // ✅ 불필요한 줄 간격 제거
        margin: 0, // ✅ 혹시 모를 기본 마진 방지
    },

    activeLabel: {
        color: "#111",
        fontWeight: "600",
    },
};
