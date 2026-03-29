import React, { useState } from 'react';
import { Archive, Download, RefreshCw, Folder } from 'lucide-react';

const MOCK_HISTORY = [];

export default function BulkHistory() {
    const [filter, setFilter] = useState('All');

    const filteredHistory = MOCK_HISTORY.filter(h => filter === 'All' || h.type === filter);

    return (
        <div className="bulk-page-container" style={{ padding: '0', maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ padding: '2rem', background: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)' }}>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', margin: '0 0 0.5rem 0', fontWeight: 800 }}>Bulk Operations History</h1>
                <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.875rem' }}>Review past batch processing jobs, view logs, and download records.</p>
            </div>

            <div style={{ background: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {['All', 'Offer Letters', 'Certificates', 'Team Import'].map(f => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className={`bulk-filter-btn ${filter === f ? 'active' : ''}`}
                                style={{
                                    background: filter === f ? 'var(--btn-accent-bg)' : 'transparent',
                                    border: filter === f ? '1px solid var(--btn-accent-bg)' : '1px solid var(--border)',
                                    color: filter === f ? 'var(--btn-accent-text)' : 'var(--text-secondary)',
                                    padding: '0.4rem 1rem',
                                    borderRadius: '99px',
                                    fontSize: '0.8125rem',
                                    fontWeight: 600,
                                    cursor: 'pointer'
                                }}
                            >
                                {f}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="bulk-history-table-wrapper">
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem', minWidth: '800px' }}>

                        <thead style={{ background: 'rgba(255,255,255,0.02)' }}>
                            <tr>
                                <th style={{ padding: '1rem 1.5rem', color: 'var(--text-muted)' }}>Date & Time</th>
                                <th style={{ padding: '1rem', color: 'var(--text-muted)' }}>Type</th>
                                <th style={{ padding: '1rem', color: 'var(--text-muted)' }}>Batch Name</th>
                                <th style={{ padding: '1rem', color: 'var(--text-muted)' }}>Status</th>
                                <th style={{ padding: '1rem', color: 'var(--text-muted)' }}>Processed</th>
                                <th style={{ padding: '1rem 1.5rem', color: 'var(--text-muted)', textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredHistory.map((job) => (
                                <tr key={job.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                    <td style={{ padding: '1.25rem 1.5rem', color: 'var(--text-secondary)' }}>{job.date}</td>
                                    <td style={{ padding: '1.25rem', fontWeight: 600 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <Folder size={16} color="var(--blue)" /> {job.type}
                                        </div>
                                    </td>
                                    <td style={{ padding: '1.25rem', fontWeight: 600 }}>{job.batch_name}</td>
                                    <td style={{ padding: '1.25rem' }}>
                                        <span style={{
                                            display: 'inline-flex', alignItems: 'center', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600,
                                            background: job.status === 'Completed' ? 'rgba(46, 232, 160, 0.1)' : 'rgba(231, 76, 60, 0.1)',
                                            color: job.status === 'Completed' ? 'var(--success)' : 'var(--error)'
                                        }}>
                                            {job.status}
                                        </span>
                                    </td>
                                    <td style={{ padding: '1.25rem' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                            <span><strong style={{ color: 'var(--text-primary)' }}>{job.processed}</strong> Success</span>
                                            {job.failed > 0 && <span style={{ color: 'var(--error)', fontSize: '0.75rem' }}>{job.failed} Failed</span>}
                                        </div>
                                    </td>
                                    <td style={{ padding: '1.25rem 1.5rem', textAlign: 'right' }}>
                                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                            {job.type !== 'Team Import' && (
                                                <button className="btn-secondary" style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                    <Download size={14} /> ZIP
                                                </button>
                                            )}
                                            <button className="btn-secondary" style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                <Archive size={14} /> View Log
                                            </button>
                                            {job.failed > 0 && (
                                                <button style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px', background: 'var(--blue-muted)', color: 'var(--blue)', border: '1px solid var(--blue-border)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                    <RefreshCw size={14} /> Retry Failed
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {filteredHistory.length === 0 && (
                        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                            No history found for this category.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
