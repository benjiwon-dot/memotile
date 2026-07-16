// src/pages/DeleteAccountRequest.jsx
// Data Safety: 비로그인 상태에서도 계정 삭제 요청 가능한 페이지
// Google Play Console에서 "Delete data" URL로 등록
// → 사용자가 이메일 입력 → 백엔드에서 삭제 요청 처리 (이메일 확인 + 삭제)

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';

export default function DeleteAccountRequest() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const handleRequestDelete = async (e) => {
        e.preventDefault();
        setMessage('');
        setError('');
        if (!email.trim()) { setError('Please enter your email address.'); return; }

        setIsLoading(true);
        try {
            const fn = httpsCallable(functions, 'userDeleteAccountByEmail');
            const res = await fn({ email });
            setMessage('✓ Deletion request received. If this email is associated with an account, it will be deleted shortly.');
            setEmail('');
            setTimeout(() => navigate('/'), 5000);
        } catch (err) {
            console.error('[DeleteAccountRequest]', err);
            setError(err?.message || 'Request failed. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={{
            minHeight: '100vh', backgroundColor: '#fff', padding: '40px 20px',
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div style={{ maxWidth: 400, width: '100%' }}>
                <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12, color: '#111' }}>Delete Account</h1>
                <p style={{ fontSize: 14, color: '#666', marginBottom: 24, lineHeight: 1.6 }}>
                    Enter your email address associated with your MemoTile account. We will process your deletion request and remove all your personal data.
                </p>

                <form onSubmit={handleRequestDelete} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <input
                        type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                        placeholder="your@email.com" disabled={isLoading}
                        style={{
                            padding: '12px 16px', fontSize: 16, border: '1px solid #ddd', borderRadius: 8,
                            fontFamily: 'inherit', backgroundColor: '#fff', color: '#111'
                        }}
                    />
                    <button
                        type="submit" disabled={isLoading}
                        style={{
                            padding: '12px 16px', fontSize: 16, fontWeight: 700, backgroundColor: isLoading ? '#ccc' : '#EF4444',
                            color: '#fff', border: 'none', borderRadius: 8, cursor: isLoading ? 'not-allowed' : 'pointer'
                        }}
                    >
                        {isLoading ? 'Processing...' : 'Request Deletion'}
                    </button>
                </form>

                {message && <div style={{ marginTop: 16, padding: 12, backgroundColor: '#d1fae5', color: '#065f46', borderRadius: 8, fontSize: 14 }}>{message}</div>}
                {error && <div style={{ marginTop: 16, padding: 12, backgroundColor: '#fee2e2', color: '#7f1d1d', borderRadius: 8, fontSize: 14 }}>{error}</div>}

                <p style={{ fontSize: 12, color: '#999', marginTop: 24, textAlign: 'center' }}>
                    <a href="/privacy" style={{ color: '#0284c7', textDecoration: 'none' }}>Privacy Policy</a> · <a href="/" style={{ color: '#0284c7', textDecoration: 'none' }}>Home</a>
                </p>
            </div>
        </div>
    );
}
