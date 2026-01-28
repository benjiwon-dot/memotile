# Rebuild Instructions for Native Editor

Since we are using `react-native-reanimated` and `react-native-gesture-handler`, and we've just updated `babel.config.js` and `package.json`, it is CRITICAL to rebuild the native directories to prevent "Worklet mismatch" or crashes.

## 1. Clean Native Directories
Remove existing builds to force a clean slate.

```bash
rm -rf ios android .expo node_modules
```

## 2. Install Dependencies
Ensure you install the exact versions compatible with your Expo SDK (54).

```bash
npm install
npx expo install react-native-reanimated react-native-gesture-handler
```

## 3. Prebuild Native Projects (Clean)
This generates the `ios` and `android` folders with the correct native code linkage.

```bash
npx expo prebuild --clean
```

## 4. Run on Simulator / Emulator
Do NOT use Expo Go for this if possible, as standard Expo Go might not match custom native runtime exactly if you have made deep changes, though usually it is fine for these libraries. However, `prebuild` implies you are moving towards a Development Build (Dev Client).

**iOS:**
```bash
npx expo run:ios
```

**Android:**
```bash
npx expo run:android
```

## 5. Verify
- Open the app.
- Go to "Start with your photo".
- Select a photo.
- In Editor, try:
  - Dragging the photo (Pan).
  - Pinching to zoom (Pinch).
  - Changing filters.

If it crashes immediately upon entering Editor, check the metro logs for "ReanimatedMismatch" errors, which usually means the rebuild didn't take clean effect.
