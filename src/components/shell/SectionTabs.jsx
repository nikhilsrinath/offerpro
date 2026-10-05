import React from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Seg } from '../ui/edge';
import { useT } from '../ui/edgeUtils';

/* ══════════════════════════════════════════════════════════════════════════
   A page with more than one way of working — one offer or a batch of them —
   switched by a segmented control under the shell header.

   The page is registered as flush in App.jsx, so this owns the whole body:
   a `flush` tab (the form-beside-preview editors) fills it edge to edge; any
   other tab scrolls inside it with the padding the shell gives a normal page.
   The chosen tab is part of the path — the page's own path for the first
   tab, `<base>/<path>` for the others (/employees/ex-employees) — so links
   and refreshes land on it.
   ══════════════════════════════════════════════════════════════════════════ */

/** Where a tab of the page at `base` lives. */
const tabPath = (base, tabs, id) => (id === tabs[0].id ? base : `${base}/${tabs.find((x) => x.id === id)?.path || id}`);

export default function SectionTabs({ tabs, label, base }) {
    const t = useT();
    const location = useLocation();
    const navigate = useNavigate();
    const sub = location.pathname.slice(base.length + 1).split('/')[0];
    const active = tabs.find((x) => sub && (x.path || x.id) === sub) || tabs[0];
    const select = (id) => navigate(tabPath(base, tabs, id), { replace: true });

    // Older links named the tab in ?mode=.
    const mode = new URLSearchParams(location.search).get('mode');
    if (mode && tabs.some((x) => x.id === mode)) {
        const rest = new URLSearchParams(location.search);
        rest.delete('mode');
        const q = rest.toString();
        return <Navigate to={tabPath(base, tabs, mode) + (q ? '?' + q : '')} replace />;
    }

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
