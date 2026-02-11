"use client";

import React, { useState } from "react";
import { useRouter } from "expo-router";
import {
    signInWithEmailAndPassword,
    signOut,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import AdminOrderList from "@/components/admin/AdminOrderList.web";
import SecurityDrawer from "@/components/admin/SecurityDrawer.web";
import { useRequireAdmin } from "@/lib/admin/useRequireAdmin";
import {
    Shield,
    LogOut,
    Eye,
    EyeOff,
    AlertCircle,
    Loader2,
    Lock,
} from "lucide-react";

export default function AdminDashboardPage() {
    const gate = useRequireAdmin();
    const router = useRouter();

    const [loginEmail, setLoginEmail] = useState("ben.jiwon@kangkook.com");
    const [loginPassword, setLoginPassword] = useState("");
    const [loginLoading, setLoginLoading] = useState(false);
    const [loginError, setLoginError] = useState<string | null>(null);
    const [showPass, setShowPass] = useState(false);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoginLoading(true);
        setLoginError(null);
        try {
            await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
        } catch (err: any) {
            setLoginError(err.message || "Login failed.");
        } finally {
            setLoginLoading(false);
        }
    };

    const handleSignOut = async () => {
        await signOut(auth);
        router.replace("/");
    };

    if (gate.status === "loading") {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="animate-spin" />
            </div>
        );
    }

    if (gate.status === "denied" && gate.reason === "NO_USER") {
        return (
            <form onSubmit={handleLogin} className="max-w-md mx-auto py-20 space-y-6">
                <h1 className="text-3xl font-black text-center">Admin Login</h1>

                {loginError && (
                    <div className="text-rose-500 font-bold flex gap-2">
                        <AlertCircle size={18} /> {loginError}
                    </div>
                )}

                <input
                    className="admin-input w-full"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                />

                <div className="relative">
                    <input
                        type={showPass ? "text" : "password"}
                        className="admin-input w-full pr-10"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                    />
                    <button
                        type="button"
                        onClick={() => setShowPass(!showPass)}
                        className="absolute right-3 top-1/2 -translate-y-1/2"
                    >
                        {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                </div>

                <button className="admin-btn w-full">
                    {loginLoading ? <Loader2 className="animate-spin" /> : "Login"}
                </button>
            </form>
        );
    }

    if (gate.status === "denied") {
        return (
            <div className="text-center py-20 text-rose-500 font-bold">
                Access denied
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto pb-20 space-y-8">
            <SecurityDrawer
                isOpen={isDrawerOpen}
                onClose={() => setIsDrawerOpen(false)}
                email={gate.email || undefined}
            />

            <div className="flex justify-between items-end border-b pb-4">
                <h1 className="text-4xl font-black">System Operations</h1>
                <div className="flex gap-2">
                    <button onClick={() => setIsDrawerOpen(true)} className="admin-btn">
                        <Lock size={14} /> Security
                    </button>
                    <button onClick={handleSignOut} className="admin-btn">
                        <LogOut size={14} /> Sign out
                    </button>
                </div>
            </div>

            <AdminOrderList />
        </div>
    );
}
