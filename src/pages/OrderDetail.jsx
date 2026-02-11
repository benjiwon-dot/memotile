import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, X } from 'lucide-react';
import { getOrderById } from '../utils/orders';
import { useLanguage } from '../context/LanguageContext';

export default function OrderDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { t } = useLanguage();
    const [previewImage, setPreviewImage] = useState(null);
    const order = getOrderById(id);

    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape') setPreviewImage(null);
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, []);

    if (!order) {
        return (
            <div style={styles.container}>
                <div style={styles.header}>
                    <button onClick={() => navigate(-1)} style={styles.backBtn}>
                        <ChevronLeft size={24} color="#111" />
                    </button>
                    <div style={styles.title}>{t.orderNotFound}</div>
                </div>
                <div style={{ padding: 20 }}>{t.orderNotFoundDesc}</div>
            </div>
        );
    }

    const getStatusInfo = (status) => {
        const statuses = {
            paid: { label: t.statusPaid, color: '#4CAF50', bg: '#E8F5E9' },
            processing: { label: t.statusProcessing, color: '#FF9800', bg: '#FFF3E0' },
            printed: { label: t.statusPrinted, color: '#2196F3', bg: '#E3F2FD' },
            shipping: { label: t.statusShipping, color: '#9C27B0', bg: '#F3E5F5' },
            delivered: { label: t.statusDelivered, color: '#607D8B', bg: '#ECEFF1' },
        };
        return statuses[status] || statuses.processing;
    };

    const statusInfo = getStatusInfo(order.status);

    const renderPayment = () => {
        if (order.payment && order.payment.brand && order.payment.last4) {
            return `${order.payment.brand.charAt(0).toUpperCase() + order.payment.brand.slice(1).toLowerCase()} •••• ${order.payment.last4}`;
        }
        return order.paymentMethod === 'CARD' ? t.cardGeneric : order.paymentMethod;
    };

    return (
        <div style={{ ...styles.container, overflow: previewImage ? 'hidden' : 'auto' }}>
            <div style={styles.header}>
                <button onClick={() => navigate(-1)} style={styles.backBtn}>
                    <ChevronLeft size={24} color="#111" />
                </button>
                <div style={styles.title}>{t.orderDetailTitle}</div>
            </div>

            <div style={styles.content}>
                <div style={styles.section}>
                    <div style={styles.orderSummary}>
                        <div style={styles.summaryRowTop}>
                            <div style={styles.orderMeta}>
                                <div style={styles.orderMetaLabel}>{t.ordersId}</div>
                                <div style={styles.orderMetaValue}>#{order.id}</div>
                            </div>

                            <div
                                style={{
                                    ...styles.statusBadge,
                                    color: statusInfo.color,
                                    backgroundColor: statusInfo.bg,
                                }}
                            >
                                {statusInfo.label}
                            </div>
                        </div>

                        <div style={styles.summaryRowBottom}>
                            <div style={styles.orderDate}>
                                {new Date(order.createdAt).toLocaleDateString()}
                            </div>

                            <div style={styles.orderTotal}>
                                ฿{order.total.toFixed(2)}
                            </div>
                        </div>
                    </div>
                </div>

                <div style={styles.section}>
                    <h3 style={styles.sectionTitle}>{t.itemsTitle}</h3>
                    <div style={styles.itemGrid}>
                        {order.items.map((item, idx) => (
                            <button
                                key={idx}
                                style={styles.itemCard}
                                onClick={() => setPreviewImage(item.assets?.viewUrl || item.previewUrl || item.src)}
                            >
                                <img src={item.assets?.viewUrl || item.previewUrl || item.src} alt="" style={styles.itemImg} />
                            </button>
                        ))}
                    </div>
                </div>

                <div style={styles.section}>
                    <h3 style={styles.sectionTitle}>{t.shippingAddressTitle}</h3>
                    <div style={styles.shippingCard}>
                        <div style={styles.addressRow}>
                            <span style={styles.addressLabel}>{t.fullName}</span>
                            <span style={styles.addressValue}>{order.shipping.fullName}</span>
                        </div>
                        <div style={styles.addressRow}>
                            <span style={styles.addressLabel}>{t.addressLabel}</span>
                            <span style={styles.addressValue}>{order.shipping.address1}</span>
                        </div>
                        {order.shipping.address2 && (
                            <div style={styles.addressRow}>
                                <span style={styles.addressLabel}>{t.address2Label}</span>
                                <span style={styles.addressValue}>{order.shipping.address2}</span>
                            </div>
                        )}
                        <div style={styles.addressRow}>
                            <span style={styles.addressLabel}>{t.city} / {t.state}</span>
                            <span style={styles.addressValue}>{order.shipping.city}, {order.shipping.state}</span>
                        </div>
                        <div style={styles.addressRow}>
                            <span style={styles.addressLabel}>{t.postalCode}</span>
                            <span style={styles.addressValue}>{order.shipping.postalCode}</span>
                        </div>
                        <div style={styles.addressRow}>
                            <span style={styles.addressLabel}>{t.country}</span>
                            <span style={styles.addressValue}>{order.shipping.country}</span>
                        </div>
                        <div style={styles.addressRow}>
                            <span style={styles.addressLabel}>{t.phoneLabel}</span>
                            <span style={styles.addressValue}>{order.shipping.phone}</span>
                        </div>
                        <div style={styles.addressRow}>
                            <span style={styles.addressLabel}>{t.emailLabel}</span>
                            <span style={styles.addressValue}>{order.shipping.email}</span>
                        </div>
                    </div>
                </div>

                <div style={styles.section}>
                    <h3 style={styles.sectionTitle}>{t.paymentTitle}</h3>
                    <div style={styles.paymentCard}>
                        {renderPayment()}
                    </div>
                </div>
            </div>

            {/* Preview Modal */}
            {previewImage && (
                <div style={styles.modalOverlay} onClick={() => setPreviewImage(null)}>
                    <button style={styles.closeBtn} onClick={() => setPreviewImage(null)}>
                        <X size={28} color="#fff" />
                    </button>
                    <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
                        <img src={previewImage} alt="Preview" style={styles.previewImg} />
                    </div>
                </div>
            )}
        </div>
    );
}


