"use client";

import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import {
    signInWithEmailAndPassword,
    signOut,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
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
    Lock
} from 'lucide-react-native';

export default function AdminDashboardPage() {
    const gate = useRequireAdmin();
    const router = useRouter();

    // Login Form State
    const [loginEmail, setLoginEmail] = useState('ben.jiwon@kangkook.com');
    const [loginPassword, setLoginPassword] = useState('');
    const [loginLoading, setLoginLoading] = useState(false);
    const [loginError, setLoginError] = useState<string | null>(null);
    const [showPass, setShowPass] = useState(false);

    // Security Drawer State
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoginLoading(true);
        setLoginError(null);
        try {
            await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
        } catch (err: any) {
            console.error("Login error", err);
            setLoginError(err.message || 'Login failed. Please check credentials.');
        } finally {
            setLoginLoading(false);
        }
    };

    const handleSignOut = async () => {
        try {
            await signOut(auth);
        } catch (err) {
            console.error("Signout error", err);
        }
    };

    if (gate.status === 'loading') {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-accent"></div>
                <p className="text-zinc-400 font-bold animate-pulse font-mono">Authenticating System...</p>
            </div>
        );
    }

    // --- CASE 1: NO USER (Login UI) ---
    if (gate.status === 'denied' && gate.reason === 'NO_USER') {
        return (
            <div className="min-h-[70vh] flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-white border border-zinc-200 shadow-2xl rounded-3xl overflow-hidden">
                    <div className="bg-zinc-50 p-8 border-b border-zinc-100 flex flex-col items-center gap-4">
                        <div className="w-16 h-16 bg-accent rounded-2xl flex items-center justify-center shadow-lg shadow-accent/20">
                            <Shield color="white" size={32} />
                        </div>
                        <div className="text-center">
                            <h1 className="text-2xl font-black text-zinc-900 tracking-tight">Memotile Admin</h1>
                            <p className="text-zinc-400 font-bold text-sm uppercase tracking-widest mt-1">Operational Access</p>
                        </div>
                    </div>

                    <form onSubmit={handleLogin} className="p-8 space-y-6">
                        <div className="bg-rose-50 border border-rose-100 p-4 rounded-xl flex items-start gap-3 text-rose-600 text-sm">
                            <AlertCircle size={18} color="#e11d48" />
                            <p className="font-bold leading-tight">{loginError}</p>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest ml-1">Email</label>
                                <input
                                    type="email"
                                    readOnly={loginLoading}
                                    className="admin-input w-full"
                                    value={loginEmail}
                                    onChange={(e) => setLoginEmail(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest ml-1">Password</label>
                                <div className="relative">
                                    <input
                                        type={showPass ? "text" : "password"}
                                        className="admin-input w-full pr-10"
                                        placeholder="••••••••"
                                        value={loginPassword}
                                        onChange={(e) => setLoginPassword(e.target.value)}
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPass(!showPass)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 focus:outline-none"
                                    >
                                        {showPass ? <EyeOff size={18} color="currentColor" /> : <Eye size={18} color="currentColor" />}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loginLoading}
                            className="w-full bg-accent text-white font-black py-4 rounded-2xl transition-all hover:scale-[1.02] active:scale-95 shadow-xl shadow-accent/20 flex items-center justify-center gap-3 disabled:opacity-50"
                        >
                            {loginLoading ? (
                                <div className="animate-spin">
                                    <Loader2 size={20} color="white" />
                                </div>
                            ) : null}
                            <span>{loginLoading ? 'Verifying...' : 'Sign In to Dashboard'}</span>
                        </button>

                        <p className="text-center text-xs text-zinc-400">
                            Strictly reserved for authenticated administrators only.
                        </p>
                    </form>
                </div>
            </div>
        );
    }

    // --- CASE 2: ACCESS DENIED (Specific Reasons) ---
    if (gate.status === 'denied') {
        const { reason, email, claims } = gate;
        return (
            <div className="min-h-[60vh] flex items-center justify-center p-8">
                <div className="max-w-md w-full bg-white border border-zinc-200 shadow-xl rounded-2xl p-8 space-y-6">
                    <div className="flex flex-col items-center text-center gap-4">
                        <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center">
                            <AlertCircle color="#e11d48" size={32} />
                        </div>
                        <div className="space-y-1">
                            <h1 className="text-2xl font-black text-zinc-900">Permission Required</h1>
                            <p className="text-zinc-500">
                                {reason === 'NOT_ALLOWED_EMAIL' && 'This email is not authorized for administrative modules.'}
                                {reason === 'NOT_ADMIN' && 'Your account lacks the active isAdmin privilege.'}
                                {reason === 'ERROR' && (gate.message || 'Authorization subsystem failure.')}
                            </p>
                        </div>
                    </div>

                    <div className="bg-zinc-50 rounded-xl p-4 space-y-3 font-mono text-[10px]">
                        <div className="flex justify-between border-b border-zinc-100 pb-2">
                            <span className="text-zinc-400">Identity:</span>
                            <span className="text-zinc-600 font-bold">{email || 'Unknown'}</span>
                        </div>
                        <div className="flex justify-between border-b border-zinc-100 pb-2">
                            <span className="text-zinc-400">Root Cause:</span>
                            <span className="text-rose-600 font-bold uppercase tracking-wider">{reason}</span>
                        </div>
                        {reason === 'NOT_ADMIN' && (
                            <p className="text-zinc-400 font-sans mt-2 leading-relaxed">
                                Please contact the system lead to activate the <strong className="text-zinc-900">isAdmin</strong> claim for your UID. Refresh this page once granted.
                            </p>
                        )}
                        <div className="pt-2">
                            <p className="text-zinc-400 mb-2 underline">Current Token Claims:</p>
                            <pre className="text-zinc-500 overflow-auto max-h-40 leading-tight">
                                {JSON.stringify(claims || {}, null, 2)}
                            </pre>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3">
                        <button
                            onClick={handleSignOut}
                            className="w-full bg-accent text-white font-bold py-3 rounded-xl transition-all hover:brightness-110 flex items-center justify-center gap-2"
                        >
                            <LogOut size={16} /> Sign Out & Try Different Account
                        </button>
                        <button
                            onClick={() => router.replace('/')}
                            className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-600 font-bold py-3 rounded-xl transition-colors"
                        >
                            Return to Public Site
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // --- CASE 3: ALLOWED (Dashboard + Security) ---
    return (
        <div className="max-w-7xl mx-auto space-y-12 pb-20">
            {/* Security Drawer */}
            <SecurityDrawer
                isOpen={isDrawerOpen}
                onClose={() => setIsDrawerOpen(false)}
                email={gate.email || undefined}
            />

            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-zinc-100">
                <div className="space-y-1">
                    <h1 className="text-4xl font-black text-zinc-900 tracking-tight">System Operations</h1>
                    <p className="text-zinc-500 font-medium">Monitoring and managing active Memotile orders.</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setIsDrawerOpen(true)}
                        className="bg-white hover:bg-zinc-50 border border-zinc-200 text-zinc-600 px-4 py-2 rounded-lg text-xs font-black flex items-center gap-2 transition-colors shadow-sm"
                    >
                        <Lock size={14} /> SECURITY
                    </button>
                    <button
                        onClick={handleSignOut}
                        className="bg-zinc-100 hover:bg-zinc-200 text-zinc-600 px-4 py-2 rounded-lg text-xs font-black flex items-center gap-2 transition-colors"
                    >
                        <LogOut size={14} /> SIGN OUT
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1">
                {/* Main Content: Orders */}
                <div className="space-y-8">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-1.5 h-8 bg-accent rounded-full" />
                        <h2 className="text-2xl font-black text-zinc-900">Customer Orders</h2>
                    </div>
                    <AdminOrderList />
                </div>
            </div>
        </div>
    );
}
