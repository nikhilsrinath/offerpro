import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, UserPlus } from 'lucide-react';
import { Page, Btn, Muted } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { Step, BulkFrame, LiveFeed, Outcome } from './shared/BulkKit';

import CSVUploader from './shared/CSVUploader';
import ValidationTable from './shared/ValidationTable';
import BulkProgressTracker from './shared/BulkProgressTracker';
import { useOrg } from '../../context/OrgContext';
import { storageService } from '../../services/storageService';
import { useSection } from '../financial/financeHooks';
import { toIsoDate } from '../../services/importDates';
import { findDuplicates } from '../../services/employeeImport';

const MOCK_TEAM_SAMPLE = [
    { first_name: "Rahul", last_name: "Sharma", email: "rahul@example.com", role: "UI Designer", department: "Product", location: "Chennai", start_date: "01-Apr-2026", employee_id: "EMP100" },
    { first_name: "Priya", last_name: "Menon", email: "priya@example.com", role: "Backend Developer", department: "Engineering", location: "Bangalore", start_date: "01-Apr-2026", employee_id: "EMP101" },
    { first_name: "Arjun", last_name: "Kumar", email: "invalid-email", role: "Marketing Analyst", department: "Marketing", location: "Chennai", start_date: "01-Apr-2026", employee_id: "" },
];

const COLUMNS = ['first_name', 'last_name', 'email', 'role', 'department', 'location', 'start_date', 'employee_id'];

const VALIDATION_CONFIG = {
    first_name: { required: true },
    last_name: { required: true },
    email: { required: true, email: true },
    role: { required: true },
    // Held as yyyy-mm-dd; a date the sheet gave that could not be read is kept
    // as typed so it shows up here instead of vanishing.
    start_date: { validate: (val) => (val && toIsoDate(val) == null ? 'start date is not a valid date' : '') },
};

const DATE_COLUMNS = ['start_date'];

