import React, { useEffect, useState } from 'react';
import {
    View,
    StyleSheet,
    Pressable,
    Alert,
    Text,
    ActivityIndicator
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePhoto } from '../../src/context/PhotoContext';
import { useLanguage } from '../../src/context/LanguageContext';
import { colors } from '../../src/theme/colors';

// Import RN Editor Components
import TopBarRN from '../../src/components/editorRN/TopBarRN';
import CropFrameRN from '../../src/components/editorRN/CropFrameRN';
import FilterStripRN from '../../src/components/editorRN/FilterStripRN';
import { FILTERS, FilterType } from '../../src/components/editorRN/filters';

// State for each photo's edits
type EditState = {
    crop: { x: number; y: number; scale: number };
    filter: FilterType;
};

export default function EditorScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { photos, currentIndex, setCurrentIndex, saveDraft } = usePhoto();
    const { t } = useLanguage();

    // Local state to track edits per photo index
    // In a real app, this should probably be in PhotoContext or a separate EditContext
    // For now, we keep it local but initialized from defaults.
    const [edits, setEdits] = useState<Record<number, EditState>>({});

    // Ensure we have a valid photo
    const currentPhoto = photos?.[currentIndex];

    useEffect(() => {
        if (!photos || photos.length === 0) {
            // Redirect if empty
            router.replace('/(tabs)');
        }
    }, [photos]);

    // Initialize edit state for current index if missing
    useEffect(() => {
        if (currentPhoto && !edits[currentIndex]) {
            setEdits(prev => ({
                ...prev,
                [currentIndex]: {
                    crop: { x: 0, y: 0, scale: 1 },
                    filter: FILTERS[0]
                }
            }));
        }
    }, [currentIndex, currentPhoto]);

    // Save draft whenever edits change
    useEffect(() => {
        saveDraft('editor');
    }, [edits, currentIndex]);

    if (!currentPhoto) return <View style={styles.loading}><ActivityIndicator /></View>;

    const currentEdit = edits[currentIndex] || { crop: { x: 0, y: 0, scale: 1 }, filter: FILTERS[0] };

    const updateCurrentEdit = (partial: Partial<EditState>) => {
        setEdits(prev => ({
            ...prev,
            [currentIndex]: { ...(prev[currentIndex] ?? currentEdit), ...partial },
        }));
    };

    const handleBack = () => {
        router.replace('/create/select');
    };

    const handleNext = () => {
        if (currentIndex < photos.length - 1) {
            setCurrentIndex(currentIndex + 1);
        } else {
            // Finish / Checkout
            // In a real app, we would process the crops here (generate images)
            // For now, save draft and go to checkout (placeholder)
            Alert.alert("Checkout", "Proceeding to checkout with " + photos.length + " items.");
            // router.push('/create/checkout');
        }
    };

    return (
        <View style={styles.container}>
            <TopBarRN
                current={currentIndex + 1}
                total={photos.length}
                onBack={handleBack}
                onNext={handleNext}
            />

            <View style={styles.editorArea}>
                <CropFrameRN
                    imageSrc={currentPhoto.uri}
                    crop={currentEdit.crop}
                    onChange={(newCrop) => updateCurrentEdit({ crop: newCrop })}
                    currentFilter={currentEdit.filter}
                />
            </View>


            <View style={[styles.bottomBar, { paddingBottom: Math.max(20, insets.bottom) }]}>
                <FilterStripRN
                    currentFilter={currentEdit.filter}
                    imageSrc={currentPhoto.uri}
                    onSelect={(f) => updateCurrentEdit({ filter: f })}
                />

                <View style={styles.primaryBtnContainer}>
                    <Pressable style={styles.primaryBtn} onPress={handleNext}>
                        <Text style={styles.primaryBtnText}>
                            {currentIndex === photos.length - 1 ? (t.saveCheckout || "Save & Checkout") : (t.nextPhoto || "Next Photo")}
                        </Text>
                    </Pressable>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.surface,
    },
    loading: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center'
    },
    editorArea: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#F7F7F8',
    },
    bottomBar: {
        backgroundColor: '#F7F7F8',
        borderTopWidth: 1,
        borderTopColor: 'rgba(0,0,0,0.05)',
    },
    primaryBtnContainer: {
        padding: 16,
        alignItems: 'center',
    },
    primaryBtn: {
        width: '100%',
        maxWidth: 340,
        height: 52,
        backgroundColor: colors.ink,
        borderRadius: 26,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowOffset: { width: 0, height: 8 },
        shadowRadius: 20,
        elevation: 6,
    },
    primaryBtnText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    }
});
