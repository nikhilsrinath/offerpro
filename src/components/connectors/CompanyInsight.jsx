import React, { useState } from 'react';
import { ExternalLink, Linkedin, RefreshCw, TrendingUp, TrendingDown, Users, UserPlus, Check } from 'lucide-react';
import { Btn } from '../ui/edge';
import { useT, MONO } from '../ui/edgeUtils';
import { apolloService, useConnectorFor } from '../../services/connectorsService';
import { growthText, isHiringFast, sizeText } from '../../shared/apollo';
import apolloLogo from '../../assets/connectors/apollo.png';

/* A client's or vendor's company, as Apollo.io knows it: industry, size,
   headcount growth, revenue, links. Shown on the client page and the CRM
   lead panel; works anywhere a record with `company_profile` is.

   With Apollo connected, it can look the company up (or refresh it), and,
   given `onAddContact`, find decision makers there and add one as a contact
   person. Without Apollo and with nothing stored, it renders nothing. */

const fmtDate = (iso) => {
    try { return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; }
};

function Fact({ label, value, t }) {
    if (value === null || value === undefined || value === '') return null;
    return (
        <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11.5, color: t.faint, marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 13, color: t.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
        </div>
    );
}

function Mark({ src, name, size = 36, t }) {
    const [broken, setBroken] = useState(false);
    return (
        <span aria-hidden="true" style={{ width: size, height: size, borderRadius: 9, flex: 'none', display: 'grid', placeItems: 'center', background: '#fff', border: `1px solid ${t.line}`, overflow: 'hidden', fontSize: 13, fontWeight: 700, color: '#101828' }}>
            {src && !broken
                ? <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} style={{ width: size - 8, height: size - 8, objectFit: 'contain' }} />
                : (name || '?').trim().charAt(0).toUpperCase()}
        </span>
    );
}