const styles = {
    container: {
        backgroundColor: '#F7F7F8',
        minHeight: '100vh',
    },
    header: {
        height: '52px',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        backgroundColor: '#fff',
        position: 'sticky',
        top: 0,
        zIndex: 10,
    },
    backBtn: {
        background: 'none',
        border: 'none',
        padding: 0,
        marginRight: 16,
        cursor: 'pointer',
    },
    title: {
        fontSize: '17px',
        fontWeight: '600',
    },
    content: {
        padding: '20px',
        paddingBottom: '100px',
    },
    section: {
        marginBottom: '24px',
    },
    sectionTitle: {
        fontSize: '15px',
        fontWeight: '700',
        marginBottom: '12px',
        color: '#111',
    },
    orderSummary: {
        backgroundColor: '#fff',
        padding: '20px',
        borderRadius: '16px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
    },
    summaryRowTop: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    summaryRowBottom: {
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
    },
    orderMeta: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
    },
    orderMetaLabel: {
        fontSize: '11px',
        textTransform: 'uppercase',
        color: '#8E8E93',
        fontWeight: '700',
        letterSpacing: '0.06em',
    },
    orderMetaValue: {
        fontSize: '13px',
        fontFamily: 'monospace',
        color: '#111',
        fontWeight: '700',
    },
    statusBadge: {
        padding: '6px 12px',
        borderRadius: '20px',
        fontSize: '12px',
        fontWeight: '800',
    },
    orderDate: {
        fontSize: '13px',
        color: '#8E8E93',
        fontWeight: '600',
    },
    orderTotal: {
        fontSize: '20px',
        fontWeight: '800',
        color: '#111',
        letterSpacing: '-0.01em',
    },
    itemGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '12px',
    },
    itemCard: {
        backgroundColor: '#fff',
        padding: 0,
        border: 'none',
        overflow: 'hidden',
        boxShadow: '0 4px 10px rgba(0,0,0,0.02)',
        cursor: 'pointer',
        transition: 'opacity 0.2s',
        borderRadius: '8px',
    },
    itemImg: {
        width: '100%',
        aspectRatio: '1',
        objectFit: 'cover',
        display: 'block',
    },
    shippingCard: {
        backgroundColor: '#fff',
        padding: '16px',
        borderRadius: '16px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
    },
    addressRow: {
        display: 'flex',
        flexDirection: 'column',
        marginBottom: '12px',
    },
    addressLabel: {
        fontSize: '11px',
        fontWeight: '600',
        color: '#8E8E93',
        textTransform: 'uppercase',
        marginBottom: '2px',
    },
    addressValue: {
        fontSize: '14px',
        color: '#111',
        fontWeight: '500',
        lineHeight: '1.4',
    },
    paymentCard: {
        backgroundColor: '#fff',
        padding: '16px',
        borderRadius: '16px',
        fontSize: '15px',
        fontWeight: '700',
        color: '#111',
        boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
    },
    modalOverlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.9)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fadeIn 0.2s ease-out',
    },
    modalContent: {
        width: '90%',
        maxWidth: '500px',
        aspectRatio: '1',
        backgroundColor: '#000',
    },
    previewImg: {
        width: '100%',
        height: '100%',
        objectFit: 'contain',
    },
    closeBtn: {
        position: 'absolute',
        top: '20px',
        right: '20px',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        zIndex: 1001,
    }
};

// Add keyframes for fadeIn directly in style
const styleTag = document.createElement("style");
styleTag.innerHTML = `
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
`;
document.head.appendChild(styleTag);
