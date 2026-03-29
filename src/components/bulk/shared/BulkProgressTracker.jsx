import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

export default function BulkProgressTracker({ total, processed, failed, status }) {
    const [animatedProcessed, setAnimatedProcessed] = useState(0);

    // Animate the counter number smoothly
    useEffect(() => {
        setAnimatedProcessed(processed);
    }, [processed]);

    const percentage = total === 0 ? 0 : Math.round((processed / total) * 100);

    // Colors based on status
    const getColor = () => {
        if (status === 'error') return '#E74C3C';
        if (status === 'done' && failed === 0) return '#2EE8A0';
        if (status === 'done' && failed > 0) return '#f59e0b';
        return 'var(--text-primary)';
    };

    const getStatusIcon = () => {
        if (status === 'done') {
            return failed > 0 ? <AlertTriangle size={24} color="#f59e0b" /> : <CheckCircle2 size={24} color="#2EE8A0" />;
        }
        if (status === 'error') {
            return <AlertTriangle size={24} color="#E74C3C" />;
        }
        return <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: "linear" }}><Loader2 size={24} color="var(--text-primary)" /></motion.div>;
    };

    const strokeDasharray = 283; // 2 * pi * r (r=45)
    const strokeDashoffset = strokeDasharray - (strokeDasharray * percentage) / 100;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', padding: '2rem', background: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)' }}>
            {/* Circular Progress */}
            <div style={{ position: 'relative', width: '120px', height: '120px' }}>
                <svg width="120" height="120" viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
                    {/* Background circle */}
                    <circle cx="50" cy="50" r="45" fill="none" stroke="var(--border)" strokeWidth="8" />

                    {/* Progress circle */}
                    <motion.circle
                        cx="50"
                        cy="50"
                        r="45"
                        fill="none"
                        stroke={getColor()}
                        strokeWidth="8"
                        strokeLinecap="round"
                        initial={{ strokeDashoffset: strokeDasharray }}
                        animate={{ strokeDashoffset }}
                        transition={{ duration: 0.5, ease: "easeInOut" }}
                        style={{ strokeDasharray }}
                    />
                </svg>

                {/* Center Text (percentage) */}
                <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                    <span style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                        {percentage}%
                    </span>
                </div>
            </div>

            {/* Stats Row */}
            <div style={{ textAlign: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                    {getStatusIcon()}
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
                        {status === 'processing' ? 'Generating Documents...' :
                            status === 'done' ? 'Generation Complete' : 'Generation Failed'}
                    </h3>
                </div>

                <div style={{ display: 'flex', gap: '2rem', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>{animatedProcessed}</span>
                        <span>Generated</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <span style={{ fontSize: '1.5rem', fontWeight: 700, color: failed > 0 ? 'var(--error)' : 'var(--text-primary)' }}>{failed}</span>
                        <span>Failed</span>
                    </div>
                    {status === 'processing' && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{total - processed - failed}</span>
                            <span>Pending</span>
                        </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>{total}</span>
                        <span>Total</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
