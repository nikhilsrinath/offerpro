import React, { useState } from 'react';
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
    role: { required: true }
};

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

    const handleUpload = (parsedData) => {
        setData(parsedData);
        setStep(2);
    };

    const handleEdit = (rowIdx, colKey, value) => {
        const newData = [...data];
        newData[rowIdx][colKey] = value;
        setData(newData);
    };

    const validateRow = (row) => {
        let isValid = true;
        Object.keys(VALIDATION_CONFIG).forEach(col => {
            const val = row[col] || '';
            const rules = VALIDATION_CONFIG[col];
            if (rules.required && !val.toString().trim()) isValid = false;
            if (rules.email && val && !/^\S+@\S+\.\S+$/.test(val)) isValid = false;
        });
        return isValid;
    };

    const startImport = async () => {
        const validRows = data.filter(r => validateRow(r));
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
                await storageService.saveEmployee({
                    first_name: row.first_name || '',
                    last_name: row.last_name || '',
                    email: row.email || '',
                    role: row.role || '',
                    department: row.department || '',
                    location: row.location || '',
                    start_date: row.start_date || '',
                    employee_id: row.employee_id || '',
                }, orgId);

                pCount++;
                setProcessed(pCount);
                newResults.push({ ...row, status: 'Imported', timestamp: new Date().toLocaleTimeString() });
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

    const validCount = data.filter(r => validateRow(r)).length;
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
                        detail: r.status === 'Failed' ? r.error : `${r.role} profile added`,
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
                        <ValidationTable data={data} columns={COLUMNS} onEdit={handleEdit} validationConfig={VALIDATION_CONFIG} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14, paddingTop: 14, borderTop: '1px solid ' + t.lineSoft }}>
                            <Muted size={11}>Rows with errors are skipped. Only valid rows create profiles.</Muted>
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
