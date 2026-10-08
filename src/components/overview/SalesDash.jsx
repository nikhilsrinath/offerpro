import React, { useEffect, useMemo, useState } from 'react';
import { Target, Repeat, Users, IndianRupee, Globe } from 'lucide-react';
import { salesGeoService } from '../../services/salesGeoService';
import { useSection } from '../financial/financeHooks';
import { categoryLabel } from '../../services/financeCategories';
import { annualRecurring, acquisitionSpend, SALES_KEYS } from '../../services/salesMetrics';
import { fmtShort, fmtInr, iso } from './overviewModel';
import { RankBars, SplitBar, Funnel, EmptyNote, TipBody, Delta } from './vizKit';
import { Dashboard, Card, Tile, Figure, FigureRow, More, TileRow, CardGrid, ListRow, MiniSeg } from './dashKit';

/* ══════════════════════════════════════════════════════════════════════════
   Dashboard · Sales & marketing: where the next rupee comes from, and what
   it costs to find it.

   The CRM board and recurring revenue are snapshots and say so; quotations,
   customers and countries follow the period. Sales & marketing spend has its
   own trailing window (1M/3M/6M/1Y), because acquisition cost is read over a
   fixed look-back rather than whatever period the page is set to.
   ══════════════════════════════════════════════════════════════════════════ */

const WINDOWS = [
    { id: '1m', label: '1M', months: 1, note: 'last month' },
    { id: '3m', label: '3M', months: 3, note: 'last 3 months' },
    { id: '6m', label: '6M', months: 6, note: 'last 6 months' },
    { id: '1y', label: '1Y', months: 12, note: 'last 12 months' },
];
const windowStart = (today, months) => {
    const d = new Date(`${today}T00:00:00`);
    d.setMonth(d.getMonth() - months);
    d.setDate(d.getDate() + 1);
    return iso(d);
};

let regionNames = null;
const countryName = (code) => {
    try {
        regionNames = regionNames || new Intl.DisplayNames(['en'], { type: 'region' });
        return regionNames.of(code) || code;
    } catch { return code; }
};

export default function SalesDash() {
    return <Dashboard>{(ctx) => <SalesBody {...ctx} />}</Dashboard>;
}

