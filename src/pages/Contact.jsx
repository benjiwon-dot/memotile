import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Mail, MessageCircle, Copy, Check } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const EMAIL_SUPPORT = 'official@memotile.com';

export default function Contact() {
    const navigate = useNavigate();
    const { t } = useLanguage();
    const [copied, setCopied] = useState(false);

    const copyToClipboard = () => {
        navigator.clipboard.writeText(EMAIL_SUPPORT);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleLineClick = () => {
        alert(t.comingSoon);
    };

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <button onClick={() => navigate(-1)} style={styles.backBtn}>
                    <ChevronLeft size={24} color="#111" />
                </button>
                <div style={styles.title}>{t.chatTitle}</div>
                <div style={{ width: 24 }}></div>
            </div>

            <div style={styles.content}>
                <div style={styles.sectionHeader}>{t.customerSupport}</div>
                <p style={styles.introText}>{t.contactIntro}</p>

                <div style={styles.card}>
                    <div style={styles.cardHeader}>
                        <Mail size={20} color="var(--primary)" />
                        <span style={styles.cardTitle}>{t.emailSupport}</span>
                    </div>
                    <div style={styles.emailContainer}>
                        <a href={`mailto:${EMAIL_SUPPORT}`} style={styles.emailText}>
                            {EMAIL_SUPPORT}
                        </a>
                        <button onClick={copyToClipboard} style={styles.copyBtn}>
                            {copied ? <Check size={18} color="var(--success)" /> : <Copy size={18} color="#8E8E93" />}
                        </button>
                    </div>
                    <p style={styles.cardHint}>{t.expectedResponse}</p>
                </div>

                <div style={styles.card}>
                    <div style={styles.cardHeader}>
                        <MessageCircle size={20} color="#06C755" />
                        <span style={styles.cardTitle}>{t.lineSupport}</span>
                    </div>
                    <button onClick={handleLineClick} style={styles.lineBtn}>
                        {t.chatWithUs} on LINE
                    </button>
                    <p style={styles.cardHint}>{t.quickAssistance}</p>
                </div>

                <div style={styles.footer}>
                    <p style={styles.footerText}>{t.supportHours}</p>
                </div>
            </div>
        </div>
    );
}

const styles = {
    container: {
        backgroundColor: '#F2F2F7',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
    },
    header: {
        height: '52px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        backgroundColor: '#fff',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        borderBottom: '1px solid #E5E5EA',
    },
    backBtn: {
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
    },
    title: {
        fontSize: '17px',
        fontWeight: '600',
        color: '#111',
    },
    content: {
        padding: '24px 20px',
        paddingBottom: '100px',
        flex: 1,
        overflowY: 'auto',
    },
    sectionHeader: {
        fontSize: '22px',
        fontWeight: '700',
        color: '#111',
        marginBottom: '12px',
    },
    introText: {
        fontSize: '15px',
        lineHeight: '1.5',
        color: '#666',
        marginBottom: '24px',
    },
    card: {
        backgroundColor: '#fff',
        borderRadius: '16px',
        padding: '20px',
        marginBottom: '20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    },
    cardHeader: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '16px',
    },
    cardTitle: {
        fontSize: '17px',
        fontWeight: '600',
        color: '#111',
    },
    emailContainer: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#F8F8FA',
        padding: '12px 14px',
        borderRadius: '10px',
        border: '1px solid #E5E5EA',
        marginBottom: '8px',
    },
    emailText: {
        fontSize: '16px',
        color: '#111',
        textDecoration: 'none',
        fontWeight: '500',
    },
    copyBtn: {
        padding: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    },
    lineBtn: {
        width: '100%',
        height: '48px',
        backgroundColor: '#06C755',
        color: '#fff',
        borderRadius: '10px',
        fontSize: '16px',
        fontWeight: '600',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '8px',
    },
    cardHint: {
        fontSize: '13px',
        color: '#8E8E93',
    },
    footer: {
        marginTop: '12px',
        textAlign: 'center',
    },
    footerText: {
        fontSize: '13px',
        color: '#8E8E93',
    }
};
