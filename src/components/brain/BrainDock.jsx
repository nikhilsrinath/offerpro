import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
    LayoutGrid, List, PanelRightClose, Sparkles, Activity, Crosshair, X,
} from 'lucide-react';
import { useT, MONO } from '../ui/edgeUtils';
import { Empty, Search, Muted } from '../ui/edge';
import { kindLabel } from '../../services/brainService';
import BrainSummary from './BrainSummary';
import BrainInspector from './BrainInspector';
import BrainAsk from './BrainAsk';
import BrainHealth from './BrainHealth';

/* The side dock.

   Everything that is not the graph lives here, behind a rail of five icons.
   One panel is open at a time, and its width is the reader's to set and keep:
   Ask wants a column wide enough to read a paragraph in, Summary is a list of
   figures and wants none of that. The width is remembered rather than chosen
   per tab, because a panel that resizes itself every time you change tab moves
   the graph under the person reading it.

   The rail stays visible when the panel is closed, so the graph can be taken
   full-bleed without losing the way back. */

const MIN_W = 300;
const MAX_W = 620;
const STORE_KEY = 'edgebrain.dock.width';

function storedWidth(fallback) {
    try {
        const v = Number(window.localStorage.getItem(STORE_KEY));
        if (Number.isFinite(v) && v >= MIN_W) return Math.min(v, MAX_W);
    } catch { /* private mode, or no storage at all: the default is fine */ }
    return fallback;
}

const TABS = [
    { id: 'summary', label: 'Summary', icon: LayoutGrid, hint: 'What the brain knows' },
    { id: 'entities', label: 'Entities', icon: List, hint: 'Search and browse every record' },
    { id: 'inspect', label: 'Inspect', icon: Crosshair, hint: 'The selected record' },
    { id: 'ask', label: 'Ask', icon: Sparkles, hint: 'Ask a question of your records' },
    { id: 'health', label: 'Health', icon: Activity, hint: 'Sync state and coverage' },
];

