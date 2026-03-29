import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Award, Download, Play, CheckCircle2, QrCode, ShieldCheck, Database, Search } from 'lucide-react';

import CSVUploader from './shared/CSVUploader';
import ValidationTable from './shared/ValidationTable';
import BulkProgressTracker from './shared/BulkProgressTracker';
import DocumentCard from './shared/DocumentCard';

const MOCK_CERT_SAMPLE = [
    { recipient_name: "Amit Kumar", certificate_type: "Completion", course_name: "React Bootcamp", completion_date: "20-Mar-2026", score: "92", grade: "A", email: "amit@example.com" },
    { recipient_name: "Sneha Rao", certificate_type: "Achievement", course_name: "Python Basics", completion_date: "20-Mar-2026", score: "78", grade: "B", email: "sneha@example.com" },
    { recipient_name: "Jason Bourne", certificate_type: "Participation", course_name: "Annual Hackathon", completion_date: "05-Apr-2026", score: "-", grade: "-", email: "jason@example.com" },
    { recipient_name: "Invalid Data", certificate_type: "", course_name: "", completion_date: "", score: "", grade: "", email: "invalid-email" }
];

const COLUMNS = ['recipient_name', 'certificate_type', 'course_name', 'completion_date', 'score', 'grade', 'email'];

const VALIDATION_CONFIG = {
    recipient_name: { required: true },
    email: { required: true, email: true },
    course_name: { required: true }
};

const CERTIFICATE_TYPES = [
    'Course Completion Certificate',
    'Internship Completion Certificate',
    'Achievement Certificate',
    'Participation Certificate',
    'Excellence Award Certificate'
];

