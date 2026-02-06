export type OrderStatus = "paid" | "processing" | "printed" | "shipping" | "delivered" | "failed" | "refunded";

export interface Pricing {
    subtotal: number;
    shippingFee: number;
    discount: number;
    total: number;
}

export interface Customer {
    fullName: string;
    email: string;
    phone: string;
}

export interface Shipping {
    fullName: string;
    address1: string;
    address2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    phone: string;
    email: string;
}

export interface PaymentInfo {
    provider: string;
    transactionId?: string;
    method?: string;
    paidAt?: string; // ISO String
}

export interface OrderHeader {
    id: string;
    orderCode: string;
    status: OrderStatus;
    createdAt: string; // ISO String
    updatedAt: string; // ISO String
    uid: string;
    currency: string;
    pricing: Pricing;
    customer: Customer;
    shipping: Shipping;
    payment: PaymentInfo;
    itemsCount: number;
    storageBasePath?: string;
    locale: string;
    // Part 2 Ops Fields
    adminNote?: string;
    trackingNumber?: string;
    refundedAt?: string;
    canceledAt?: string;
}

export interface OrderItemAdmin {
    index: number;
    size: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    filterId: string;
    crop?: any; // Normalized or cropPx legacy
    assets: {
        previewPath?: string;
        previewUrl?: string;
        printPath?: string;
        printUrl?: string;
    };
}

export interface OrderDetail extends OrderHeader {
    items: OrderItemAdmin[];
}

export interface ListOrdersParams {
    q?: string;
    status?: string;
    country?: string;
    limit?: number;
    cursor?: any;
    from?: string; // YYYY-MM-DD
    to?: string;   // YYYY-MM-DD
    sort?: "asc" | "desc";
    mode?: "queue" | "default";
}

export interface ListOrdersResponse {
    rows: OrderHeader[];
    nextCursor?: string;
}
