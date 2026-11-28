import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbulb, X } from 'lucide-react';
import { useT } from '../ui/edgeUtils';
import { Btn } from '../ui/edge';
import { GUIDES, guideKey } from './pageGuides';
import { useGuideState, dismissGuide, hideAllGuides, countGuideView, guideOpen } from './guideState';

/* ══════════════════════════════════════════════════════════════════════════
   A page's tip: what the page is for and how to start, for people new to
   Opstead. Shown under the page's heading until it is dismissed (Got it),
   or until every tip is turned off (Hide all tips); the account menu's
   "Show page tips again" brings them back. Nothing shows for a page without
   a tip. A tip also retires by itself after a few visits (guideState).
   ══════════════════════════════════════════════════════════════════════════ */

export default function PageGuide({ id, style }) {
    const key = guideKey(id);
    // A fresh tip for each page, so its visit is counted once.
    return key ? <Tip key={key} guide={key} style={style} /> : null;
}

function Tip({ guide: key, style }) {
    const t = useT();
    const state = useGuideState();
    const g = GUIDES[key];
    // Decided when the page opens, so the visit being counted now does not
    // hide the tip while it is being read.
    const [shown] = useState(() => guideOpen(state, key));
    // Once per visit (a ref, so React's development double-run counts it once).
    const counted = useRef(false);
    useEffect(() => {
        if (shown && !counted.current) { counted.current = true; countGuideView(key); }
    }, [shown, key]);
    if (!g || !shown || state.off || state.done.includes(key)) return null;

    const link = {
        background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit',
        fontSize: 12, color: t.faint, textDecoration: 'underline', textUnderlineOffset: 3,
    };
    return (
        <section role="note" aria-label={`About this page: ${g.title}`} className="page-guide" style={{
            position: 'relative', display: 'grid', gap: 12, padding: '14px 16px 14px 14px', borderRadius: 12,
            border: '1px solid color-mix(in srgb, ' + t.accent + ' 22%, ' + t.line + ')',
            background: 'color-mix(in srgb, ' + t.accent + ' ' + (t.isDark ? 9 : 5) + '%, ' + t.card + ')',
            ...style,
        }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', paddingRight: 28 }}>
                <span aria-hidden="true" style={{
                    width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'grid', placeItems: 'center',
                    background: t.accentSoft, color: t.accent,
                }}><Lightbulb size={16} strokeWidth={1.8} /></span>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: t.text, lineHeight: 1.35 }}>{g.title}</div>
                    <p style={{ margin: '3px 0 0', fontSize: 12.5, color: t.dim, lineHeight: 1.55, maxWidth: 820 }}>{g.body}</p>
                </div>
            </div>
            {g.steps?.length > 0 && (
                <ol style={{
                    listStyle: 'none', margin: 0, padding: '0 0 0 42px', display: 'grid', gap: '8px 18px',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                }}>
                    {g.steps.map((s, i) => (
                        <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: t.text, lineHeight: 1.5, minWidth: 0 }}>
                            <span aria-hidden="true" style={{
                                width: 18, height: 18, borderRadius: 99, flexShrink: 0, marginTop: 1, display: 'grid', placeItems: 'center',
                                fontSize: 10.5, fontWeight: 700, color: t.accent, background: t.accentSoft,
                            }}>{i + 1}</span>
                            <span style={{ minWidth: 0 }}>{s}</span>
                        </li>
                    ))}
                </ol>
            )}
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', paddingLeft: 42 }}>
                <Link to="/help/guides" style={{ ...link, marginRight: 'auto' }}>Every tip is in Help &amp; Support</Link>
                <button type="button" onClick={hideAllGuides} style={link}>Hide all tips</button>
                <Btn primary size="sm" onClick={() => dismissGuide(key)}>Got it</Btn>
            </div>
            <button type="button" onClick={() => dismissGuide(key)} aria-label="Close this tip" title="Close"
                style={{
                    position: 'absolute', top: 10, right: 10, width: 26, height: 26, borderRadius: 7, display: 'grid', placeItems: 'center',
                    background: 'transparent', border: 'none', color: t.faint, cursor: 'pointer',
                }}><X size={15} /></button>
        </section>
    );
}
