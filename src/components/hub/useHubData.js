import { useEffect, useMemo, useState } from 'react';
import { orgStore } from '../../services/orgStore';
import { documentStore } from '../../services/documentStore';
import { salesGeoService, periodRange } from '../../services/salesGeoService';
import { countsAsIncome, loadFinanceCategories } from '../../services/financeCategories';
import { cashPosition } from '../../services/financeAnalytics';
import { getStatus as getBrainStatus } from '../../services/brainService';

/* ══════════════════════════════════════════════════════════════════════════
   Everything the hub's widgets read, derived once per change.

   The figures follow the rules the old hub established:
     · revenue = settled invoices + cash-book income that counts as takings
       (funding and refunds excluded by countsAsIncome);
     · spend   = expenses that have left the bank + what has actually been
       paid against vendor bills, on the day it left;
     · every figure is computed from the org's live sections, never sampled.
   ══════════════════════════════════════════════════════════════════════════ */

export const dayKey = (d) => {
    const x = new Date(d);
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
};

const docValue = (d) => Number(d.grand_total || d.amount || d.subtotal || 0);
const num = (v) => Number(v) || 0;
const pct = (now, prev) => (prev > 0 ? ((now - prev) / prev) * 100 : (now > 0 ? 100 : 0));

/**
 * A live list for an orgStore section. Subscribes only once the org is loaded:
 * listenSection is a no-op before then, and a hook that subscribed too early
 * would sit on an empty list for the life of the page.
 */
function useLive(section, ready) {
    const [list, setList] = useState(() => orgStore.getSectionAsList(section));
    useEffect(() => {
        if (!ready) return undefined;
        return orgStore.listenSection(section, (value) => setList(Object.values(value || {})));
    }, [section, ready]);
    return list;
}

