import React, { useState } from 'react';
import { Btn, Seg, Status, Empty } from '../../ui/edge';
import { MONO, useT, tableFrame, thStyle, tdStyle } from '../../ui/edgeUtils';
import { fmtDmy } from '../../../services/importDates';

const ROWS_PER_PAGE = 50;

const label = (col) => col.replace(/_/g, ' ');

/* The uploaded rows, checked against the page's rules, with every cell
   editable in place. A cell is a button until it is being edited, so it can be
   reached with Tab and opened with Enter; Enter saves, Escape cancels. */
export default function ValidationTable({
    data, columns, onEdit, validationConfig,
    // Optional: columns that hold dates (shown dd/mm/yyyy, edited on a calendar),
    // a delete button on each row, and a check against what is already there:
    // rowCheck(row, idx) → { errors: [], warning: string, note?: string }. A
    // warning holds the row back until it is ignored; a note is shown under a
    // valid row (what importing it will do).
    dateColumns = [], onDeleteRow, rowCheck, onIgnore,
}) {
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
        let warning = '';
        let note = '';
        if (rowCheck) {
            const found = rowCheck(row, idx);
            errors.push(...(found.errors || []));
            warning = found.warning || '';
            note = found.note || '';
        }
        return { row, idx, errors, warning, note, isValid: errors.length === 0 && !warning };
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

    const th = { ...thStyle(t), position: 'sticky', top: 0, zIndex: 1 };
    const td = { ...tdStyle(t), padding: '9px 14px', verticalAlign: 'top' };

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <Seg size="sm" label="Show rows" value={filter} onChange={(v) => { setFilter(v); setPage(0); }} options={[
                    { id: 'All', label: 'All', count: data.length },
                    { id: 'Valid', label: 'Valid', count: validCount },
                    { id: 'Invalid', label: 'Invalid', count: invalidCount },
                ]} />
                <div style={{ flex: 1 }} />
                <span role="status" style={{ fontSize: 12, color: t.faint }}>
                    {validCount} valid · {invalidCount} need attention · {data.length} total
                </span>
            </div>

            <div className="edge-scroll" style={{ ...tableFrame(t), overflow: 'auto', maxHeight: 520 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO }}>
                    <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                        Uploaded rows. Select a cell to edit it.
                    </caption>
                    <thead>
                        <tr>
                            <th scope="col" style={th}>Status</th>
                            {columns.map((col) => (
                                <th key={col} scope="col" style={th}>{label(col)}</th>
                            ))}
                            {onDeleteRow && <th scope="col" style={th}><span className="eo-sr">Remove row</span></th>}
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedData.map(({ row, idx, errors, warning, note, isValid }) => (
                            <tr key={idx} style={{ background: isValid ? undefined : t.panelAlt }}>
                                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                    {isValid
                                        ? (
                                            <span>
                                                <Status tone="up">Valid</Status>
                                                {note && (
                                                    <span style={{ display: 'block', fontSize: 11, color: t.dim, marginTop: 3, whiteSpace: 'normal', maxWidth: 200 }}>
                                                        {note}
                                                    </span>
                                                )}
                                            </span>
                                        )
                                        : (
                                            <span title={[...errors, warning].filter(Boolean).join(', ')}>
                                                <Status tone="down">{errors.length ? 'Invalid' : 'Check'}</Status>
                                                <span style={{ display: 'block', fontSize: 11, color: t.dim, marginTop: 3, whiteSpace: 'normal', maxWidth: 200 }}>
                                                    {[...errors, warning].filter(Boolean).join('; ')}
                                                </span>
                                                {warning && !errors.length && onIgnore && (
                                                    <Btn size="sm" style={{ marginTop: 4 }} onClick={() => onIgnore(idx)}>Ignore</Btn>
                                                )}
                                            </span>
                                        )}
                                </td>
                                {columns.map((col) => {
                                    const isEditing = editingCell?.rowIdx === idx && editingCell?.colKey === col;
                                    const hasError = errors.some((e) => e.startsWith(label(col)));
                                    const value = row[col];
                                    return (
                                        <td key={col} style={{
                                            padding: 3, borderBottom: '1px solid ' + t.line,
                                            boxShadow: hasError ? 'inset 2px 0 0 ' + t.down : 'none',
                                        }}>
                                            {isEditing ? (
                                                <input
                                                    autoFocus
                                                    type={dateColumns.includes(col) ? 'date' : 'text'}
                                                    aria-label={`${label(col)}, row ${idx + 1}`}
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(e.target.value)}
                                                    onBlur={saveEdit}
                                                    onKeyDown={onEditKey}
                                                    className="edge-input"
                                                    style={{
                                                        width: '100%', minWidth: 120, height: 30, boxSizing: 'border-box', padding: '0 8px',
                                                        background: t.panel, border: '1px solid ' + t.text, borderRadius: 6,
                                                        color: t.text, fontFamily: MONO, fontSize: 13,
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
                                                        background: 'transparent', cursor: 'text', fontFamily: MONO, fontSize: 13,
                                                        color: hasError ? t.down : t.text,
                                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                                    }}
                                                >
                                                    {value
                                                        ? (dateColumns.includes(col) ? fmtDmy(value) : value)
                                                        : <span style={{ color: t.faint }}>-</span>}
                                                </button>
                                            )}
                                        </td>
                                    );
                                })}
                                {onDeleteRow && (
                                    <td style={{ padding: '3px 9px', borderBottom: '1px solid ' + t.line, verticalAlign: 'middle' }}>
                                        <Btn size="sm" aria-label={`Delete row ${idx + 1}`} onClick={() => onDeleteRow(idx)}>Delete</Btn>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
                {paginatedData.length === 0 && <Empty>No rows match this filter.</Empty>}
            </div>

            {filteredData.length > ROWS_PER_PAGE && (
                <nav aria-label="Rows pages" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                    <Btn size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Btn>
                    <span style={{ fontSize: 12, color: t.faint }} aria-live="polite">Page {page + 1} of {pageCount}</span>
                    <Btn size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>Next</Btn>
                </nav>
            )}

            <style>{`
                .edge-page .edge-cell:hover { border-color: ${t.line} !important; background: ${t.panel} !important; }
            `}</style>
        </div>
    );
}
