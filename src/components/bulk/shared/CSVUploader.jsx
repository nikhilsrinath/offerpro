import React, { useState, useRef } from 'react';
import { UploadCloud, FileDown, AlertCircle } from 'lucide-react';
import * as XLSX from 'xlsx';

export default function CSVUploader({ columns, onUpload, sampleData }) {
    const [dragActive, setDragActive] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef(null);

    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const processFile = (file) => {
        setError('');
        const fileName = file.name.toLowerCase();
        if (!fileName.endsWith('.csv') && !fileName.endsWith('.xlsx')) {
            setError('Please upload a valid CSV or XLSX file.');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = e.target.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const parsedData = XLSX.utils.sheet_to_json(sheet, { defval: "" });

                if (parsedData.length === 0) {
                    setError('The uploaded file is empty.');
                    return;
                }

                // Basic validation - check if at least one required column exists
                const fileHeaders = Object.keys(parsedData[0] || {}).map(h => h.toLowerCase().trim());
                const missingColumns = columns.filter(c => !fileHeaders.includes(c.toLowerCase().trim()));

                if (missingColumns.length === columns.length) {
                    setError('Invalid CSV format. Please use the provided template.');
                    return;
                }

                onUpload(parsedData);
            } catch (err) {
                console.error(err);
                setError('Failed to parse the file. Please check its format.');
            }
        };
        reader.readAsBinaryString(file);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            processFile(e.dataTransfer.files[0]);
        }
    };

    const handleChange = (e) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            processFile(e.target.files[0]);
        }
    };

    const downloadSample = () => {
        const ws = XLSX.utils.json_to_sheet(sampleData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Template");
        XLSX.writeFile(wb, "Template.csv", { bookType: "csv" });
    };

    return (
        <div className="bulk-uploader-section">
            <div
                className={`bulk-drag-zone ${dragActive ? 'active' : ''}`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => inputRef.current.click()}
                style={{
                    border: `2px dashed ${dragActive ? 'var(--gold)' : 'var(--border)'}`,
                    background: dragActive ? 'rgba(245, 200, 66, 0.05)' : 'var(--surface)',
                    padding: '4rem 2rem',
                    borderRadius: '16px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '1rem'
                }}
            >
                <div style={{ background: 'rgba(245, 200, 66, 0.1)', padding: '1rem', borderRadius: '50%' }}>
                    <UploadCloud size={32} color="var(--gold)" />
                </div>
                <div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                        Drag & drop your CSV file here
                    </h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>or click to browse</p>
                </div>
                <input
                    ref={inputRef}
                    type="file"
                    accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                    onChange={handleChange}
                    style={{ display: 'none' }}
                />
            </div>

            {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--error)', marginTop: '1rem', fontSize: '0.875rem' }}>
                    <AlertCircle size={16} />
                    <span>{error}</span>
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.5rem' }}>
                <button
                    onClick={downloadSample}
                    className="btn-secondary"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', padding: '0.6rem 1.25rem', borderRadius: '8px' }}
                >
                    <FileDown size={16} />
                    Download Sample CSV Template
                </button>
            </div>
        </div>
    );
}