export default function BrainDock({
    tab, onTab, open, onOpenChange, width = 356,
    // summary
    status, metrics,
    // entities
    query, onQuery, listed, searching, selectedId, onOpenNode, shownCount, hasHits,
    // inspector
    detail, detailLoading, detailError, onLocate,
    // ask
    orgId, stale, syncedAt,
    // health
    syncing, actionError, onSync, onFullRebuild,
    // health/locked
    lockedToHealth,
}) {
    const t = useT();
    const active = TABS.find((x) => x.id === tab) || TABS[0];
    const [w, setW] = useState(() => storedWidth(width));
    const [dragging, setDragging] = useState(false);
    const dragRef = useRef(null);

    const pick = (id) => {
        if (id === tab && open) { onOpenChange(false); return; }
        onTab(id);
        onOpenChange(true);
    };

    const resize = useCallback((next) => {
        const clamped = Math.round(Math.min(MAX_W, Math.max(MIN_W, next)));
        setW(clamped);
        try { window.localStorage.setItem(STORE_KEY, String(clamped)); } catch { /* fine */ }
    }, []);

    /* The drag is tracked on the window rather than on the handle: a resize that
       stops the moment the pointer outruns a five-pixel target is the reason
       handles like this feel broken. */
    useEffect(() => {
        if (!dragging) return undefined;
        const onMove = (e) => {
            const d = dragRef.current;
            if (!d) return;
            resize(d.w - (e.clientX - d.x));
        };
        const onUp = () => { dragRef.current = null; setDragging(false); };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
        };
    }, [dragging, resize]);

    /* A resize is a pointer held down and moved across the whole window, which
       is exactly the gesture that selects text. Suppressing it for the duration
       is cheaper than fighting it at every element the pointer crosses. */
    useEffect(() => {
        if (!dragging) return undefined;
        const prev = document.body.style.userSelect;
        const prevCursor = document.body.style.cursor;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
        return () => {
            document.body.style.userSelect = prev;
            document.body.style.cursor = prevCursor;
        };
    }, [dragging]);

    return (
        <div style={{
            display: 'flex', height: '100%', minHeight: 0, flexShrink: 0,
            borderLeft: `1px solid ${t.line}`, background: t.panel, position: 'relative',
        }}>
            {open && (
                <div
                    role="separator" aria-orientation="vertical" tabIndex={0}
                    aria-label="Resize the panel" aria-valuenow={w}
                    aria-valuemin={MIN_W} aria-valuemax={MAX_W}
                    onPointerDown={(e) => {
                        // Without this the drag starts a text selection across
                        // whatever the pointer passes over, which is both ugly
                        // and the reason the release feels like it did nothing.
                        e.preventDefault();
                        dragRef.current = { x: e.clientX, w };
                        setDragging(true);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'ArrowLeft') { e.preventDefault(); resize(w + 24); }
                        if (e.key === 'ArrowRight') { e.preventDefault(); resize(w - 24); }
                    }}
                    className="brain-dock-grip"
                    style={{
                        position: 'absolute', left: -4, top: 0, bottom: 0, width: 9,
                        cursor: 'col-resize', zIndex: 9, touchAction: 'none',
                        userSelect: 'none',
                        background: dragging ? t.lineStrong : 'transparent',
                        transition: 'background .15s ease',
                    }}
                />
            )}
            {/* ── the rail ─────────────────────────────────────────────────── */}
            <nav aria-label="EdgeBrain panels" style={{
                width: 46, flexShrink: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: 4, padding: '9px 0',
                borderRight: open ? `1px solid ${t.line}` : 'none',
            }}>
                {TABS.map((x) => {
                    const on = open && tab === x.id;
                    const disabled = lockedToHealth && x.id !== 'health';
                    const Icon = x.icon;
                    return (
                        <button
                            key={x.id} type="button" className="edge-icon"
                            onClick={() => pick(x.id)} disabled={disabled}
                            aria-pressed={on} title={disabled ? 'Unavailable until the brain is healthy' : x.hint}
                            style={{
                                width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center',
                                cursor: disabled ? 'not-allowed' : 'pointer', position: 'relative',
                                border: `1px solid ${on ? t.line : 'transparent'}`,
                                background: on ? t.panelAlt : 'transparent',
                                color: disabled ? t.ghost : on ? t.text : t.faint,
                                opacity: disabled ? 0.45 : 1,
                                transition: 'background .15s ease, color .15s ease',
                            }}>
                            <Icon aria-hidden="true" size={15} strokeWidth={1.7} />
                            <span style={SR_ONLY}>{x.label}</span>
                        </button>
                    );
                })}

                <div style={{ flex: 1 }} />

                {open && (
                    <button
                        type="button" className="edge-icon" onClick={() => onOpenChange(false)}
                        title="Hide the panel" aria-label="Hide the panel"
                        style={{
                            width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center',
                            cursor: 'pointer', border: '1px solid transparent',
                            background: 'transparent', color: t.faint,
                        }}>
                        <PanelRightClose aria-hidden="true" size={15} strokeWidth={1.7} />
                    </button>
                )}
            </nav>

            {/* ── the panel ────────────────────────────────────────────────── */}
            {open && (
                <section
                    aria-label={active.label}
                    style={{
                        width: w, flexShrink: 0, display: 'flex', flexDirection: 'column',
                        minHeight: 0, background: t.panel,
                    }}
                    className="brain-dock-panel"
                >
                    <header style={{
                        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
                        padding: '0 8px 0 14px', height: 42,
                        borderBottom: `1px solid ${t.line}`,
                    }}>
                        <span style={{
                            fontSize: 10, letterSpacing: '0.11em', color: t.faint, fontFamily: MONO,
                        }}>{active.label.toUpperCase()}</span>
                        <div style={{ flex: 1 }} />
                        <button
                            type="button" className="edge-icon" onClick={() => onOpenChange(false)}
                            aria-label="Close panel"
                            style={{
                                width: 26, height: 26, borderRadius: 6, display: 'grid', placeItems: 'center',
                                cursor: 'pointer', border: '1px solid transparent',
                                background: 'transparent', color: t.faint,
                            }}>
                            <X aria-hidden="true" size={13} strokeWidth={1.9} />
                        </button>
                    </header>

                    {tab === 'entities' ? (
                        <EntityBrowser
                            t={t} query={query} onQuery={onQuery} listed={listed}
                            searching={searching} selectedId={selectedId} onOpenNode={onOpenNode}
                            shownCount={shownCount} hasHits={hasHits}
                        />
                    ) : (
                        <div className="edge-scroll" style={{
                            flex: 1, minHeight: 0, overflowY: 'auto', padding: 14,
                        }}>
                            {tab === 'summary' && (
                                <BrainSummary
                                    status={status} metrics={metrics}
                                    onAsk={() => onTab('ask')}
                                />
                            )}
                            {tab === 'inspect' && (
                                <BrainInspector
                                    detail={detail} loading={detailLoading} error={detailError}
                                    onOpen={onOpenNode} onLocate={onLocate}
                                />
                            )}
                            {tab === 'ask' && (
                                <BrainAsk orgId={orgId} stale={stale} syncedAt={syncedAt} />
                            )}
                            {tab === 'health' && (
                                <BrainHealth
                                    status={status} syncing={syncing} error={actionError}
                                    onSync={onSync} onFullRebuild={onFullRebuild}
                                />
                            )}
                        </div>
                    )}
                </section>
            )}

            {/* The grip is invisible until it is wanted: a permanent bar between
                the graph and the panel would be one more line competing with the
                hairlines that carry the layout. */}
            <style>{`
                .brain-dock-grip:hover,
                .brain-dock-grip:focus-visible { background: ${t.lineStrong} !important; }
                .brain-dock-grip:focus-visible { outline: none; }
            `}</style>
        </div>
    );
}

