import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Download, Play, CheckCircle2 } from 'lucide-react';

import CSVUploader from './shared/CSVUploader';
import ValidationTable from './shared/ValidationTable';
import BulkProgressTracker from './shared/BulkProgressTracker';
import DocumentCard from './shared/DocumentCard';

const MOCK_OFFER_SAMPLE = [
    { candidate_name: "Rahul Sharma", role: "UI Designer", department: "Product", salary: "25000", start_date: "01-Apr-2026", manager_name: "Nikhil", location: "Chennai", email: "rahul@example.com" },
    { candidate_name: "Priya Menon", role: "Backend Developer", department: "Engineering", salary: "35000", start_date: "01-Apr-2026", manager_name: "Sujan", location: "Bangalore", email: "priya@example.com" },
    { candidate_name: "Arjun Kumar", role: "Marketing Analyst", department: "Marketing", salary: "", start_date: "01-Apr-2026", manager_name: "Jeremiah", location: "Chennai", email: "invalid-email" },
    { candidate_name: "Sneha Rao", role: "Data Scientist", department: "Analytics", salary: "45000", start_date: "01-Apr-2026", manager_name: "Nikhil", location: "Hyderabad", email: "sneha@example.com" }
];

const COLUMNS = ['candidate_name', 'role', 'department', 'salary', 'start_date', 'manager_name', 'location', 'email'];

const VALIDATION_CONFIG = {
    candidate_name: { required: true },
    role: { required: true },
    email: { required: true, email: true },
    salary: { required: true }
};

const TEMPLATES = [
    { id: 't1', name: 'Standard Full-Time Offer' },
    { id: 't2', name: 'Internship Offer Letter' },
    { id: 't3', name: 'Executive Contract' }
];

