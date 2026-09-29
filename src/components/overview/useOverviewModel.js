import { useEffect, useMemo, useState } from 'react';
import { useSection } from '../financial/financeHooks';
import { loadFinanceCategories } from '../../services/financeCategories';
import { todayIso } from '../../services/financeAnalytics';
import { buildOverview } from './overviewModel';

/**
 * The one overview model every dashboard page — and the hub's widget
 * drill-downs — reads from, so the same figure can never disagree between them.
 */
export function useOverviewModel(periodId, today = todayIso()) {
    const finDocs = useSection('fin_docs');
    const records = useSection('records');
    const employees = useSection('employees');
    const exEmployees = useSection('ex_employees');
    const expenses = useSection('expenses');
    const income = useSection('income_entries');
    const purchases = useSection('purchase_invoices');
    const vendors = useSection('vendors');
    const leads = useSection('crm_leads');
    const tasks = useSection('tasks');
    const catalog = useSection('catalog');

    // Reference data, not tenant data, so it is not in orgStore's cache. Only
    // the category LABELS need it; every figure is computed from the treatment
    // already stamped on each row, so a slow fetch cannot move a number.
    const [, setCatsReady] = useState(false);
    useEffect(() => { loadFinanceCategories().then(() => setCatsReady(true)); }, []);

    const model = useMemo(() => buildOverview(
        { finDocs, records, employees, exEmployees, expenses, income, purchases, vendors, leads, tasks, catalog },
        periodId, today,
    ), [finDocs, records, employees, exEmployees, expenses, income, purchases, vendors, leads, tasks, catalog, periodId, today]);

    return model;
}
