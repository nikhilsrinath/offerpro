import React, { useState, useRef, useId } from 'react';
import { UploadCloud, FileDown } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Btn } from '../../ui/edge';
import { MONO, useT } from '../../ui/edgeUtils';

/* A file drop target that is also an ordinary button: Enter or Space opens the
   file picker, and a parse error is announced rather than only painted red. */
export default function CSVUploader({ columns, onUpload, sampleData }) {
    const t = useT();
    const [dragActive, setDragActive] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef(null);
    const hintId = useId();

    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
        else if (e.type === 'dragleave') setDragActive(false);
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
                const workbook = XLSX.read(e.target.result, { type: 'binary' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const parsedData = XLSX.utils.sheet_to_json(sheet, { defval: '' });

                if (parsedData.length === 0) {
                    setError('The uploaded file is empty.');
                    return;
                }

                // At least one expected column has to be present.
                const fileHeaders = Object.keys(parsedData[0] || {}).map((h) => h.toLowerCase().trim());
                const missingColumns = columns.filter((c) => !fileHeaders.includes(c.toLowerCase().trim()));
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
        if (e.dataTransfer.files && e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
    };

    const handleChange = (e) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) processFile(e.target.files[0]);
        e.target.value = '';
    };

    const downloadSample = () => {
        const ws = XLSX.utils.json_to_sheet(sampleData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Template');
        XLSX.writeFile(wb, 'Template.csv', { bookType: 'csv' });
    };

    return (
        <div>
            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
                aria-describedby={hintId}
                className="edge-btn"
                style={{
                    width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                    padding: '38px 20px', cursor: 'pointer', fontFamily: MONO, color: t.text,
                    border: '1px dashed ' + (dragActive ? t.text : t.lineStrong), borderRadius: 10,
                    background: dragActive ? t.panelAlt : t.panel,
                    transition: 'border-color .15s, background .15s',
                }}
            >
                <UploadCloud aria-hidden="true" size={22} strokeWidth={1.6} style={{ color: t.dim }} />
                <span style={{ fontSize: 12.5 }}>Choose a CSV or XLSX file</span>
                <span id={hintId} style={{ fontSize: 10.5, color: t.faint }}>
                    or drop it here · columns: {columns.join(', ')}
                </span>
            </button>
            <input
                ref={inputRef} type="file" tabIndex={-1} aria-hidden="true"
                accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                onChange={handleChange}
                style={{ display: 'none' }}
            />

            <div role="alert" style={{ minHeight: error ? undefined : 0 }}>
                {error && (
                    <div style={{ marginTop: 10, fontSize: 11, color: t.down }}>{error}</div>
                )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
                <Btn size="sm" onClick={downloadSample}>
                    <FileDown aria-hidden="true" size={13} strokeWidth={1.8} /> Download sample template
                </Btn>
            </div>
        </div>
    );
}
