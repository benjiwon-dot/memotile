// src/components/home/BrandHeader.jsx
import React from 'react';
// ✅ import 경로가 정확한지 확인 (상위 폴더 개수에 따라 ../ 조절 필요할 수 있음)
import logoHorizontal from '../../../assets/logo_horizontal.png';

export default function BrandHeader() {
    return (
        <header style={styles.container}>
            <div style={styles.logoWrapper}>
                <img src={logoHorizontal} alt="MEMOTILE" style={styles.logo} />
            </div>
            <p style={styles.tagline}>Premium photo tiles. Stick & restick.</p>
        </header>
    );
}

const styles = {
    container: {
        textAlign: 'center',
        padding: '48px 20px 24px 20px',
        marginTop: 'var(--safe-area-top)',
        backgroundColor: '#ffffff',
    },
    logoWrapper: {
        display: 'flex',
        justifyContent: 'center',
        marginBottom: '12px',
    },
    logo: {
        height: '48px', // 웹용 크기 최적화
        width: 'auto',
        maxWidth: '80%',
        objectFit: 'contain',
    },
    tagline: {
        fontSize: '16px',
        color: 'var(--text-secondary, #666)',
        fontWeight: '400',
        margin: 0,
        letterSpacing: '-0.3px',
    }
};