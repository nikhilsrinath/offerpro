import React, { useState } from 'react';
import { Btn, Seg, Status, Empty } from '../../ui/edge';
import { MONO, useT } from '../../ui/edgeUtils';

const ROWS_PER_PAGE = 50;

const label = (col) => col.replace(/_/g, ' ');

/* The uploaded rows, checked against the page's rules, with every cell
   editable in place. A cell is a button until it is being edited, so it can be
   reached with Tab and opened with Enter; Enter saves, Escape cancels. */
export default function ValidationTable({ data, columns, onEdit, validationConfig }) {
    const t = useT();
    const [editingCell, setEditingCell] = useState(null); // { rowIdx, colKey }
    const [editValue, setEditValue] = useState('');
    const [filter, setFilter] = useState('All');
    const [page, setPage] = useState(0);

    const validatedData = data.map((row, idx) => {
        const errors = [];
        if (validationConfig) {
            Object.keys(validationConfig).forEach((col) => {
                const val = row[col] || '';
                const rules = validationConfig[col];
                if (rules.required && !val.toString().trim()) errors.push(`${label(col)} is required`);
                if (rules.email && val && !/^\S+@\S+\.\S+$/.test(val)) errors.push(`${label(col)} is not a valid email`);
                if (rules.validate) {
                    const customError = rules.validate(val, row);
                    if (customError) errors.push(customError);
                }
            });
        }
        return { row, idx, errors, isValid: errors.length === 0 };
    });

    const validCount = validatedData.filter((r) => r.isValid).length;
    const invalidCount = validatedData.length - validCount;

    const filteredData = validatedData.filter((r) => {
        if (filter === 'Valid') return r.isValid;
        if (filter === 'Invalid') return !r.isValid;
        return true;
    });
    const pageCount = Math.max(1, Math.ceil(filteredData.length / ROWS_PER_PAGE));
    const paginatedData = filteredData.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);

    const startEdit = (rowIdx, colKey, val) => {
        setEditingCell({ rowIdx, colKey });
        setEditValue(val ?? '');
    };

    const saveEdit = () => {
        if (!editingCell) return;
        onEdit(editingCell.rowIdx, editingCell.colKey, editValue);
        setEditingCell(null);
    };

    const onEditKey = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditingCell(null); }
    };

    const th = {
        textAlign: 'left', padding: '9px 12px', fontSize: 9.5, letterSpacing: '0.09em', fontWeight: 400,
        color: t.faint, borderBottom: '1px solid ' + t.line, whiteSpace: 'nowrap',
        position: 'sticky', top: 0, background: t.panel, zIndex: 1,
    };

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <Seg size="sm" label="Show rows" value={filter} onChange={(v) => { setFilter(v); setPage(0); }} options={[
                    { id: 'All', label: 'All', count: data.length },
                    { id: 'Valid', label: 'Valid', count: validCount },
                    { id: 'Invalid', label: 'Invalid', count: invalidCount },
                ]} />
                <div style={{ flex: 1 }} />
                <span role="status" style={{ fontSize: 10.5, color: t.faint }}>
                    {validCount} valid · {invalidCount} need attention · {data.length} total
                </span>
            </div>

            <div className="edge-scroll" style={{ overflow: 'auto', maxHeight: 520, border: '1px solid ' + t.line, borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO }}>
                    <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                        Uploaded rows. Select a cell to edit it.
                    </caption>
                    <thead>
                        <tr>
                            <th scope="col" style={th}>STATUS</th>
                            {columns.map((col) => (
                                <th key={col} scope="col" style={th}>{label(col).toUpperCase()}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedData.map(({ row, idx, errors, isValid }) => (
                            <tr key={idx} style={{ background: isValid ? undefined : t.panelAlt }}>
                                <td style={{ padding: '8px 12px', borderBottom: '1px solid ' + t.lineSoft, whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                                    {isValid
                                        ? <Status tone="up">Valid</Status>
                                        : (
                                            <span title={errors.join(', ')}>
                                                <Status tone="down">Invalid</Status>
                                                <span style={{ display: 'block', fontSize: 9.5, color: t.dim, marginTop: 3, whiteSpace: 'normal', maxWidth: 180 }}>
                                                    {errors.join('; ')}
                                                </span>
                                            </span>
                                        )}
                                </td>
                                {columns.map((col) => {
                                    const isEditing = editingCell?.rowIdx === idx && editingCell?.colKey === col;
                                    const hasError = errors.some((e) => e.startsWith(label(col)));
                                    const value = row[col];
                                    return (
                                        <td key={col} style={{
                                            padding: 3, borderBottom: '1px solid ' + t.lineSoft,
                                            boxShadow: hasError ? 'inset 2px 0 0 ' + t.down : 'none',
                                        }}>
                                            {isEditing ? (
                                                <input
                                                    autoFocus
                                                    aria-label={`${label(col)}, row ${idx + 1}`}
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(e.target.value)}
                                                    onBlur={saveEdit}
                                                    onKeyDown={onEditKey}
                                                    className="edge-input"
                                                    style={{
                                                        width: '100%', minWidth: 120, height: 30, boxSizing: 'border-box', padding: '0 8px',
                                                        background: t.panel, border: '1px solid ' + t.text, borderRadius: 6,
                                                        color: t.text, fontFamily: MONO, fontSize: 11.5,
                                                    }}
                                                />
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="edge-cell"
                                                    onClick={() => startEdit(idx, col, value)}
                                                    aria-label={`${label(col)}, row ${idx + 1}: ${value || 'empty'}${hasError ? ', has an error' : ''}. Edit`}
                                                    style={{
                                                        display: 'block', width: '100%', minHeight: 30, maxWidth: 220, textAlign: 'left',
                                                        padding: '0 9px', border: '1px solid transparent', borderRadius: 6,
                                                        background: 'transparent', cursor: 'text', fontFamily: MONO, fontSize: 11.5,
                                                        color: hasError ? t.down : t.text,
                                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                                    }}
                                                >
                                                    {value || <span style={{ color: t.faint }}>—</span>}
                                                </button>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
                {paginatedData.length === 0 && <Empty>No rows match this filter.</Empty>}
            </div>

            {filteredData.length > ROWS_PER_PAGE && (
                <nav aria-label="Rows pages" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                    <Btn size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Btn>
                    <span style={{ fontSize: 10.5, color: t.faint }} aria-live="polite">Page {page + 1} of {pageCount}</span>
                    <Btn size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>Next</Btn>
                </nav>
            )}

            <style>{`
                .edge-page .edge-cell:hover { border-color: ${t.line} !important; background: ${t.panel} !important; }
            `}</style>
        </div>
    );
}
