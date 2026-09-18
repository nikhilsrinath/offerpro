import React, { useState } from 'react';
import { Play } from 'lucide-react';
import { Page, Btn, Field, Select, Muted } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { Step, BulkFrame, LiveFeed, Outcome } from './shared/BulkKit';

import CSVUploader from './shared/CSVUploader';
import ValidationTable from './shared/ValidationTable';
import BulkProgressTracker from './shared/BulkProgressTracker';
import DocumentCard from './shared/DocumentCard';
import { documentStore } from '../../services/documentStore';
import { createPortalLink } from '../../services/portalService';
import { useOrg } from '../../context/OrgContext';

const MOCK_OFFER_SAMPLE = [
    { candidate_name: "Rahul Sharma", role: "UI Designer", department: "Product", salary: "25000", start_date: "2026-04-01", manager_name: "Nikhil", location: "Chennai", email: "rahul@example.com" },
    { candidate_name: "Priya Menon", role: "Backend Developer", department: "Engineering", salary: "35000", start_date: "2026-04-01", manager_name: "Sujan", location: "Bangalore", email: "priya@example.com" },
    { candidate_name: "Arjun Kumar", role: "Marketing Analyst", department: "Marketing", salary: "", start_date: "2026-04-01", manager_name: "Jeremiah", location: "Chennai", email: "invalid-email" },
    { candidate_name: "Sneha Rao", role: "Data Scientist", department: "Analytics", salary: "45000", start_date: "2026-04-01", manager_name: "Nikhil", location: "Hyderabad", email: "sneha@example.com" }
];

const COLUMNS = ['candidate_name', 'role', 'department', 'salary', 'start_date', 'manager_name', 'location', 'email'];

const VALIDATION_CONFIG = {
    candidate_name: { required: true },
    role: { required: true },
    email: { required: true, email: true },
    salary: { required: true }
};

const TEMPLATES = [
    { id: 't1', name: 'Standard Full-Time Offer', offerType: 'fulltime' },
    { id: 't2', name: 'Internship Offer Letter', offerType: 'internship' },
    { id: 't3', name: 'Executive Contract', offerType: 'fulltime' },
];

function parseDate(raw) {
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const d = new Date(raw);
    if (!isNaN(d)) return d.toISOString().split('T')[0];
    return '';
}

const VARIABLES = ['candidate_name', 'role', 'salary', 'start_date', 'department', 'manager_name', 'location'];

