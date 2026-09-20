import React from 'react';
import {
    Users, Building2, Receipt, Package, FileText, ListChecks,
    Activity, GitBranch, History, ShieldCheck, Sparkles,
} from 'lucide-react';
import { useT, MONO } from '../ui/edgeUtils';
import { Btn } from '../ui/edge';

/* The screen a company sees before it has a brain.

   No upload, no form, no questionnaire: everything EdgeBrain needs is already
   in the organisation's own tables, and asking for it again would be asking a
   company to re-enter what it has already entered. The single control builds it
   from what is there. */

const DOMAINS = [
    { icon: Users,       label: 'Team',          note: 'Employees, departments, reporting lines' },
    { icon: Building2,   label: 'Customers',     note: 'Clients, pipeline stage, contact detail' },
    { icon: Receipt,     label: 'Finance',       note: 'Invoices, quotes, payments, what is owed' },
    { icon: Package,     label: 'Products',      note: 'Catalogue, pricing, what each has sold' },
    { icon: FileText,    label: 'Documents',     note: 'Offers, certificates, NDAs and MoUs' },
    { icon: ListChecks,  label: 'Operations',    note: 'Tasks, leave, announcements, vendors' },
    { icon: Activity,    label: 'Activity',      note: 'Notifications and recent movement' },
    { icon: GitBranch,   label: 'Relationships', note: 'Who reports to whom, who bought what' },
    { icon: History,     label: 'History',       note: 'Timestamps and prior state on every record' },
];

export default function BrainOnboarding({ onBuild, building, error, canBuild }) {
    const t = useT();

    return (
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '26px 0 40px', fontFamily: MONO }}>
            <div style={{
                border: `1px solid ${t.line}`, borderRadius: 14, overflow: 'hidden',
                background: t.panel,
            }}>
                {/* The one place in the module that spends a gradient: it marks the
                    threshold between not having a brain and having one. */}
                <div style={{
                    padding: '34px 30px 28px',
                    borderBottom: `1px solid ${t.line}`,
                    background: t.isDark
                        ? 'radial-gradient(120% 140% at 12% 0%, rgba(125,211,252,0.10) 0%, rgba(167,139,250,0.06) 38%, transparent 70%)'
                        : 'radial-gradient(120% 140% at 12% 0%, rgba(3,105,161,0.07) 0%, rgba(109,40,217,0.05) 38%, transparent 70%)',
                }}>
                    <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 7,
                        border: `1px solid ${t.lineStrong}`, borderRadius: 999,
                        padding: '4px 10px', fontSize: 9.5, letterSpacing: '0.08em',
                        color: t.dim, marginBottom: 16,
                    }}>
                        <Sparkles aria-hidden="true" size={11} strokeWidth={1.9} />
                        EDGEBRAIN
                    </div>

                    <h2 style={{
                        margin: 0, fontSize: 26, fontWeight: 500, letterSpacing: '-0.03em',
                        color: t.text, lineHeight: 1.2,
                    }}>Build your Company Brain</h2>

                    <p style={{
                        margin: '12px 0 0', fontSize: 12.5, lineHeight: 1.75,
                        color: t.dim, maxWidth: 580,
                    }}>
                        EdgeBrain organises the data already in EdgeOS into one connected
                        context your AI can reason over — so a question about a customer,
                        an invoice and the person who owns the account is one question
                        rather than three screens.
                    </p>
                    <p style={{
                        margin: '10px 0 0', fontSize: 11.5, lineHeight: 1.7,
                        color: t.faint, maxWidth: 580,
                    }}>
                        Nothing to upload and nothing to type. It reads the records this
                        organisation already holds, and your database stays the source of
                        truth — EdgeBrain is a view onto it, never a copy that drifts.
                    </p>
                </div>

                <div style={{ padding: '22px 30px 24px' }}>
                    <div style={{
                        fontSize: 9, letterSpacing: '0.1em', color: t.faint, marginBottom: 14,
                    }}>WHAT IT WILL ORGANISE</div>

                    <div style={{
                        display: 'grid', gap: 1,
                        gridTemplateColumns: 'repeat(auto-fill, minmax(238px, 1fr))',
                        background: t.lineSoft, border: `1px solid ${t.lineSoft}`, borderRadius: 10,
                        overflow: 'hidden',
                    }}>
                        {DOMAINS.map(({ icon: Icon, label, note }) => (
                            <div key={label} style={{
                                display: 'flex', gap: 11, padding: '13px 14px',
                                background: t.panel, alignItems: 'flex-start',
                            }}>
                                <Icon aria-hidden="true" size={15} strokeWidth={1.7}
                                    style={{ color: t.dim, flexShrink: 0, marginTop: 1 }} />
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: 11.5, color: t.text }}>{label}</div>
                                    <div style={{ fontSize: 10, color: t.faint, marginTop: 3, lineHeight: 1.55 }}>{note}</div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div style={{
                        display: 'flex', alignItems: 'flex-start', gap: 9,
                        marginTop: 18, padding: '11px 13px',
                        border: `1px solid ${t.lineSoft}`, borderRadius: 9, background: t.panelAlt,
                    }}>
                        <ShieldCheck aria-hidden="true" size={14} strokeWidth={1.7}
                            style={{ color: t.dim, flexShrink: 0, marginTop: 1 }} />
                        <div style={{ fontSize: 10.5, color: t.dim, lineHeight: 1.65 }}>
                            Every record keeps the permission of the table it came from. Someone
                            who cannot see pay or a customer list today will not see them
                            through EdgeBrain, and no answer is assembled from anything
                            outside this organisation.
                        </div>
                    </div>

                    {error && (
                        <div role="alert" style={{
                            marginTop: 16, padding: '11px 13px', borderRadius: 9,
                            border: `1px solid ${t.down}`, fontSize: 11, color: t.down, lineHeight: 1.6,
                        }}>{error}</div>
                    )}

                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 13, marginTop: 22, flexWrap: 'wrap',
                    }}>
                        <Btn primary onClick={onBuild} disabled={building || !canBuild}>
                            {building ? 'Building…' : 'Build Company Brain'}
                        </Btn>
                        <span style={{ fontSize: 10.5, color: t.faint }}>
                            {!canBuild
                                ? 'Your role cannot build the Company Brain — ask an owner or admin.'
                                : building
                                    ? 'Reading your records and connecting them. This runs once.'
                                    : 'Takes a few seconds. You can keep working while it runs.'}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
