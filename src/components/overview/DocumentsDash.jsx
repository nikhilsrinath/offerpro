import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Briefcase, Award, ShieldCheck, Receipt, FolderOpen, ChevronRight } from 'lucide-react';
import { MONO } from '../ui/edgeUtils';
import { libraryService, categoryLabel } from '../../services/libraryService';
import { DOC_GROUPS, docGroupOf, fmtDay, fmtShort } from './overviewModel';
import { Columns, CalendarHeat, RankBars, SplitBar, EmptyNote } from './vizKit';
import { Dashboard, Card, Tile, Figure, More, TileRow, CardGrid, ListRow } from './dashKit';

/* ══════════════════════════════════════════════════════════════════════════
   Dashboard · Documents — everything the company has issued or keeps.

   Issued documents (HR letters and financial documents) follow the period;
   offer responses and the library are today's state.
   ══════════════════════════════════════════════════════════════════════════ */

// The four states a reader distinguishes, as the Recruitment Tracker has them.
const OFFER_STATE = (s) => (['signed', 'accepted', 'acknowledged', 'fully_signed'].includes(s) ? 'accepted'
    : s === 'declined' ? 'declined'
        : ['sent', 'viewed'].includes(s) ? 'awaiting'
            : s === 'cancelled' ? 'cancelled' : 'unsent');

const ROUTE = { invoice: '/invoices', quotation: '/quotations', proforma: '/proforma' };

export default function DocumentsDash() {
    return <Dashboard>{(ctx) => <DocumentsBody {...ctx} />}</Dashboard>;
}

