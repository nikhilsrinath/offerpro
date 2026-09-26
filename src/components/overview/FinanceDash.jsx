import React, { useMemo, useState } from 'react';
import { IndianRupee, Wallet, TrendingUp, Hourglass, Truck, Landmark } from 'lucide-react';
import { useSection } from '../financial/financeHooks';
import { balanceOf, cashPosition, taxSummary } from '../../services/financeAnalytics';
import { fmtShort, fmtInr, customerKey } from './overviewModel';
import { Columns, RankBars, SplitBar, Gauge, Legend, Delta, TipBody } from './vizKit';
import { Dashboard, Card, Tile, Figure, BigCount, More, MiniSeg, TileRow, CardGrid } from './dashKit';
import { plainBtn } from './vizHooks';

/* ══════════════════════════════════════════════════════════════════════════
   Dashboard · Finance — money in, money out, and who owes whom.

   Period-scoped: income, collections, spending, invoice health, GST.
   Snapshots (they have no history, and say so): receivables, payables and
   the all-time cash position — the same cashPosition() the hub tile and
   EdgeBrain's cash.* aggregates (0066) are pinned to.
   ══════════════════════════════════════════════════════════════════════════ */

const SOURCE_LABEL = {
    invoice_payments: 'Invoice payments', proforma_advances: 'Proforma advances',
    cash_book_revenue: 'Cash book · earned', cash_book_funding: 'Cash book · funding', cash_book_other: 'Cash book · other',
    expenses: 'Expenses', vendor_bills: 'Vendor bills',
};

export default function FinanceDash() {
    return <Dashboard>{(ctx) => <FinanceBody {...ctx} />}</Dashboard>;
}

