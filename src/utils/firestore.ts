import { FieldValue, Timestamp, GeoPoint } from "firebase/firestore";

/**
 * recursively removes keys with `undefined` values.
 * - Deep clones the object.
 * - Removes undefined keys from objects.
 * - Filters undefined items from arrays.
 * - Preserves null (valid JSON/Firestore value).
 * - Preserves Firestore special types (Timestamp, GeoPoint, FieldValue).
 */
export function stripUndefined<T>(obj: T): T {
    const strippedPaths: string[] = [];

    const result = stripLogic(obj, "", strippedPaths);

    if (__DEV__ && strippedPaths.length > 0) {
        console.warn(`[stripUndefined] Stripped ${strippedPaths.length} undefined keys:`, strippedPaths.slice(0, 5));
    }

    return result as T;
}

function stripLogic(obj: any, path: string, strippedPaths: string[]): any {
    if (obj === undefined) {
        if (path) strippedPaths.push(path);
        return undefined;
    }
    if (obj === null) return null;

    // Preserve Primitives
    if (typeof obj !== "object") return obj;

    // Preserve Firestore special types
    // Note: serverTimestamp() returns a Sentinel object which is harder to detect strictly without internals,
    // but usually checking constructor === Object is a good proxy for "plain object to sanitize" vs "class instance to keep".
    // Also explicitly check for known types if possible.
    if (obj instanceof Date) return new Date(obj);
    if (obj instanceof Timestamp) return obj;
    if (obj instanceof GeoPoint) return obj;
    if (obj instanceof FieldValue) return obj;

    // Handle Arrays
    if (Array.isArray(obj)) {
        return obj.reduce((acc, item, index) => {
            const stripped = stripLogic(item, `${path}[${index}]`, strippedPaths);
            if (stripped !== undefined) {
                acc.push(stripped);
            }
            return acc;
        }, [] as any[]);
    }

    // Handle Plain Objects
    // Using prototype check to be safe about custom classes vs plain objects
    const proto = Object.getPrototypeOf(obj);
    if (!proto || proto === Object.prototype) {
        const newObj: any = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const newPath = path ? `${path}.${key}` : key;
                const value = stripLogic(obj[key], newPath, strippedPaths);
                if (value !== undefined) {
                    newObj[key] = value;
                }
            }
        }
        return newObj;
    }

    // Fallback: Return complex objects as-is (assuming they are special types we shouldn't touch)
    return obj;
}
