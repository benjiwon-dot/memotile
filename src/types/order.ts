import { Timestamp } from 'firebase/firestore';
import type { ProductType } from './product';

export interface OrderItem {
    // Local / Legacy compat
    previewUri: string;         // local path or cached uri
    printUri?: string;          // high-res local path for background upload
    src?: string;               // legacy/fallback src

    // Web compat (Firestore fields)
    previewUrl?: string;        // downloadURL (filled after upload)
    printUrl?: string;          // downloadURL (filled after upload)
    storagePath?: string;       // GCS path (e.g. orders/2026/id/items/0.jpg)
    printStoragePath?: string;  // GCS path for high-res
    index: number;
    assets?: {
        viewPath?: string;
        viewUrl?: string;
        previewPath: string;
        previewUrl: string;
        printPath: string;
        printUrl: string | null;
    };

    quantity: number;
    filterId: string;
    filterParams?: {
        matrix: number[];
        overlayColor?: string;
        overlayOpacity?: number;
    } | null;
    cropPx: {
        x: number;
        y: number;
        width: number;
        height: number;
        scale: number;
    } | null;
    unitPrice: number;
    lineTotal: number;
    size: "20x20";
}

export interface OrderDoc {
    id?: string;
    uid: string;
    productType?: ProductType; // "tile"(기본) | "photobook". 미설정 주문은 tile로 간주.
    orderCode: string; // 7-char code (e.g. ABC1234)
    itemsCount: number;
    storageBasePath?: string;
    createdAt: any; // Timestamp | Date | number | string
    updatedAt: any;
    status: "paid" | "processing" | "printed" | "shipping" | "delivered" | "failed" | "refunded";
    currency: string;
    subtotal: number;
    discount: number;
    shippingFee: number;
    total: number;
    promoCode?: string;

    customer: {
        email: string;
        fullName: string;
        phone: string;
    };

    shipping: {
        fullName: string;
        address1: string;
        address2?: string;
        city: string;
        state: string;
        postalCode: string;
        country: string;
        phone: string;
        email: string;
    };

    items?: OrderItem[]; // Optional in Header (moved to subcollection)

    // 포토북 주문 전용(productType==="photobook"일 때만). 타일 주문엔 없음.
    photobook?: {
        size: "A4" | "A3";
        cover: "soft" | "hard";
        pageCount: number;
        density?: string | null;
        title?: string | null;
        coverPhotoId?: string | null;
        coverThumbPath?: string | null;   // Storage 경로(표지 썸네일)
        originalsBasePath?: string | null; // 선택 원본들이 올라간 Storage 폴더
        layout?: any;                      // buildPages 결과(페이지별 사진·셀·크롭) 인라인 JSON
        pdfPath?: string | null;           // 서버 함수 생성 후 채움(MVP엔 null)
    };

    payment: {
        provider: string;
        transactionId?: string;
        method?: string;
        brand?: string;
        last4?: string;
        paidAt?: Timestamp | any;
    };

    promo?: {
        code: string;
        type: string;
        value: number;
    } | null;
    paymentMethod: string; // "CARD" etc
    locale: string;
}