export default function BulkCertificates() {
    const [step, setStep] = useState(1);
    const [selectedType, setSelectedType] = useState(CERTIFICATE_TYPES[0]);
    const [data, setData] = useState([]);

    // Options
    const [autoGenId, setAutoGenId] = useState(true);
    const [addQr, setAddQr] = useState(true);
    const [addRegistry, setAddRegistry] = useState(true);

    // Progress states
    const [processed, setProcessed] = useState(0);
    const [failed, setFailed] = useState(0);
    const [generationStatus, setGenerationStatus] = useState('idle');
    const [results, setResults] = useState([]);

    // Registry view
    const [searchQuery, setSearchQuery] = useState('');

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
            await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 400));

            const hasError = !row.course_name;

            if (hasError) {
                fCount++;
                setFailed(fCount);
                newResults.push({ ...row, status: 'Failed', error: 'Missing course info' });
            } else {
                pCount++;
                setProcessed(pCount);
                const certId = autoGenId ? `CERT-2026-${Math.floor(10000 + Math.random() * 90000)}` : 'N/A';
                newResults.push({ ...row, status: 'Generated', timestamp: new Date().toLocaleTimeString(), id: certId });
            }
            setResults([...newResults]);
        }

        setGenerationStatus('done');
        setStep(4);
    };

    const validCount = data.filter(r => validateRow(r)).length;

    return (
        <div className="bulk-page-container bulk-responsive-flex" style={{ padding: '0', maxWidth: '1400px', margin: '0 auto', minHeight: 'calc(100vh - 100px)' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <div style={{ padding: '2rem', background: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }}>
                    {/* Subtle background glow */}
                    <div style={{ position: 'absolute', top: -100, right: -100, width: 300, height: 300, background: 'radial-gradient(circle, rgba(59, 130, 246, 0.04) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />

                    <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', margin: '0 0 0.5rem 0', fontWeight: 800, letterSpacing: '-0.02em' }}>Bulk Certificate Generation</h1>
                    <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '1rem' }}>Issue verifiable certificates to multiple recipients simultaneously.</p>
                </div>

                <AnimatePresence mode="wait">
                    {step === 1 && (
                        <motion.div key="step1" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

                            {/* Configuration Panel */}
                            <div className="bulk-bento-grid" style={{ background: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)', padding: '2.5rem', boxShadow: '0 10px 40px rgba(0,0,0,0.02)' }}>

                                {/* Left: Certificate Type */}
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
                                        <div style={{ background: 'var(--blue-muted)', color: 'var(--blue)', width: 32, height: 32, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>1</div>
                                        <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Certificate Type</h3>
                                    </div>

                                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.75rem', fontWeight: 600, letterSpacing: '0.05em' }}>SELECT TEMPLATE</div>

                                    <div style={{ position: 'relative' }}>
                                        <select
                                            value={selectedType}
                                            onChange={e => setSelectedType(e.target.value)}
                                            style={{
                                                appearance: 'none',
                                                width: '100%', padding: '1rem 1.25rem', background: 'var(--background)',
                                                border: '1px solid var(--border)', borderRadius: '12px', color: 'var(--text-primary)',
                                                fontSize: '1rem', outline: 'none', cursor: 'pointer', transition: 'border-color 0.2s',
                                                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)'
                                            }}
                                            onFocus={e => e.target.style.borderColor = 'var(--blue)'}
                                            onBlur={e => e.target.style.borderColor = 'var(--border)'}
                                        >
                                            {CERTIFICATE_TYPES.map(t => (
                                                <option key={t} value={t}>{t}</option>
                                            ))}
                                        </select>
                                        {/* Custom Dropdown Arrow */}
                                        <div style={{ position: 'absolute', right: '1.25rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }}>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                        </div>
                                    </div>

                                    <div style={{ marginTop: '2.5rem', padding: '1.5rem', background: 'rgba(59, 130, 246, 0.05)', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.1)' }}>
                                        <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--blue)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <ShieldCheck size={16} /> Verified Issuance
                                        </h4>
                                        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8125rem', lineHeight: 1.6 }}>
                                            All certificates generated in this batch will be cryptographically signed by your organization profile. Do not upload test data to production registries.
                                        </p>
                                    </div>
                                </div>

                                {/* Right: Generation Options */}
                                <div style={{ flex: 1.2 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
                                        <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Generation Options</h3>
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                                        {/* Option 1 */}
                                        <div
                                            onClick={() => setAutoGenId(!autoGenId)}
                                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem', background: 'var(--background)', border: '1px solid var(--border)', borderRadius: '12px', cursor: 'pointer', transition: 'all 0.2s' }}
                                            onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'}
                                            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                                        >
                                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                                <div style={{ width: 40, height: 40, borderRadius: '10px', background: 'rgba(59, 130, 246, 0.1)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <ShieldCheck size={20} />
                                                </div>
                                                <div>
                                                    <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Auto-generate Certificate ID</div>
                                                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>E.g. CERT-2026-64921</div>
                                                </div>
                                            </div>
                                            <div style={{ width: 44, height: 24, background: autoGenId ? 'var(--blue)' : 'var(--border)', borderRadius: '12px', padding: 2, display: 'flex', alignItems: 'center', transition: 'background 0.3s' }}>
                                                <motion.div animate={{ x: autoGenId ? 20 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} style={{ width: 20, height: 20, background: autoGenId ? '#000' : '#fff', borderRadius: '50%', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }} />
                                            </div>
                                        </div>

                                        {/* Option 2 */}
                                        <div
                                            onClick={() => setAddQr(!addQr)}
                                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem', background: 'var(--background)', border: '1px solid var(--border)', borderRadius: '12px', cursor: 'pointer', transition: 'all 0.2s' }}
                                            onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'}
                                            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                                        >
                                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                                <div style={{ width: 40, height: 40, borderRadius: '10px', background: 'rgba(46, 232, 160, 0.1)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <QrCode size={20} />
                                                </div>
                                                <div>
                                                    <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Add QR Authenticator</div>
                                                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Embeds a scannable verification code</div>
                                                </div>
                                            </div>
                                            <div style={{ width: 44, height: 24, background: addQr ? 'var(--blue)' : 'var(--border)', borderRadius: '12px', padding: 2, display: 'flex', alignItems: 'center', transition: 'background 0.3s' }}>
                                                <motion.div animate={{ x: addQr ? 20 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} style={{ width: 20, height: 20, background: addQr ? '#000' : '#fff', borderRadius: '50%', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }} />
                                            </div>
                                        </div>

                                        {/* Option 3 */}
                                        <div
                                            onClick={() => setAddRegistry(!addRegistry)}
                                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem', background: 'var(--background)', border: '1px solid var(--border)', borderRadius: '12px', cursor: 'pointer', transition: 'all 0.2s' }}
                                            onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'}
                                            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                                        >
                                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                                <div style={{ width: 40, height: 40, borderRadius: '10px', background: 'var(--blue-muted)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <Database size={20} />
                                                </div>
                                                <div>
                                                    <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Log to Registry</div>
                                                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Save to your permanent records database</div>
                                                </div>
                                            </div>
                                            <div style={{ width: 44, height: 24, background: addRegistry ? 'var(--blue)' : 'var(--border)', borderRadius: '12px', padding: 2, display: 'flex', alignItems: 'center', transition: 'background 0.3s' }}>
                                                <motion.div animate={{ x: addRegistry ? 20 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} style={{ width: 20, height: 20, background: addRegistry ? '#000' : '#fff', borderRadius: '50%', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }} />
                                            </div>
                                        </div>

                                    </div>
                                </div>
                            </div>

                            {/* Upload Data Panel */}
                            <div style={{ background: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)', padding: '2.5rem', boxShadow: '0 10px 40px rgba(0,0,0,0.02)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
                                    <div style={{ background: 'var(--btn-accent-bg)', color: 'var(--btn-accent-text)', width: 32, height: 32, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>2</div>
                                    <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Import Recipient Data</h3>
                                </div>
                                <CSVUploader columns={COLUMNS} onUpload={handleUpload} sampleData={MOCK_CERT_SAMPLE} />
                            </div>
                        </motion.div>
                    )}

                    {step === 2 && (
                        <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                            <div style={{ background: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)', padding: '2rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                    <h3 style={{ fontSize: '1.125rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                                        <div style={{ background: 'var(--btn-accent-bg)', color: 'var(--btn-accent-text)', width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem' }}>3</div>
                                        Validation & Preview
                                    </h3>
                                    <button onClick={() => setStep(1)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.875rem', textDecoration: 'underline' }}>Configure again</button>
                                </div>

                                <ValidationTable
                                    data={data}
                                    columns={COLUMNS}
                                    onEdit={handleEdit}
                                    validationConfig={VALIDATION_CONFIG}
                                />

                                <div style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                                        Generating <strong>{selectedType}</strong> for all valid rows.
                                    </div>
                                    <button
                                        onClick={startGeneration}
                                        disabled={validCount === 0}
                                        style={{
                                            background: validCount > 0 ? 'var(--btn-accent-bg)' : 'var(--background)',
                                            color: validCount > 0 ? 'var(--btn-accent-text)' : 'var(--text-muted)',
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
                                        Generate {validCount} Certificates
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
                                    <div style={{ background: 'rgba(46, 232, 160, 0.05)', border: '1px solid rgba(46, 232, 160, 0.2)', padding: '1.5rem', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                            <CheckCircle2 size={24} color="var(--success)" />
                                            <div>
                                                <h4 style={{ margin: 0, fontSize: '1.125rem', color: 'var(--success)' }}>{processed} Certificates Generated Successfully</h4>
                                                {failed > 0 && <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--error)' }}>{failed} records failed generation.</p>}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '1rem' }}>
                                            <button style={{ background: 'var(--btn-accent-bg)', color: 'var(--btn-accent-text)', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                                <Download size={16} /> Download All as ZIP
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Certificate Registry Panel */}
                {step === 4 && addRegistry && (
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
                        <div style={{ background: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)', marginTop: '2rem', overflow: 'hidden' }}>
                            <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>Certificate Registry</h3>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--background)', border: '1px solid var(--border)', padding: '0.5rem 1rem', borderRadius: '8px' }}>
                                    <Search size={16} color="var(--text-muted)" />
                                    <input
                                        type="text"
                                        placeholder="Search by ID or Name"
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '0.875rem' }}
                                    />
                                </div>
                            </div>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                                    <thead style={{ background: 'rgba(255,255,255,0.02)' }}>
                                        <tr>
                                            <th style={{ padding: '1rem', color: 'var(--text-muted)' }}>Certificate ID</th>
                                            <th style={{ padding: '1rem', color: 'var(--text-muted)' }}>Recipient Name</th>
                                            <th style={{ padding: '1rem', color: 'var(--text-muted)' }}>Course / Topic</th>
                                            <th style={{ padding: '1rem', color: 'var(--text-muted)' }}>Issue Date</th>
                                            <th style={{ padding: '1rem', color: 'var(--text-muted)' }}>Status</th>
                                            <th style={{ padding: '1rem', color: 'var(--text-muted)', textAlign: 'right' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {results.filter(r => r.status === 'Generated' && (
                                            (r.recipient_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                                            (r.id || '').toLowerCase().includes(searchQuery.toLowerCase())
                                        )).map((res, i) => (
                                            <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                                                <td style={{ padding: '1rem', fontFamily: 'monospace', color: 'var(--blue)' }}>{res.id}</td>
                                                <td style={{ padding: '1rem', fontWeight: 600 }}>{res.recipient_name}</td>
                                                <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>{res.course_name}</td>
                                                <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>{new Date().toLocaleDateString()}</td>
                                                <td style={{ padding: '1rem' }}>
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0.2rem 0.5rem', background: 'rgba(46, 232, 160, 0.1)', color: 'var(--success)', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>Active</span>
                                                </td>
                                                <td style={{ padding: '1rem', textAlign: 'right' }}>
                                                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                                        <button className="btn-secondary" style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px' }}>Preview</button>
                                                        <button className="btn-secondary" style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px' }}>Download</button>
                                                        <button className="btn-secondary" style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px' }}>Link</button>
                                                        <button style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px', background: 'rgba(231, 76, 60, 0.1)', color: 'var(--error)', border: '1px solid rgba(231, 76, 60, 0.2)', cursor: 'pointer' }}>Revoke</button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </motion.div>
                )}
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
                            overflow: 'hidden'
                        }}
                    >
                        <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                            <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>Live Feed</h3>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {results.slice().reverse().map((res, i) => (
                                <div key={i} style={{ padding: '1rem', background: 'var(--background)', borderRadius: '8px', borderLeft: `3px solid ${res.status === 'Failed' ? 'var(--error)' : 'var(--blue)'}` }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                        <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{res.recipient_name}</span>
                                        <span style={{ fontSize: '0.75rem', color: res.status === 'Failed' ? 'var(--error)' : 'var(--blue)', fontWeight: 600 }}>{res.status}</span>
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        {res.status === 'Failed' ? res.error : `${selectedType} generated.`}
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
