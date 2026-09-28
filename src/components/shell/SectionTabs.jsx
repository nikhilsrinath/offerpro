import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Seg } from '../ui/edge';
import { useT } from '../ui/edgeUtils';

/* ══════════════════════════════════════════════════════════════════════════
   A page with more than one way of working — one offer or a batch of them —
   switched by a segmented control under the shell header.

   The page is registered as flush in App.jsx, so this owns the whole body:
   a `flush` tab (the form-beside-preview editors) fills it edge to edge; any
   other tab scrolls inside it with the padding the shell gives a normal page.
   The chosen tab is `?mode=` in the URL, so links and refreshes land on it.
   ══════════════════════════════════════════════════════════════════════════ */

export default function SectionTabs({ tabs, label }) {
    const t = useT();
    const [params, setParams] = useSearchParams();
    const active = tabs.find((x) => x.id === params.get('mode')) || tabs[0];

    const select = (id) => setParams((p) => {
        const next = new URLSearchParams(p);
        if (id === tabs[0].id) next.delete('mode'); else next.set('mode', id);
        return next;
    }, { replace: true });

    return (
        <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div className="edge-scroll" style={{
                display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
                padding: '10px clamp(12px, 2vw, 20px)', overflowX: 'auto',
                borderBottom: '1px solid ' + t.line, background: t.panel,
            }}>
                <Seg label={label} value={active.id} onChange={select}
                    options={tabs.map((x) => ({ id: x.id, label: x.label }))} />
                {active.note && (
                    <span style={{ fontSize: 12, color: t.faint, whiteSpace: 'nowrap' }}>{active.note}</span>
                )}
            </div>
            <div
                key={active.id}
                className={active.flush ? undefined : 'edge-scroll'}
                style={{
                    flex: 1, minHeight: 0, position: 'relative',
                    overflow: active.flush ? 'hidden' : 'auto',
                    padding: active.flush ? 0 : 'clamp(12px, 2vw, 20px)',
                }}
            >
                {active.render()}
            </div>
        </div>
    );
}
