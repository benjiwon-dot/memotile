import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, X, CreditCard, Smartphone } from 'lucide-react';
import TilesCarousel from '../components/checkout/TilesCarousel';
import ShippingDetailsCard from '../components/checkout/ShippingDetailsCard';
import { readEditorCartMeta, addOrder, clearEditorCartMeta } from '../utils/orders';
import { useLanguage } from '../context/LanguageContext';

export default function Checkout() {
    const navigate = useNavigate();
    const { t } = useLanguage();
    const [items, setItems] = useState([]);
    const [previewTile, setPreviewTile] = useState(null);
    const [paymentMethod, setPaymentMethod] = useState('card');

    // Shipping form state
    const [formData, setFormData] = useState({
        fullName: '',
        phone: '',
        email: '',
        instagram: '',
        address1: '',
        address2: '',
        city: '',
        state: '',
        postalCode: '',
        country: 'Thailand'
    });
    const [errors, setErrors] = useState({});

    useEffect(() => {
        const cart = readEditorCartMeta();
        setItems(cart);
    }, []);

    const TILE_PRICE = 200;
    const total = items.length * TILE_PRICE;

    const handleFormChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (errors[field]) {
            setErrors(prev => {
                const updated = { ...prev };
                delete updated[field];
                return updated;
            });
        }
    };

    const validate = () => {
        const newErrors = {};
        const required = ['fullName', 'phone', 'email', 'address1', 'city', 'state', 'postalCode'];
        required.forEach(field => {
            if (!formData[field]) newErrors[field] = t.required;
        });
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handlePlaceOrder = () => {
        if (items.length === 0) {
            alert(t.cartEmpty);
            return;
        }

        if (!validate()) {
            alert(t.fillRequired);
            return;
        }

        const order = {
            id: `ORD-${Date.now()}`,
            createdAt: Date.now(),
            items: items.map(x => ({
                id: x.id,
                previewUrl: x.previewUrl || x.sourceUrl || x.src || "",
                src: x.sourceUrl || x.src,
                qty: x.qty ?? 1
            })).filter(item => item.previewUrl !== ""),
            shipping: formData,
            paymentMethod: paymentMethod.toUpperCase() === 'CARD' ? 'CARD' :
                paymentMethod.toUpperCase() === 'APPLE' ? 'APPLE_PAY' : 'GOOGLE_PAY',
            total: total
        };

        addOrder(order);
        clearEditorCartMeta();
        navigate(`/order-success?id=${order.id}`);
    };

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <button onClick={() => navigate(-1)} style={styles.backBtn}>
                    <ChevronLeft size={24} color="#111" />
                    <span style={styles.backText}>{t.edit}</span>
                </button>
                <div style={styles.title}>{t.checkoutTitle}</div>
                <div style={{ width: 60 }}></div>
            </div>

            <div style={styles.content}>
                <div style={{ marginTop: '20px' }}>
                    <TilesCarousel
                        items={items}
                        onSelect={(idx) => setPreviewTile(items[idx])}
                    />
                </div>

                <div style={styles.summaryCard}>
                    <div style={styles.summaryRow}>
                        <span style={{ fontWeight: 500 }}>{items.length} {t.tilesSize}</span>
                        <span>฿{total.toFixed(2)}</span>
                    </div>
                    <div style={{ ...styles.summaryRow, color: '#10B981' }}>
                        <span style={{ fontWeight: 500 }}>{t.shipping}</span>
                        <span>{t.free}</span>
                    </div>
                    <div style={styles.divider} />
                    <div style={styles.totalRow}>
                        <span>{t.totalLabel}</span>
                        <span>฿{total.toFixed(2)}</span>
                    </div>
                </div>

                <ShippingDetailsCard formData={formData} onChange={handleFormChange} errors={errors} />

                <div style={styles.paymentSection}>
                    <h3 style={styles.sectionTitle}>{t.payment}</h3>
                    <div style={styles.paymentMethods}>
                        <div
                            style={paymentMethod === 'card' ? { ...styles.payOption, ...styles.payOptionSelected } : styles.payOption}
                            onClick={() => setPaymentMethod('card')}
                        >
                            <div style={{ ...styles.radioCircle, ...(paymentMethod === 'card' ? styles.radioActive : {}) }} />
                            <CreditCard size={20} color="#333" style={{ marginRight: 10 }} />
                            <span style={styles.payText}>{t.creditDebitCard}</span>
                        </div>

                        {paymentMethod === 'card' && (
                            <div style={{ padding: '12px 0 0 0' }}>
                                <input type="text" placeholder={t.cardNumber} style={styles.input} />
                                <div style={styles.cardRow}>
                                    <input type="text" placeholder={t.expiryDate} style={styles.input} />
                                    <input type="text" placeholder={t.cvc} style={styles.input} />
                                </div>
                            </div>
                        )}

                        <div
                            style={paymentMethod === 'apple' ? { ...styles.payOption, ...styles.payOptionSelected } : styles.payOption}
                            onClick={() => setPaymentMethod('apple')}
                        >
                            <div style={{ ...styles.radioCircle, ...(paymentMethod === 'apple' ? styles.radioActive : {}) }} />
                            <Smartphone size={20} color="#333" style={{ marginRight: 10 }} />
                            <span style={styles.payText}>{t.applePay}</span>
                        </div>

                        <div
                            style={paymentMethod === 'google' ? { ...styles.payOption, ...styles.payOptionSelected } : styles.payOption}
                            onClick={() => setPaymentMethod('google')}
                        >
                            <div style={{ ...styles.radioCircle, ...(paymentMethod === 'google' ? styles.radioActive : {}) }} />
                            <span style={styles.payText}>{t.googlePay}</span>
                        </div>
                    </div>
                </div>

                <div style={styles.bottomAction}>
                    <button style={styles.placeOrderBtn} onClick={handlePlaceOrder}>
                        {t.placeOrder} · ฿{total.toFixed(2)}
                    </button>
                </div>
            </div>

            {previewTile && (
                <div style={styles.modalOverlay} onClick={() => setPreviewTile(null)}>
                    <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
                        <button onClick={() => setPreviewTile(null)} style={styles.closeBtn}>
                            <X size={32} color="#fff" />
                        </button>
                        <img
                            src={previewTile.previewUrl}
                            alt="Full Preview"
                            style={styles.fullImage}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}


const styles = {
    container: {
        backgroundColor: '#fff',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
    },
    header: {
        height: '52px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        padding: '0 16px',
        marginTop: 'var(--safe-area-top)',
        backgroundColor: '#fff',
    },
    backBtn: {
        position: 'absolute',
        left: '16px',
        border: 'none',
        background: 'none',
        display: 'flex',
        alignItems: 'center',
        padding: '8px 0',
        cursor: 'pointer',
    },
    backText: {
        fontSize: '16px',
        color: '#111',
        fontWeight: '500',
        marginLeft: '4px',
    },
    title: {
        fontSize: '17px',
        fontWeight: '600',
        color: '#111',
    },
    content: {
        flex: 1,
        paddingBottom: '120px', // Space at end
    },
    // Order Summary Card
    summaryCard: {
        margin: '20px 20px 30px 20px',
        padding: '24px',
        backgroundColor: '#fff',
        borderRadius: '20px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
        border: '1px solid rgba(0,0,0,0.03)',
    },
    summaryRow: {
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '15px',
        color: '#333',
        marginBottom: '10px',
    },
    divider: {
        height: '1px',
        backgroundColor: '#f0f0f0',
        margin: '16px 0',
    },
    totalRow: {
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '18px',
        fontWeight: '700',
        color: '#111',
    },
    // Payment Section
    paymentSection: {
        padding: '0 20px',
        marginBottom: '20px',
    },
    sectionTitle: {
        fontSize: '18px',
        fontWeight: '700',
        color: '#111',
        marginBottom: '20px',
        letterSpacing: '-0.3px',
    },
    paymentMethods: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
    },
    payOption: {
        display: 'flex',
        alignItems: 'center',
        padding: '16px',
        borderRadius: '16px', // Softer
        border: '1px solid #E5E7EB',
        cursor: 'pointer',
        backgroundColor: '#fff',
        transition: 'all 0.2s',
    },
    payOptionSelected: {
        borderColor: '#111',
        backgroundColor: '#FAFAFA',
    },
    radioCircle: {
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        border: '1.5px solid #ccc',
        marginRight: '12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    },
    radioActive: {
        borderColor: '#111',
        borderWidth: '5px', // Creates the "dot" effect
    },
    payText: {
        fontWeight: '500',
        fontSize: '15px',
        color: '#111',
        flex: 1,
    },
    // Bottom Action Area
    bottomAction: {
        padding: '20px 20px 40px 20px',
        display: 'flex',
        justifyContent: 'center',
    },
    placeOrderBtn: {
        backgroundColor: '#111',
        color: '#fff',
        height: '56px',
        width: '100%',
        borderRadius: '28px',
        fontSize: '17px',
        fontWeight: '600',
        border: 'none',
        cursor: 'pointer',
        boxShadow: '0 4px 15px rgba(0,0,0,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    },
    // Card inputs helpers
    input: {
        width: '100%',
        height: '48px',
        padding: '0 16px',
        borderRadius: '12px',
        border: '1px solid #E5E7EB',
        fontSize: '16px',
        backgroundColor: '#fff',
        outline: 'none',
        marginBottom: '8px',
    },
    cardRow: {
        display: 'flex',
        gap: '12px',
    },
    // Modal
    modalOverlay: {
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.9)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fadeIn 0.2s ease-out',
    },
    modalContent: {
        position: 'relative',
        maxWidth: '90%',
        maxHeight: '90%',
    },
    closeBtn: {
        position: 'absolute',
        top: '-50px',
        right: '0',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
    },
    fullImage: {
        width: 'min(92vw, 520px)',
        height: 'min(80vh, 520px)',
        objectFit: 'contain', // ✅ 원본 확인용이면 contain이 맞음
        display: 'block',
        backgroundColor: '#000', // 혹시 JPG 주변톤 대비
        boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
    },

};
