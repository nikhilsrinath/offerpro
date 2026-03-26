import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Play, CheckCircle2, UserPlus, FileSpreadsheet } from 'lucide-react';

import CSVUploader from './shared/CSVUploader';
import ValidationTable from './shared/ValidationTable';
import BulkProgressTracker from './shared/BulkProgressTracker';

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
            await new Promise(resolve => setTimeout(resolve, 600 + Math.random() * 300));

            const hasError = !row.employee_id; // Simulating duplication or missing ID issue

            if (hasError) {
                fCount++;
                setFailed(fCount);
                newResults.push({ ...row, status: 'Failed', error: 'Missing logic or duplicate ID' });
            } else {
                pCount++;
                setProcessed(pCount);
                newResults.push({ ...row, status: 'Imported', timestamp: new Date().toLocaleTimeString() });
            }
            setResults([...newResults]);
        }

        setImportStatus('done');
        setStep(4);
    };

    const validCount = data.filter(r => validateRow(r)).length;

    return (
        <div className="bulk-page-container bulk-responsive-flex" style={{ padding: '0', maxWidth: '1400px', margin: '0 auto', minHeight: 'calc(100vh - 100px)' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <div style={{ padding: '2rem', background: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)' }}>
                    <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', margin: '0 0 0.5rem 0', fontWeight: 800 }}>Bulk Employee Import</h1>
                    <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.875rem' }}>Import your company roster via CSV to automatically populate the employee registry.</p>
                </div>

                <AnimatePresence mode="wait">
                    {step === 1 && (
                        <motion.div key="step1" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}>
                            <div style={{ background: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)', padding: '2rem' }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
                                    <h3 style={{ fontSize: '1.125rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                                        <div style={{ background: 'var(--gold)', color: '#000', width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem' }}>1</div>
                                        Upload Employee Data
                                    </h3>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                                        <FileSpreadsheet size={16} /> Use the exact template format
                                    </div>
                                </div>

                                <CSVUploader columns={COLUMNS} onUpload={handleUpload} sampleData={MOCK_TEAM_SAMPLE} />
                            </div>
                        </motion.div>
                    )}

                    {step === 2 && (
                        <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                            <div style={{ background: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)', padding: '2rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                    <h3 style={{ fontSize: '1.125rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                                        <div style={{ background: 'var(--gold)', color: '#000', width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem' }}>2</div>
                                        Validation & Editing
                                    </h3>
                                    <button onClick={() => setStep(1)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.875rem', textDecoration: 'underline' }}>Upload different file</button>
                                </div>

                                <ValidationTable
                                    data={data}
                                    columns={COLUMNS}
                                    onEdit={handleEdit}
                                    validationConfig={VALIDATION_CONFIG}
                                />

                                <div style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                                        Invalid rows will be skipped. Only valid records create profiles.
                                    </div>
                                    <button
                                        onClick={startImport}
                                        disabled={validCount === 0}
                                        style={{
                                            background: validCount > 0 ? 'var(--gold)' : 'var(--background)',
                                            color: validCount > 0 ? '#000' : 'var(--text-muted)',
                                            border: 'none',
                                            padding: '1rem 2rem',
                                            borderRadius: '8px',
                                            fontSize: '1rem',
                                            fontWeight: 700,
                                            cursor: validCount > 0 ? 'pointer' : 'not-allowed',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        <UserPlus size={18} fill="currentColor" />
                                        Import {validCount} Employees
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {(step === 3 || step === 4) && (
                        <motion.div key="step34" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                            <BulkProgressTracker
                                total={validCount}
                                processed={processed}
                                failed={failed}
                                status={importStatus}
                            />

                            {step === 4 && (
                                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} style={{ marginTop: '2rem' }}>
                                    <div style={{ background: 'rgba(46, 232, 160, 0.05)', border: '1px solid rgba(46, 232, 160, 0.2)', padding: '1.5rem', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                            <CheckCircle2 size={24} color="var(--success)" />
                                            <div>
                                                <h4 style={{ margin: 0, fontSize: '1.125rem', color: 'var(--success)' }}>{processed} Profiles Created Successfully</h4>
                                                {failed > 0 && <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--error)' }}>{failed} records failed to import.</p>}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '1rem' }}>
                                            <button style={{ background: 'var(--blue)', color: '#fff', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                                <Users size={16} /> View Employee Registry
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* RIGHT COLUMN: Live feed (only shown in steps 3 and 4) */}
            <AnimatePresence>
                {(step === 3 || step === 4) && (
                    <motion.div
                        className="bulk-side-panel"
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: '380px' }}
                        style={{
                            background: 'var(--surface)',
                            borderRadius: '16px',
                            border: '1px solid var(--border)',
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                            minWidth: '380px'
                        }}
                    >
                        <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                            <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>Import Log</h3>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {results.slice().reverse().map((res, i) => (
                                <div key={i} style={{ padding: '1rem', background: 'var(--background)', borderRadius: '8px', borderLeft: `3px solid ${res.status === 'Failed' ? 'var(--error)' : 'var(--blue)'}` }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                        <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{res.first_name} {res.last_name}</span>
                                        <span style={{ fontSize: '0.75rem', color: res.status === 'Failed' ? 'var(--error)' : 'var(--blue)', fontWeight: 600 }}>{res.status}</span>
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        {res.status === 'Failed' ? res.error : `${res.role} profile added.`}
                                    </div>
                                </div>
                            ))}
                            {step === 3 && (
                                <div style={{ padding: '1rem', background: 'transparent', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                                    Processing next employee...
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
