import React, { useEffect, useMemo, useState } from 'react';
import { Target, Trophy, FileSignature, Users, IndianRupee, Globe } from 'lucide-react';
import { salesGeoService } from '../../services/salesGeoService';
import { fmtShort, fmtInr } from './overviewModel';
import { RankBars, SplitBar, Funnel, EmptyNote, TipBody, Delta } from './vizKit';
import { Dashboard, Card, Tile, BigCount, More, TileRow, CardGrid, ListRow } from './dashKit';

/* ══════════════════════════════════════════════════════════════════════════
   Dashboard · Sales & clients — where the next rupee comes from.

   The CRM board is a snapshot (it keeps no stage history) and says so; the
   quotations, customers, products and countries follow the period.
   ══════════════════════════════════════════════════════════════════════════ */

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

function SalesBody({ model, open, t, cat, ramp, status, cols, tileCols, orgId }) {
    const k = model.kpis;
    const { period } = model;

    // sales_by_country() (0013/0042) — the same RPC the country map reads.
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
    const quoted = model.quotes.reduce((s, q) => s + q.amount, 0);
    const quoteColor = { accepted: status.good, open: t.faint, lost: status.critical, draft: t.ghost };

    return (<>
        <TileRow cols={tileCols(6)}>
            <Tile icon={Target} label="Pipeline" value={fmtShort(k.pipeline.value)} exact={fmtInr(k.pipeline.value)}
                delta={<span style={{ fontSize: 10.5, color: t.dim }}>{k.pipeline.open} open</span>}
                foot="open leads on the CRM board · today" spark={k.pipeline.spark} sparkBars color={ramp[2]}
                onClick={() => open({ kind: 'metric', id: 'pipeline' })} />
            <Tile icon={Trophy} label="Deal win rate" value={k.pipeline.winRate === null ? '—' : `${k.pipeline.winRate.toFixed(0)}%`}
                exact={k.pipeline.winRate === null ? 'no closed deals' : `${k.pipeline.winRate.toFixed(1)}%`}
                foot={`${model.stages[2].count} won · ${model.stages[3].count} lost`}
                onClick={() => open({ kind: 'stage', id: 'deal' })} />
            <Tile icon={FileSignature} label="Quote win rate" value={model.quoteWinRate === null ? '—' : `${model.quoteWinRate.toFixed(0)}%`}
                exact={model.quoteWinRate === null ? 'no decided quotations' : `${model.quoteWinRate.toFixed(1)}%`}
                foot={`${fmtShort(quoted)} quoted in period`}
                onClick={() => open({ kind: 'quotes', id: 'accepted' })} />
            <Tile icon={Users} label="Billed clients" value={String(activeClients)} exact={`${activeClients} clients`}
                foot={model.customers[0] ? `top: ${model.customers[0].name}` : 'no invoices in period'}
                onClick={() => open({ kind: 'metric', id: 'invoiced' })} />
            <Tile icon={IndianRupee} label="Avg invoice" value={avgInvoice === null ? '—' : fmtShort(avgInvoice)} exact={avgInvoice === null ? 'no invoices' : fmtInr(avgInvoice)}
                delta={<Delta value={k.invoiced.delta} />} foot={`${k.invoiced.count} invoices · ${fmtShort(k.invoiced.value)}`}
                spark={k.invoiced.spark} color={cat[0]} onClick={() => open({ kind: 'metric', id: 'invoiced' })} />
            <Tile icon={Globe} label="Top market" value={countries[0] ? countries[0].key : '—'}
                exact={countries[0] ? `${countries[0].name} · ${fmtInr(countries[0].value)}` : 'no country data'}
                foot={countries[0] ? `${countries[0].name} · ${fmtShort(countries[0].value)}` : geo === null ? 'loading…' : 'no client countries on record'} />
        </TileRow>

        <CardGrid cols={cols}>
            <Card title="Sales pipeline" note="CRM board · today" right={<More onClick={() => open({ kind: 'metric', id: 'pipeline' })} />}>
                {model.stages.every((s) => s.count === 0) ? <EmptyNote>No leads on the CRM board</EmptyNote> : (
                    <Funnel format={fmtShort} onSelect={(s) => open({ kind: 'stage', id: s.id === 'all' ? undefined : s.id })} stages={[
                        { ...model.stages[0], label: 'All leads', count: model.stages.reduce((s, x) => s + x.count, 0), value: model.stages.reduce((s, x) => s + x.value, 0), color: ramp[0], ink: '#0d366b', id: 'all' },
                        { ...model.stages[1], label: 'Contacted+', count: model.stages[1].count + model.stages[2].count + model.stages[3].count, value: model.stages[1].value + model.stages[2].value + model.stages[3].value, color: ramp[1], id: 'contacted' },
                        { ...model.stages[2], label: 'Won', color: ramp[3] },
                    ].map((s, i, arr) => ({ ...s, conversion: i === 0 ? undefined : arr[i - 1].count ? (s.count / arr[i - 1].count) * 100 : null }))} />
                )}
                <div style={{ fontSize: 10, color: t.faint, marginTop: 10 }}>
                    {model.stages[3].count} lost · {model.stages[0].count} not yet contacted
                </div>
            </Card>

            <Card title="Biggest open leads" note="not yet won or lost · today" right={<More label="CRM" to="/crm" />}>
                {openLeads.length === 0 ? <EmptyNote>No open leads</EmptyNote> : openLeads.slice(0, 7).map((l) => (
                    <ListRow key={l.id} label={l.company_name || l.name || 'Unnamed lead'}
                        sub={[l.person_name, l.stage === 'contacted' ? 'contacted' : 'not contacted yet'].filter(Boolean).join(' · ')}
                        value={Number(l.value) ? fmtShort(l.value) : '—'}
                        onClick={() => open({ kind: 'stage', id: l.stage })} />
                ))}
            </Card>

            <Card title="Quotations" note="issued in period">
                <BigCount value={model.quoteWinRate === null ? '—' : `${model.quoteWinRate.toFixed(0)}%`} label="win rate, decided quotes" />
                <SplitBar format={fmtShort} unit="Quoted" parts={model.quotes.map((q) => ({ id: q.id, label: q.label, value: q.amount, color: quoteColor[q.id], note: `${q.count}` }))}
                    onSelect={(p) => open({ kind: 'quotes', id: p.id })} />
            </Card>

            <Card title="Top customers" note="by invoiced value" right={<More onClick={() => open({ kind: 'metric', id: 'invoiced' })} />}>
                <RankBars rows={model.customers.map((c) => ({
                    ...c, value: c.invoiced,
                    tip: <TipBody title={c.name} rows={[{ label: 'Invoiced', value: fmtInr(c.invoiced), color: cat[0] }, { label: 'Paid', value: fmtInr(c.paid), color: cat[2] }, { label: 'Owed', value: fmtInr(c.outstanding) }, { label: 'Invoices', value: String(c.count) }]} />,
                }))} format={fmtShort} total={k.invoiced.value} color={cat[0]} sub={(r) => (r.outstanding > 0.5 ? `${fmtShort(r.outstanding)} owed` : '')}
                    onSelect={(r) => open({ kind: 'customer', key: r.key })} empty="No invoices in this period" />
            </Card>

            <Card title="What sells" note="line items billed" right={<More label="Products" to="/products" />}>
                <RankBars rows={model.products.map((p) => ({
                    ...p, value: p.revenue,
                    tip: <TipBody title={p.name} rows={[{ label: 'Revenue', value: fmtInr(p.revenue), color: cat[0] }, { label: 'Units', value: p.units.toLocaleString('en-IN') }, { label: 'Invoices', value: String(p.invoiceCount) }]} />,
                }))} format={fmtShort} color={cat[0]} sub={(r) => `${r.units.toLocaleString('en-IN')} u`}
                    onSelect={(r) => open({ kind: 'product', key: r.key })} empty="No line items in this period" />
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