function People({ orgId, profile, onAddContact, existing, t }) {
    const [state, setState] = useState({ loading: false, people: null, error: '' });
    const [busy, setBusy] = useState(null);
    const [added, setAdded] = useState({});
    const [failed, setFailed] = useState({});

    const find = async () => {
        setState({ loading: true, people: null, error: '' });
        try {
            const out = await apolloService.people(orgId, { domain: profile.domain, apolloId: profile.apollo_id });
            setState({ loading: false, people: out.people || [], error: '' });
        } catch (err) {
            setState({ loading: false, people: null, error: err.message });
        }
    };

    const add = async (p) => {
        setBusy(p.id);
        setFailed((f) => ({ ...f, [p.id]: '' }));
        try {
            const { person } = await apolloService.reveal(orgId, p.id);
            const dup = person.email && existing.some((c) => (c.email || '').toLowerCase() === person.email.toLowerCase());
            if (!dup) await onAddContact(person);
            setAdded((a) => ({ ...a, [p.id]: dup ? 'Already a contact' : (person.email ? 'Added' : 'Added, no verified email') }));
        } catch (err) {
            setFailed((f) => ({ ...f, [p.id]: err.message }));
        } finally {
            setBusy(null);
        }
    };

    return (
        <div style={{ borderTop: `1px solid ${t.line}`, paddingTop: 12, marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: t.text, flex: 1, minWidth: 160 }}>Decision Makers</div>
                <Btn size="sm" onClick={find} disabled={state.loading}>
                    <Users size={13} /> {state.loading ? 'Searching…' : state.people ? 'Search Again' : 'Find People'}
                </Btn>
            </div>
            {!state.people && !state.error && (
                <div style={{ fontSize: 12, color: t.faint, marginTop: 4 }}>
                    Owners, founders, directors and heads at this company. Finding them is free; adding one as a contact uses an Apollo credit to get their work email.
                </div>
            )}
            {state.error && <div role="alert" style={{ fontSize: 12.5, color: t.down, marginTop: 6 }}>{state.error}</div>}
            {state.people && state.people.length === 0 && (
                <div style={{ fontSize: 12.5, color: t.dim, marginTop: 6 }}>Apollo has no decision makers listed at this company.</div>
            )}
            {state.people && state.people.length > 0 && (
                <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 6 }}>
                    {state.people.map((p) => (
                        <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: `1px solid ${t.line}`, borderRadius: 8 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, color: t.text, fontWeight: 500 }}>{p.name}</div>
                                <div style={{ fontSize: 12, color: t.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {p.title || 'No title listed'}{p.has_email ? '' : ' · no email on file'}
                                </div>
                                {failed[p.id] && <div role="alert" style={{ fontSize: 12, color: t.down, marginTop: 2 }}>{failed[p.id]}</div>}
                            </div>
                            {added[p.id]
                                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: t.up }}><Check size={13} /> {added[p.id]}</span>
                                : (
                                    <Btn size="sm" onClick={() => add(p)} disabled={!!busy} title="Uses an Apollo credit">
                                        <UserPlus size={13} /> {busy === p.id ? 'Adding…' : 'Add as Contact'}
                                    </Btn>
                                )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/**
 * kind      'client' | 'vendor'
 * record    the cached client or vendor (needs id, company_profile)
 * onAddContact(person) adds { name, title, email, linkedin_url } as a contact
 *           person; omit it to hide Decision Makers
 */
export default function CompanyInsight({ orgId, kind = 'client', record, onAddContact, existingContacts = [], style }) {
    const t = useT();
    const { status, role } = useConnectorFor(orgId, 'apollo');
    const [profile, setProfile] = useState(record?.company_profile || null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [filled, setFilled] = useState(null);
    const [lastId, setLastId] = useState(record?.id);

    // Another record shown in the same place: start from its own details.
    if (record?.id !== lastId) {
        setLastId(record?.id);
        setProfile(record?.company_profile || null);
        setError('');
        setFilled(null);
    }

    // The column is not on this database (0106), or nothing to show and no way to get it.
    if (!record || !('company_profile' in record)) return null;
    const canLookUp = !!status && role !== 'viewer';
    if (!profile && !canLookUp) return null;

    const lookUp = async () => {
        setBusy(true);
        setError('');
        try {
            const out = await apolloService.enrich(orgId, kind, record.id);
            setProfile(out.company);
            setFilled(out.filled || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const frame = { border: `1px solid ${t.line}`, borderRadius: 12, background: t.card, padding: 14, ...style };
    const head = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <img src={apolloLogo} alt="" aria-hidden="true" style={{ width: 16, height: 16, borderRadius: 4 }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: t.text, flex: 1 }}>Company Details</span>
            {profile && canLookUp && (
                <Btn size="sm" onClick={lookUp} disabled={busy} title="Look the company up again (1 Apollo credit)">
                    <RefreshCw size={13} /> {busy ? 'Refreshing…' : 'Refresh'}
                </Btn>
            )}
        </div>
    );

    if (!profile) {
        return (
            <section aria-label="Company details" style={frame}>
                {head}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <p style={{ margin: 0, fontSize: 12.5, color: t.dim, lineHeight: 1.5, flex: 1, minWidth: 200 }}>
                        Look this company up on Apollo.io for its industry, size, hiring and LinkedIn. Uses 1 Apollo credit. Only blank fields are filled in.
                    </p>
                    <Btn size="sm" primary onClick={lookUp} disabled={busy}>{busy ? 'Looking Up…' : 'Look Up'}</Btn>
                </div>
                {error && <div role="alert" style={{ fontSize: 12.5, color: t.down, marginTop: 8 }}>{error}</div>}
            </section>
        );
    }

    const growth = growthText(profile.growth_6m);
    const hiring = isHiringFast(profile);
    const shrinking = Number(profile.growth_6m) <= -0.1;
    const place = [profile.city, profile.state, profile.country].filter(Boolean).join(', ');
    const link = (href, icon, label) => href && (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: t.dim, textDecoration: 'none' }}>
            {icon} {label}
        </a>
    );

    return (
        <section aria-label="Company details" style={frame}>
            {head}
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <Mark src={profile.logo_url} name={profile.name} t={t} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{profile.name || record.clientName || record.company_name}</span>
                        {hiring && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 7px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, color: t.up, background: t.raised }}>
                                <TrendingUp size={12} /> Hiring Fast
                            </span>
                        )}
                        {shrinking && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 7px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, color: t.down, background: t.raised }}>
                                <TrendingDown size={12} /> Shrinking
                            </span>
                        )}
                    </div>
                    <div style={{ fontSize: 12.5, color: t.dim, marginTop: 2 }}>
                        {[profile.industry, place].filter(Boolean).join(' · ') || profile.domain}
                    </div>
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6 }}>
                        {link(profile.website, <ExternalLink size={12} />, profile.domain || 'Website')}
                        {link(profile.linkedin_url, <Linkedin size={12} />, 'LinkedIn')}
                    </div>
                </div>
            </div>

            {profile.description && (
                <p style={{ margin: '10px 0 0', fontSize: 12.5, color: t.dim, lineHeight: 1.55 }}>{profile.description}</p>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginTop: 12 }}>
                <Fact t={t} label="People" value={sizeText(profile.employees)} />
                <Fact t={t} label="Headcount, 6 Months" value={growth} />
                <Fact t={t} label="Headcount, 12 Months" value={growthText(profile.growth_12m)} />
                <Fact t={t} label="Annual Revenue" value={profile.annual_revenue_printed ? `$${profile.annual_revenue_printed}` : null} />
                <Fact t={t} label="Founded" value={profile.founded_year} />
                <Fact t={t} label="Funding" value={[profile.funding_stage, profile.total_funding_printed && `$${profile.total_funding_printed}`].filter(Boolean).join(' · ') || null} />
            </div>

            {profile.keywords?.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
                    {profile.keywords.slice(0, 8).map((k) => (
                        <span key={k} style={{ fontSize: 11.5, padding: '2px 8px', borderRadius: 999, background: t.raised, color: t.dim, fontFamily: MONO }}>{k}</span>
                    ))}
                </div>
            )}

            {error && <div role="alert" style={{ fontSize: 12.5, color: t.down, marginTop: 8 }}>{error}</div>}
            {filled && filled.length > 0 && (
                <div style={{ fontSize: 12, color: t.up, marginTop: 8 }}>Filled in the blank {filled.map((f) => f.replace('_', ' ').replace('country code', 'country')).join(', ')}.</div>
            )}

            {onAddContact && canLookUp && (profile.domain || profile.apollo_id) && (
                <People orgId={orgId} profile={profile} onAddContact={onAddContact} existing={existingContacts} t={t} />
            )}

            <div style={{ fontSize: 11.5, color: t.faint, marginTop: 12 }}>
                From Apollo.io{profile.fetched_at ? `, updated ${fmtDate(profile.fetched_at)}` : ''}. Figures are Apollo’s estimates.
            </div>
        </section>
    );
}
