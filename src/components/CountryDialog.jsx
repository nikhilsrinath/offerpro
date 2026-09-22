import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { X, ArrowUp, ArrowDown, ArrowUpRight, ChevronRight } from 'lucide-react';
import { periodRange } from '../services/salesGeoService';
import { docNumber } from '../services/documentStore';
import {
    countsAsIncome, categoryLabel, groupOf, rowTreatment,
    TREATMENTS, INCOME_TREATMENTS,
} from '../services/financeCategories';

/* ══════════════════════════════════════════════════════════════════════════
   Country drill-down for the Hub's Revenue by Geography map.
   Left: the tapped country's outline, alone. Right: one tab at a time —
   Overview, Customers, Documents, Products — so the pane answers a single
   question instead of showing every figure at once.

   Revenue uses the same definition as sales_by_country() after 0042: issued
   invoices in a sold state PLUS cash-book receipts that were earned and are not
   the collection of an invoice. The headline prefers the RPC row the map was
   drawn from, so the dialog can never disagree with the tooltip that led here.

   Money in that was not earned - funding, a loan, a refund - and money out are
   both shown, in the Cash book tab and summarised on the Overview, but neither
   is added to revenue.
   ══════════════════════════════════════════════════════════════════════════ */

const SOLD = new Set(['sent', 'viewed', 'partially_paid', 'overdue', 'paid', 'payment_submitted']);
const LIVE_OFFER_DEAD = new Set(['cancelled', 'expired', 'declined', 'draft']);
const DOC_ROUTE = { invoice: '/invoices', quotation: '/quotations', proforma: '/proforma' };

const fmtCompact = (n) => {
    const v = Math.round(n || 0);
    const a = Math.abs(v);
    if (a >= 10000000) return (v / 10000000).toFixed(2) + 'Cr';
    if (a >= 100000)   return (v / 100000).toFixed(2) + 'L';
    if (a >= 1000)     return (v / 1000).toFixed(1) + 'k';
    return String(v);
};
const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const dateOf = (d) => String(d.issue_date || d.created_at || '').slice(0, 10);
const val = (d) => Number(d.grand_total || d.amount || d.subtotal || 0);
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

/* The outline, fitted to its own bounding box. getBBox is the only reliable
   way to frame an arbitrary projected path without parsing it. */
function Outline({ t, d, fill }) {
    const ref = useRef(null);
    const [box, setBox] = useState(null);
    useLayoutEffect(() => {
        if (!ref.current) return;
        const b = ref.current.getBBox();
        const pad = Math.max(b.width, b.height) * 0.08 + 1;
        setBox([b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2]);
    }, [d]);
    return (
        <svg
            viewBox={box ? box.join(' ') : '0 0 960 480'}
            preserveAspectRatio="xMidYMid meet"
            style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}
        >
            <path
                ref={ref} d={d} fill={fill} stroke={t.text}
                strokeWidth={1.2} vectorEffect="non-scaling-stroke" strokeLinejoin="round"
                style={{ opacity: box ? 1 : 0, transition: 'opacity .25s' }}
            />
        </svg>
    );
}

