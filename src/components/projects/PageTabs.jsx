import React from 'react';
import { Seg } from '../ui/edge';

/* A group's pages as a switcher at the top of the page. The way Billing
   switches between quotations, proformas and invoices. The rail keeps one
   item per group; this picks the page inside it. Scrolls sideways on a
   phone rather than wrapping. */
export default function PageTabs({ label, pages, current, onOpen }) {
    if (pages.length < 2) return null;
    return (
        <div className="edge-scroll" style={{ overflowX: 'auto', maxWidth: '100%', margin: '-4px 0 14px', paddingBottom: 2 }}>
            <Seg label={label} value={current} onChange={onOpen}
                options={pages.map((x) => ({ id: x.id, label: x.label }))} />
        </div>
    );
}
