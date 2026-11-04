import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { Btn } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { apolloService, useConnectorFor } from '../../services/connectorsService';
import { blanksToFill, domainForRecord, makeCountryCode, sizeText, growthText } from '../../shared/apollo';
import apolloLogo from '../../assets/connectors/apollo.png';

/* "Fill From Apollo" on the Add / Edit Client and Vendor panels. It looks
   the company up by the form's website or business email, or by its name
   (then asks which company was meant), and fills only the blank fields.
   Nothing is saved until the form is: the details travel with the form as
   `company_profile`. Shown only while Apollo is connected. */

let countryCode = null;
async function loadCountryCode() {
    if (!countryCode) {
        const { ALL_COUNTRIES } = await import('../../data/worldMap.js');
        countryCode = makeCountryCode(ALL_COUNTRIES);
    }
    return countryCode;
}

const LABEL = {
    website: 'website', industry: 'industry', clientAddress: 'address', address: 'address', clientName: 'company name',
    company_name: 'company name', country_code: 'country', buyerState: 'state', state: 'state',
};

/**
 * kind     'client' (Client form field names) | 'vendor'
 * form     the form's current values
 * onFill(fields, profile)  sets the fields and keeps the profile with the form
 */
export default function ApolloFill({ orgId, kind = 'client', form, onFill }) {
    const t = useT();
    const { status, role } = useConnectorFor(orgId, 'apollo');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [candidates, setCandidates] = useState(null);
    const [done, setDone] = useState(null);

    if (!status || role === 'viewer') return null;

    const name = kind === 'client' ? form.clientName : form.company_name;
    const apply = async (company) => {
        const fields = blanksToFill(form, company, kind, { countryCode: await loadCountryCode() });
        onFill(fields, company);
        setDone({ company, fields: Object.keys(fields) });
        setCandidates(null);
    };

    const lookUp = async (domain) => {
        setBusy(true);
        setError('');
        setDone(null);
        try {
            const d = domain || domainForRecord(form);
            const out = await apolloService.lookup(orgId, d ? { domain: d } : { name });
            if (out.company) await apply(out.company);
            else setCandidates(out.candidates || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const canTry = !!domainForRecord(form) || String(name || '').trim().length >= 2;
    const box = { border: `1px solid ${t.line}`, borderRadius: 10, padding: '10px 12px', background: t.panelAlt };

    return (
        <div style={box}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <img src={apolloLogo} alt="" aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 4 }} />
                <div style={{ flex: 1, minWidth: 180, fontSize: 12.5, color: t.dim, lineHeight: 1.45 }}>
                    {done
                        ? <span style={{ color: t.text }}><Check size={13} style={{ verticalAlign: -2, color: t.up }} /> {done.company.name}{done.company.employees ? `, ${sizeText(done.company.employees)}` : ''}{done.company.growth_6m !== null && done.company.growth_6m !== undefined ? ` (${growthText(done.company.growth_6m)} in 6 months)` : ''}. {done.fields.length ? `Filled the blank ${done.fields.map((f) => LABEL[f] || f).join(', ')}.` : 'No blank fields to fill; the details are kept with this record.'}</span>
                        : 'Enter the website, a business email or the company name, then fill the rest from Apollo.io. Uses 1 Apollo credit.'}
                </div>
                <Btn size="sm" onClick={() => lookUp()} disabled={busy || !canTry} title={canTry ? undefined : 'Enter a website, business email or company name first'}>
                    {busy ? 'Looking Up…' : done ? 'Look Up Again' : 'Fill From Apollo'}
                </Btn>
            </div>
            {error && <div role="alert" style={{ fontSize: 12.5, color: t.down, marginTop: 8 }}>{error}</div>}
            {candidates && (
                <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12, color: t.faint, marginBottom: 6 }}>Which company is it? Picking one uses 1 more credit.</div>
                    <div style={{ display: 'grid', gap: 6 }}>
                        {candidates.map((c) => (
                            <button key={c.domain} type="button" onClick={() => lookUp(c.domain)} disabled={busy}
                                style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: `1px solid ${t.line}`, background: t.card, color: t.text, cursor: 'pointer', font: 'inherit' }}>
                                <span style={{ width: 24, height: 24, borderRadius: 6, background: '#fff', border: `1px solid ${t.line}`, display: 'grid', placeItems: 'center', overflow: 'hidden', flex: 'none' }}>
                                    {c.logo_url ? <img src={c.logo_url} alt="" referrerPolicy="no-referrer" style={{ width: 18, height: 18, objectFit: 'contain' }} /> : null}
                                </span>
                                <span style={{ flex: 1, minWidth: 0 }}>
                                    <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>{c.name}</span>
                                    <span style={{ display: 'block', fontSize: 12, color: t.faint }}>{[c.domain, c.place].filter(Boolean).join(' · ')}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