export default function BulkOfferLetters() {
    const [step, setStep] = useState(1); // 1: config/upload, 2: validate, 3: generating, 4: results
    const [selectedTemplate, setSelectedTemplate] = useState(TEMPLATES[0].id);
    const [data, setData] = useState([]);

    // Progress states
    const [processed, setProcessed] = useState(0);
    const [failed, setFailed] = useState(0);
    const [generationStatus, setGenerationStatus] = useState('idle'); // idle, processing, done, error
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

    const startGeneration = async () => {
        const validRows = data.filter(r => validateRow(r));
        if (validRows.length === 0) return;

        setStep(3);
        setGenerationStatus('processing');
        setProcessed(0);
        setFailed(0);
        setResults([]);

        const newResults = [];
        let pCount = 0;
        let fCount = 0;

        for (let i = 0; i < validRows.length; i++) {
            const row = validRows[i];
            // Simulate delay for generation
            await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 400));

            // Randomly fail ~5% of the time just to show error states (unless we want perfect for this demo)
            // Let's make it 100% success for valid rows usually, but we can simulate a failure manually if they had no manager_name
            const hasError = !row.manager_name;

            if (hasError) {
                fCount++;
                setFailed(fCount);
                newResults.push({ ...row, status: 'Failed', error: 'Missing manager signature mapping' });
            } else {
                pCount++;
                setProcessed(pCount);
                newResults.push({ ...row, status: 'Generated', timestamp: new Date().toLocaleTimeString() });
            }
            setResults([...newResults]); // update real-time
        }

        setGenerationStatus('done');
        setStep(4);
    };

    const validCount = data.filter(r => validateRow(r)).length;

    return (
        <div className="bulk-page-container bulk-responsive-flex" style={{ padding: '0', maxWidth: '1400px', margin: '0 auto', minHeight: 'calc(100vh - 100px)' }}>

            {/* LEFT COLUMN: Main Config & Work Area */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <div style={{ padding: '2rem', background: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }}>
                    {/* Subtle background glow */}
                    <div style={{ position: 'absolute', top: -100, right: -100, width: 300, height: 300, background: 'radial-gradient(circle, rgba(245, 200, 66, 0.05) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />
                    <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', margin: '0 0 0.5rem 0', fontWeight: 800, letterSpacing: '-0.02em' }}>Bulk Offer Letters</h1>
                    <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '1rem' }}>Generate and distribute hundreds of personalized offer letters in minutes.</p>
                </div>

                <AnimatePresence mode="wait">
                    {step === 1 && (
                        <motion.div key="step1" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                            <div className="bulk-bento-grid" style={{ background: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)', padding: '2.5rem', boxShadow: '0 10px 40px rgba(0,0,0,0.02)' }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
                                        <div style={{ background: 'rgba(245, 200, 66, 0.1)', color: 'var(--gold)', width: 32, height: 32, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>1</div>
                                        <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Template Selection</h3>
                                    </div>

                                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.75rem', fontWeight: 600, letterSpacing: '0.05em' }}>SELECT SAVED TEMPLATE</div>

                                    <div style={{ position: 'relative' }}>
                                        <select
                                            value={selectedTemplate}
                                            onChange={e => setSelectedTemplate(e.target.value)}
                                            style={{
                                                appearance: 'none',
                                                width: '100%', padding: '1rem 1.25rem', background: 'var(--background)',
                                                border: '1px solid var(--border)', borderRadius: '12px', color: 'var(--text-primary)',
                                                fontSize: '1rem', outline: 'none', cursor: 'pointer', transition: 'border-color 0.2s',
                                                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)'
                                            }}
                                            onFocus={e => e.target.style.borderColor = 'var(--gold)'}
                                            onBlur={e => e.target.style.borderColor = 'var(--border)'}
                                        >
                                            {TEMPLATES.map(t => (
                                                <option key={t.id} value={t.id}>{t.name}</option>
                                            ))}
                                        </select>
                                        <div style={{ position: 'absolute', right: '1.25rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }}>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                        </div>
                                    </div>

                                    <div style={{ marginTop: '2.5rem' }}>
                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem', fontWeight: 600, letterSpacing: '0.05em' }}>AVAILABLE VARIABLES (FOUND IN TEMPLATE)</p>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                            {['{{candidate_name}}', '{{role}}', '{{salary}}', '{{start_date}}', '{{department}}', '{{manager_name}}', '{{location}}'].map(v => (
                                                <span key={v} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--gold)' }}>{v}</span>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Live Template Miniature Preview */}
                                <div style={{
                                    width: '220px', height: '280px', background: '#fafafa', borderRadius: '12px',
                                    border: '1px solid rgba(0,0,0,0.1)', padding: '1.5rem', display: 'flex',
                                    flexDirection: 'column', gap: '0.75rem', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                                    position: 'relative', overflow: 'hidden', transform: 'rotate(1deg)',
                                    transformOrigin: 'bottom right'
                                }}>
                                    {/* Template Name overlay */}
                                    <div style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'var(--gold)', color: '#000', fontSize: '0.6rem', fontWeight: 800, padding: '0.2rem 0.4rem', borderRadius: '4px', maxWidth: '120px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {TEMPLATES.find(t => t.id === selectedTemplate)?.name}
                                    </div>

                                    {/* Fake text lines representing the document */}
                                    <div style={{ width: '35%', height: '10px', background: '#d4d4d8', borderRadius: '3px', marginBottom: '1.25rem' }} />
                                    <div style={{ width: '100%', height: '6px', background: '#e4e4e7', borderRadius: '3px' }} />
                                    <div style={{ width: '100%', height: '6px', background: '#e4e4e7', borderRadius: '3px' }} />
                                    <div style={{ width: '85%', height: '6px', background: '#e4e4e7', borderRadius: '3px', marginBottom: '0.5rem' }} />

                                    <div style={{ width: '100%', height: '6px', background: '#e4e4e7', borderRadius: '3px' }} />
                                    <div style={{ width: '90%', height: '6px', background: '#e4e4e7', borderRadius: '3px', marginBottom: '0.5rem' }} />

                                    <div style={{ width: '100%', height: '6px', background: '#e4e4e7', borderRadius: '3px' }} />
                                    <div style={{ width: '70%', height: '6px', background: '#e4e4e7', borderRadius: '3px' }} />

                                    {/* Fake signature area at the bottom */}
                                    <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        <div style={{ width: '40%', height: '6px', background: '#d4d4d8', borderRadius: '3px' }} />
                                        <div style={{ width: '60%', height: '18px', background: 'rgba(59, 130, 246, 0.1)', borderBottom: '1px solid rgba(59, 130, 246, 0.4)', borderRadius: '2px', display: 'flex', alignItems: 'center', padding: '0 0.25rem' }}>
                                            <svg viewBox="0 0 100 20" style={{ width: '100%', height: '100%', opacity: 0.5 }}>
                                                <path d="M10 15 Q 20 5, 30 15 T 50 15 T 70 10 T 90 15" fill="none" stroke="var(--blue)" strokeWidth="2" />
                                            </svg>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div style={{ background: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)', padding: '2rem' }}>
                                <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <div style={{ background: 'var(--gold)', color: '#000', width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem' }}>2</div>
                                    Upload Data
                                </h3>
                                <CSVUploader columns={COLUMNS} onUpload={handleUpload} sampleData={MOCK_OFFER_SAMPLE} />
                            </div>
                        </motion.div>
                    )}

                    {step === 2 && (
                        <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                            <div style={{ background: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)', padding: '2rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                    <h3 style={{ fontSize: '1.125rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                                        <div style={{ background: 'var(--gold)', color: '#000', width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem' }}>3</div>
                                        Validation & Preview
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
                                        Invalid rows will be excluded automatically.
                                    </div>
                                    <button
                                        onClick={startGeneration}
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
                                        <Play size={18} fill="currentColor" />
                                        Generate {validCount} Offer Letters
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
                                status={generationStatus}
                            />

                            {step === 4 && (
                                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} style={{ marginTop: '2rem' }}>
                                    <div style={{ background: 'rgba(46, 232, 160, 0.05)', border: '1px solid rgba(46, 232, 160, 0.2)', padding: '1.5rem', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                            <CheckCircle2 size={24} color="var(--success)" />
                                            <div>
                                                <h4 style={{ margin: 0, fontSize: '1.125rem', color: 'var(--success)' }}>{processed} Offer Letters Generated Successfully</h4>
                                                {failed > 0 && <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--error)' }}>{failed} records failed generation.</p>}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '1rem' }}>
                                            {failed > 0 && (
                                                <button className="btn-secondary" style={{ padding: '0.75rem 1.5rem', borderRadius: '8px', fontSize: '0.875rem' }}>
                                                    Download Failed Records CSV
                                                </button>
                                            )}
                                            <button style={{ background: 'var(--gold)', color: '#000', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                                <Download size={16} /> Download All as ZIP
                                            </button>
                                        </div>
                                    </div>

                                    <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1.5rem' }}>Generated Documents</h3>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
                                        {results.map((res, i) => (
                                            <DocumentCard
                                                key={i}
                                                title={res.candidate_name}
                                                subtitle={`${res.role} • ${res.department}`}
                                                status={res.status}
                                                timestamp={res.timestamp || '-'}
                                                onPreview={res.status === 'Generated' ? () => alert(`Previewing document for ${res.candidate_name}`) : null}
                                                onDownload={res.status === 'Generated' ? () => alert(`Downloading PDF for ${res.candidate_name}`) : null}
                                            />
                                        ))}
                                    </div>
                                </motion.div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* RIGHT COLUMN: Live Results Panel (only when generating or done) */}
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
                            overflow: 'hidden'
                        }}
                    >
                        <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                            <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>Live Feed</h3>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {results.slice().reverse().map((res, i) => (
                                <div key={i} style={{ padding: '1rem', background: 'var(--background)', borderRadius: '8px', borderLeft: `3px solid ${res.status === 'Failed' ? 'var(--error)' : 'var(--success)'}` }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                        <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{res.candidate_name}</span>
                                        <span style={{ fontSize: '0.75rem', color: res.status === 'Failed' ? 'var(--error)' : 'var(--success)', fontWeight: 600 }}>{res.status}</span>
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        {res.status === 'Failed' ? res.error : `${res.role} offer generated.`}
                                    </div>
                                </div>
                            ))}
                            {step === 3 && (
                                <div style={{ padding: '1rem', background: 'transparent', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                                    Processing next record...
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
