// src/utils/storagePaths.ts

export const formatYYYYMMDD = (d = new Date()) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}${mm}${dd}`;
};

// ✅ base: orders/{date}/{orderCode}/{name}
export const buildOrderStorageBasePath = (
    orderCode: string,
    customerName?: string,
    createdAt?: Date
) => {
    const dateKey = formatYYYYMMDD(createdAt ?? new Date());

    // 경로에 실명 그대로는 위험할 수 있어 슬러그 처리(영문/숫자/하이픈/언더스코어만)
    const raw = (customerName || "").trim();
    const safe =
        raw
            .toLowerCase()
            .replace(/\s+/g, "_")
            .replace(/[^a-z0-9\-_]/g, "")
            .slice(0, 32) || "customer";

    return `orders/${dateKey}/${orderCode}/${safe}`;
};

// ✅ print file path: orders/{date}/{orderCode}/{name}/print.jpg (or print_2.jpg...)
export const buildItemPrintPath = (basePath: string, index: number, ext = "jpg") => {
    const fileName = index === 0 ? `print.${ext}` : `print_${index + 1}.${ext}`;
    return `${basePath}/${fileName}`;
};

// ✅ preview는 지금은 printUrl 재사용하므로 굳이 분리 안 해도 됨.
// 그래도 남겨두고 싶으면 동일하게 만들어둠.
export const buildItemPreviewPath = (basePath: string, index: number, ext = "jpg") => {
    const fileName = index === 0 ? `preview.${ext}` : `preview_${index + 1}.${ext}`;
    return `${basePath}/${fileName}`;
};
