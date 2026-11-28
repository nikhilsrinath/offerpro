// Pay: records one month's salary for one employee as a General Ledger debit
// (category Salaries / Intern stipend, the person as "Paid to"). The sum is
// worked out here (gross − unpaid leave + bonus − deduction − TDS = net) and
// the net is the cash that went out; TDS is kept beside it (0103), the month
// in pay_period (0109).
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal, Field, Input, Select, Textarea, Btn, Status } from '../ui/edge';
import { canAllocate, saveSplitFromPicker } from '../../services/projectService';
import { isOpen } from '../../services/projectAnalytics';
import { useT, MONO } from '../ui/edgeUtils';
import ProjectSelect from '../shared/ProjectSelect';
import { orgStore } from '../../services/orgStore';
import { leaveService } from '../../services/leaveService';
import { PAYMENT_METHODS } from '../../shared/financeTaxonomy';
import { baseCurrency, formatCurrency } from '../../shared/currency.js';
import { useToast } from '../shared/Toast';
import { useSection } from '../financial/financeHooks';
import {
    monthKeyOf, payPeriodOf, monthName, unpaidLeaveDays, salaryBreakdown,
    salaryPaidIn, payrollCategory, daysInMonth, revisionsOf, salaryForMonth, monthsSince,
} from '../../shared/payroll';

const todayIso = () => new Date().toISOString().slice(0, 10);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** The projects someone was on at any time in a month ('YYYY-MM'), from their Team memberships. */
function projectsInMonth(members, employeeId, monthKey) {
    const first = `${monthKey}-01`;
    const last = `${monthKey}-${String(daysInMonth(monthKey)).padStart(2, '0')}`;
    return [...new Set(members
        .filter((m) => m.employee_id === employeeId && m.start_date && m.start_date <= last && (!m.end_date || m.end_date >= first))
        .map((m) => m.project_id))];
}

const missingColumn = (err) => /pay_period/.test(String(err?.message || '')) && /column|schema/i.test(String(err?.message || ''));

