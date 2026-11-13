import React, { useRef } from 'react';
import { Plus, X, GripVertical } from 'lucide-react';
import { MONO, useT } from '../ui/edgeUtils';
import { checkItem } from './notesModel';
import { TickBox, IconBtn } from './workspaceUi';

/* The editing surface of a note, shared by the composer at the top of Notes
   and the side panel: a text body, or a checklist whose lines are ticked,
   typed, removed and dragged into order. Enter adds the next line,
   Backspace on an empty line removes it. Ticked lines sit under the rest. */

export function AutoTextarea({ value, onChange, placeholder, minRows = 3, style, ...rest }) {
    const ref = useRef(null);
    const fit = (el) => { if (!el) return; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };
    return (
        <textarea ref={(el) => { ref.current = el; fit(el); }} value={value} rows={minRows} placeholder={placeholder}
            onChange={(e) => { onChange(e.target.value); fit(e.target); }}
            className="ws-bare-input" style={{ resize: 'none', overflow: 'hidden', lineHeight: 1.6, fontFamily: MONO, ...style }} {...rest} />
    );
}

export function ChecklistEditor({ items, onChange, autoFocusNew }) {
    const t = useT();
    const refs = useRef({});
    const dragId = useRef(null);
    const open = items.filter((i) => !i.done);
    const done = items.filter((i) => i.done);

    const setItem = (id, patch) => onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    const focus = (id) => setTimeout(() => refs.current[id]?.focus(), 0);
    const addAfter = (id) => {
        const it = checkItem('');
        const at = items.findIndex((i) => i.id === id);
        const next = [...items];
        next.splice(at < 0 ? next.length : at + 1, 0, it);
        onChange(next);
        focus(it.id);
    };
    const drop = (id) => {
        const at = open.findIndex((i) => i.id === id);
        onChange(items.filter((i) => i.id !== id));
        const prev = open[at - 1];
        if (prev) focus(prev.id);
    };
    const moveBefore = (id, beforeId) => {
        if (!id || id === beforeId) return;
        const moving = items.find((i) => i.id === id);
        const rest = items.filter((i) => i.id !== id);
        const at = rest.findIndex((i) => i.id === beforeId);
        rest.splice(at < 0 ? rest.length : at, 0, moving);
        onChange(rest);
    };

    const line = (i) => (
        <div key={i.id} className="ws-row" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minHeight: 30, padding: '2px 0', position: 'relative' }}
            draggable={!i.done}
            onDragStart={(e) => { dragId.current = i.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', i.id); }}
            onDragOver={(e) => { if (dragId.current && !i.done) e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); moveBefore(dragId.current, i.id); dragId.current = null; }}>
            {!i.done && <GripVertical aria-hidden="true" size={13} className="ws-reveal" style={{ color: t.ghost, marginTop: 6, marginLeft: -4, cursor: 'grab', flexShrink: 0 }} />}
            <span style={{ paddingTop: 5, marginLeft: i.done ? 9 : 0 }}>
                <TickBox done={i.done} size={16} label={(i.done ? 'Untick: ' : 'Tick: ') + (i.text || 'item')} onToggle={() => setItem(i.id, { done: !i.done })} />
            </span>
            <input ref={(el) => { refs.current[i.id] = el; }} value={i.text} maxLength={1000}
                autoFocus={autoFocusNew && i === items[items.length - 1] && !i.text}
                onChange={(e) => setItem(i.id, { text: e.target.value })}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addAfter(i.id); }
                    else if (e.key === 'Backspace' && !i.text) { e.preventDefault(); drop(i.id); }
                }}
                aria-label="List item" placeholder="List item"
                className="ws-bare-input" style={{
                    flex: 1, height: 26, fontFamily: MONO, fontSize: 13.5,
                    color: i.done ? t.faint : t.text, textDecoration: i.done ? 'line-through' : 'none',
                }} />
            <IconBtn icon={X} label="Remove item" size={24} className="ws-reveal" onClick={() => onChange(items.filter((x) => x.id !== i.id))} />
        </div>
    );

    return (
        <div>
            {open.map(line)}
            <button type="button" onClick={() => { const it = checkItem(''); onChange([...open, it, ...done]); focus(it.id); }} className="ws-ghost-btn" style={{
                display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 4px', border: 'none', background: 'transparent',
                color: t.faint, fontFamily: MONO, fontSize: 13, cursor: 'pointer', borderRadius: 6,
            }}><Plus aria-hidden="true" size={16} />List item</button>
            {done.length > 0 && (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid ' + t.lineSoft }}>
                    <div style={{ fontSize: 11.5, color: t.faint, padding: '2px 0 4px' }}>{done.length} ticked</div>
                    {done.map(line)}
                </div>
            )}
        </div>
    );
}