export default function BulkTeamMembers() {
    const t = useT();
    const navigate = useNavigate();
    const { activeOrg } = useOrg();
    const [step, setStep] = useState(1);
    const [data, setData] = useState([]);

    // Progress states
    const [processed, setProcessed] = useState(0);
    const [failed, setFailed] = useState(0);
    const [importStatus, setImportStatus] = useState('idle');
    const [results, setResults] = useState([]);
    // Rows whose name matches someone already here but who the user says is a
    // different person. Kept by the row's own key so deleting rows does not shift it.
    const [ignored, setIgnored] = useState(() => new Set());

    const registry = useSection('employees');
    const exEmployees = useSection('ex_employees');
    const registryRows = useMemo(() => [...registry, ...exEmployees], [registry, exEmployees]);

    const handleUpload = (parsedData) => {
        setData(parsedData.map((row, i) => ({
            ...row,
            _key: `r${Date.now()}-${i}`,
            // A sheet hands dates over as serial numbers; they are kept as yyyy-mm-dd.
            start_date: toIsoDate(row.start_date) ?? String(row.start_date),
            employee_id: row.employee_id == null ? '' : String(row.employee_id).trim(),
        })));
        setIgnored(new Set());
        setStep(2);
    };

    const deleteRow = (idx) => setData((rows) => rows.filter((_, i) => i !== idx));
    const ignoreRow = (idx) => setIgnored((prev) => new Set(prev).add(data[idx]?._key));

    // The registry and the rows above each row, checked for the same email, the
    // same employee ID (both stop the row) and the same name (the user may ignore).
    // A row matching an ex-employee is that person rejoining: it brings their record back.
    const checks = useMemo(() => findDuplicates(data, registryRows, ignored), [data, registryRows, ignored]);
    const rowCheck = (row, idx) => {
        const c = checks[idx] || { errors: [], warning: '' };
        const back = c.rejoin;
        return back
            ? { ...c, note: `Rejoining · ${back.studentName || back.name || 'ex-employee'}${back.employee_code ? ` keeps ${back.employee_code}` : ''}` }
            : c;
    };

    const handleEdit = (rowIdx, colKey, value) => {
        setData((rows) => rows.map((r, i) => (i === rowIdx ? { ...r, [colKey]: value } : r)));
        // An edit can make it a different person: ask again.
        setIgnored((prev) => { const next = new Set(prev); next.delete(data[rowIdx]?._key); return next; });
    };

    const validateRow = (row) => {
        let isValid = true;
        Object.keys(VALIDATION_CONFIG).forEach(col => {
            const val = row[col] || '';
            const rules = VALIDATION_CONFIG[col];
            if (rules.required && !val.toString().trim()) isValid = false;
            if (rules.email && val && !/^\S+@\S+\.\S+$/.test(val)) isValid = false;
            if (rules.validate && rules.validate(val, row)) isValid = false;
        });
        return isValid;
    };

    const rowOk = (row, idx) => validateRow(row) && !checks[idx]?.errors.length && !checks[idx]?.warning;

    const startImport = async () => {
        const validRows = data.map((r, i) => ({ ...r, _rejoin: checks[i]?.rejoin || null })).filter((r, i) => rowOk(r, i));
        if (validRows.length === 0) return;

        const orgId = activeOrg?.id;
        if (!orgId) return;

        setStep(3);
        setImportStatus('processing');
        setProcessed(0);
        setFailed(0);
        setResults([]);

        const newResults = [];
        let pCount = 0;
        let fCount = 0;

        for (let i = 0; i < validRows.length; i++) {
            const row = validRows[i];

            try {
                const first = String(row.first_name || '').trim();
                const last = String(row.last_name || '').trim();
                const details = {
                    studentName: `${first} ${last}`.trim(),
                    email: String(row.email || '').trim(),
                    role: row.role || '',
                    department: row.department || '',
                    location: row.location || '',
                    startDate: toIsoDate(row.start_date) || '',
                    offerType: 'fulltime',
                };
                if (row._rejoin) {
                    // Their old record comes back with its Employee ID; no second row.
                    await storageService.rejoinEmployee(row._rejoin.id, details, orgId);
                } else {
                    await storageService.saveEmployee({ ...details, employee_code: row.employee_id || '' }, orgId);
                }

                pCount++;
                setProcessed(pCount);
                newResults.push({ ...row, status: row._rejoin ? 'Rejoined' : 'Imported', timestamp: new Date().toLocaleTimeString() });
            } catch (err) {
                fCount++;
                setFailed(fCount);
                newResults.push({ ...row, status: 'Failed', error: err.message || 'Failed to save employee' });
            }
            setResults([...newResults]);
        }

        setImportStatus('done');
        setStep(4);
    };

    const validCount = data.filter((r, i) => rowOk(r, i)).length;
    const running = step === 3 || step === 4;

    return (
        <Page>
            <BulkFrame feed={running && (
                <LiveFeed
                    title="Import log"
                    items={results.map((r) => ({
                        title: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
                        status: r.status,
                        failed: r.status === 'Failed',
                        detail: r.status === 'Failed' ? r.error
                            : r.status === 'Rejoined' ? `back as ${r.role}, their record and Employee ID restored`
                            : `${r.role} profile added`,
                    }))}
                    working={step === 3}
                    workingText="Processing next employee…"
                />
            )}>
                {step === 1 && (
                    <Step n={1} title="Upload employee data" note="Use the template's column names">
                        <CSVUploader columns={COLUMNS} onUpload={handleUpload} sampleData={MOCK_TEAM_SAMPLE} />
                    </Step>
                )}

                {step === 2 && (
                    <Step n={2} title="Check and fix rows" actions={<Btn size="sm" onClick={() => setStep(1)}>Upload a different file</Btn>}>
                        <ValidationTable data={data} columns={COLUMNS} onEdit={handleEdit} validationConfig={VALIDATION_CONFIG}
                            dateColumns={DATE_COLUMNS} onDeleteRow={deleteRow} rowCheck={rowCheck} onIgnore={ignoreRow} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14, paddingTop: 14, borderTop: '1px solid ' + t.lineSoft }}>
                            <Muted size={12.5}>
                                Rows with errors are skipped, and so are rows that match a current employee,
                                fix them, delete them, or ignore a matching name if it is a different person.
                                A row matching an ex-employee brings them back on their old record.
                            </Muted>
                            <div style={{ flex: 1 }} />
                            <Btn primary onClick={startImport} disabled={validCount === 0}>
                                <UserPlus aria-hidden="true" size={13} strokeWidth={2} /> Import {validCount} employee{validCount === 1 ? '' : 's'}
                            </Btn>
                        </div>
                    </Step>
                )}

                {running && (
                    <BulkProgressTracker total={validCount} processed={processed} failed={failed} status={importStatus} noun="employees" verb="Imported" />
                )}

                {step === 4 && (
                    <Outcome
                        ok={`${processed} profile${processed === 1 ? '' : 's'} created`}
                        failed={failed}
                        action={(
                            <Btn primary onClick={() => navigate('/employees')}>
                                <Users aria-hidden="true" size={13} strokeWidth={1.8} /> View employee registry
                            </Btn>
                        )}
                    >
                        {failed} row{failed === 1 ? '' : 's'} failed to import.
                    </Outcome>
                )}
            </BulkFrame>
        </Page>
    );
}
