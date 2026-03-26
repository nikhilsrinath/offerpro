import React from 'react';
import { motion } from 'framer-motion';

export default function RecipientStatusBadge({ status }) {
    const getBadgeStyle = () => {
        switch (status) {
            case 'pending':
                return {
                    bg: 'rgba(245, 200, 66, 0.1)',
                    color: '#F5C842', // var(--gold)
                    border: 'rgba(245, 200, 66, 0.2)',
                    label: 'Awaiting Your Response'
                };
            case 'accepted':
                return {
                    bg: 'rgba(46, 232, 160, 0.1)',
                    color: '#2EE8A0', // var(--success)
                    border: 'rgba(46, 232, 160, 0.2)',
                    label: 'Accepted'
                };
            case 'declined':
                return {
                    bg: 'rgba(231, 76, 60, 0.1)',
                    color: '#E74C3C', // var(--error)
                    border: 'rgba(231, 76, 60, 0.2)',
                    label: 'Declined'
                };
            case 'expired':
                return {
                    bg: 'rgba(136, 136, 170, 0.1)',
                    color: '#8888AA', // var(--muted)
                    border: 'rgba(136, 136, 170, 0.2)',
                    label: 'Expired'
                };
            default:
                return {
                    bg: 'rgba(255, 255, 255, 0.05)',
                    color: 'inherit',
                    border: 'rgba(255, 255, 255, 0.1)',
                    label: status
                };
        }
    };

    const style = getBadgeStyle();

    return (
        <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.375rem',
            padding: '0.375rem 0.75rem',
            background: style.bg,
            border: `1px solid ${style.border}`,
            borderRadius: '99px',
            color: style.color,
            fontSize: '0.75rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
        }}>
            {status === 'pending' && (
                <motion.div
                    animate={{ opacity: [1, 0.4, 1] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    style={{ width: '8px', height: '8px', borderRadius: '50%', background: style.color }}
                />
            )}
            {style.label}
        </div>
    );
}