/* The entity browser is the keyboard and screen-reader path to everything the
   canvas draws, and the fastest way to reach a record whose name you already
   know. Search runs against the database rather than the loaded graph, because
   the canvas holds a capped slice and a record outside that cap must still be
   findable. */
function EntityBrowser({
    t, query, onQuery, listed, searching, selectedId, onOpenNode, shownCount, hasHits,
}) {
    return (
        <>
            <div style={{
                padding: '11px 12px', borderBottom: `1px solid ${t.lineSoft}`, flexShrink: 0,
            }}>
                <Search
                    value={query} onChange={onQuery} width="100%"
                    placeholder="Search employees, invoices, customers…"
                />
                <div style={{ marginTop: 8 }}>
                    <Muted size={9.5}>
                        {searching ? 'Searching…'
                            : hasHits ? `${listed.length} match${listed.length === 1 ? '' : 'es'} in the whole brain`
                                : `${shownCount} on the graph`}
                    </Muted>
                </div>
            </div>

            {listed.length === 0 ? (
                <Empty>
                    {query
                        ? `Nothing in the brain matches “${query}”.`
                        : 'No entities in this domain yet.'}
                </Empty>
            ) : (
                <ul className="edge-scroll" style={{
                    listStyle: 'none', margin: 0, padding: 0, flex: 1, minHeight: 0, overflowY: 'auto',
                }}>
                    {listed.slice(0, 300).map((n) => (
                        <li key={n.id}>
                            <button
                                type="button" className="edge-row"
                                onClick={() => onOpenNode(n)}
                                aria-current={selectedId === n.id ? 'true' : undefined}
                                style={{
                                    display: 'block', width: '100%', padding: '8px 13px',
                                    textAlign: 'left', cursor: 'pointer', border: 'none',
                                    fontFamily: MONO, borderBottom: `1px solid ${t.lineSoft}`,
                                    background: selectedId === n.id ? t.panelAlt : 'transparent',
                                }}>
                                <span style={{
                                    display: 'block', fontSize: 11.5, color: t.text,
                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                }}>{n.label}</span>
                                <span style={{
                                    display: 'block', fontSize: 9, color: t.faint, marginTop: 2,
                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                }}>
                                    {kindLabel(n.kind).toUpperCase()}{n.state ? ` · ${n.state}` : ''}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}

const SR_ONLY = {
    position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
    overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

