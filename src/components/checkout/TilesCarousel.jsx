import React from 'react';


export default function TilesCarousel({ items, onSelect }) {
    return (
        <div style={styles.carouselContainer}>
            {items.map((item, idx) => (
                <div key={idx} style={styles.snapItem}>
                    <div style={styles.card} onClick={() => onSelect(idx)}>
                        <img
                            src={item.previewUrl || item.sourceUrl || item.src}
                            alt=""
                            style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",   // ✅ 흰여백 제거 핵심
                                display: "block",     // ✅ 아래 틈 제거
                                backgroundColor: "#fff",
                            }}
                        />

                    </div>
                </div>
            ))}

            {/* Spacer to allow scrolling last item effectively */}
            <div style={{ minWidth: '20px' }}></div>
        </div>
    );
}

const styles = {
    carouselContainer: {
        display: 'flex',
        overflowX: 'auto',
        gap: '8px',
        padding: '0 20px 20px 20px', // Inset padding
        scrollSnapType: 'x mandatory',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
    },
    snapItem: {
        scrollSnapAlign: 'start',
        flexShrink: 0,
    },
    card: {
        width: '140px',
        height: '140px',
        borderRadius: '0', // Square
        overflow: 'hidden',
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)', // Subtle shadow
        cursor: 'pointer',
        backgroundColor: '#fff',
        border: '1px solid rgba(0,0,0,0.05)',
    },
    img: {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
    }
};