function FinanceBody({ model, open, navigate, t, cat, ramp, status, cols, grid, tileCols, today }) {
    const k = model.kpis;
    const [cashMode, setCashMode] = useState('cash');
    const purchases = useSection('purchase_invoices');
    const vendors = useSection('vendors');
    const { raw, period } = model;

    const cash = useMemo(() => cashPosition({
        finDocs: raw.finDocs, income: raw.income, expenses: raw.expenses, purchases,
    }), [raw.finDocs, raw.income, raw.expenses, purchases]);

    const payables = useMemo(() => {
        const vName = Object.fromEntries(vendors.map((v) => [v.id, v.company_name || v.name || 'Vendor']));
        const map = new Map();
        let total = 0; let overdue = 0; let overdueCount = 0;
        purchases.filter((b) => b.status !== 'void').forEach((b) => {
            const bal = Math.max(0, (Number(b.total) || 0) - (Number(b.amount_paid) || 0));
            if (bal <= 0.009) return;
            const late = b.due_date && b.due_date < today;
            total += bal;
            if (late) { overdue += bal; overdueCount += 1; }
            const key = b.vendor_id || 'none';
            const cur = map.get(key) || { key, name: vName[b.vendor_id] || 'No vendor', value: 0, overdue: 0, count: 0 };
            cur.value += bal; cur.count += 1; if (late) cur.overdue += bal;
            map.set(key, cur);
        });
        return { total, overdue, overdueCount, rows: [...map.values()].sort((a, b) => b.value - a.value) };
    }, [purchases, vendors, today]);

    // Who owes you: every open invoice, not just this period's — a debt does
    // not stop being owed because it was raised last year.
    const debtors = useMemo(() => {
        const map = new Map();
        raw.invoices.forEach((d) => {
            const bal = balanceOf(d);
            if (bal <= 0.009) return;
            const key = customerKey(d);
            const cur = map.get(key) || { key, name: d.clientName || 'Unnamed', value: 0, overdue: 0, count: 0 };
            cur.value += bal; cur.count += 1;
            if (d.due_date && d.due_date < today) cur.overdue += bal;
            map.set(key, cur);
        });
        return [...map.values()].sort((a, b) => b.value - a.value);
    }, [raw.invoices, today]);

    const gst = useMemo(() => taxSummary({
        docs: raw.finDocs, purchases, expenses: raw.expenses, income: raw.income, vendors,
    }, period.from, period.to), [raw.finDocs, raw.expenses, raw.income, purchases, vendors, period.from, period.to]);

    const cashSeries = cashMode === 'cash'
        ? [{ key: 'invoiced', label: 'Invoiced', color: cat[0] }, { key: 'collected', label: 'Collected on invoices', color: cat[2] }, { key: 'expenses', label: 'Expenses', color: cat[1] }]
        : [{ key: 'income', label: 'Income', color: cat[0] }, { key: 'expenses', label: 'Expenses', color: cat[1] }];
    const stateColor = { paid: status.good, partial: status.warning, awaiting: t.faint, overdue: status.critical };

    const inRows = Object.entries(cash.bySource)
        .filter(([s]) => !['expenses', 'vendor_bills'].includes(s))
        .map(([s, v]) => ({ key: s, name: SOURCE_LABEL[s] || s, value: v })).sort((a, b) => b.value - a.value);
    const outRows = ['expenses', 'vendor_bills'].filter((s) => cash.bySource[s])
        .map((s) => ({ key: s, name: SOURCE_LABEL[s], value: cash.bySource[s] }));

    return (<>
        <TileRow cols={tileCols(6)}>
            <Tile icon={IndianRupee} label="Revenue" value={fmtShort(k.revenue.value)} exact={fmtInr(k.revenue.value)}
                delta={<Delta value={k.revenue.delta} />}
                foot={k.revenue.direct > 0 ? `${fmtShort(k.revenue.direct)} without an invoice` : `${k.invoiced.count} invoices`}
                spark={k.revenue.spark} color={cat[0]} onClick={() => open({ kind: 'metric', id: 'invoiced' })} />
            <Tile icon={Wallet} label="Collected" value={fmtShort(k.collected.value)} exact={fmtInr(k.collected.value)}
                delta={<Delta value={k.collected.delta} />} foot={model.avgDaysToPay === null ? 'no settled invoices yet' : `paid in ${model.avgDaysToPay.toFixed(0)} days on average`}
                spark={k.collected.spark} color={cat[2]} onClick={() => open({ kind: 'metric', id: 'collected' })} />
            <Tile icon={TrendingUp} label="Net profit" value={fmtShort(k.net.value)} exact={fmtInr(k.net.value)} tone={k.net.value < 0 ? 'down' : null}
                delta={<Delta value={k.net.delta} />} foot={k.net.margin === null ? 'no income in period' : `${k.net.margin.toFixed(1)}% margin`}
                spark={k.net.spark} onClick={() => open({ kind: 'metric', id: 'net' })} />
            <Tile icon={Hourglass} label="Receivables" value={fmtShort(k.outstanding.value)} exact={fmtInr(k.outstanding.value)}
                delta={k.outstanding.overdue > 0
                    ? <span style={{ fontSize: 10.5, fontWeight: 600, color: t.down }}>{fmtShort(k.outstanding.overdue)} late</span>
                    : <span style={{ fontSize: 10.5, color: t.faint }}>none late</span>}
                foot="owed to you · today" spark={k.outstanding.spark} sparkBars color={ramp[3]}
                onClick={() => open({ kind: 'metric', id: 'outstanding' })} />
            <Tile icon={Truck} label="Payables" value={fmtShort(payables.total)} exact={fmtInr(payables.total)}
                delta={payables.overdue > 0
                    ? <span style={{ fontSize: 10.5, fontWeight: 600, color: t.down }}>{fmtShort(payables.overdue)} late</span>
                    : <span style={{ fontSize: 10.5, color: t.faint }}>none late</span>}
                foot={`you owe ${payables.rows.length} vendor${payables.rows.length === 1 ? '' : 's'} · today`}
                onClick={() => navigate('/purchases')} />
            <Tile icon={Landmark} label="Net cash" value={fmtShort(cash.net)} exact={fmtInr(cash.net)} tone={cash.net < 0 ? 'down' : null}
                foot={`${fmtShort(cash.received)} in · ${fmtShort(cash.paidOut)} out · all time`}
                onClick={() => navigate('/cashbook')} />
        </TileRow>

        <CardGrid cols={cols}>
            <Card style={grid(2)} title={cashMode === 'cash' ? 'Cash flow' : 'Profit & loss'}
                note={cashMode === 'cash' ? 'invoiced · collected on invoices · spent, gross' : 'income (invoiced + cash book) vs expenses, net of GST · line = net'}
                right={<MiniSeg label="Chart basis" value={cashMode} onChange={setCashMode} options={[{ id: 'cash', label: 'Cash' }, { id: 'pl', label: 'P&L' }]} />}>
                <Columns data={model.series} series={cashSeries} height={260} tipFormat={fmtInr}
                    line={cashMode === 'pl' ? { key: 'net', label: 'Net', color: t.text } : undefined}
                    onSelect={(i) => open({ kind: 'bucket', index: i })} />
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginTop: 10 }}>
                    <Legend items={[...cashSeries.map((s) => ({ label: s.label, color: s.color })), ...(cashMode === 'pl' ? [{ label: 'Net', color: t.text, line: true }] : [])]} />
                    <span style={{ flex: 1 }} />
                    <Figure label="income" value={fmtShort(model.pl.income)} />
                    <Figure label="expenses" value={fmtShort(model.pl.expenses)} />
                    <Figure label="net" value={fmtShort(model.pl.net)} tone={model.pl.net < 0 ? 'down' : 'up'} />
                </div>
            </Card>

            <Card title="Collection health" note="receivables as of today">
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
                    <button type="button" className="ov-plain" aria-label="Collected share — open detail" onClick={() => open({ kind: 'metric', id: 'collected' })} style={plainBtn}>
                        <Gauge value={model.collectionRate} label="COLLECTED" size={140} color={cat[2]} />
                    </button>
                    <div style={{ flex: 1, minWidth: 130, display: 'grid', gap: 10 }}>
                        <Figure big label="outstanding" value={fmtShort(k.outstanding.value)} />
                        <Figure big label="overdue" value={fmtShort(k.outstanding.overdue)} tone={k.outstanding.overdue > 0 ? 'down' : null} />
                        <div style={{ fontSize: 10, color: t.faint, lineHeight: 1.5 }}>Gauge: share of this period’s invoicing already paid.</div>
                    </div>
                </div>
                <SplitBar format={fmtShort} unit="Balance" parts={model.aging.map((a, i) => ({ id: a.id, label: a.label, value: a.amount, color: ramp[i], note: `${a.count}` }))}
                    onSelect={(p) => open({ kind: 'aging', id: p.id })} />
            </Card>

            <Card title="Who owes you" note="open invoice balances by client · today" right={<More onClick={() => open({ kind: 'metric', id: 'outstanding' })} />}>
                <RankBars rows={debtors.map((d) => ({
                    ...d,
                    tip: <TipBody title={d.name} rows={[{ label: 'Owed', value: fmtInr(d.value) }, { label: 'Overdue', value: fmtInr(d.overdue) }, { label: 'Open invoices', value: String(d.count) }]} />,
                }))} format={fmtShort} color={ramp[3]} total={k.outstanding.value}
                    sub={(r) => (r.overdue > 0.5 ? <span style={{ color: t.down }}>{fmtShort(r.overdue)} late</span> : '')}
                    onSelect={(r) => open({ kind: 'customer', key: r.key })} empty="Nobody owes you anything" />
            </Card>

            <Card title="What you owe" note="unpaid vendor bills · today" right={<More label="Bills" to="/purchases" />}>
                <RankBars rows={payables.rows.map((v) => ({
                    ...v,
                    tip: <TipBody title={v.name} rows={[{ label: 'Owed', value: fmtInr(v.value) }, { label: 'Overdue', value: fmtInr(v.overdue) }, { label: 'Open bills', value: String(v.count) }]} />,
                }))} format={fmtShort} color={cat[1]} total={payables.total}
                    sub={(r) => (r.overdue > 0.5 ? <span style={{ color: t.down }}>{fmtShort(r.overdue)} late</span> : '')}
                    onSelect={(r) => navigate(r.key === 'none' ? '/purchases' : `/purchases?vendor=${r.key}`)} empty="No unpaid vendor bills" />
            </Card>

            <Card title="Spending" note="by category, net of GST" right={<More onClick={() => open({ kind: 'metric', id: 'net' })} />}>
                <RankBars rows={model.categories.map((c) => ({
                    ...c, key: c.name, name: c.label,
                    tip: <TipBody title={c.label} rows={[{ label: 'This period', value: fmtInr(c.value), color: cat[1] }, ...(c.prev !== null ? [{ label: 'Previous', value: fmtInr(c.prev) }] : []), { label: 'Entries', value: String(c.count) }]} />,
                }))} format={fmtShort} color={cat[1]} total={model.pl.expenses}
                    sub={(r) => (r.prev !== null && r.prev > 0 ? <Delta invert value={((r.value - r.prev) / r.prev) * 100} /> : null)}
                    onSelect={(r) => open({ kind: 'category', name: r.key })} empty="No expenses in this period" />
            </Card>

            <Card title="Invoice health" note="this period’s invoices, by payment state">
                <BigCount value={model.states.reduce((s, x) => s + x.count, 0)} label="invoices issued" />
                <SplitBar format={fmtShort} unit="Invoiced" parts={model.states.map((s) => ({ id: s.id, label: s.label, value: s.amount, color: stateColor[s.id], note: `${s.count}` }))}
                    onSelect={(p) => open({ kind: 'state', id: p.id })} />
            </Card>

            <Card title="Cash position" note="every rupee in and out, all time" right={<More label="Cash book" to="/cashbook" />}>
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12 }}>
                    <Figure big label="received" value={fmtShort(cash.received)} />
                    <Figure big label="paid out" value={fmtShort(cash.paidOut)} />
                    <Figure big label="net" value={fmtShort(cash.net)} tone={cash.net < 0 ? 'down' : 'up'} />
                </div>
                <div style={{ fontSize: 9, letterSpacing: '0.1em', color: t.faint, marginBottom: 4 }}>MONEY IN</div>
                <RankBars rows={inRows} format={fmtShort} color={cat[2]} max={4} empty="Nothing received yet" />
                <div style={{ fontSize: 9, letterSpacing: '0.1em', color: t.faint, margin: '10px 0 4px' }}>MONEY OUT</div>
                <RankBars rows={outRows} format={fmtShort} color={cat[1]} max={2} empty="Nothing paid out yet" />
            </Card>

            <Card title="GST" note="output vs input tax in this period · a preparation aid" right={<More label="Tax summary" to="/tax-summary" />}>
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12 }}>
                    <Figure big label="collected" value={fmtShort(gst.output.gst)} />
                    <Figure big label="paid" value={fmtShort(gst.input.gst)} />
                    <Figure big label={gst.netPayable >= 0 ? 'net payable' : 'credit'} value={fmtShort(Math.abs(gst.netPayable))} tone={gst.netPayable > 0 ? 'down' : 'up'} />
                </div>
                <SplitBar format={fmtShort} unit="GST" parts={[
                    { id: 'out', label: 'Output GST', value: gst.output.gst, color: cat[0], note: `${gst.output.count}` },
                    { id: 'in', label: 'Input GST', value: gst.input.gst, color: cat[1] },
                ]} onSelect={() => navigate('/tax-summary')} />
            </Card>
        </CardGrid>

        <div style={{ fontSize: 10, color: t.faint, marginTop: 16, lineHeight: 1.6 }}>
            Profit is taxable income less expenses and purchase bills, net of GST. Receivables, payables and cash position are as of today and do not follow the period.
        </div>
    </>);
}
