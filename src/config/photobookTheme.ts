// src/config/photobookTheme.ts
//
// AI 포토북(bebememo 스타일) 디자인 토큰. /photobook/* 화면 + 홈 AI 섹션에만 사용.
// 기존 src/theme/colors.ts(타일·체크아웃·admin)는 건드리지 않음.
// 라이트/다크는 RN 내장 useColorScheme()로 전환(의존성 0).
// 그라데이션은 react-native-svg(이미 설치됨)로 구현 → 새 네이티브 리빌드 불필요.
import { useColorScheme, TextStyle } from "react-native";

export interface PhotobookTheme {
    isDark: boolean;
    bg: string;
    surface: string;
    surfaceAlt: string;
    ink: string;
    textSecondary: string;
    textMuted: string;
    border: string;
    coral: string;
    pink: string;
    peach: string;
    mint: string;
    gradient: [string, string]; // 피치→핑크 (시작점 살짝 핑크 반영)
    onGradient: string;         // 그라데이션 위 텍스트
    pillText: string;           // 흰 pill 위 텍스트(코랄)
    shadow: string;
}

const light: PhotobookTheme = {
    isDark: false,
    bg: "#FFF8F4",
    surface: "#FFFFFF",
    surfaceAlt: "#FFF0E8",
    ink: "#3D2B26",
    textSecondary: "#8C7B73",
    textMuted: "#B8A79E",
    border: "#F2E5DC",
    coral: "#FF7E66",
    pink: "#FF6F91",
    peach: "#FFB59E",
    mint: "#7FD8B0",
    gradient: ["#FF8C7C", "#FF6F91"],
    onGradient: "#FFFFFF",
    pillText: "#E04A6E",
    shadow: "rgba(61,43,38,0.10)",
};

const dark: PhotobookTheme = {
    isDark: true,
    bg: "#1E1611",        // 웜브라운 미세조정
    surface: "#2A211C",
    surfaceAlt: "#342820",
    ink: "#FBEDE6",
    textSecondary: "#CBB8AE",
    textMuted: "#93817A",
    border: "#3F332C",
    coral: "#FF8A73",
    pink: "#FF7E9D",
    peach: "#FFB59E",
    mint: "#7FD8B0",
    gradient: ["#FF8C7C", "#FF6F91"],
    onGradient: "#FFFFFF",
    pillText: "#E04A6E",
    shadow: "rgba(0,0,0,0.45)",
};

export function usePhotobookTheme(): PhotobookTheme {
    return useColorScheme() === "dark" ? dark : light;
}

export const pbRadius = { xs: 8, sm: 12, md: 16, lg: 20, xl: 28, pill: 999 } as const;

export const pbSpace = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40 } as const;

export const pbType: Record<
    "display" | "title" | "heading" | "subhead" | "body" | "caption" | "label",
    TextStyle
> = {
    display: { fontSize: 30, fontWeight: "700" },
    title: { fontSize: 24, fontWeight: "700" },
    heading: { fontSize: 18, fontWeight: "600" },
    subhead: { fontSize: 16, fontWeight: "600" },
    body: { fontSize: 15, fontWeight: "500" },
    caption: { fontSize: 13, fontWeight: "500" },
    label: { fontSize: 12, fontWeight: "700" },
};
