import React, { useState } from 'react';
import { Download, Play } from 'lucide-react';

import CSVUploader from './shared/CSVUploader';
import ValidationTable from './shared/ValidationTable';
import BulkProgressTracker from './shared/BulkProgressTracker';
import { Step, BulkFrame, LiveFeed, Outcome, SwitchRow } from './shared/BulkKit';
import { Page, Btn, Field, Select, Muted, Search, Table, Tr, Td, Status, Empty, Grid } from '../ui/edge';
import { useT, fmtDate } from '../ui/edgeUtils';

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
    const t = useT();
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
    const running = step === 3 || step === 4;
    const q = searchQuery.toLowerCase();
    const registry = results.filter((r) => r.status === 'Generated' && (
        (r.recipient_name || '').toLowerCase().includes(q) || (r.id || '').toLowerCase().includes(q)
    ));

    return (
        <Page>
            <BulkFrame feed={running && (
                <LiveFeed
                    items={results.map((r) => ({
                        title: r.recipient_name,
                        status: r.status,
                        failed: r.status === 'Failed',
                        detail: r.status === 'Failed' ? r.error : r.id,
                    }))}
                    working={step === 3}
                />
            )}>
                {step === 1 && (<>
                    <Step n={1} title="Certificate and options">
                        <Grid min={260} gap={14}>
                            <div>
                                <Field label="Certificate type">
                                    <Select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
                                        {CERTIFICATE_TYPES.map((ct) => <option key={ct} value={ct}>{ct}</option>)}
                                    </Select>
                                </Field>
                                <p style={{ margin: '12px 0 0', fontSize: 10.5, lineHeight: 1.6, color: t.dim }}>
                                    Every certificate in the batch is issued under your organisation profile. Keep test data out of the live registry.
                                </p>
                            </div>
                            <div role="group" aria-label="Generation options" style={{ display: 'grid', gap: 8 }}>
                                <SwitchRow checked={autoGenId} onChange={setAutoGenId} title="Auto-generate certificate ID" note="For example CERT-2026-64921" />
                                <SwitchRow checked={addQr} onChange={setAddQr} title="Add QR verification" note="Embeds a scannable verification code" />
                                <SwitchRow checked={addRegistry} onChange={setAddRegistry} title="Log to registry" note="Keeps a record of every certificate issued" />
                            </div>
                        </Grid>
                    </Step>
                    <Step n={2} title="Import recipients">
                        <CSVUploader columns={COLUMNS} onUpload={handleUpload} sampleData={MOCK_CERT_SAMPLE} />
                    </Step>
                </>)}

                {step === 2 && (
                    <Step n={3} title="Check and fix rows" actions={<Btn size="sm" onClick={() => setStep(1)}>Back to options</Btn>}>
                        <ValidationTable data={data} columns={COLUMNS} onEdit={handleEdit} validationConfig={VALIDATION_CONFIG} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14, paddingTop: 14, borderTop: '1px solid ' + t.lineSoft }}>
                            <Muted size={11}>Issuing <span style={{ color: t.text }}>{selectedType}</span> for every valid row.</Muted>
                            <div style={{ flex: 1 }} />
                            <Btn primary onClick={startGeneration} disabled={validCount === 0}>
                                <Play aria-hidden="true" size={13} strokeWidth={2} /> Generate {validCount} certificate{validCount === 1 ? '' : 's'}
                            </Btn>
                        </div>
                    </Step>
                )}

                {running && (
                    <BulkProgressTracker total={validCount} processed={processed} failed={failed} status={generationStatus} noun="certificates" />
                )}

                {step === 4 && (
                    <Outcome
                        ok={`${processed} certificate${processed === 1 ? '' : 's'} generated`}
                        failed={failed}
                        action={<Btn primary><Download aria-hidden="true" size={13} strokeWidth={1.8} /> Download all as ZIP</Btn>}
                    >
                        {failed} row{failed === 1 ? '' : 's'} failed.
                    </Outcome>
                )}

                {step === 4 && addRegistry && (
                    <section aria-labelledby="cert-registry">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                            <h2 id="cert-registry" style={{ margin: 0, fontSize: 12.5, fontWeight: 500, color: t.text }}>Certificate registry</h2>
                            <div style={{ flex: 1 }} />
                            <Search value={searchQuery} onChange={setSearchQuery} placeholder="Search by ID or name" />
                        </div>
                        <Table
                            cols={[
                                { key: 'id', label: 'Certificate ID' },
                                { key: 'name', label: 'Recipient' },
                                { key: 'course', label: 'Course / topic' },
                                { key: 'date', label: 'Issued' },
                                { key: 'status', label: 'Status' },
                                { key: 'actions', label: 'Actions', align: 'right' },
                            ]}
                            empty={registry.length === 0 && <Empty>No certificates match that search.</Empty>}
                        >
                            {registry.map((res, i) => (
                                <Tr key={i}>
                                    <Td nowrap>{res.id}</Td>
                                    <Td>{res.recipient_name}</Td>
                                    <Td muted>{res.course_name}</Td>
                                    <Td muted nowrap>{fmtDate(new Date())}</Td>
                                    <Td><Status tone="up">Active</Status></Td>
                                    <Td align="right" nowrap>
                                        <div style={{ display: 'inline-flex', gap: 6 }}>
                                            <Btn size="sm" aria-label={`Preview certificate for ${res.recipient_name}`}>Preview</Btn>
                                            <Btn size="sm" aria-label={`Download certificate for ${res.recipient_name}`}>Download</Btn>
                                            <Btn size="sm" aria-label={`Copy link for ${res.recipient_name}`}>Link</Btn>
                                            <Btn size="sm" danger aria-label={`Revoke certificate for ${res.recipient_name}`}>Revoke</Btn>
                                        </div>
                                    </Td>
                                </Tr>
                            ))}
                        </Table>
                    </section>
                )}
            </BulkFrame>
        </Page>
    );
}