function SalesBody({ model, open, navigate, t, cat, ramp, status, cols, tileCols, orgId }) {
    const k = model.kpis;
    const { period } = model;

    // sales_by_country() (0013/0042). The same RPC the country map reads.
    const [geo, setGeo] = useState(null);
    useEffect(() => {
        let alive = true;
        salesGeoService.byCountry(orgId, { from: period.from, to: period.to })
            .then((rows) => { if (alive) setGeo(rows); })
            .catch(() => { if (alive) setGeo([]); });
        return () => { alive = false; };
    }, [orgId, period.from, period.to]);
    const countries = useMemo(() => (geo || [])
        .filter((r) => r.code && r.revenue > 0)
        .map((r) => ({ key: r.code, name: countryName(r.code), value: r.revenue, prev: r.prevRevenue, customers: r.customerCount, docs: r.docCount }))
        .sort((a, b) => b.value - a.value), [geo]);

    const openLeads = useMemo(() => [...model.stages[0].rows, ...model.stages[1].rows]
        .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)), [model.stages]);
    const activeClients = model.customers.length;
    const avgInvoice = k.invoiced.count ? k.invoiced.value / k.invoiced.count : null;
    const { today } = model.raw;

    // ARR, and sales & marketing spend over a trailing window ending today,
    // salesMetrics, the same figures the hub's widgets show.
    const recurring = useSection('fin_recurring');
    const recur = useMemo(() => annualRecurring(recurring, today), [recurring, today]);
    const [win, setWin] = useState('3m');
    const winDef = WINDOWS.find((w) => w.id === win);
    const acq = useMemo(() => {
        const a = acquisitionSpend(model.raw.spend, model.raw.leads, windowStart(today, winDef.months), today);
        return { ...a, cats: a.byCat.map((c) => ({ ...c, name: c.key === 'Marketing' ? 'Marketing (legacy)' : categoryLabel(c.key) })) };
    }, [model.raw, today, winDef]);
    const quoteColor = { accepted: status.good, open: t.faint, lost: status.critical, draft: t.ghost };

    return (<>
        <TileRow bento cols={tileCols(5)}>
            <Tile icon={Target} label="Pipeline" value={fmtShort(k.pipeline.value)} exact={fmtInr(k.pipeline.value)}
                delta={<span style={{ fontSize: 12, color: t.dim }}>{k.pipeline.open} open</span>}
                foot="open leads on the CRM board · today" spark={k.pipeline.spark} sparkBars color={ramp[2]}
                onClick={() => open({ kind: 'metric', id: 'pipeline' })} />
            <Tile icon={Repeat} label="Annual recurring revenue" value={fmtShort(recur.value)} exact={fmtInr(recur.value)}
                foot={recur.count ? `${recur.count} active recurring invoice${recur.count === 1 ? '' : 's'} · ${recur.clients} client${recur.clients === 1 ? '' : 's'} · today` : 'no active recurring invoices'}
                color={cat[1]} onClick={() => navigate('/billing/recurring')} />
            <Tile icon={Users} label="Billed clients" value={String(activeClients)} exact={`${activeClients} clients`}
                foot={model.customers[0] ? `top: ${model.customers[0].name}` : 'no invoices in period'}
                onClick={() => open({ kind: 'metric', id: 'invoiced' })} />
            <Tile icon={IndianRupee} label="Avg invoice" value={avgInvoice === null ? '-' : fmtShort(avgInvoice)} exact={avgInvoice === null ? 'no invoices' : fmtInr(avgInvoice)}
                delta={<Delta value={k.invoiced.delta} />} foot={`${k.invoiced.count} invoices · ${fmtShort(k.invoiced.value)}`}
                spark={k.invoiced.spark} color={cat[0]} onClick={() => open({ kind: 'metric', id: 'invoiced' })} />
            <Tile icon={Globe} label="Top market" value={countries[0] ? countries[0].key : '-'}
                exact={countries[0] ? `${countries[0].name} · ${fmtInr(countries[0].value)}` : 'no country data'}
                foot={countries[0] ? `${countries[0].name} · ${fmtShort(countries[0].value)}` : geo === null ? 'loading…' : 'no client countries on record'} />
        </TileRow>

        <CardGrid cols={cols}>
            <Card accent title="Sales pipeline" note="CRM board · today" right={<More onClick={() => open({ kind: 'metric', id: 'pipeline' })} />}>
                {model.stages.every((s) => s.count === 0) ? <EmptyNote>No leads on the CRM board</EmptyNote> : (
                    <Funnel format={fmtShort} onSelect={(s) => open({ kind: 'stage', id: s.id === 'all' ? undefined : s.id })} stages={[
                        { ...model.stages[0], label: 'All leads', count: model.stages.reduce((s, x) => s + x.count, 0), value: model.stages.reduce((s, x) => s + x.value, 0), color: ramp[0], ink: t.isDark ? '#fff' : '#0d366b', id: 'all' },
                        { ...model.stages[1], label: 'Contacted+', count: model.stages[1].count + model.stages[2].count + model.stages[3].count, value: model.stages[1].value + model.stages[2].value + model.stages[3].value, color: ramp[1], id: 'contacted' },
                        { ...model.stages[2], label: 'Won', color: ramp[3] },
                    ].map((s, i, arr) => ({ ...s, conversion: i === 0 ? undefined : arr[i - 1].count ? (s.count / arr[i - 1].count) * 100 : null }))} />
                )}
                <div style={{ fontSize: 11.5, color: t.faint, marginTop: 10 }}>
                    {model.stages[3].count} lost · {model.stages[0].count} not yet contacted
                </div>
            </Card>

            <Card title="Biggest open leads" note="not yet won or lost · today" right={<More label="CRM" to="/crm" />}>
                {openLeads.length === 0 ? <EmptyNote>No open leads</EmptyNote> : openLeads.slice(0, 7).map((l) => (
                    <ListRow key={l.id} label={l.company_name || l.name || 'Unnamed lead'}
                        sub={[l.person_name, l.stage === 'contacted' ? 'contacted' : 'not contacted yet'].filter(Boolean).join(' · ')}
                        value={Number(l.value) ? fmtShort(l.value) : '-'}
                        onClick={() => open({ kind: 'stage', id: l.stage })} />
                ))}
            </Card>

            <Card title="Quotations" note="issued in period">
                <SplitBar donut center={{ value: model.quoteWinRate === null ? '-' : `${model.quoteWinRate.toFixed(0)}%`, label: 'Win rate' }} format={fmtShort} unit="Quoted" parts={model.quotes.map((q) => ({ id: q.id, label: q.label, value: q.amount, color: quoteColor[q.id], note: `${q.count}` }))}
                    onSelect={(p) => open({ kind: 'quotes', id: p.id })} />
            </Card>

            <Card title="Top customers" note="by invoiced value" right={<More onClick={() => open({ kind: 'metric', id: 'invoiced' })} />}>
                <RankBars rows={model.customers.map((c) => ({
                    ...c, value: c.invoiced,
                    tip: <TipBody title={c.name} rows={[{ label: 'Invoiced', value: fmtInr(c.invoiced), color: cat[0] }, { label: 'Paid', value: fmtInr(c.paid), color: cat[2] }, { label: 'Owed', value: fmtInr(c.outstanding) }, { label: 'Invoices', value: String(c.count) }]} />,
                }))} format={fmtShort} total={k.invoiced.value} color={cat[0]} sub={(r) => (r.outstanding > 0.5 ? `${fmtShort(r.outstanding)} owed` : '')}
                    onSelect={(r) => open({ kind: 'customer', key: r.key })} empty="No invoices in this period" />
            </Card>

            <Card title="Sales & marketing spend" note={`net of GST · ${winDef.note}`}
                right={<MiniSeg label="Spend window" value={win} onChange={setWin} options={WINDOWS} />}>
                <FigureRow>
                    <Figure big label="sales spend" value={fmtShort(acq.sales)} />
                    <Figure big label="marketing spend" value={fmtShort(acq.marketing)} />
                    <Figure big label="avg expenses / lead" value={acq.perLead === null ? '-' : fmtShort(acq.perLead)} />
                </FigureRow>
                <RankBars rows={acq.cats.map((c) => ({
                    ...c,
                    tip: <TipBody title={c.name} rows={[{ label: SALES_KEYS.has(c.key) ? 'Sales' : 'Marketing', value: fmtInr(c.value), color: cat[4] }, { label: 'Share', value: `${((c.value / acq.total) * 100).toFixed(0)}%` }]} />,
                }))} format={fmtShort} total={acq.total} color={cat[4]}
                    onSelect={(r) => open({ kind: 'category', name: r.key })} empty="No sales or marketing expenses in this window" />
                <div style={{ fontSize: 11.5, color: t.faint, marginTop: 10 }}>
                    {acq.leads} new lead{acq.leads === 1 ? '' : 's'} on the CRM board · {fmtShort(acq.total)} spent in all
                </div>
            </Card>

            <Card title="Revenue by country" note="invoiced + earned without an invoice, by client country">
                {geo === null ? <EmptyNote>Loading…</EmptyNote> : (
                    <RankBars rows={countries.map((c) => ({
                        ...c,
                        tip: <TipBody title={c.name} rows={[{ label: 'Revenue', value: fmtInr(c.value), color: cat[3] }, { label: 'Previous period', value: fmtInr(c.prev) }, { label: 'Clients', value: String(c.customers) }]} />,
                    }))} format={fmtShort} color={cat[3]}
                        sub={(r) => (period.prev && r.prev > 0 ? <Delta value={((r.value - r.prev) / r.prev) * 100} /> : null)}
                        empty="No revenue with a client country in this period" />
                )}
            </Card>
        </CardGrid>
    </>);
}
