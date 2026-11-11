// Pay: records one month's salary for one employee as a General Ledger debit
// (category Salaries / Intern stipend, the person as "Paid to"). The sum is
// worked out here (gross − unpaid leave + bonus − deduction − TDS = net) and
// the net is the cash that went out; TDS is kept beside it (0103), the month
// in pay_period (0109).
import { useEffect, useMemo, useState } from 'react';
import { Modal, Field, Input, Select, Textarea, Btn, Status } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { orgStore } from '../../services/orgStore';
import { leaveService } from '../../services/leaveService';
import { PAYMENT_METHODS } from '../../shared/financeTaxonomy';
import { baseCurrency, formatCurrency } from '../../shared/currency.js';
import { useToast } from '../shared/Toast';
import { useSection } from '../financial/financeHooks';
import {
    monthlySalary, monthKeyOf, payPeriodOf, monthName, unpaidLeaveDays, salaryBreakdown,
    salaryPaidIn, payrollCategory, daysInMonth,
} from '../../shared/payroll';

const todayIso = () => new Date().toISOString().slice(0, 10);

/** The last twelve months, newest first, as 'YYYY-MM'. */
function recentMonthKeys(n = 12) {
    const d = new Date();
    return Array.from({ length: n }, (_, i) => monthKeyOf(new Date(d.getFullYear(), d.getMonth() - i, 1)));
}

const missingColumn = (err) => /pay_period/.test(String(err?.message || '')) && /column|schema/i.test(String(err?.message || ''));

export default function PaySalaryPanel({ emp, orgId, onClose, onPaid }) {
    const t = useT();
    const toast = useToast();
    const expenses = useSection('expenses');
    const name = emp.full_name || emp.name || 'Employee';
    const currency = (emp.currency || baseCurrency()).toUpperCase();
    const foreign = currency !== baseCurrency().toUpperCase();
    const fmt = (v) => formatCurrency(v, { currency });

    const [month, setMonth] = useState(monthKeyOf());
    const [gross, setGross] = useState(String(monthlySalary(emp) ?? ''));
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

    const pay = async () => {
        setError('');
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
        setBusy(true);
        try {
            try {
                await orgStore.addItem('expenses', entry);
            } catch (err) {
                // 0109 not applied yet: save it without the month column.
                if (!missingColumn(err)) throw err;
                const { pay_period: _p, ...rest } = entry;
                await orgStore.addItem('expenses', rest);
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
                    <Select value={month} onChange={(e) => setMonth(e.target.value)}>
                        {recentMonthKeys().map((k) => <option key={k} value={k}>{monthName(k)}</option>)}
                    </Select>
                </Field>
                {already.length > 0 && (
                    <div><Status tone="up">Already paid for {monthName(month)}: {fmt(already.reduce((s, e) => s + (Number(e.original_amount) || 0), 0))}</Status></div>
                )}
                <Field label="Gross salary" hint={`From the employee's pay (${emp.paymentFrequency || 'Monthly'}). Change it for this month only.`}>
                    <Input type="number" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="0" />
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

                <div className="stat-box" style={{ padding: '10px 16px' }}>
                    {row('Gross', fmt(b.gross))}
                    {b.lop > 0 && row(`Unpaid leave (${Number(lopDays) || 0}d)`, '− ' + fmt(b.lop), { dim: true })}
                    {b.bonus > 0 && row('Bonus', '+ ' + fmt(b.bonus), { dim: true })}
                    {b.deduction > 0 && row('Other deduction', '− ' + fmt(b.deduction), { dim: true })}
                    {b.tds > 0 && row('TDS', '− ' + fmt(b.tds), { dim: true })}
                    {row('Net pay', fmt(b.net), { strong: true })}
                </div>

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
                {error && <div style={{ color: t.down, fontSize: 12.5 }}>{error}</div>}
            </div>
        </Modal>
    );
}
