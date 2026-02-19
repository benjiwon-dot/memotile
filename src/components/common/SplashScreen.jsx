import React, { useEffect, useState } from 'react';
// Assuming assets are served from root or via a loader. 
// If using Vite/Webpack with standard config, we might need to import it.
// Let's try to reference it relatively if possible, or use the public absolute path if it's in public.
// However, the assets folder is at root. 
// In many Expo Web setups, `require` for images works similar to Native.
// Let's try standard import which is safest.
import splashImage from '../../../assets/splash.png';

/**
 * Premium Splash Screen
 * - Max 2s duration
 * - Tap to skip
 * - Fade in/out only
 */
export default function SplashScreen({ onFinish }) {
    const [fade, setFade] = useState('in');

    useEffect(() => {
        // Start fade out after 2.0s (was 1.5s)
        const fadeOutTimer = setTimeout(() => {
            setFade('out');
        }, 2000);

        // Finish after 2.4s (to ensure fade out completes within 2s)
        const finishTimer = setTimeout(() => {
            onFinish();
        }, 2400);

        return () => {
            clearTimeout(fadeOutTimer);
            clearTimeout(finishTimer);
        };
    }, [onFinish]);

    return (
        <div
            onClick={onFinish} // Tap to skip
            style={{
                ...styles.container,
                opacity: fade === 'in' ? 1 : 0,
                transition: 'opacity 0.4s ease-out',
                cursor: 'pointer'
            }}
        >
            <img
                src={splashImage}
                alt="Splash Logo"
                style={styles.image}
            />
        </div>
    );
}

const styles = {
    container: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#FFFFFF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        userSelect: 'none',
    },
    image: {
        width: '100%',
        height: '100%',
        maxWidth: '100%',
        maxHeight: '100%',
        objectFit: 'contain',
        paddingLeft: '20px',
        paddingRight: '20px',
        boxSizing: 'border-box'
    }
};