export default function PaySalaryPanel({ emp, orgId, onClose, onPaid }) {
    const t = useT();
    const toast = useToast();
    const expenses = useSection('expenses');
    // Their pay history (0121): a past month is filled in at the rate it had.
    const allRevisions = useSection('pay_revisions');
    const revisions = useMemo(() => revisionsOf(allRevisions, emp.id), [allRevisions, emp.id]);
    // Every month since they joined (salaries entered for past months too).
    const months = useMemo(() => monthsSince(emp.startDate || emp.start_date), [emp.startDate, emp.start_date]);
    const name = emp.full_name || emp.name || 'Employee';
    const currency = (emp.currency || baseCurrency()).toUpperCase();
    const foreign = currency !== baseCurrency().toUpperCase();
    const fmt = (v) => formatCurrency(v, { currency });

    const [month, setMonth] = useState(monthKeyOf());
    const [gross, setGross] = useState(String(salaryForMonth(emp, monthKeyOf(), revisions) ?? ''));
    // A different month starts again from that month's rate.
    // An amount typed for the month is kept until another month is picked.
    const [grossTouched, setGrossTouched] = useState(false);
    const pickMonth = (k) => { setMonth(k); setGrossTouched(false); setGross(String(salaryForMonth(emp, k, revisions) ?? '')); };
    // The history arrives after the panel opens: the month shown takes its rate
    // then, unless an amount was typed for it.
    useEffect(() => {
        if (!grossTouched) setGross(String(salaryForMonth(emp, month, revisions) ?? ''));
    }, [revisions]); // eslint-disable-line react-hooks/exhaustive-deps
    const [lopDays, setLopDays] = useState('');
    const [lopTouched, setLopTouched] = useState(false);
    const [bonus, setBonus] = useState('');
    const [deduction, setDeduction] = useState('');
    const [tds, setTds] = useState('');
    const [paidOn, setPaidOn] = useState(todayIso());
    const [method, setMethod] = useState('bank_transfer');
    const [reference, setReference] = useState('');
    const [fxRate, setFxRate] = useState('');
    const [notes, setNotes] = useState('');
    const [leave, setLeave] = useState({ requests: [], types: [], loaded: false });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    // Which project(s) the pay is for. Starts on the projects they were on that
    // month (one: all of it; several: an amount each); what is left over stays
    // General. Saved as the salary's project split, so each project's ledger
    // and Labour (0122) count their share.
    const canSplit = canAllocate();
    const members = useSection('project_members');
    const projects = useSection('projects');
    const [split, setSplit] = useState([]);
    const [splitTouched, setSplitTouched] = useState(false);
    useEffect(() => {
        if (splitTouched) return;
        setSplit(projectsInMonth(members, emp.id, month).map((id) => ({ project_id: id, amount: '' })));
    }, [members, emp.id, month, splitTouched]);
    const editSplit = (next) => { setSplitTouched(true); setSplit(next); };
    const projectOptions = useMemo(() => {
        const mine = new Set(projectsInMonth(members, emp.id, month));
        return projects.filter((p) => !p.archived_at && (mine.has(p.id) || isOpen(p)))
            .sort((a, b) => (mine.has(b.id) - mine.has(a.id)) || String(a.name || '').localeCompare(String(b.name || '')));
    }, [projects, members, emp.id, month]);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            leaveService.listRequests(orgId, { employeeId: emp.id }).catch(() => []),
            leaveService.listTypes(orgId).catch(() => []),
        ]).then(([requests, types]) => { if (!cancelled) setLeave({ requests, types, loaded: true }); });
        return () => { cancelled = true; };
    }, [orgId, emp.id]);

    const leaveDays = useMemo(() => unpaidLeaveDays(leave.requests, leave.types, month), [leave, month]);
    // Filled from approved unpaid leave until it is typed over.
    useEffect(() => { if (!lopTouched && leave.loaded) setLopDays(leaveDays ? String(leaveDays) : ''); }, [leaveDays, lopTouched, leave.loaded]);

    const already = salaryPaidIn(expenses, month)[emp.id] || [];
    const b = salaryBreakdown({ gross, monthKey: month, lopDays, bonus, deduction, tds });

    // The split as typed: one project with no amount takes all of it.
    const splitRows = split.filter((r) => r.project_id);
    const wholeToOne = splitRows.length === 1 && String(splitRows[0].amount).trim() === '';
    const splitUsed = wholeToOne ? b.net : r2(splitRows.reduce((n, r) => n + (Number(r.amount) || 0), 0));
    const splitLeft = r2(b.net - splitUsed);
    const splitError = (() => {
        if (!canSplit || !splitRows.length) return '';
        if (new Set(splitRows.map((r) => r.project_id)).size !== splitRows.length) return 'Each project can be listed once.';
        if (!wholeToOne && splitRows.some((r) => !(Number(r.amount) > 0))) return 'Enter how much of the pay is for each project.';
        if (splitLeft < -0.005) return `The projects add up to more than the net pay (${fmt(b.net)}).`;
        return '';
    })();

    const pay = async () => {
        setError('');
        if (splitError) return setError(splitError);
        if (!(b.gross > 0)) return setError('Enter the gross salary for the month.');
        if (b.net <= 0) return setError('Net pay comes to nothing. Check the deductions.');
        if (!paidOn) return setError('Pick the date it was paid.');
        if (foreign && !(Number(fxRate) > 0)) return setError(`Enter the ${currency} to ${baseCurrency()} rate.`);
        const lines = [
            `Gross ${fmt(b.gross)}`,
            b.lop ? `Unpaid leave ${Number(lopDays) || 0}d − ${fmt(b.lop)}` : null,
            b.bonus ? `Bonus + ${fmt(b.bonus)}` : null,
            b.deduction ? `Deduction − ${fmt(b.deduction)}` : null,
            b.tds ? `TDS − ${fmt(b.tds)}` : null,
            `Net ${fmt(b.net)}`,
        ].filter(Boolean).join(' · ');
        const entry = {
            description: `Salary ${monthName(month)} · ${name}`,
            category: payrollCategory(emp),
            employee_id: emp.id,
            original_amount: b.net,
            currency, fx_rate: foreign ? Number(fxRate) : 1,
            date: paidOn,
            payment_method: method,
            reference: reference.trim() || null,
            status: 'paid',
            tds_amount: b.tds,
            pay_period: payPeriodOf(month),
            notes: [lines, notes.trim()].filter(Boolean).join('\n'),
        };
        // Allocations are in the org's own currency, as the entry's amount is.
        const rate = foreign ? Number(fxRate) : 1;
        const picker = !canSplit || !splitRows.length ? null
            : wholeToOne || (splitRows.length === 1 && Math.abs(Number(splitRows[0].amount) - b.net) < 0.005)
                ? { mode: 'single', rows: [{ project_id: splitRows[0].project_id, amount: '' }], touched: true }
                : { mode: 'split', rows: splitRows.map((r) => ({ project_id: r.project_id, amount: String(r2(Number(r.amount) * rate)) })), touched: true };
        setBusy(true);
        try {
            let saved;
            try {
                saved = await orgStore.addItem('expenses', entry);
            } catch (err) {
                // 0109 not applied yet: save it without the month column.
                if (!missingColumn(err)) throw err;
                const { pay_period: _p, ...rest } = entry;
                saved = await orgStore.addItem('expenses', rest);
            }
            // The salary is paid either way; a split that fails is said, and can
            // be set again on the entry in the ledger.
            try {
                await saveSplitFromPicker('expense', saved?.id, picker);
            } catch (splitErr) {
                toast(`${name} paid, but the project split was not saved: ${splitErr.message}. Edit the entry in the ledger to set it.`, 'error');
            }
            toast(`${name} paid ${fmt(b.net)} for ${monthName(month)}`, 'success');
            onPaid?.();
            onClose();
        } catch (err) {
            const msg = String(err?.message || err);
            setError(/expenses_one_salary_per_month_idx|duplicate key/i.test(msg)
                ? `${name} is already paid for ${monthName(month)}.`
                : msg);
        } finally {
            setBusy(false);
        }
    };

    const row = (label, value, opts = {}) => (
        <div style={{
            display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0',
            fontSize: opts.strong ? 14 : 13, fontWeight: opts.strong ? 600 : 400,
            color: opts.dim ? t.dim : t.text,
            borderTop: opts.strong ? '1px solid ' + t.line : 'none', marginTop: opts.strong ? 4 : 0,
        }}>
            <span>{label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        </div>
    );

    return (
        <Modal open onClose={onClose} width={680} title={`Pay ${name}`}
            note={[emp.role, emp.employee_code].filter(Boolean).join(' · ') || undefined}
            footer={
                <>
                    <div style={{ flex: 1 }} />
                    <Btn onClick={onClose}>Cancel</Btn>
                    <Btn primary onClick={pay} disabled={busy || already.length > 0}>
                        {busy ? 'Paying…' : `Pay ${fmt(b.net)}`}
                    </Btn>
                </>
            }>
            <div style={{ display: 'grid', gap: 14 }}>
                <Field label="Month">
                    <Select value={month} onChange={(e) => pickMonth(e.target.value)}>
                        {months.map((k) => <option key={k} value={k}>{monthName(k)}</option>)}
                    </Select>
                </Field>
                {already.length > 0 && (
                    <div><Status tone="up">Already paid for {monthName(month)}: {fmt(already.reduce((s, e) => s + (Number(e.original_amount) || 0), 0))}</Status></div>
                )}
                <Field label="Gross salary" hint={`${revisions.length ? `Their pay in ${monthName(month)}, from their pay history` : "From the employee's pay"} (${emp.paymentFrequency || 'Monthly'}). Change it for this month only, e.g. a part month.`}>
                    <Input type="number" value={gross} onChange={(e) => { setGrossTouched(true); setGross(e.target.value); }} placeholder="0" />
                </Field>
                <Field label="Unpaid leave days" hint={leave.loaded
                    ? `${leaveDays} day${leaveDays === 1 ? '' : 's'} of approved unpaid leave in ${monthName(month)} · ${fmt(b.dailyRate)} a day (÷ ${daysInMonth(month)})`
                    : 'Reading leave…'}>
                    <Input type="number" value={lopDays} placeholder="0"
                        onChange={(e) => { setLopTouched(true); setLopDays(e.target.value); }} />
                </Field>
                <Field label="Bonus"><Input type="number" value={bonus} onChange={(e) => setBonus(e.target.value)} placeholder="0" /></Field>
                <Field label="Other deduction" hint="Advance recovery, fines…"><Input type="number" value={deduction} onChange={(e) => setDeduction(e.target.value)} placeholder="0" /></Field>
                <Field label="TDS" hint="Withheld from the pay; recorded beside the payment, not in it.">
                    <Input type="number" value={tds} onChange={(e) => setTds(e.target.value)} placeholder="0" />
                </Field>

                {canSplit && (
                    <div>
                        <div style={{ fontSize: 12.5, fontWeight: 500, color: t.dim, marginBottom: 6 }}>Projects</div>
                        <div style={{ fontSize: 11.5, color: t.faint, marginBottom: 8 }}>
                            Which project(s) this pay is for. Each project's ledger and labour cost count its share; what is left stays General.
                        </div>
                        <div style={{ display: 'grid', gap: 8 }}>
                            {split.map((r, i) => (
                                <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 150px 32px', gap: 8, alignItems: 'center' }}>
                                    {/* Name and code each in a column, the list over the panel. */}
                                    <ProjectSelect floating ariaLabel={`Project ${i + 1}`} projects={projectOptions} value={r.project_id} noneLabel=""
                                        onChange={(id) => editSplit(split.map((x, j) => (j === i ? { ...x, project_id: id } : x)))}
                                        btnStyle={{
                                            height: 32, padding: '0 10px 0 11px', borderRadius: 7, fontSize: 13, fontFamily: MONO,
                                            background: t.panelAlt, border: '1px solid ' + t.lineStrong, color: t.text,
                                        }} />
                                    <Input type="number" aria-label={`Amount for project ${i + 1}`} value={r.amount}
                                        placeholder={split.length === 1 ? 'All of it' : '0'}
                                        onChange={(e) => editSplit(split.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                                    <Btn aria-label={`Remove project ${i + 1}`} title="Remove" style={{ width: 32, padding: 0 }}
                                        onClick={() => editSplit(split.filter((_, j) => j !== i))}>
                                        <Trash2 size={14} aria-hidden="true" />
                                    </Btn>
                                </div>
                            ))}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                                <Btn onClick={() => editSplit([...split, { project_id: '', amount: '' }])}>
                                    <Plus size={14} aria-hidden="true" /> Add project
                                </Btn>
                                {splitRows.length > 0 && !splitError && (
                                    <span style={{ fontSize: 12, color: t.faint }}>
                                        {splitLeft > 0.005 ? `General (no project): ${fmt(splitLeft)}` : 'All of it is on projects'}
                                    </span>
                                )}
                                {!splitRows.length && <span style={{ fontSize: 12, color: t.faint }}>No project: all of it stays General.</span>}
                            </div>
                            {splitError && <div style={{ color: t.down, fontSize: 12 }}>{splitError}</div>}
                        </div>
                    </div>
                )}

                <Field label="Paid on"><Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
                <Field label="Method">
                    <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                        {PAYMENT_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </Select>
                </Field>
                {foreign && (
                    <Field label={`${currency} to ${baseCurrency()} rate`}>
                        <Input type="number" value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="0" />
                    </Field>
                )}
                <Field label="Reference" hint="UTR, cheque number…"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
                <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
                {/* What is being paid, last: the sum of everything above it. */}
                <div className="stat-box" style={{ padding: '10px 16px' }}>
                    {row('Gross', fmt(b.gross))}
                    {b.lop > 0 && row(`Unpaid leave (${Number(lopDays) || 0}d)`, '− ' + fmt(b.lop), { dim: true })}
                    {b.bonus > 0 && row('Bonus', '+ ' + fmt(b.bonus), { dim: true })}
                    {b.deduction > 0 && row('Other deduction', '− ' + fmt(b.deduction), { dim: true })}
                    {b.tds > 0 && row('TDS', '− ' + fmt(b.tds), { dim: true })}
                    {row('Net pay', fmt(b.net), { strong: true })}
                </div>
                {error && <div style={{ color: t.down, fontSize: 12.5 }}>{error}</div>}
            </div>
        </Modal>
    );
}
