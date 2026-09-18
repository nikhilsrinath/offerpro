import React from 'react';
import { Bar, StatBand } from '../../ui/edge';
import { useT } from '../../ui/edgeUtils';

/* How far a batch has got. A bar rather than a ring — it reads at a glance and
   exposes itself as a progressbar, so a screen reader hears the same number. */
export default function BulkProgressTracker({ total, processed, failed, status, noun = 'documents', verb = 'Generated' }) {
    const t = useT();
    const done = processed + failed;
    const percentage = total === 0 ? 0 : Math.round((done / total) * 100);

    const heading = status === 'processing'
        ? `Working… ${done} of ${total}`
        : status === 'done'
            ? (failed > 0 ? `Finished with ${failed} failed` : 'Finished')
            : 'Something went wrong';

    return (
        <section aria-label="Batch progress" style={{ border: '1px solid ' + t.line, borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
                <h3 aria-live="polite" style={{ margin: 0, fontSize: 12.5, fontWeight: 500, color: t.text }}>{heading}</h3>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.03em', color: t.text }}>{percentage}%</span>
            </div>
            <div role="progressbar" aria-label={`${verb} ${noun}`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}
                aria-valuetext={`${done} of ${total}`}>
                <Bar value={done} max={total || 1} height={5} tone={status === 'done' && failed === 0 ? t.up : t.text} />
            </div>
            <div style={{ marginTop: 14 }}>
                <StatBand items={[
                    { label: verb, value: processed, tone: processed > 0 ? 'up' : undefined },
                    { label: 'Failed', value: failed, tone: failed > 0 ? 'down' : undefined },
                    ...(status === 'processing' ? [{ label: 'Pending', value: Math.max(0, total - done) }] : []),
                    { label: 'Total', value: total },
                ]} />
            </div>
        </section>
    );
}
