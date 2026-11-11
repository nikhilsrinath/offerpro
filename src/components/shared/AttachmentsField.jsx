import { useRef, useState } from 'react';
import { Btn, Row } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_COUNT, fmtSize } from '../../services/announcementService';

/**
 * An announcement's attachments, as one row of the side panel: the label on
 * the left, the files and the picker on the right, lined up with the other
 * fields. `form` holds `keep` (files already on it that stay), `files` (new
 * ones to upload) and `dropped` (saved ones taken off).
 *
 * A div with the field classes rather than <Field>: Field is a <label>, and a
 * label around Remove buttons would press the first one on any click.
 */
export default function AttachmentsField({ form, setForm }) {
    const t = useT();
    const input = useRef(null);
    const [problem, setProblem] = useState('');
    const keep = form.keep || [];
    const files = form.files || [];
    const count = keep.length + files.length;

    const addFiles = (list) => {
        const picked = [...list];
        const big = picked.filter((f) => f.size > ATTACHMENT_MAX_BYTES);
        const ok = picked.filter((f) => f.size <= ATTACHMENT_MAX_BYTES).slice(0, Math.max(0, ATTACHMENT_MAX_COUNT - count));
        setProblem(big.length
            ? `${big.map((f) => f.name).join(', ')} ${big.length === 1 ? 'is' : 'are'} over 10 MB.`
            : ok.length < picked.length ? `At most ${ATTACHMENT_MAX_COUNT} attachments.` : '');
        setForm({ ...form, files: [...files, ...ok] });
        if (input.current) input.current.value = '';
    };

    return (
        <div className="edge-field" role="group" aria-label="Attachments" style={{ display: 'block', minWidth: 0 }}>
            <span className="edge-field-label" style={{ display: 'block', fontSize: 13.5, fontWeight: 500, lineHeight: 1.4, color: t.text, marginBottom: 6 }}>
                Attachments ({count}/{ATTACHMENT_MAX_COUNT})
            </span>
            <span className="edge-field-control" style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                {[...keep.map((f) => ({ f, kept: true })), ...files.map((f) => ({ f, kept: false }))].map(({ f, kept }, i) => (
                    <Row key={kept ? f.path : `new-${i}-${f.name}`} gap={8} style={{
                        border: '1px solid ' + t.line, borderRadius: 7, padding: '5px 5px 5px 10px',
                    }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                        <span style={{ fontSize: 11, color: t.faint }}>{kept ? fmtSize(f.size) : `${fmtSize(f.size)} · new`}</span>
                        <Btn size="sm" aria-label={`Remove ${f.name}`} onClick={() => setForm(kept
                            ? { ...form, keep: keep.filter((x) => x !== f), dropped: [...(form.dropped || []), f] }
                            : { ...form, files: files.filter((x) => x !== f) })}>Remove</Btn>
                    </Row>
                ))}
                <input ref={input} type="file" multiple hidden aria-label="Add attachments"
                    onChange={(e) => addFiles(e.target.files || [])} />
                <span>
                    <Btn size="sm" disabled={count >= ATTACHMENT_MAX_COUNT} onClick={() => input.current?.click()}>Add Files</Btn>
                </span>
                <span className="edge-field-hint" style={{ fontSize: 11.5, color: t.faint }}>Up to 10 MB each.</span>
                {problem && <span role="alert" style={{ fontSize: 12.5, color: t.down }}>{problem}</span>}
            </span>
        </div>
    );
}
