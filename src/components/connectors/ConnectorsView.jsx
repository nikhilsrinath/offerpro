import React, { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Modal, Btn } from '../ui/edge';
import { useOrg } from '../../context/OrgContext';
import { useConnectorFor } from '../../services/connectorsService';
import { CONNECTORS, GROUPS } from './connectorCatalog';
import { GUIDES } from './connectorGuides';
import { useApolloConnection } from './useApolloConnection';
import './connectors.css';

/* AI → Connectors: every service Opstead can connect to, grouped. Each card
   carries the service's own logo and opens a side panel that explains the
   connector: what it does in Opstead, how to set it up, how to get the most
   from it, and exactly what it can and cannot see. Until a connector is
   built its card says Coming Soon and its Connect button is disabled; a
   built one ('live') shows Connected on its card, and its panel connects
   it, changes its settings and shows its activity. */

const groupLabel = (id) => GROUPS.find((g) => g.id === id)?.label || '';

function Logo({ c, large }) {
    const Icon = c.icon;
    return (
        <span className={`cn-logo${Icon ? ' is-icon' : ''}${c.wide ? ' is-wide' : ''}${large ? ' is-lg' : ''}`} aria-hidden="true">
            {Icon ? <Icon size={large ? 24 : 20} strokeWidth={1.8} /> : <img src={c.logo} alt="" />}
        </span>
    );
}

function ConnectorCard({ c, connected, onOpen }) {
    return (
        <button type="button" className="cn-card" onClick={onOpen} aria-label={`${c.name}: ${connected ? 'connected, ' : ''}how it works`}>
            <div className="cn-card-top">
                <Logo c={c} />
                {c.status === 'soon' && <span className="cn-soon">Coming Soon</span>}
                {connected && <span className="cn-soon is-on"><Check size={12} strokeWidth={2.6} aria-hidden="true" /> Connected</span>}
            </div>
            <div className="cn-name">{c.name}</div>
            <p className="cn-desc">{c.desc}</p>
        </button>
    );
}

function Section({ title, children }) {
    return (
        <section className="cn-sec">
            <h3>{title}</h3>
            {children}
        </section>
    );
}

function AccessList({ items, tone }) {
    if (!items?.length) return null;
    const Mark = tone === 'never' ? X : Check;
    return (
        <ul className={`cn-access is-${tone}`}>
            {items.map((t) => <li key={t}><Mark size={13} strokeWidth={2.4} aria-hidden="true" /><span>{t}</span></li>)}
        </ul>
    );
}

function ConnectorPanel({ c, orgId, onClose }) {
    const g = c ? GUIDES[c.id] : null;
    const soon = c?.status === 'soon';
    // Hooks run for every panel; only Apollo's is shown, and only for Apollo.
    const apolloConn = useApolloConnection(orgId, { open: c?.id === 'apollo', onClose });
    const live = c?.id === 'apollo' ? apolloConn : null;
    return (
        <Modal
            open={!!c}
            onClose={onClose}
            width={680}
            title={c?.name || ''}
            note={c ? `${groupLabel(c.group)}${soon ? ' · Coming Soon' : live?.connected ? ' · Connected' : ''}` : ''}
            footer={(
                <>
                    <Btn onClick={onClose}>Close</Btn>
                    {live ? live.footer : <Btn primary disabled={soon} title={soon ? 'Coming soon' : undefined}>{c?.cta || 'Connect'}</Btn>}
                </>
            )}
        >
            {c && g && (
                <>
                    <div className="cn-hero">
                        <Logo c={c} large />
                        <p>{g.summary}</p>
                    </div>
                    {soon && (
                        <div className="cn-note">
                            This connector is being built. Here is how it will work, so you can get ready.
                        </div>
                    )}
                    {live && <Section title="Connection">{live.section}</Section>}
                    <Section title="How Opstead Uses It">
                        <div className="cn-uses">
                            {g.uses.map((u) => (
                                <div key={u.title} className="cn-use">
                                    <div className="cn-use-title">{u.title}</div>
                                    <p>{u.text}</p>
                                </div>
                            ))}
                        </div>
                    </Section>
                    <Section title="How to Set It Up">
                        <ol className="cn-steps">
                            {g.setup.map((s, i) => <li key={s}><span className="cn-step-n">{i + 1}</span><span>{s}</span></li>)}
                        </ol>
                    </Section>
                    <Section title="Getting the Most From It">
                        <ul className="cn-tips">{g.tips.map((t) => <li key={t}>{t}</li>)}</ul>
                    </Section>
                    <Section title="What Opstead Can See">
                        <div className="cn-access-grid">
                            <div><div className="cn-access-head">Reads</div><AccessList items={g.access.reads} tone="ok" /></div>
                            <div><div className="cn-access-head">Writes</div><AccessList items={g.access.writes} tone="ok" /></div>
                            <div><div className="cn-access-head">Never</div><AccessList items={g.access.never} tone="never" /></div>
                        </div>
                        <p className="cn-who">{g.who} Disconnecting removes Opstead’s access straight away.</p>
                    </Section>
                </>
            )}
        </Modal>
    );
}

export default function ConnectorsView() {
    const { activeOrg } = useOrg();
    const orgId = activeOrg?.id;
    const apollo = useConnectorFor(orgId, 'apollo');
    const connected = { apollo: !!apollo.status };
    const [openId, setOpenId] = useState(null);
    const open = CONNECTORS.find((c) => c.id === openId) || null;
    return (
        <div className="ask-pane eo-scroll">
            <div className="ask-pane-inner">
                <div className="ask-pane-head"><h2>Connectors</h2><span className="ag-badge">{CONNECTORS.length}</span></div>
                {GROUPS.map((g) => {
                    const items = CONNECTORS.filter((c) => c.group === g.id);
                    if (!items.length) return null;
                    return (
                        <section key={g.id} className="cn-group" aria-label={g.label}>
                            <h3 className="cn-group-title">{g.label}</h3>
                            <div className="cn-grid">
                                {items.map((c) => <ConnectorCard key={c.id} c={c} connected={!!connected[c.id]} onOpen={() => setOpenId(c.id)} />)}
                            </div>
                        </section>
                    );
                })}
            </div>
            <ConnectorPanel c={open} orgId={orgId} onClose={() => setOpenId(null)} />
        </div>
    );
}
