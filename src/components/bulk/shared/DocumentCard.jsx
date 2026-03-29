import React from 'react';
import { motion } from 'framer-motion';
import { FileText, Download, Eye, Edit3, CheckCircle2, XCircle } from 'lucide-react';

export default function DocumentCard({ title, subtitle, status, timestamp, onPreview, onDownload, onEdit }) {

    const getStatusBadge = () => {
        if (status === 'Generated' || status === 'Sent') {
            return (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: 'rgba(46, 232, 160, 0.1)', color: 'var(--success)', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                    <CheckCircle2 size={12} /> {status}
                </span>
            );
        }
        if (status === 'Failed') {
            return (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: 'rgba(231, 76, 60, 0.1)', color: 'var(--error)', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                    <XCircle size={12} /> Failed
                </span>
            );
        }
        return null;
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -4, boxShadow: '0 12px 24px rgba(0,0,0,0.2)' }}
            style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                position: 'relative',
                overflow: 'hidden'
            }}
        >
            {/* Format Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: 40, height: 40, borderRadius: '8px', background: 'var(--blue-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--blue)' }}>
                        <FileText size={20} />
                    </div>
                    <div>
                        <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</h4>
                        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{subtitle}</p>
                    </div>
                </div>
            </div>

            {/* Meta */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{timestamp}</p>
                {getStatusBadge()}
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0' }} />

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
                {onPreview && (
                    <button onClick={onPreview} className="btn-secondary" style={{ flex: 1, padding: '0.5rem', fontSize: '0.8125rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem', borderRadius: '6px' }}>
                        <Eye size={14} /> Preview
                    </button>
                )}
                {onDownload && (
                    <button onClick={onDownload} className="btn-secondary" style={{ flex: 1, padding: '0.5rem', fontSize: '0.8125rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem', borderRadius: '6px' }}>
                        <Download size={14} /> PDF
                    </button>
                )}
                {onEdit && (
                    <button onClick={onEdit} className="btn-secondary" style={{ padding: '0.5rem', borderRadius: '6px' }}>
                        <Edit3 size={14} />
                    </button>
                )}
            </div>
        </motion.div>
    );
}