function Tabs({ t, font, tabs, value, onChange }) {
    return (
        <div role="tablist" style={{
            display: 'flex', gap: 2, padding: '0 10px', borderBottom: '1px solid ' + t.line,
            flexShrink: 0, overflowX: 'auto',
        }}>
            {tabs.map((tb) => {
                const on = tb.id === value;
                return (
                    <button
                        key={tb.id} type="button" role="tab" aria-selected={on}
                        onClick={() => onChange(tb.id)} className="cd-tab"
                        style={{
                            fontFamily: font, fontSize: 11, padding: '10px 8px 9px', background: 'transparent',
                            border: 'none', borderBottom: '1.5px solid ' + (on ? t.text : 'transparent'),
                            marginBottom: -1, color: on ? t.text : t.faint, cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                            transition: 'color .15s, border-color .15s',
                        }}
                    >
                        {tb.label}
                        {tb.count !== undefined && (
                            <span style={{
                                fontSize: 9, padding: '1px 5px', borderRadius: 4, lineHeight: 1.4,
                                background: on ? t.selBg : t.raised, color: on ? t.selText : t.faint,
                            }}>{tb.count}</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

/* One label/value line. Rows with more behind them carry a chevron and open it. */
function Row({ t, label, value, note, onClick, tone }) {
    const Tag = onClick ? 'button' : 'div';
    return (
        <Tag
            type={onClick ? 'button' : undefined} onClick={onClick}
            className={onClick ? 'cd-row' : undefined}
            style={{ ...listRow(t), cursor: onClick ? 'pointer' : 'default' }}
        >
            <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: t.dim }}>{label}</span>
            {note ? (
                <span style={{ fontSize: 9.5, color: t.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '45%' }}>{note}</span>
            ) : null}
            <span style={{ fontSize: 11.5, color: tone || t.text, whiteSpace: 'nowrap' }}>{value}</span>
            <ChevronRight size={12} style={{ color: onClick ? t.faint : 'transparent', flexShrink: 0 }} />
        </Tag>
    );
}

const Label = ({ t, children, right }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 9, color: t.faint, letterSpacing: '0.08em', marginBottom: 8 }}>
        <span>{children}</span>
        {right ? <span style={{ marginLeft: 'auto', letterSpacing: 0 }}>{right}</span> : null}
    </div>
);

const Empty = ({ t, children }) => (
    <div style={{ padding: '48px 12px', fontSize: 10.5, color: t.faint, textAlign: 'center' }}>{children}</div>
);

const Bar = ({ t, pct }) => (
    <span style={{ display: 'block', height: 3, background: t.scale[0], borderRadius: 2, marginTop: 7, overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: pct + '%', background: t.scale[4] }} />
    </span>
);

export default function CountryDialog({
    t, font, code, name, path, geoRow, rank, marketCount,
    period, periods, onPeriod, finDocs, clients, isMobile, onClose, onNavigate,
    income = [], expenses = [],
}) {
    const [hoverBar, setHoverBar] = useState(null);
    const [tab, setTab] = useState('overview');

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const api = periods.find((p) => p.id === period)?.api || '12m';

    const m = useMemo(() => {
        const { from, to } = periodRange(api);
        const today = new Date().toISOString().slice(0, 10);
        const inCountry = finDocs.filter((d) => String(d.country_code || d.country || '').toUpperCase() === code);
        const inWindow = inCountry.filter((d) => { const k = dateOf(d); return k >= from && k <= to; });

        const sold = inWindow.filter((d) => d.type === 'invoice' && SOLD.has(d.status));
        const paidOf = (d) => (d.status === 'paid' ? val(d) : Number(d.amount_paid) || 0);
        const revenue = sold.reduce((a, d) => a + val(d), 0);
        const collected = sold.reduce((a, d) => a + paidOf(d), 0);
        const outstanding = Math.max(0, revenue - collected);
        const overdue = new Set(sold.filter((d) => d.status !== 'paid'
            && (d.status === 'overdue' || (d.due_date && d.due_date < today))));
        const overdueAmount = [...overdue].reduce((a, d) => a + val(d) - (Number(d.amount_paid) || 0), 0);
        const offers = inWindow.filter((d) => (d.type === 'quotation' || d.type === 'proforma') && !LIVE_OFFER_DEAD.has(d.status));
        const pipeline = offers.reduce((a, d) => a + val(d), 0);

        // customers — keyed by customer_id, falling back to the billed name so
        // invoices with no linked client still count
        const clientById = new Map(clients.map((c) => [c.id, c]));
        const byCust = new Map();
        sold.forEach((d) => {
            const key = d.customer_id || 'name:' + (d.clientName || 'Unnamed');
            const known = clientById.get(d.customer_id);
            const c = byCust.get(key) || {
                key, id: d.customer_id || null,
                name: known?.name || d.clientName || 'Unnamed',
                contact: known?.person_name || null,
                email: known?.email || d.clientEmail || null,
                revenue: 0, paid: 0, count: 0, last: '',
            };
            c.revenue += val(d);
            c.paid += paidOf(d);
            c.count += 1;
            if (dateOf(d) > c.last) c.last = dateOf(d);
            byCust.set(key, c);
        });
        const customers = [...byCust.values()].sort((a, b) => b.revenue - a.revenue);
        const directory = clients.filter((c) => String(c.country_code || '').toUpperCase() === code && !c.archived_at);
        const dormant = directory.filter((c) => !byCust.has(c.id));

        // products — line totals, pre-tax, like the product filter on the RPC
        const byItem = new Map();
        sold.forEach((d) => (d.items || []).forEach((li) => {
            const k = (li.description || 'Untitled item').trim();
            const p = byItem.get(k) || { name: k, amount: 0, qty: 0 };
            p.amount += Number(li.amount) || (Number(li.quantity) || 0) * (Number(li.rate) || 0);
            p.qty += Number(li.quantity) || 0;
            byItem.set(k, p);
        }));
        const products = [...byItem.values()].sort((a, b) => b.amount - a.amount);

        // trend — daily for 30D, monthly otherwise
        const trend = [];
        if (api === '30d') {
            for (let i = 29; i >= 0; i--) {
                const dt = new Date(); dt.setDate(dt.getDate() - i);
                const k = dt.toISOString().slice(0, 10);
                trend.push({
                    label: dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
                    value: sold.filter((d) => dateOf(d) === k).reduce((a, d) => a + val(d), 0),
                    key: k,
                });
            }
        } else {
            const months = api === '3m' ? 3 : api === '6m' ? 6 : 12;
            const now = new Date();
            for (let i = months - 1; i >= 0; i--) {
                const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const k = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
                trend.push({
                    label: dt.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
                    value: sold.filter((d) => dateOf(d).slice(0, 7) === k).reduce((a, d) => a + val(d), 0),
                    key: k,
                });
            }
        }

        const docs = inWindow.slice().sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
        const currencies = [...new Set(inWindow.map((d) => d.currency).filter(Boolean))];

        return {
            revenue, collected, outstanding, overdue, overdueAmount, pipeline, offers,
            invoiceCount: sold.length, customers, dormant, products, trend, docs,
            currencies, from, to, sold,
        };
    }, [finDocs, clients, code, api]);

    /* ── the cash book, for this country and this window ──────────────────────
       Kept in its own memo rather than folded into the one above: it depends on
       different inputs, and a country's invoices should not be recomputed
       because somebody recorded an unrelated expense.

       Everything here is GROSS, matching the document side - a document
       contributes grand_total, which includes GST - so the two can be added
       without being wrong by exactly the tax. */
    const cash = useMemo(() => {
        const { from, to } = periodRange(api);
        const here = (r) => String(r.country_code || '').toUpperCase() === code;
        const within = (d) => { const k = String(d || '').slice(0, 10); return k >= from && k <= to; };
        const gross = (r) => Number(r.amount) || 0;

        const ins = income.filter((r) => here(r) && within(r.date || r.received_on));
        // status 'pending' is an expense that has not been paid: no cash has
        // moved, so it has no place on a cash report.
        const outs = expenses.filter((r) => here(r) && r.status !== 'pending'
            && within(r.paid_on || r.date || r.incurred_on));

        const sum = (rows) => rows.reduce((a, r) => a + gross(r), 0);
        const earned = ins.filter(countsAsIncome);

        // One bucket per treatment, so "₹2L came in" can always be answered
        // with "and only ₹1.4L of it was a sale".
        const byTreatment = (rows, dir) => {
            const map = new Map();
            rows.forEach((r) => {
                const key = rowTreatment(r, dir);
                const b = map.get(key) || {
                    key, label: TREATMENTS[key]?.label || key, amount: 0, count: 0,
                };
                b.amount += gross(r);
                b.count += 1;
                map.set(key, b);
            });
            return [...map.values()].sort((a, b) => b.amount - a.amount);
        };

        // And one per category group, which is the layer a person actually
        // recognises: "People & labour", not "operating".
        // No direction argument: groupOf() is keyed on the category alone, and
        // an income key and an expense key can never collide.
        const byGroup = (rows) => {
            const map = new Map();
            rows.forEach((r) => {
                const key = groupOf(r.category) || 'Other';
                const b = map.get(key) || { key, amount: 0, count: 0, items: new Map() };
                b.amount += gross(r);
                b.count += 1;
                const label = categoryLabel(r.category) || r.category;
                b.items.set(label, (b.items.get(label) || 0) + gross(r));
                map.set(key, b);
            });
            return [...map.values()]
                .map((b) => ({
                    ...b,
                    items: [...b.items.entries()]
                        .map(([label, amount]) => ({ label, amount }))
                        .sort((a, b2) => b2.amount - a.amount),
                }))
                .sort((a, b) => b.amount - a.amount);
        };

        const byMethod = (rows) => {
            const map = new Map();
            rows.forEach((r) => {
                const key = (r.payment_method || 'other').replace(/_/g, ' ');
                map.set(key, (map.get(key) || 0) + gross(r));
            });
            return [...map.entries()].map(([label, amount]) => ({ label, amount }))
                .sort((a, b) => b.amount - a.amount);
        };

        const cashIn = sum(ins);
        const cashOut = sum(outs);
        const entries = [
            ...ins.map((r) => ({ ...r, dir: 'in', on: r.date || r.received_on })),
            ...outs.map((r) => ({ ...r, dir: 'out', on: r.paid_on || r.date || r.incurred_on })),
        ].sort((a, b) => String(b.on).localeCompare(String(a.on)));

        return {
            ins, outs, entries,
            direct: sum(earned),
            directCount: earned.length,
            cashIn, cashOut, netCash: cashIn - cashOut,
            notEarned: cashIn - sum(earned),
            taxIn: ins.reduce((a, r) => a + (Number(r.tax_amount) || 0), 0),
            taxOut: outs.reduce((a, r) => a + (Number(r.tax_amount) || 0), 0),
            inByTreatment: byTreatment(ins, 'in'),
            outByGroup: byGroup(outs),
            inByGroup: byGroup(ins),
            methodsIn: byMethod(ins),
            // Only the spend that is actually a cost. capex buys an asset and
            // financing repays a loan; neither belongs in a margin.
            operatingOut: outs.filter((r) => rowTreatment(r, 'out') === 'operating')
                .reduce((a, r) => a + gross(r), 0),
            currencies: [...new Set([...ins, ...outs].map((r) => r.currency)
                .filter((c) => c && c !== 'INR'))],
        };
    }, [income, expenses, code, api]);

    // The document figures plus the cash book, which is what 0042's `revenue`
    // means. Computed locally as well so the dialog still adds up when the RPC
    // is unavailable and the Hub fell back to the client cache.
    const localRevenue = m.revenue + cash.direct;
    const revenue = geoRow ? geoRow.revenue : localRevenue;
    // A direct receipt is money already in hand, so it is collected by
    // definition - there is nothing left to chase on it.
    const collected = m.collected + cash.direct;
    const prev = geoRow?.prevRevenue || 0;
    const growth = prev > 0 ? ((revenue - prev) / prev) * 100 : null;
    const collectedPct = localRevenue > 0 ? Math.min(100, (collected / localRevenue) * 100) : 0;
    // Net margin on the cash that actually moved: earned income less the spend
    // that is genuinely a cost. Deliberately not "revenue - everything out".
    const marginBase = localRevenue;
    const netHere = localRevenue - cash.operatingOut;
    // The bars are documents + direct receipts, bucketed on the same key the
    // document side used: a full date for 30D, a year-month otherwise.
    const trend = useMemo(() => m.trend.map((b) => {
        const extra = cash.ins.filter(countsAsIncome).reduce((a, r) => {
            const k = String(r.date || r.received_on || '').slice(0, b.key.length);
            return k === b.key ? a + (Number(r.amount) || 0) : a;
        }, 0);
        return { ...b, value: b.value + extra, direct: extra };
    }), [m.trend, cash.ins]);

    const trendMax = Math.max(...trend.map((x) => x.value), 1);
    const fill = t.scale[geoRow?.level || 0];

    const go = (to) => { onClose(); onNavigate(to); };

    return (
        <div
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
            style={{
                position: 'fixed', inset: 0, zIndex: 200,
                background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)',
                display: 'grid', placeItems: 'center',
                padding: isMobile ? 10 : 28, fontFamily: font, color: t.text,
                animation: 'cdFade .16s ease-out',
            }}
        >
            <div
                role="dialog" aria-modal="true" aria-label={name + ' market detail'}
                style={{
                    width: 'min(1040px, 100%)', height: isMobile ? '100%' : 'min(680px, 100%)',
                    background: t.panel, border: '1px solid ' + t.lineStrong, borderRadius: 12,
                    boxShadow: t.shadow, overflow: 'hidden',
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) minmax(0, 1.1fr)',
                    gridTemplateRows: isMobile ? 'auto minmax(0, 1fr)' : 'minmax(0, 1fr)',
                    animation: 'cdRise .2s cubic-bezier(.16,1,.3,1)',
                }}
            >
                {/* ── LEFT: outline ─────────────────────────────────────── */}
                <div style={{
                    position: 'relative', display: 'flex', flexDirection: 'column',
                    background: t.panelAlt,
                    borderRight: isMobile ? 'none' : '1px solid ' + t.line,
                    borderBottom: isMobile ? '1px solid ' + t.line : 'none',
                    padding: isMobile ? '14px 14px 12px' : '22px 24px',
                    minHeight: 0,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                            fontSize: 9.5, color: t.faint, border: '1px solid ' + t.line,
                            borderRadius: 4, padding: '2px 5px', letterSpacing: '0.06em',
                        }}>{code}</span>
                        {rank ? <span style={{ fontSize: 9.5, color: t.faint }}>#{rank} of {marketCount} markets</span> : null}
                        {isMobile && (
                            <button type="button" onClick={onClose} aria-label="Close" style={closeBtn(t)}><X size={14} /></button>
                        )}
                    </div>

                    <div style={{
                        flex: 1, minHeight: isMobile ? 110 : 0, maxHeight: isMobile ? 140 : 'none',
                        padding: isMobile ? '10px 22%' : '28px 12px', display: 'flex',
                    }}>
                        {path ? <Outline t={t} d={path} fill={fill} /> : (
                            <div style={{ margin: 'auto', fontSize: 10.5, color: t.faint }}>no outline for {code}</div>
                        )}
                    </div>

                    <div>
                        <div style={{ fontSize: isMobile ? 20 : 28, letterSpacing: '-0.05em', lineHeight: 1.05 }}>{name}</div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: isMobile ? 16 : 20, letterSpacing: '-0.04em' }}>{inr(revenue)}</span>
                            {growth !== null && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10.5, color: growth >= 0 ? t.up : t.down }}>
                                    {growth >= 0 ? <ArrowUp size={10} strokeWidth={2.8} /> : <ArrowDown size={10} strokeWidth={2.8} />}
                                    {Math.abs(growth).toFixed(1)}% vs prev
                                </span>
                            )}
                        </div>
                        <div style={{ fontSize: 9.5, color: t.faint, marginTop: 4 }}>
                            {(geoRow?.share || 0).toFixed(1)}% of total revenue
                            {m.currencies.length ? ' · billed in ' + m.currencies.join(', ') : ''}
                            {cash.currencies.length ? ' · cash in ' + cash.currencies.join(', ') : ''}
                        </div>
                    </div>
                </div>

                {/* ── RIGHT: header · tabs · scrolling body · nav ──────── */}
                <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 12px 8px 16px', borderBottom: '1px solid ' + t.line, flexShrink: 0,
                    }}>
                        <span style={{ fontSize: 12.5 }}>Market detail</span>
                        <span style={{ flex: 1 }} />
                        <div style={{ display: 'flex', gap: 1 }}>
                            {periods.map((p) => {
                                const on = p.id === period;
                                return (
                                    <button key={p.id} type="button" onClick={() => onPeriod(p.id)} className="nm-seg" style={{
                                        fontFamily: font, fontSize: 9.5, fontWeight: 500, height: 20, padding: '0 6px',
                                        border: '1px solid ' + (on ? t.lineStrong : 'transparent'),
                                        background: on ? t.selBg : 'transparent', color: on ? t.selText : t.faint,
                                        borderRadius: 5, cursor: 'pointer',
                                    }}>{p.id}</button>
                                );
                            })}
                        </div>
                        {!isMobile && (
                            <button type="button" onClick={onClose} aria-label="Close" style={closeBtn(t)}><X size={14} /></button>
                        )}
                    </div>

                    <Tabs t={t} font={font} value={tab} onChange={setTab} tabs={[
                        { id: 'overview', label: 'Overview' },
                        { id: 'customers', label: 'Customers', count: m.customers.length },
                        { id: 'documents', label: 'Documents', count: m.docs.length },
                        { id: 'products', label: 'Products', count: m.products.length },
                        { id: 'cash', label: 'Cash book', count: cash.entries.length },
                    ]} />

                    {/* flex:1 + minHeight:0 is what lets this pane scroll; without
                        them the flex children shrink to fit and nothing scrolls */}
                    <div key={tab} className="nm-scroll" style={{
                        flex: 1, minHeight: 0, overflowY: 'auto',
                        padding: '18px 16px 22px', animation: 'cdFade .15s ease-out',
                    }}>
                        {tab === 'overview' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                                {/* billed → collected → outstanding, on one bar */}
                                <div>
                                    <Label t={t} right={cash.direct > 0
                                        ? <span style={{ letterSpacing: 0 }}>
                                            {inr(m.revenue)} invoiced · {inr(cash.direct)} direct
                                          </span>
                                        : null}>EARNED THIS PERIOD</Label>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12 }}>
                                        {[
                                            ['Revenue', revenue, t.text],
                                            ['Collected', collected, t.text],
                                            ['Outstanding', m.outstanding, m.outstanding > 0 ? t.text : t.faint],
                                        ].map(([k, v, c]) => (
                                            <div key={k} style={{ minWidth: 0 }}>
                                                <div style={{ fontSize: 10, color: t.faint, marginBottom: 5 }}>{k}</div>
                                                <div title={inr(v)} style={{
                                                    fontSize: isMobile ? 16 : 20, letterSpacing: '-0.045em', color: c,
                                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                                }}>₹{fmtCompact(v)}</div>
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ height: 5, background: t.scale[0], borderRadius: 3, overflow: 'hidden', marginTop: 14 }}>
                                        <div style={{ height: '100%', width: collectedPct + '%', background: t.text, transition: 'width .4s cubic-bezier(.16,1,.3,1)' }} />
                                    </div>
                                    <div style={{ fontSize: 9.5, color: t.faint, marginTop: 6 }}>
                                        {collectedPct.toFixed(0)}% collected
                                        {cash.direct > 0 ? ' · direct receipts counted as collected' : ''}
                                    </div>
                                </div>

                                {/* CASH MOVED - a different question from "what did
                                    we earn", and answered separately for that reason.
                                    Hidden entirely when this country has no cash book,
                                    so an invoice-only market sees the pane it always
                                    saw rather than three zeroes. */}
                                {(cash.cashIn > 0 || cash.cashOut > 0) && (
                                    <div>
                                        <Label t={t} right={(cash.ins.length + cash.outs.length)
                                            + ' entries'}>CASH MOVED HERE</Label>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12 }}>
                                            {[
                                                ['In', cash.cashIn, t.text],
                                                ['Out', cash.cashOut, cash.cashOut > 0 ? t.down : t.faint],
                                                [cash.netCash >= 0 ? 'Net' : 'Net out', Math.abs(cash.netCash),
                                                    cash.netCash >= 0 ? t.up : t.down],
                                            ].map(([k, v, c]) => (
                                                <div key={k} style={{ minWidth: 0 }}>
                                                    <div style={{ fontSize: 10, color: t.faint, marginBottom: 5 }}>{k}</div>
                                                    <div title={inr(v)} style={{
                                                        fontSize: isMobile ? 16 : 20, letterSpacing: '-0.045em', color: c,
                                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                                    }}>₹{fmtCompact(v)}</div>
                                                </div>
                                            ))}
                                        </div>
                                        <div style={{ fontSize: 9.5, color: t.faint, marginTop: 8, lineHeight: 1.5 }}>
                                            {cash.notEarned > 0
                                                ? inr(cash.notEarned) + ' of the money in was not earned — funding, a refund or an invoice being settled — so it is not in revenue. '
                                                : ''}
                                            {cash.operatingOut > 0
                                                ? inr(cash.operatingOut) + ' of the money out is a running cost; the rest bought an asset, repaid a loan or was tax or a drawing.'
                                                : ''}
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <Label t={t} right={hoverBar !== null && trend[hoverBar]
                                        ? (
                                            <span style={{ color: t.text }}>
                                                {trend[hoverBar].label} · {inr(trend[hoverBar].value)}
                                                {trend[hoverBar].direct > 0
                                                    ? ' (incl ' + inr(trend[hoverBar].direct) + ' direct)' : ''}
                                            </span>
                                        )
                                        : (api === '30d' ? 'daily' : 'monthly')}>REVENUE TREND</Label>
                                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 96 }}>
                                        {trend.map((b, i) => (
                                            <div key={i}
                                                 onMouseEnter={() => setHoverBar(i)} onMouseLeave={() => setHoverBar(null)}
                                                 style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', cursor: 'crosshair' }}>
                                                <div style={{
                                                    width: '100%', height: Math.max(2, (b.value / trendMax) * 100) + '%',
                                                    background: b.value ? (hoverBar === i ? t.text : t.scale[4]) : t.scale[0],
                                                    borderRadius: 2, transition: 'background .15s',
                                                }} />
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: t.faint, marginTop: 6 }}>
                                        <span>{trend[0]?.label}</span>
                                        <span>{trend[trend.length - 1]?.label}</span>
                                    </div>
                                </div>

                                <div>
                                    <Label t={t}>AT A GLANCE</Label>
                                    <div style={{ borderBottom: '1px solid ' + t.lineSoft }}>
                                        <Row t={t} label="Customers billed" value={m.customers.length}
                                             note={m.dormant.length ? '+' + m.dormant.length + ' in directory' : null}
                                             onClick={() => setTab('customers')} />
                                        {m.customers[0] && (
                                            <Row t={t} label="Top customer" value={'₹' + fmtCompact(m.customers[0].revenue)}
                                                 note={m.customers[0].name} onClick={() => setTab('customers')} />
                                        )}
                                        <Row t={t} label="Invoices issued" value={m.invoiceCount}
                                             note={m.invoiceCount ? 'avg ₹' + fmtCompact(m.revenue / m.invoiceCount) : null}
                                             onClick={m.docs.length ? () => setTab('documents') : undefined} />
                                        <Row t={t} label="Overdue"
                                             value={m.overdue.size ? '₹' + fmtCompact(m.overdueAmount) : 'None'}
                                             note={m.overdue.size ? m.overdue.size + (m.overdue.size === 1 ? ' invoice' : ' invoices') : null}
                                             tone={m.overdue.size ? t.down : t.faint}
                                             onClick={m.overdue.size ? () => setTab('documents') : undefined} />
                                        <Row t={t} label="Pipeline" value={'₹' + fmtCompact(geoRow ? geoRow.pipeline : m.pipeline)}
                                             note={m.offers.length + ' live ' + (m.offers.length === 1 ? 'quote' : 'quotes')}
                                             onClick={m.offers.length ? () => setTab('documents') : undefined} />
                                        {m.products[0] && (
                                            <Row t={t} label="Top product" value={'₹' + fmtCompact(m.products[0].amount)}
                                                 note={m.products[0].name} onClick={() => setTab('products')} />
                                        )}
                                        {cash.directCount > 0 && (
                                            <Row t={t} label="Direct receipts" value={'₹' + fmtCompact(cash.direct)}
                                                 note={cash.directCount + (cash.directCount === 1 ? ' entry' : ' entries') + ' · no invoice'}
                                                 onClick={() => setTab('cash')} />
                                        )}
                                        {cash.cashOut > 0 && (
                                            <Row t={t} label="Spent here" value={'₹' + fmtCompact(cash.cashOut)}
                                                 note={cash.outs.length + (cash.outs.length === 1 ? ' payment' : ' payments')}
                                                 tone={t.down} onClick={() => setTab('cash')} />
                                        )}
                                        {(cash.cashIn > 0 || cash.cashOut > 0) && marginBase > 0 && (
                                            <Row t={t} label="Net of running costs"
                                                 value={(netHere < 0 ? '−₹' : '₹') + fmtCompact(Math.abs(netHere))}
                                                 note={((netHere / marginBase) * 100).toFixed(0) + '% margin'}
                                                 tone={netHere < 0 ? t.down : undefined} />
                                        )}
                                        {(cash.taxIn > 0 || cash.taxOut > 0) && (
                                            <Row t={t} label="GST in cash entries"
                                                 value={'₹' + fmtCompact(cash.taxIn - cash.taxOut)}
                                                 note={'₹' + fmtCompact(cash.taxIn) + ' out · ₹' + fmtCompact(cash.taxOut) + ' in'} />
                                        )}
                                        <Row t={t} label="Previous period" value={'₹' + fmtCompact(prev)}
                                             note={growth !== null ? (growth >= 0 ? '+' : '') + growth.toFixed(1) + '%' : null} />
                                    </div>
                                </div>
                            </div>
                        )}

                        {tab === 'customers' && (
                            m.customers.length === 0 && m.dormant.length === 0 ? <Empty t={t}>No customers from {name} yet</Empty> : (
                                <div>
                                    {m.customers.length > 0 && <Label t={t} right="revenue · paid">BILLED THIS PERIOD</Label>}
                                    {m.customers.map((c) => (
                                        <button key={c.key} type="button" className="cd-row" onClick={() => go('/customers')} style={listRow(t)}>
                                            <span style={avatar(t)}>{c.name.charAt(0).toUpperCase()}</span>
                                            <span style={{ flex: 1, minWidth: 0 }}>
                                                <span style={line1}>{c.name}</span>
                                                <span style={line2(t)}>
                                                    {c.count} {c.count === 1 ? 'invoice' : 'invoices'} · last {fmtDate(c.last)}
                                                    {c.contact ? ' · ' + c.contact : c.email ? ' · ' + c.email : ''}
                                                </span>
                                                <Bar t={t} pct={(c.revenue / (m.customers[0].revenue || 1)) * 100} />
                                            </span>
                                            <span style={{ textAlign: 'right', flexShrink: 0 }}>
                                                <span style={line1}>₹{fmtCompact(c.revenue)}</span>
                                                <span style={{ ...line2(t), color: c.paid >= c.revenue ? t.up : t.faint }}>
                                                    {c.revenue ? Math.round((c.paid / c.revenue) * 100) : 0}% paid
                                                </span>
                                            </span>
                                            <ChevronRight size={12} style={{ color: t.faint, flexShrink: 0 }} />
                                        </button>
                                    ))}
                                    {m.dormant.length > 0 && (
                                        <div style={{ marginTop: m.customers.length ? 24 : 0 }}>
                                            <Label t={t}>IN DIRECTORY · NOT BILLED THIS PERIOD</Label>
                                            {m.dormant.map((c) => (
                                                <button key={c.id} type="button" className="cd-row" onClick={() => go('/customers')} style={listRow(t)}>
                                                    <span style={{ ...avatar(t), color: t.faint }}>{(c.name || '?').charAt(0).toUpperCase()}</span>
                                                    <span style={{ flex: 1, minWidth: 0 }}>
                                                        <span style={{ ...line1, color: t.dim }}>{c.name}</span>
                                                        <span style={line2(t)}>{c.person_name || c.email || c.state || '—'}</span>
                                                    </span>
                                                    <ChevronRight size={12} style={{ color: t.faint, flexShrink: 0 }} />
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )
                        )}

                        {tab === 'documents' && (
                            m.docs.length === 0 ? <Empty t={t}>No documents for {name} in this period</Empty> : (
                                <div>
                                    <Label t={t} right="newest first">INVOICES · QUOTES · PROFORMAS</Label>
                                    {m.docs.map((d) => {
                                        const late = m.overdue.has(d);
                                        return (
                                            <button key={d.id} type="button" className="cd-row" onClick={() => go(DOC_ROUTE[d.type] || '/invoices')} style={listRow(t)}>
                                                <span style={{ flex: 1, minWidth: 0 }}>
                                                    <span style={line1}>
                                                        {docNumber(d)}
                                                        <span style={{ color: t.faint, marginLeft: 8 }}>{d.clientName || '—'}</span>
                                                    </span>
                                                    <span style={line2(t)}>
                                                        {d.type} · {fmtDate(dateOf(d))}{d.due_date ? ' · due ' + fmtDate(d.due_date) : ''}
                                                    </span>
                                                </span>
                                                <span style={{ textAlign: 'right', flexShrink: 0 }}>
                                                    <span style={line1}>{inr(val(d))}</span>
                                                    <span style={{ ...line2(t), color: d.status === 'paid' ? t.up : late ? t.down : t.faint }}>
                                                        {late ? 'overdue' : String(d.status || '').replace(/_/g, ' ')}
                                                    </span>
                                                </span>
                                                <ChevronRight size={12} style={{ color: t.faint, flexShrink: 0 }} />
                                            </button>
                                        );
                                    })}
                                </div>
                            )
                        )}

                        {tab === 'cash' && (
                            cash.entries.length === 0
                                ? <Empty t={t}>No cash recorded against {name} in this period</Empty>
                                : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                                        {/* Money in, by what it actually was. The treatment
                                            is the answer to "is this revenue?", so it leads. */}
                                        {cash.inByTreatment.length > 0 && (
                                            <div>
                                                <Label t={t} right={inr(cash.cashIn)}>MONEY IN</Label>
                                                <div style={{ borderBottom: '1px solid ' + t.lineSoft }}>
                                                    {cash.inByTreatment.map((b) => (
                                                        <Row key={b.key} t={t} label={b.label}
                                                             value={'₹' + fmtCompact(b.amount)}
                                                             note={b.count + (b.count === 1 ? ' entry' : ' entries')
                                                                 + (INCOME_TREATMENTS.has(b.key) ? ' · counts as revenue' : ' · not revenue')}
                                                             tone={INCOME_TREATMENTS.has(b.key) ? undefined : t.dim} />
                                                    ))}
                                                </div>
                                                {/* The categories behind those treatments, which
                                                    is the layer somebody recognises: "Counter sale",
                                                    not "revenue". */}
                                                {cash.inByGroup.length > 0 && (
                                                    <div style={{ fontSize: 9.5, color: t.faint, marginTop: 8, lineHeight: 1.6 }}>
                                                        {cash.inByGroup.map((g) => g.key + ': '
                                                            + g.items.map((it) => it.label + ' ₹' + fmtCompact(it.amount)).join(', ')).join(' · ')}
                                                    </div>
                                                )}
                                                {cash.methodsIn.length > 1 && (
                                                    <div style={{ fontSize: 9.5, color: t.faint, marginTop: 6 }}>
                                                        received by {cash.methodsIn.map((x) => x.label + ' ₹' + fmtCompact(x.amount)).join(' · ')}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Money out, by the group a person recognises,
                                            with the categories underneath it. */}
                                        {cash.outByGroup.length > 0 && (
                                            <div>
                                                <Label t={t} right={inr(cash.cashOut)}>MONEY OUT</Label>
                                                {cash.outByGroup.map((g) => (
                                                    <div key={g.key} style={{ borderTop: '1px solid ' + t.lineSoft, padding: '10px 0' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                            <span style={{ flex: 1, minWidth: 0, fontSize: 11.5 }}>{g.key}</span>
                                                            <span style={{ fontSize: 11.5 }}>₹{fmtCompact(g.amount)}</span>
                                                        </div>
                                                        <Bar t={t} pct={(g.amount / (cash.outByGroup[0].amount || 1)) * 100} />
                                                        <div style={{ fontSize: 9.5, color: t.faint, marginTop: 6, lineHeight: 1.6 }}>
                                                            {g.items.map((it) => it.label + ' ₹' + fmtCompact(it.amount)).join(' · ')}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        <div>
                                            <Label t={t} right="newest first">EVERY ENTRY</Label>
                                            {cash.entries.map((r) => (
                                                <button key={r.dir + r.id} type="button" className="cd-row"
                                                        onClick={() => go('/cashbook')} style={listRow(t)}>
                                                    <span aria-hidden="true" style={{
                                                        width: 18, flexShrink: 0, fontSize: 12,
                                                        color: r.dir === 'in' ? t.up : t.down,
                                                    }}>{r.dir === 'in' ? '+' : '−'}</span>
                                                    <span style={{ flex: 1, minWidth: 0 }}>
                                                        <span style={line1}>{r.description}</span>
                                                        <span style={line2(t)}>
                                                            {categoryLabel(r.category) || r.category}
                                                            {' · ' + fmtDate(r.on)}
                                                            {r.currency && r.currency !== 'INR'
                                                                ? ' · ' + r.currency + ' ' + (Number(r.original_amount) || 0).toLocaleString('en-IN')
                                                                : ''}
                                                            {r.place_of_supply ? ' · ' + r.place_of_supply : ''}
                                                        </span>
                                                    </span>
                                                    <span style={{ textAlign: 'right', flexShrink: 0 }}>
                                                        <span style={{ ...line1, color: r.dir === 'in' ? t.text : t.down }}>
                                                            {inr(Number(r.amount) || 0)}
                                                        </span>
                                                        <span style={line2(t)}>
                                                            {TREATMENTS[rowTreatment(r, r.dir)]?.label || rowTreatment(r, r.dir)}
                                                            {Number(r.tax_amount) > 0 ? ' · GST ₹' + fmtCompact(r.tax_amount) : ''}
                                                        </span>
                                                    </span>
                                                    <ChevronRight size={12} style={{ color: t.faint, flexShrink: 0 }} />
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )
                        )}

                        {tab === 'products' && (
                            m.products.length === 0 ? <Empty t={t}>No line items billed to {name}</Empty> : (
                                <div>
                                    <Label t={t} right="line totals, pre-tax">BY REVENUE</Label>
                                    {m.products.map((p, i) => (
                                        <div key={p.name} style={{ ...listRow(t), cursor: 'default' }}>
                                            <span style={{ fontSize: 9.5, color: t.ghost, width: 16, flexShrink: 0 }}>{String(i + 1).padStart(2, '0')}</span>
                                            <span style={{ flex: 1, minWidth: 0 }}>
                                                <span style={line1}>{p.name}</span>
                                                <Bar t={t} pct={(p.amount / (m.products[0].amount || 1)) * 100} />
                                            </span>
                                            <span style={{ textAlign: 'right', flexShrink: 0 }}>
                                                <span style={line1}>₹{fmtCompact(p.amount)}</span>
                                                <span style={line2(t)}>qty {p.qty.toLocaleString('en-IN')}</span>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )
                        )}
                    </div>

                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, flexWrap: 'wrap',
                        padding: '7px 12px', borderTop: '1px solid ' + t.line,
                    }}>
                        <span style={{ fontSize: 9, color: t.faint, letterSpacing: '0.08em', marginRight: 6 }}>OPEN</span>
                        {[['Customers', '/customers'], ['Invoices', '/invoices'], ['Cash book', '/cashbook'], ['Revenue', '/revenue']].map(([label, to]) => (
                            <button key={to} type="button" className="nm-nav" onClick={() => go(to)} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: font, fontSize: 10.5,
                                padding: '4px 7px', border: 'none', borderRadius: 5,
                                background: 'transparent', color: t.dim, cursor: 'pointer',
                            }}>{label}<ArrowUpRight size={10} /></button>
                        ))}
                    </div>
                </div>
            </div>
            <style>{`
                .cd-row:hover { background: ${t.panelAlt} !important; }
                .cd-tab:hover { color: ${t.text} !important; }
                @keyframes cdFade { from { opacity: 0; } to { opacity: 1; } }
                @keyframes cdRise { from { opacity: 0; transform: translateY(8px) scale(.99); } to { opacity: 1; transform: none; } }
            `}</style>
        </div>
    );
}

/* Rows bleed 6px past the column so their hover wash has room, without
   shifting the text off the column's left edge. */
const listRow = (t) => ({
    display: 'flex', alignItems: 'center', gap: 10,
    width: 'calc(100% + 12px)', margin: '0 -6px', padding: '10px 6px',
    textAlign: 'left', background: 'transparent', border: 'none',
    borderTop: '1px solid ' + t.lineSoft, borderRadius: 6,
    fontFamily: 'inherit', color: t.text, cursor: 'pointer',
});

const avatar = (t) => ({
    width: 26, height: 26, borderRadius: 6, flexShrink: 0, border: '1px solid ' + t.line,
    display: 'grid', placeItems: 'center', fontSize: 10.5, color: t.dim,
});

const line1 = { display: 'block', fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const line2 = (t) => ({
    display: 'block', fontSize: 9.5, color: t.faint, marginTop: 2,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
});

const closeBtn = (t) => ({
    marginLeft: 'auto', width: 24, height: 24, display: 'grid', placeItems: 'center',
    border: '1px solid ' + t.line, borderRadius: 6, background: 'transparent',
    color: t.dim, cursor: 'pointer', padding: 0,
});
