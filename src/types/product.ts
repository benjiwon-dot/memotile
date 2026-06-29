// src/types/product.ts
//
// 주문 제품 종류. Phase 1은 전부 "tile". AI 선별/포토북 흐름이 붙으면 "photobook"을 사용.
export type ProductType = "tile" | "photobook";

export const DEFAULT_PRODUCT_TYPE: ProductType = "tile";
