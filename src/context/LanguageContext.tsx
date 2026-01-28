import React, { createContext, useContext, useState, ReactNode } from 'react';
import { STRINGS } from '../utils/translations'; // Existing translations file

type Locale = 'TH' | 'EN';

interface LanguageContextType {
    locale: Locale;
    setLocale: (lang: Locale) => void;
    t: typeof STRINGS['EN']; // Type inference from EN strings
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
    const [locale, setLocale] = useState<Locale>('TH');

    const value = {
        locale,
        setLocale,
        t: STRINGS[locale], // Returns the strings for current locale
    };

    return (
        <LanguageContext.Provider value={value}>
            {children}
        </LanguageContext.Provider>
    );
};

export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
};
