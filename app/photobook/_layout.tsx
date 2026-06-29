// app/photobook/_layout.tsx
//
// AI 포토북 흐름의 격리된 Stack. Phase 1은 index(placeholder)만.
// 향후 register / scan / timeline 등이 이 폴더 아래로 추가된다.
import { Stack } from "expo-router";

export default function PhotobookLayout() {
    return <Stack screenOptions={{ headerShown: false }} />;
}
