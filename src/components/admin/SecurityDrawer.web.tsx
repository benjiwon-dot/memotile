"use client";

import React, { useState } from "react";
import { X, Key, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import {
    reauthenticateWithCredential,
    updatePassword,
    EmailAuthProvider,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

interface SecurityDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    email?: string;
}

export default function SecurityDrawer({ isOpen, onClose, email }: SecurityDrawerProps) {
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [passLoading, setPassLoading] = useState(false);
    const [passStatus, setPassStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);

    const handleUpdatePassword = async (e: React.FormEvent) => {
        e.preventDefault();

        if (newPassword !== confirmPassword) {
            setPassStatus({ type: "error", msg: "Passwords do not match." });
            return;
        }
        if (newPassword.length < 6) {
            setPassStatus({ type: "error", msg: "Password must be at least 6 characters." });
            return;
        }

        setPassLoading(true);
        setPassStatus(null);

        try {
            const user = auth.currentUser;
            if (!user || !user.email) throw new Error("No authenticated user.");

            // 1) Reauthenticate
            const credential = EmailAuthProvider.credential(user.email, currentPassword);
            await reauthenticateWithCredential(user, credential);

            // 2) Update
            await updatePassword(user, newPassword);

            setPassStatus({ type: "success", msg: "Password updated successfully." });
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
        } catch (err: any) {
            console.error("Password change error", err);
            let msg = "Failed to update password.";
            if (err.code === "auth/wrong-password") msg = "Current password is incorrect.";
            if (err.code === "auth/requires-recent-login") msg = "Session expired. Please relogin to try again.";
            setPassStatus({ type: "error", msg });
        } finally {
            setPassLoading(false);
        }
    };

    return (
        <>
            {/* Backdrop */}
            <div
                className={`fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity z-40 ${isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                    }`}
                onClick={onClose}
            />

            {/* Drawer */}
            <div
                className={`fixed right-0 top-0 bottom-0 w-full max-w-sm bg-white shadow-2xl z-50 transition-transform duration-300 transform ${isOpen ? "translate-x-0" : "translate-x-full"
                    }`}
            >
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50">
                        <div className="flex items-center gap-3">
                            <Key size={20} className="text-zinc-400" />
                            <h2 className="text-lg font-black text-zinc-900">Security Settings</h2>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-zinc-200 rounded-full transition-colors">
                            <X size={20} className="text-zinc-500" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-8">
                        <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-100">
                            <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">
                                Account Context
                            </h4>
                            <p className="text-sm font-bold text-zinc-700">{email || "Unknown User"}</p>
                        </div>

                        <div className="space-y-6">
                            <div>
                                <h3 className="font-bold text-zinc-900 mb-1">Change Password</h3>
                                <p className="text-xs text-zinc-500">Ensure your new password is strong and unique.</p>
                            </div>

                            {passStatus && (
                                <div
                                    className={`${passStatus.type === "success"
                                        ? "bg-emerald-50 text-emerald-600 border-emerald-100"
                                        : "bg-rose-50 text-rose-600 border-rose-100"
                                        } p-4 rounded-xl border text-sm flex items-start gap-3`}
                                >
                                    {passStatus.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                                    <p className="font-bold leading-tight">{passStatus.msg}</p>
                                </div>
                            )}

                            <form onSubmit={handleUpdatePassword} className="space-y-4">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">
                                        Current Password
                                    </label>
                                    <input
                                        type="password"
                                        className="admin-input-small text-sm w-full py-3"
                                        placeholder="Required for verification"
                                        value={currentPassword}
                                        onChange={(e) => setCurrentPassword(e.target.value)}
                                        required
                                    />
                                </div>

                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">
                                        New Password
                                    </label>
                                    <input
                                        type="password"
                                        className="admin-input-small text-sm w-full py-3"
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        required
                                    />
                                </div>

                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">
                                        Confirm New Password
                                    </label>
                                    <input
                                        type="password"
                                        className="admin-input-small text-sm w-full py-3"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        required
                                    />
                                </div>

                                <button
                                    type="submit"
                                    disabled={passLoading}
                                    className="w-full bg-zinc-900 text-white font-black py-4 rounded-xl hover:bg-zinc-800 transition-all flex items-center justify-center gap-3 disabled:opacity-50 mt-4 shadow-lg shadow-zinc-200"
                                >
                                    {passLoading ? (
                                        <div className="animate-spin">
                                            <Loader2 size={16} color="white" />
                                        </div>
                                    ) : null}
                                    Update Password
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
