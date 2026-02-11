import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Auth
import { initializeAuth, getAuth } from "firebase/auth";
// @ts-ignore
import { getReactNativePersistence } from "firebase/auth";

// Functions
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// --- App Singleton ---
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Logs
console.log("[Firebase Config] projectId:", app.options.projectId);
console.log("[Firebase Config] authDomain:", app.options.authDomain);

// --- Core SDKs ---
export const db = getFirestore(app);
export const storage = getStorage(app);

// --- Auth Singleton (🔥 CRITICAL FIX) ---
let _auth: ReturnType<typeof getAuth> | null = null;

export const auth = (() => {
    if (_auth) return _auth;

    if (Platform.OS === "web") {
        _auth = getAuth(app);
    } else {
        try {
            _auth = initializeAuth(app, {
                persistence: getReactNativePersistence(AsyncStorage),
            });
        } catch (e: any) {
            // 이미 초기화된 경우 (Fast Refresh / HMR / double import)
            if (e?.code === "auth/already-initialized") {
                _auth = getAuth(app);
            } else {
                throw e;
            }
        }
    }

    return _auth;
})();

// --- Functions (region MUST match deployed functions) ---
const FUNCTIONS_REGION = "us-central1"; // 🔁 change to "us-central1" if needed
export const functions = getFunctions(app, FUNCTIONS_REGION);

if (__DEV__) {
    console.log("[Firebase] Configured with bucket:", firebaseConfig.storageBucket);
    console.log("[Firebase] Functions region:", FUNCTIONS_REGION);
}

/**
 * GOOGLE OAUTH DEV UNBLOCK CHECKLIST:
 * 1. [ ] Create OAuth 2.0 Client IDs in Google Cloud Console:
 *    - iOS: com.benjiwon.memotileappanti
 *    - Web: (for dev)
 * 2. [ ] Update app.json:
 *    - ios.bundleIdentifier: "com.benjiwon.memotileappanti"
 *    - extra.googleIosClientId: (the new ID)
 *    - extra.googleWebClientId: (the new ID)
 * 3. [ ] Firebase Console -> Build -> Authentication -> Settings -> Google
 *    - Add your iOS Bundle ID.
 *    - Add Web Client ID to the "Web SDK configuration" if not present.
 * 4. [ ] Ensure your email is added to the OAuth Consent Screen "Test Users".
 */
