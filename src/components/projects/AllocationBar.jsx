import React from 'react';
import { Bar } from '../ui/edge';
import { useT } from '../ui/edgeUtils';

/** A share of someone's time. Over 100% is drawn full and said out loud. */
export default function AllocationBar({ pct, width = 90 }) {
    const t = useT();
    const v = Number(pct) || 0;
    const over = v > 100;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width, display: 'inline-block' }}>
                <Bar value={Math.min(v, 100)} max={100} height={4} tone={over ? t.down : undefined} />
            </span>
            <span style={{ fontSize: 10.5, color: over ? t.down : t.dim, minWidth: 34 }}>
                {Math.round(v)}%{over ? ' · over' : ''}
            </span>
        </span>
    );
}

