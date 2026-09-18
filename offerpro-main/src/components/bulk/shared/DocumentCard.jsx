import React from 'react';
import { ExternalLink, Link2, Pencil } from 'lucide-react';
import { Btn, Status } from '../../ui/edge';
import { useT } from '../../ui/edgeUtils';

/* One generated document in a batch's results. Each action names the document
   it acts on, so "Open" read out of context still says which one. */
export default function DocumentCard({
    title, subtitle, status, timestamp,
    onPreview, previewLabel = 'Open',
    onDownload, downloadLabel = 'Copy link',
    onEdit,
}) {
    const t = useT();
    const ok = status === 'Generated' || status === 'Sent' || status === 'Imported';
    return (
        <article style={{
            border: '1px solid ' + t.line, borderRadius: 10, padding: '12px 13px',
            display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0,
        }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <h4 style={{ margin: 0, fontSize: 12, fontWeight: 500, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h4>
                    {subtitle && <div style={{ fontSize: 10.5, color: t.dim, marginTop: 3 }}>{subtitle}</div>}
                </div>
                <Status tone={ok ? 'up' : status === 'Failed' ? 'down' : 'neutral'}>{status}</Status>
            </div>
            {timestamp && <div style={{ fontSize: 10.5, color: t.faint, wordBreak: 'break-all' }}>{timestamp}</div>}
            {(onPreview || onDownload || onEdit) && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid ' + t.lineSoft, paddingTop: 10 }}>
                    {onPreview && (
                        <Btn size="sm" onClick={onPreview} aria-label={`${previewLabel} ${title}`}>
                            <ExternalLink aria-hidden="true" size={12} strokeWidth={1.8} /> {previewLabel}
                        </Btn>
                    )}
                    {onDownload && (
                        <Btn size="sm" onClick={onDownload} aria-label={`${downloadLabel} for ${title}`}>
                            <Link2 aria-hidden="true" size={12} strokeWidth={1.8} /> {downloadLabel}
                        </Btn>
                    )}
                    {onEdit && (
                        <Btn size="sm" onClick={onEdit} aria-label={`Edit ${title}`}>
                            <Pencil aria-hidden="true" size={12} strokeWidth={1.8} /> Edit
                        </Btn>
                    )}
                </div>
            )}
        </article>
    );
}
