import React, { useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Edit3 } from 'lucide-react';

export default function ValidationTable({ data, columns, onEdit, validationConfig }) {
    const [editingCell, setEditingCell] = useState(null); // { rowIdx, colKey }
    const [editValue, setEditValue] = useState('');
    const [filter, setFilter] = useState('All'); // 'All', 'Valid', 'Invalid', 'Warnings'
    const [page, setPage] = useState(0);
    const rowsPerPage = 50;

    // Run validation on all data
    const validatedData = data.map((row, idx) => {
        const errors = [];
        const warnings = [];

        if (validationConfig) {
            Object.keys(validationConfig).forEach(col => {
                const val = row[col] || '';
                const rules = validationConfig[col];
                if (rules.required && !val.toString().trim()) {
                    errors.push(`${col} is required`);
                }
                if (rules.email && val && !/^\S+@\S+\.\S+$/.test(val)) {
                    errors.push(`Invalid email format for ${col}`);
                }
                if (rules.validate) {
                    const customError = rules.validate(val, row);
                    if (customError) errors.push(customError);
                }
            });
        }

        return {
            ...row,
            __index: idx,
            __isValid: errors.length === 0,
            __errors: errors,
            __warnings: warnings
        };
    });

    const validCount = validatedData.filter(r => r.__isValid).length;
    const invalidCount = validatedData.length - validCount;

    const filteredData = validatedData.filter(row => {
        if (filter === 'Valid') return row.__isValid;
        if (filter === 'Invalid') return !row.__isValid;
        if (filter === 'Warnings') return row.__warnings.length > 0;
        return true;
    });

    const paginatedData = filteredData.slice(page * rowsPerPage, (page + 1) * rowsPerPage);

    const handleEditClick = (rowIdx, colKey, val) => {
        setEditingCell({ rowIdx, colKey });
        setEditValue(val || '');
    };

    const handleEditSave = () => {
        if (editingCell) {
            onEdit(editingCell.rowIdx, editingCell.colKey, editValue);
            setEditingCell(null);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') handleEditSave();
        if (e.key === 'Escape') setEditingCell(null);
    };

    return (
        <div className="bulk-validation-table-container">
            {/* Table Header Controls */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {['All', 'Valid', 'Invalid', 'Warnings'].map(f => (
                        <button
                            key={f}
                            onClick={() => { setFilter(f); setPage(0); }}
                            className={`bulk-filter-btn ${filter === f ? 'active' : ''}`}
                            style={{
                                background: filter === f ? 'var(--surface)' : 'transparent',
                                border: `1px solid ${filter === f ? 'var(--blue)' : 'var(--border)'}`,
                                color: filter === f ? 'var(--blue)' : 'var(--text-secondary)',
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
                <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                    <span style={{ color: 'var(--success)' }}>{validCount} valid</span> &middot;{' '}
                    <span style={{ color: invalidCount > 0 ? 'var(--error)' : 'inherit' }}>{invalidCount} invalid</span> &middot;{' '}
                    {data.length} total
                </div>
            </div>

            {/* Actual Table */}
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '12px', background: 'var(--surface)', maxHeight: '600px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 10 }}>
                        <tr>
                            <th style={{ padding: '1rem', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 600 }}>Status</th>
                            {columns.map(col => (
                                <th key={col} style={{ padding: '1rem', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                    {col.replace(/_/g, ' ').toUpperCase()}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedData.map((row) => (
                            <tr
                                key={row.__index}
                                style={{
                                    borderBottom: '1px solid var(--border)',
                                    background: !row.__isValid ? 'rgba(231, 76, 60, 0.05)' : 'transparent'
                                }}
                            >
                                <td style={{ padding: '1rem', whiteSpace: 'nowrap' }}>
                                    {!row.__isValid ? (
                                        <div title={row.__errors.join(', ')} style={{ color: 'var(--error)', display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'help' }}>
                                            <XCircle size={18} fill="rgba(231,76,60,0.1)" /> <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Invalid</span>
                                        </div>
                                    ) : row.__warnings.length > 0 ? (
                                        <div title={row.__warnings.join(', ')} style={{ color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'help' }}>
                                            <AlertTriangle size={18} fill="rgba(245,158,11,0.1)" /> <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Warning</span>
                                        </div>
                                    ) : (
                                        <div style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                            <CheckCircle2 size={18} fill="rgba(46,232,160,0.1)" />
                                        </div>
                                    )}
                                </td>

                                {columns.map(col => {
                                    const isEditing = editingCell?.rowIdx === row.__index && editingCell?.colKey === col;
                                    const hasError = !row.__isValid && row.__errors.some(e => e.includes(col));

                                    return (
                                        <td
                                            key={col}
                                            onClick={() => !isEditing && handleEditClick(row.__index, col, row[col])}
                                            style={{
                                                padding: '0.75rem 1rem',
                                                cursor: 'text',
                                                position: 'relative',
                                                color: hasError ? 'var(--error)' : 'var(--text-primary)',
                                                borderLeft: hasError ? '2px solid var(--error)' : 'none'
                                            }}
                                            className="bulk-editable-cell"
                                        >
                                            {isEditing ? (
                                                <input
                                                    autoFocus
                                                    value={editValue}
                                                    onChange={e => setEditValue(e.target.value)}
                                                    onBlur={handleEditSave}
                                                    onKeyDown={handleKeyDown}
                                                    style={{
                                                        width: '100%',
                                                        background: 'var(--background)',
                                                        border: '1px solid var(--blue)',
                                                        color: 'var(--text-primary)',
                                                        padding: '0.25rem 0.5rem',
                                                        borderRadius: '4px',
                                                        outline: 'none',
                                                        fontSize: '0.875rem'
                                                    }}
                                                />
                                            ) : (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'nowrap', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {row[col] || <span style={{ opacity: 0.3 }}>-</span>}
                                                    <Edit3 size={12} className="edit-icon" style={{ opacity: 0 }} />
                                                </div>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>

                {paginatedData.length === 0 && (
                    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <p>No records found for the current filter.</p>
                    </div>
                )}
            </div>

            {/* Pagination */}
            {filteredData.length > rowsPerPage && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', fontSize: '0.875rem' }}>
                    <button
                        disabled={page === 0}
                        onClick={() => setPage(p => p - 1)}
                        className="btn-secondary"
                        style={{ padding: '0.4rem 1rem', borderRadius: '6px' }}
                    >
                        Previous
                    </button>
                    <span style={{ color: 'var(--text-muted)' }}>
                        Page {page + 1} of {Math.ceil(filteredData.length / rowsPerPage)}
                    </span>
                    <button
                        disabled={(page + 1) * rowsPerPage >= filteredData.length}
                        onClick={() => setPage(p => p + 1)}
                        className="btn-secondary"
                        style={{ padding: '0.4rem 1rem', borderRadius: '6px' }}
                    >
                        Next
                    </button>
                </div>
            )}

            {/* Minimal CSS for hover states */}
            <style>{`
        .bulk-editable-cell:hover { background: rgba(255,255,255,0.02); }
        .bulk-editable-cell:hover .edit-icon { opacity: 0.5 !important; }
      `}</style>
        </div>
    );
}
