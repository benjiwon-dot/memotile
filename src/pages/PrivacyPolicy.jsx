import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export default function PrivacyPolicy() {
    const navigate = useNavigate();

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <button onClick={() => navigate(-1)} style={styles.backBtn}>
                    <ChevronLeft size={24} color="#111" />
                </button>
                <div style={styles.title}>Privacy Policy</div>
                <div style={{ width: 24 }}></div> {/* Spacer for centering title */}
            </div>

            <div style={styles.content}>
                <h1 style={styles.pageTitle}>Privacy Policy</h1>

                <section style={styles.section}>
                    <h2 style={styles.sectionHeading}>1. Personal Information Collected</h2>
                    <ul style={styles.list}>
                        <li>Contact information (Name, Email address)</li>
                        <li>Shipping information (Address, Phone number)</li>
                        <li>Payment-related information (Processed by third-party providers)</li>
                        <li>Usage data and device information</li>
                        <li>Uploaded images and edit data</li>
                    </ul>
                </section>

                <section style={styles.section}>
                    <h2 style={styles.sectionHeading}>2. Purpose of Collection and Use</h2>
                    <ul style={styles.list}>
                        <li>Order fulfillment and delivery</li>
                        <li>Payment processing and identity verification</li>
                        <li>Customer support and responding to inquiries</li>
                        <li>Service improvement and development of new features</li>
                        <li>Compliance with legal obligations under applicable laws</li>
                    </ul>
                </section>

                <section style={styles.section}>
                    <h2 style={styles.sectionHeading}>3. Data Retention</h2>
                    <p style={styles.paragraph}>
                        MEMOTILE retains personal data only as long as necessary to fulfill the purposes of collection or as required by applicable laws.
                    </p>
                </section>

                <section style={styles.section}>
                    <h2 style={styles.sectionHeading}>4. Third-Party Sharing</h2>
                    <p style={styles.paragraph}>
                        MEMOTILE does not sell or share personal data with third parties except in the following cases:
                    </p>
                    <ul style={styles.list}>
                        <li>Sharing information with logistics providers for delivery</li>
                        <li>Sharing information with payment processors for transactions</li>
                        <li>When required by law or for investigative purposes</li>
                    </ul>
                </section>

                <section style={styles.section}>
                    <h2 style={styles.sectionHeading}>5. Data Processing Outsourcing</h2>
                    <p style={styles.paragraph}>
                        To ensure reliable service, we outsource data processing to professional providers such as cloud infrastructure, payment systems, and logistics partners.
                    </p>
                </section>

                <section style={styles.section}>
                    <h2 style={styles.sectionHeading}>6. User Rights</h2>
                    <p style={styles.paragraph}>
                        Users may access, correct, delete, or request the restriction of their personal data at any time.
                    </p>
                </section>

                <section style={styles.section}>
                    <h2 style={styles.sectionHeading}>7. Data Security Measures</h2>
                    <p style={styles.paragraph}>
                        MEMOTILE implements technical and organizational safeguards to protect your information and maintain high security standards.
                    </p>
                </section>

                <section style={styles.section}>
                    <h2 style={styles.sectionHeading}>8. Children and Teen Users</h2>
                    <p style={styles.paragraph}>
                        The service is accessible without age restriction. However, responsibility for payments lies with the authorized payer.
                    </p>
                </section>

                <section style={styles.section}>
                    <h2 style={styles.sectionHeading}>9. Cookies and Tracking Technologies</h2>
                    <p style={styles.paragraph}>
                        We use cookies for functionality and analytics. Users can manage cookie preferences through their browser settings.
                    </p>
                </section>

                <section style={styles.section}>
                    <h2 style={styles.sectionHeading}>10. Policy Updates</h2>
                    <p style={styles.paragraph}>
                        This policy may be updated from time to time, and changes become effective immediately upon being posted on the website.
                    </p>
                </section>

                <section style={styles.section}>
                    <h2 style={styles.sectionHeading}>11. Contact Information</h2>
                    <p style={styles.paragraph}>
                        For any privacy-related inquiries, please contact our support team at <a href="mailto:official@memotile.com" style={styles.link}>official@memotile.com</a>.
                    </p>
                </section>
            </div>
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
        paddingBottom: '100px', // Extra padding for tab bar
        flex: 1,
        overflowY: 'auto',
    },
    pageTitle: {
        fontSize: '24px',
        fontWeight: '700',
        marginBottom: '24px',
        color: '#111',
    },
    section: {
        marginBottom: '28px',
    },
    sectionHeading: {
        fontSize: '18px',
        fontWeight: '600',
        marginBottom: '12px',
        color: '#111',
    },
    paragraph: {
        fontSize: '15px',
        lineHeight: '1.6',
        color: '#333',
        marginBottom: '8px',
    },
    list: {
        paddingLeft: '20px',
        fontSize: '15px',
        lineHeight: '1.6',
        color: '#333',
    },
    link: {
        color: 'var(--primary)',
        textDecoration: 'none',
        fontWeight: '500',
    }
};