export function useHubData(activeOrg, geoPeriod = '12M') {
    const orgId = activeOrg?.id || null;
    const [readyFor, setReadyFor] = useState(null);
    const ready = !!orgId && readyFor === orgId;
    const [loadError, setLoadError] = useState(null);

    useEffect(() => {
        if (!orgId) return undefined;
        let alive = true;
        (async () => {
            try {
                documentStore.setContext(orgId);
                await documentStore.init();
                if (alive) { setReadyFor(orgId); setLoadError(null); }
            } catch (err) {
                if (alive) { setReadyFor(orgId); setLoadError(err?.message || 'Could not load your data'); }
            }
        })();
        return () => { alive = false; };
    }, [orgId]);

    // Category treatments, the fallback countsAsIncome uses for older rows.
    useEffect(() => { loadFinanceCategories(); }, []);

    const finDocs = useLive('fin_docs', ready);
    const records = useLive('records', ready);
    const income = useLive('income_entries', ready);
    const expenses = useLive('expenses', ready);
    const purchases = useLive('purchase_invoices', ready);
    const employees = useLive('employees', ready);
    const departments = useLive('departments', ready);
    const tasks = useLive('tasks', ready);
    const leads = useLive('crm_leads', ready);
    const notifs = useLive('fin_notifs', ready);

    /* ── money ──────────────────────────────────────────────────────────── */
    const money = useMemo(() => {
        const invoices = finDocs.filter((d) => d.type === 'invoice');
        const paid = invoices.filter((d) => d.status === 'paid');
        const earned = income.filter(countsAsIncome);

        const inEvents = [
            ...paid.map((d) => ({ at: d.issue_date || d.created_at, amount: docValue(d) })),
            ...earned.map((e) => ({ at: e.date || e.received_on, amount: num(e.amount) })),
        ].filter((x) => x.at);
        const outEvents = [
            ...expenses
                .filter((e) => e.status !== 'pending')
                .map((e) => ({ at: e.paid_on || e.date || e.incurred_on, amount: num(e.amount) })),
            ...purchases
                .filter((b) => b.status !== 'void' && num(b.amount_paid) > 0)
                .map((b) => ({ at: b.paid_on || b.bill_date, amount: num(b.amount_paid) })),
        ].filter((x) => x.at);

        const inByDay = new Map();
        const outByDay = new Map();
        inEvents.forEach((x) => { const k = dayKey(x.at); inByDay.set(k, (inByDay.get(k) || 0) + x.amount); });
        outEvents.forEach((x) => { const k = dayKey(x.at); outByDay.set(k, (outByDay.get(k) || 0) + x.amount); });

        const today = new Date();
        const mStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const pStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        // Last month up to the same day, so the 24th is compared with the 24th
        // rather than with a whole month.
        const pSameDay = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate(), 23, 59, 59);
        const sumBetween = (evs, from, to) => evs
            .filter((x) => { const d = new Date(x.at); return d >= from && (!to || d < to); })
            .reduce((a, x) => a + x.amount, 0);

        const revMonth = sumBetween(inEvents, mStart);
        const revPrev = sumBetween(inEvents, pStart, mStart);
        const revPrevToDate = sumBetween(inEvents, pStart, pSameDay);
        const spendMonth = sumBetween(outEvents, mStart);
        const spendPrev = sumBetween(outEvents, pStart, mStart);
        const spendPrevToDate = sumBetween(outEvents, pStart, pSameDay);

        const spark = (map, days = 30) => {
            const out = [];
            for (let i = days - 1; i >= 0; i--) {
                const d = new Date(today); d.setDate(d.getDate() - i);
                out.push(map.get(dayKey(d)) || 0);
            }
            return out;
        };
        // Cumulative within the month reads as progress; daily totals of a
        // business with a few invoices a month are mostly zeros.
        const cumulative = (arr) => arr.reduce((acc, v) => { acc.push((acc[acc.length - 1] || 0) + v); return acc; }, []);

        // Net cash follows EdgeBrain's cash.* rules (financeAnalytics.cashPosition,
        // 0066) — every receipt and payment, funding included — so the tile and
        // the assistant give the same number. Revenue above stays earned money.
        const cash = cashPosition({ finDocs, income, expenses, purchases });
        const byDay = (evs) => {
            const m = new Map();
            evs.filter((x) => x.at).forEach((x) => { const k = dayKey(x.at); m.set(k, (m.get(k) || 0) + x.amount); });
            return m;
        };
        const cashOut30 = spark(byDay(cash.outEvents), 30);
        const net30 = spark(byDay(cash.inEvents), 30).map((v, i) => v - cashOut30[i]);

        /* receivables */
        const DONE = new Set(['paid', 'void', 'cancelled', 'draft']);
        const open = invoices
            .filter((d) => !DONE.has(d.status))
            .map((d) => {
                const due = d.due_date ? new Date(`${String(d.due_date).slice(0, 10)}T00:00:00`) : null;
                const days = due ? Math.round((due - new Date(today.toDateString())) / 86400000) : null;
                return {
                    id: d.id,
                    number: d.doc_number || d.invoiceNumber || '',
                    client: d.issued_to || d.client?.name || d.client_name || 'Client',
                    outstanding: documentStore.outstandingOf(d),
                    due, days,
                };
            })
            .filter((r) => r.outstanding > 0)
            .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));
        const receivable = open.reduce((a, r) => a + r.outstanding, 0);
        const overdue = open.filter((r) => r.days !== null && r.days < 0);

        const payable = purchases
            .filter((b) => b.status !== 'void' && b.status !== 'paid')
            .reduce((a, b) => a + Math.max(0, num(b.total || b.amount || b.grand_total) - num(b.amount_paid)), 0);

        return {
            inByDay, outByDay,
            revMonth, revPrev, revDelta: pct(revMonth, revPrevToDate),
            spendMonth, spendPrev, spendDelta: pct(spendMonth, spendPrevToDate),
            sparkRev: cumulative(spark(inByDay, today.getDate())),
            sparkSpend: cumulative(spark(outByDay, today.getDate())),
            sparkNet: cumulative(net30),
            totalIn: cash.received, totalOut: cash.paidOut, netCash: cash.net, cashBySource: cash.bySource,
            inCount: inEvents.length, outCount: outEvents.length,
            invoiceCount: invoices.length, paidCount: paid.length,
            settled: invoices.length ? (paid.length / invoices.length) * 100 : 0,
            paidValue: paid.reduce((a, d) => a + docValue(d), 0),
            open, receivable, overdue, overdueValue: overdue.reduce((a, r) => a + r.outstanding, 0),
            payable,
        };
    }, [finDocs, income, expenses, purchases]);

    /* ── documents ──────────────────────────────────────────────────────── */
    const docs = useMemo(() => {
        const all = [
            ...records.filter((r) => r.type !== 'invoice').map((r) => ({ type: r.type, at: r.created_at })),
            ...finDocs.map((d) => ({ type: d.type, at: d.issue_date || d.created_at })),
        ].filter((d) => d.at);
        const today = new Date();
        const months = [];
        for (let i = 11; i >= 0; i--) {
            const from = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const to = new Date(today.getFullYear(), today.getMonth() - i + 1, 1);
            months.push({
                label: from.toLocaleDateString('en-IN', { month: 'short' }),
                full: from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
                value: all.filter((x) => { const d = new Date(x.at); return d >= from && d < to; }).length,
            });
        }
        const byType = {};
        all.forEach((d) => { byType[d.type] = (byType[d.type] || 0) + 1; });
        const thisMonth = months[11].value;
        return {
            total: all.length, thisMonth, delta: pct(thisMonth, months[10].value), months,
            byType: Object.entries(byType).sort((a, b) => b[1] - a[1]),
        };
    }, [records, finDocs]);

    /* ── people & work ──────────────────────────────────────────────────── */
    const team = useMemo(() => {
        const gone = new Set(['inactive', 'terminated', 'exited', 'resigned', 'offboarded']);
        const active = employees.filter((e) => !gone.has(String(e.status || '').toLowerCase()));
        const mStart = new Date(); mStart.setDate(1); mStart.setHours(0, 0, 0, 0);
        const joined = active.filter((e) => {
            const d = e.joining_date || e.joiningDate || e.start_date || e.created_at;
            return d && new Date(d) >= mStart;
        }).length;
        const byDept = {};
        active.forEach((e) => {
            const k = e.department || e.dept || e.department_name || 'Unassigned';
            byDept[k] = (byDept[k] || 0) + 1;
        });

        const todayKey = new Date().toISOString().slice(0, 10);
        const openTasks = tasks.filter((x) => x.status !== 'done');
        const overdueTasks = openTasks.filter((x) => x.status === 'overdue' || (x.deadline && x.deadline < todayKey));
        const dueToday = openTasks.filter((x) => x.deadline === todayKey);
        return {
            headcount: active.length, departments: departments.length || Object.keys(byDept).length, joined,
            byDept: Object.entries(byDept).sort((a, b) => b[1] - a[1]),
            tasks: {
                total: tasks.length, open: openTasks.length, overdue: overdueTasks.length, today: dueToday.length,
                done: tasks.length - openTasks.length,
                next: openTasks
                    .filter((x) => x.deadline)
                    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
                    .slice(0, 3),
            },
        };
    }, [employees, departments, tasks]);

    const pipeline = useMemo(() => {
        const STAGES = [
            { id: 'lead', label: 'Lead' },
            { id: 'contacted', label: 'Contacted' },
            { id: 'deal', label: 'Won' },
            { id: 'not_deal', label: 'Lost' },
        ];
        const ids = new Set(STAGES.map((s) => s.id));
        // Mirrors CRM.jsx: stage, falling back to status for older rows.
        const stageOf = (l) => (l.stage && l.stage !== 'lead' && ids.has(l.stage) ? l.stage : ids.has(l.status) ? l.status : 'lead');
        const counts = Object.fromEntries(STAGES.map((s) => [s.id, 0]));
        leads.forEach((l) => { counts[stageOf(l)] += 1; });
        const decided = counts.deal + counts.not_deal;
        return {
            total: leads.length,
            stages: STAGES.map((s) => ({ ...s, count: counts[s.id] })),
            winRate: decided ? (counts.deal / decided) * 100 : null,
        };
    }, [leads]);

    /* ── geography ──────────────────────────────────────────────────────── */
    const [geoRows, setGeoRows] = useState(null);
    useEffect(() => {
        if (!orgId) return undefined;
        let cancelled = false;
        const { from, to } = periodRange(String(geoPeriod).toLowerCase());
        salesGeoService.byCountry(orgId, { from, to })
            .then((rows) => { if (!cancelled) setGeoRows(rows || []); })
            .catch(() => { if (!cancelled) setGeoRows([]); });
        return () => { cancelled = true; };
    }, [orgId, geoPeriod]);

    const geo = useMemo(() => {
        // The RPC aggregates documents and cash-book rows in one pass. When it
        // returns nothing (failed, or not applied to this database) the same
        // sources are read from the cache on the same terms.
        let rows = (geoRows || []).filter((r) => r.code && (r.revenue > 0 || r.cashOut > 0));
        if (rows.length === 0) {
            const agg = new Map();
            const at = (code) => {
                const c = String(code || '').toUpperCase();
                if (c.length !== 2) return null;
                if (!agg.has(c)) agg.set(c, { code: c, revenue: 0, invoiced: 0, direct: 0, docCount: 0, cashIn: 0, cashOut: 0, incomeCount: 0, expenseCount: 0 });
                return agg.get(c);
            };
            finDocs.forEach((d) => {
                const row = at(d.country_code || d.country);
                if (!row) return;
                row.revenue += docValue(d); row.invoiced += docValue(d); row.docCount += 1;
            });
            income.forEach((e) => {
                const row = at(e.country_code);
                if (!row) return;
                const gross = num(e.amount);
                row.cashIn += gross; row.incomeCount += 1;
                if (countsAsIncome(e)) { row.revenue += gross; row.direct += gross; }
            });
            expenses.filter((e) => e.status !== 'pending').forEach((e) => {
                const row = at(e.country_code);
                if (!row) return;
                row.cashOut += num(e.amount); row.expenseCount += 1;
            });
            rows = [...agg.values()].filter((r) => r.revenue > 0 || r.cashOut > 0);
        }
        const ranked = rows.slice().sort((a, b) => b.revenue - a.revenue);
        const total = ranked.reduce((a, r) => a + r.revenue, 0);
        const max = ranked[0]?.revenue || 1;
        const byCode = new Map();
        ranked.forEach((r) => {
            const level = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(Math.max(0, r.revenue) / max) * 5)));
            byCode.set(r.code, { ...r, level, share: total ? (r.revenue / total) * 100 : 0 });
        });
        return {
            ranked, total, byCode, top: ranked.slice(0, 5), loading: geoRows === null,
            // Beside the total, never inside it: spend is a separate fact about a market.
            direct: ranked.reduce((a, r) => a + (r.direct || 0), 0),
            cashOut: ranked.reduce((a, r) => a + (r.cashOut || 0), 0),
        };
    }, [geoRows, finDocs, income, expenses]);

    /* ── EdgeBrain ──────────────────────────────────────────────────────── */
    const [brain, setBrain] = useState({ loading: true, status: null, error: null });
    useEffect(() => {
        if (!orgId) return undefined;
        let cancelled = false;
        getBrainStatus(orgId)
            .then((status) => { if (!cancelled) setBrain({ loading: false, status, error: null }); })
            .catch((err) => { if (!cancelled) setBrain({ loading: false, status: null, error: err?.message || 'Unavailable' }); });
        return () => { cancelled = true; };
    }, [orgId]);

    const notifications = useMemo(
        () => [...notifs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
        [notifs],
    );

    return {
        ready, loadError, money, docs, team, pipeline, geo, brain, notifications,
        finDocs, income, expenses,
    };
}