export default function BulkOfferLetters() {
    const t = useT();
    const { activeOrg } = useOrg();
    const [step, setStep] = useState(1);
    const [selectedTemplate, setSelectedTemplate] = useState(TEMPLATES[0].id);
    const [data, setData] = useState([]);

    const [processed, setProcessed] = useState(0);
    const [failed, setFailed] = useState(0);
    const [generationStatus, setGenerationStatus] = useState('idle');
    const [results, setResults] = useState([]);
    const [copiedId, setCopiedId] = useState(null);

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

    const handleCopyLink = async (portalUrl, docId) => {
        await navigator.clipboard.writeText(portalUrl);
        setCopiedId(docId);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const startGeneration = async () => {
        const validRows = data.filter(r => validateRow(r));
        if (validRows.length === 0) return;

        setStep(3);
        setGenerationStatus('processing');
        setProcessed(0);
        setFailed(0);
        setResults([]);

        const template = TEMPLATES.find((tpl) => tpl.id === selectedTemplate) || TEMPLATES[0];
        const offerType = template.offerType;
        const today = new Date().toISOString().split('T')[0];

        documentStore.setContext(activeOrg?.id);
        await documentStore.init();

        const newResults = [];
        let pCount = 0;
        let fCount = 0;

        for (let i = 0; i < validRows.length; i++) {
            const row = validRows[i];
            try {
                const salary = row.salary ? parseFloat(row.salary) : null;

                // The document number is allocated by the database at save time
                // (next_document_number), so the id is only known afterwards.
                const doc = {
                    type: 'offer_letter',
                    status: 'pending',
                    issued_to: (row.candidate_name || '').trim(),
                    recipient_email: (row.email || '').trim(),
                    recipient_phone: (row.phone || '').trim(),
                    role: (row.role || '').trim(),
                    department: (row.department || '').trim(),
                    offer_type: offerType,
                    start_date: parseDate(row.start_date),
                    end_date: '',
                    salary: salary,
                    currency: 'INR',
                    payment_frequency: 'Monthly',
                    is_paid: !!salary,
                    responsibilities: '',
                    supervisor: (row.manager_name || '').trim(),
                    location: (row.location || '').trim(),
                    valid_until: '',
                    issue_date: today,
                    created_at: new Date().toISOString(),
                    company_profile: {
                        company_name: activeOrg?.company_name || '',
                        address: activeOrg?.company_address || '',
                        email: activeOrg?.company_email || '',
                        phone: activeOrg?.company_phone || '',
                        logo_url: activeOrg?.logo_url || '',
                        signature_url: activeOrg?.signature_url || '',
                        company_tagline: activeOrg?.company_tagline || '',
                        authorized_person: activeOrg?.owner_full_name || '',
                        authorized_designation: activeOrg?.document_designation || '',
                    },
                };

                const saved = await documentStore.save(doc);

                const { url: portalUrl } = await createPortalLink({
                    orgId: activeOrg?.id,
                    documentId: saved.id,
                    recipientEmail: row.email,
                });
                pCount++;
                setProcessed(pCount);
                newResults.push({
                    ...row,
                    status: 'Generated',
                    timestamp: new Date().toLocaleTimeString(),
                    docId: saved.doc_number || saved.id,
                    portalUrl,
                });
            } catch (err) {
                fCount++;
                setFailed(fCount);
                newResults.push({ ...row, status: 'Failed', error: err.message || 'Failed to create offer' });
            }
            setResults([...newResults]);
        }

        setGenerationStatus('done');
        setStep(4);
    };

    const validCount = data.filter(r => validateRow(r)).length;
    const running = step === 3 || step === 4;

    return (
        <Page>
            <BulkFrame feed={running && (
                <LiveFeed
                    items={results.map((r) => ({
                        title: r.candidate_name,
                        status: r.status,
                        failed: r.status === 'Failed',
                        detail: r.status === 'Failed' ? r.error : r.docId,
                    }))}
                    working={step === 3}
                />
            )}>
                {step === 1 && (<>
                    <Step n={1} title="Template">
                        <div style={{ maxWidth: 420 }}>
                            <Field label="Offer template">
                                <Select value={selectedTemplate} onChange={(e) => setSelectedTemplate(e.target.value)}>
                                    {TEMPLATES.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
                                </Select>
                            </Field>
                        </div>
                        <div style={{ marginTop: 14 }}>
                            <div style={{ fontSize: 9.5, letterSpacing: '0.09em', color: t.faint, marginBottom: 6 }}>COLUMNS THE TEMPLATE FILLS IN</div>
                            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {VARIABLES.map((v) => (
                                    <li key={v} style={{
                                        fontSize: 10.5, color: t.dim, padding: '3px 7px', borderRadius: 5,
                                        border: '1px solid ' + t.line, background: t.panelAlt,
                                    }}>{v}</li>
                                ))}
                            </ul>
                        </div>
                    </Step>
                    <Step n={2} title="Upload data">
                        <CSVUploader columns={COLUMNS} onUpload={handleUpload} sampleData={MOCK_OFFER_SAMPLE} />
                    </Step>
                </>)}

                {step === 2 && (
                    <Step n={3} title="Check and fix rows" actions={<Btn size="sm" onClick={() => setStep(1)}>Upload a different file</Btn>}>
                        <ValidationTable data={data} columns={COLUMNS} onEdit={handleEdit} validationConfig={VALIDATION_CONFIG} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14, paddingTop: 14, borderTop: '1px solid ' + t.lineSoft }}>
                            <Muted size={11}>Rows with errors are left out.</Muted>
                            <div style={{ flex: 1 }} />
                            <Btn primary onClick={startGeneration} disabled={validCount === 0}>
                                <Play aria-hidden="true" size={13} strokeWidth={2} /> Generate {validCount} offer letter{validCount === 1 ? '' : 's'}
                            </Btn>
                        </div>
                    </Step>
                )}

                {running && (<>
                    <BulkProgressTracker total={validCount} processed={processed} failed={failed} status={generationStatus} noun="offer letters" />
                    {step === 4 && (<>
                        <Outcome ok={`${processed} offer letter${processed === 1 ? '' : 's'} created and added to the tracker`} failed={failed}>
                            {failed} row{failed === 1 ? '' : 's'} failed.
                        </Outcome>
                        <h2 style={{ margin: '0 0 10px', fontSize: 12.5, fontWeight: 500, color: t.text }}>Generated documents</h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                            {results.map((res, i) => (
                                <DocumentCard
                                    key={i}
                                    title={res.candidate_name}
                                    subtitle={[res.role, res.department].filter(Boolean).join(' · ')}
                                    status={res.status}
                                    timestamp={res.status === 'Generated' ? `ID ${res.docId}` : (res.error || '—')}
                                    onPreview={res.status === 'Generated' ? () => window.open(res.portalUrl, '_blank', 'noopener') : null}
                                    previewLabel="Open portal"
                                    onDownload={res.status === 'Generated' ? () => handleCopyLink(res.portalUrl, res.docId) : null}
                                    downloadLabel={copiedId === res.docId ? 'Copied' : 'Copy link'}
                                />
                            ))}
                        </div>
                    </>)}
                </>)}
            </BulkFrame>
        </Page>
    );
}
