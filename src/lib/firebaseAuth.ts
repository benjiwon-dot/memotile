// src/lib/firebaseAuth.ts
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "./firebase";

export async function resetPassword(email: string) {
    const e = (email ?? "").trim();
    if (!e) throw new Error("EMPTY_EMAIL");
    return sendPasswordResetEmail(auth, e);
}
