import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Seg, Row } from '../ui/edge';
import InvoiceList from './InvoiceList';

/* ══════════════════════════════════════════════════════════════════════════
   The company's Billing: quotations, proformas and invoices behind one rail
   item, one kind at a time. Each kind keeps its own route (/quotations,
   /proforma, /invoices) so the editors still come back to their list.
   Recurring invoices are set up per project (ProjectBilling), not here.
   ══════════════════════════════════════════════════════════════════════════ */

const KINDS = [
    { id: 'quotation', label: 'Quotations', to: '/quotations' },
    { id: 'proforma', label: 'Proforma', to: '/proforma' },
    { id: 'invoice', label: 'Invoices', to: '/invoices' },
];

export default function CompanyBilling({ kind }) {
    const navigate = useNavigate();
    const choose = (id) => navigate(KINDS.find((k) => k.id === id).to, { replace: true });

    return (
        <div style={{ display: 'grid', gap: 14 }}>
            <Row gap={12} wrap>
                <Seg label="Kind of document" value={kind} onChange={choose}
                    options={KINDS.map((k) => ({ id: k.id, label: k.label }))} />
            </Row>
            <div key={kind} style={{ minWidth: 0 }}>
                <InvoiceList type={kind} />
            </div>
        </div>
    );
}
