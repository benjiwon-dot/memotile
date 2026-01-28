export type FilterType = {
    name: string;
    // In RN, we can't easily do complex CSS filters like hue-rotate or separate saturation/contrast 
    // without a native module like react-native-image-filter-kit or using gl-react.
    // For standard Expo Image, we can only use 'tintColor' (for simpler effects) or just opacity/backgroundColor overlays.
    // However, for now, we will keep the structure. 
    // If we had a filter library, we would stick parameters here.
    // We will try to simulate SOME effects using standard view styles (opacity, overlay color) if possible, 
    // but mostly we might need to rely on the backend for the "real" print result 
    // and here just show a placeholder "tint" or "opacity" difference to indicate change, 
    // OR we just assume the user accepts the limitation that "filters" might not preview 100% accurately in RN without native modules.
    //
    // BUT the user asked to "Action: If exact CSS filters are not possible, implement nearest equivalent...".
    // Let's try to map some common ones to a semi-transparent overlay color?
    overlayColor?: string;
    overlayOpacity?: number;
};

export const FILTERS: FilterType[] = [
    { name: 'Original' },
    { name: 'Warm', overlayColor: '#f5deb3', overlayOpacity: 0.2 }, // Wheat
    { name: 'Cool', overlayColor: '#e0ffff', overlayOpacity: 0.2 }, // LightCyan
    { name: 'Vivid', overlayColor: 'transparent' }, // Cannot easily do saturation in vanilla RN view
    { name: 'B&W', overlayColor: '#333', overlayOpacity: 0.1 }, // Placeholder
    { name: 'Soft', overlayColor: '#fff', overlayOpacity: 0.1 },
    { name: 'Contrast', overlayColor: 'transparent' },
    { name: 'Fade', overlayColor: 'rgba(255,255,255,0.3)' },
    { name: 'Film', overlayColor: '#f0e68c', overlayOpacity: 0.15 }, // Khaki
    { name: 'Bright', overlayColor: 'rgba(255,255,255,0.1)' },
    { name: 'Mono', overlayColor: '#000', overlayOpacity: 0.3 }, // Simple darkening
    { name: 'Noir', overlayColor: '#000', overlayOpacity: 0.4 },
    { name: 'Dramatic', overlayColor: '#800000', overlayOpacity: 0.1 },
    { name: 'Sepia', overlayColor: '#704214', overlayOpacity: 0.3 },
    { name: 'Vintage', overlayColor: '#DEB887', overlayOpacity: 0.3 }, // Burlywood
    { name: 'Matte', overlayColor: 'rgba(255,255,255,0.15)' },
    { name: 'Golden', overlayColor: '#FFD700', overlayOpacity: 0.2 },
    { name: 'TealOrange', overlayColor: '#008080', overlayOpacity: 0.2 },
    { name: 'Crisp', overlayColor: 'transparent' },
    { name: 'Pastel', overlayColor: '#FFE4E1', overlayOpacity: 0.2 },
    { name: 'Clean', overlayColor: 'rgba(255,255,255,0.05)' },
    { name: 'Pink', overlayColor: '#FFC0CB', overlayOpacity: 0.2 },
    { name: 'Night', overlayColor: '#191970', overlayOpacity: 0.3 },
    { name: 'Sharpen', overlayColor: 'transparent' },
];