function DocumentsBody({ model, open, navigate, t, cat, status, cols, grid, tileCols, orgId }) {
    const [mixFocus, setMixFocus] = useState(null);
    const [library, setLibrary] = useState(undefined);
    useEffect(() => {
        let alive = true;
        libraryService.list(orgId).then((r) => { if (alive) setLibrary(r); }).catch(() => { if (alive) setLibrary(null); });
        return () => { alive = false; };
    }, [orgId]);

    const group = (id) => model.docGroups.find((g) => g.id === id)?.count || 0;
    const mixSeries = DOC_GROUPS.map((g, i) => ({ key: g.id, label: g.label, color: cat[i] })).filter((s) => !mixFocus || s.key === mixFocus);
    const mixData = model.series.map((s) => ({ ...s, ...s.byGroup }));

    const offers = useMemo(() => {
        const rows = model.raw.records.filter((r) => r.type === 'offer' || r.type === 'offer_letter');
        const c = { unsent: 0, awaiting: 0, accepted: 0, declined: 0, cancelled: 0 };
        rows.forEach((r) => { c[OFFER_STATE(r.status)] += 1; });
        const decided = c.accepted + c.declined;
        return { total: rows.length, c, rate: decided ? (c.accepted / decided) * 100 : null };
    }, [model.raw.records]);

    const lib = useMemo(() => {
        if (!library) return null;
        const byCat = new Map();
        library.forEach((d) => byCat.set(d.category || 'general', (byCat.get(d.category || 'general') || 0) + 1));
        const st = { ready: 0, processing: 0, failed: 0, other: 0 };
        library.forEach((d) => {
            const s = d.extraction_status;
            if (s === 'ready' || s === 'partial') st.ready += 1;
            else if (s === 'processing' || s === 'pending') st.processing += 1;
            else if (s === 'failed') st.failed += 1;
            else st.other += 1;
        });
        return {
            total: library.length,
            bytes: library.reduce((a, d) => a + (Number(d.size_bytes) || 0), 0),
            cats: [...byCat.entries()].map(([k, v]) => ({ key: k, name: categoryLabel(k), value: v })).sort((a, b) => b.value - a.value),
            st,
        };
    }, [library]);

    const { from, to } = model.period;
    const recent = model.raw.docsTimeline.filter((e) => e.date >= from && e.date <= to)
        .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
    const finCount = group('invoice') + group('quotation') + group('proforma');

    return (<>
        <TileRow cols={tileCols(6)}>
            <Tile icon={FileText} label="Issued" value={String(model.docTotal)} exact={`${model.docTotal} documents`}
                foot="HR letters + financial documents" spark={model.series.map((s) => s.docs)} sparkBars color={cat[0]}
                onClick={() => open({ kind: 'bucket', index: model.series.length - 1 })} />
            <Tile icon={Briefcase} label="Offer letters" value={String(group('offer'))} exact={`${group('offer')} in period`}
                foot={`${offers.c.awaiting} awaiting a reply`} onClick={() => open({ kind: 'docs', id: 'offer' })} />
            <Tile icon={Award} label="Certificates" value={String(group('certificate'))} exact={`${group('certificate')} in period`}
                foot="issued in period" onClick={() => open({ kind: 'docs', id: 'certificate' })} />
            <Tile icon={ShieldCheck} label="Agreements" value={String(group('agreement'))} exact={`${group('agreement')} in period`}
                foot="NDAs, MoUs and notices" onClick={() => open({ kind: 'docs', id: 'agreement' })} />
            <Tile icon={Receipt} label="Financial" value={String(finCount)} exact={`${finCount} in period`}
                foot={`${group('invoice')} invoices · ${group('quotation')} quotes`} onClick={() => open({ kind: 'docs', id: 'invoice' })} />
            <Tile icon={FolderOpen} label="Library" value={lib ? String(lib.total) : '—'} exact={lib ? `${lib.total} files` : 'not available'}
                foot={library === undefined ? 'loading…' : lib ? `${fmtBytes(lib.bytes)} stored` : 'not available to your role'}
                onClick={() => navigate('/library')} />
        </TileRow>

        <CardGrid cols={cols}>
            <Card title="Documents issued" note={`${model.docTotal} in period · click a type to isolate`} style={grid(2)}>
                <Columns data={mixData} series={mixSeries} stacked height={220} format={(v) => String(Math.round(v))} tipFormat={(v) => String(v)}
                    onSelect={(i) => open({ kind: 'bucket', index: i })} />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                    {model.docGroups.map((g, i) => {
                        const on = mixFocus === g.id;
                        return (
                            <button key={g.id} type="button" className="ov-chip" onClick={() => setMixFocus(on ? null : g.id)} aria-pressed={on}
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 26, padding: '4px 9px', borderRadius: 7, cursor: 'pointer',
                                    border: '1px solid ' + (on ? t.lineStrong : t.line), background: on ? t.panelAlt : t.panel,
                                    fontFamily: MONO, fontSize: 10.5, color: mixFocus && !on ? t.dim : t.text,
                                }}>
                                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: cat[i] }} />
                                {g.label}<b style={{ fontWeight: 600 }}>{g.count}</b>
                            </button>
                        );
                    })}
                    {mixFocus && (
                        <button type="button" className="ov-chip" onClick={() => open({ kind: 'docs', id: mixFocus })} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 26, padding: '4px 9px', borderRadius: 7, cursor: 'pointer',
                            border: '1px solid ' + t.text, background: t.text, color: t.panel, fontFamily: MONO, fontSize: 10.5,
                        }}>Analyse {DOC_GROUPS.find((g) => g.id === mixFocus)?.label.toLowerCase()} <ChevronRight aria-hidden="true" size={11} /></button>
                    )}
                </div>
            </Card>

            <Card title="Activity" note="documents per day · last 26 weeks">
                <CalendarHeat days={model.calendar} onSelect={(d) => open({ kind: 'day', date: d.date })} />
                <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
                    <Figure label="active days" value={String(model.calendar.filter((d) => d.count).length)} />
                    <Figure label="busiest day" value={(() => { const b = model.calendar.reduce((m, d) => (d.count > m.count ? d : m), { count: 0 }); return b.count ? `${b.count} · ${fmtDay(b.date).slice(0, 6)}` : '—'; })()} />
                </div>
            </Card>

            <Card title="Offer responses" note="every offer letter · today" right={<More label="Tracker" to="/offer-tracker" />}>
                {offers.total === 0 ? <EmptyNote>No offer letters yet</EmptyNote> : (<>
                    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12 }}>
                        <Figure big label="acceptance" value={offers.rate === null ? '—' : `${offers.rate.toFixed(0)}%`} />
                        <Figure big label="awaiting" value={String(offers.c.awaiting)} />
                        <Figure big label="total" value={String(offers.total)} />
                    </div>
                    <SplitBar format={(v) => String(v)} unit="Offers" parts={[
                        { id: 'accepted', label: 'Accepted', value: offers.c.accepted, color: status.good },
                        { id: 'awaiting', label: 'Sent, awaiting', value: offers.c.awaiting, color: cat[0] },
                        { id: 'unsent', label: 'Not sent', value: offers.c.unsent, color: t.faint },
                        { id: 'declined', label: 'Declined', value: offers.c.declined, color: status.critical },
                        { id: 'cancelled', label: 'Cancelled', value: offers.c.cancelled, color: t.ghost },
                    ].filter((p) => p.value > 0)} onSelect={() => navigate('/offer-tracker')} />
                </>)}
            </Card>

            <Card title="Mix" note="documents issued in period, by type">
                <RankBars rows={model.docGroups.map((g, i) => ({ key: g.id, name: g.label, value: g.count, color: cat[i] }))}
                    format={(v) => String(v)} total={model.docTotal} onSelect={(r) => open({ kind: 'docs', id: r.key })} empty="Nothing issued in this period" />
            </Card>

            <Card title="General documents" note="the library EdgeBrain reads" right={<More label="Library" to="/library" />}>
                {library === undefined ? <EmptyNote>Loading…</EmptyNote> : !lib ? <EmptyNote>The library is not available to your role</EmptyNote>
                    : lib.total === 0 ? <EmptyNote>No files in the library yet</EmptyNote> : (<>
                        <RankBars rows={lib.cats} format={(v) => String(v)} total={lib.total} max={5} color={cat[3]} onSelect={() => navigate('/library')} />
                        <div style={{ fontSize: 9, letterSpacing: '0.1em', color: t.faint, margin: '12px 0 6px' }}>READ BY EDGEBRAIN</div>
                        <SplitBar format={(v) => String(v)} unit="Files" parts={[
                            { id: 'ready', label: 'Readable', value: lib.st.ready, color: status.good },
                            { id: 'processing', label: 'Reading', value: lib.st.processing, color: cat[0] },
                            { id: 'failed', label: 'Could not read', value: lib.st.failed, color: status.critical },
                            { id: 'other', label: 'Stored, not readable', value: lib.st.other, color: t.faint },
                        ].filter((p) => p.value > 0)} onSelect={() => navigate('/library')} />
                    </>)}
            </Card>

            <Card title="Latest issued" note="most recent in period" right={<More label="Records" to="/records" />}>
                {recent.length === 0 ? <EmptyNote>Nothing issued in this period</EmptyNote> : recent.map((e) => (
                    <ListRow key={e.type + e.id} label={e.title}
                        sub={`${DOC_GROUPS.find((g) => g.id === docGroupOf(e.type))?.label || e.type}${e.number ? ' · ' + e.number : ''} · ${fmtDay(e.date)}`}
                        value={e.amount ? fmtShort(e.amount) : e.status || null}
                        onClick={() => navigate(ROUTE[e.type] || '/records')} />
                ))}
            </Card>
        </CardGrid>
    </>);
}

function fmtBytes(b) {
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
    if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
    return `${(b / 1073741824).toFixed(2)} GB`;
}
