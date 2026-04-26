// src/components/admin/AdminOrderList.tsx
import React from "react";

/**
 * ❗ Native-only placeholder
 *
 * Admin dashboard is WEB-ONLY.
 * If this component ever renders in native,
 * it means routing/architecture is wrong.
 */
export default function AdminOrderList() {
    if (__DEV__) {
        console.warn(
            "[AdminOrderList] This component is native-only placeholder. " +
            "Admin dashboard must use AdminOrderList.web.tsx"
        );
    }

    return null;
}
