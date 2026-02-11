import React from 'react';
import { Package, ChevronRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { getOrders } from '../utils/orders';
import { useLanguage } from '../context/LanguageContext';

export default function MyOrders() {
    const navigate = useNavigate();
    const { t } = useLanguage();
    const orders = getOrders();

    return (
        <div className="page-container" style={styles.container}>
            <h1 style={styles.header}>{t.orders}</h1>

            {orders.length === 0 ? (
                <div style={styles.emptyState}>
                    <div style={styles.iconPlaceholder}>
                        <Package size={48} color="#ddd" strokeWidth={1} />
                    </div>
                    <h3 style={{ fontWeight: '600', marginBottom: '8px' }}>{t.noOrders}</h3>
                </div>
            ) : (
                <div style={styles.list}>
                    {orders.map((order) => (
                        <div
                            key={order.id}
                            style={styles.card}
                            onClick={() => navigate(`/orders/${order.id}`)}
                        >
                            <div style={styles.cardContent}>
                                <div style={styles.topRow}>
                                    <span style={styles.date}>{new Date(order.createdAt).toLocaleDateString()}</span>
                                    <span style={styles.orderId}>#{order.id}</span>
                                </div>

                                {/* Image strip */}
                                <div style={styles.imageStrip}>
                                    {order.items.slice(0, 5).map((item, idx) => (
                                        <div key={idx} style={styles.stripItem}>
                                            <img src={item.assets?.viewUrl || item.previewUrl || item.src} alt="" style={styles.stripImg} />
                                        </div>
                                    ))}
                                    {order.items.length > 5 && (
                                        <div style={styles.moreCount}>+{order.items.length - 5}</div>
                                    )}
                                </div>

                                <div style={styles.bottomRow}>
                                    <span style={styles.itemCount}>{order.items.length} {t.items}</span>
                                    <span style={styles.totalPrice}>฿{order.total.toFixed(2)}</span>
                                </div>
                            </div>
                            <ChevronRight size={20} color="#ccc" />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}


const styles = {
    container: {
        paddingTop: '60px',
    },
    header: {
        paddingLeft: '20px',
        marginBottom: '20px',
        fontSize: '32px'
    },
    emptyState: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '50vh',
        textAlign: 'center',
    },
    iconPlaceholder: {
        marginBottom: '16px',
    },
    list: {
        padding: '0 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
    },
    card: {
        backgroundColor: '#fff',
        borderRadius: '20px',
        padding: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 4px 15px rgba(0,0,0,0.05)',
        cursor: 'pointer',
    },
    cardContent: {
        flex: 1,
    },
    topRow: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px',
    },
    date: {
        fontSize: '13px',
        color: '#8E8E93',
        fontWeight: '500',
    },
    orderId: {
        fontSize: '13px',
        color: '#111',
        fontWeight: '600',
        fontFamily: 'monospace',
    },
    imageStrip: {
        display: 'flex',
        gap: '6px',
        marginBottom: '16px',
    },
    stripItem: {
        width: '44px',
        height: '44px',
        borderRadius: '6px',
        overflow: 'hidden',
        border: '1px solid #f0f0f0',
    },
    stripImg: {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
    },
    moreCount: {
        width: '44px',
        height: '44px',
        borderRadius: '6px',
        backgroundColor: '#f9f9f9',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '12px',
        color: '#666',
        fontWeight: '600',
    },
    bottomRow: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    itemCount: {
        fontSize: '14px',
        color: '#666',
    },
    totalPrice: {
        fontSize: '16px',
        fontWeight: '700',
        color: '#111',
    }
};
