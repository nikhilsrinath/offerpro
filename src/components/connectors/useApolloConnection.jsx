import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Btn } from '../ui/edge';
import { confirmDialog } from '../../services/confirm';
import AutoFillChoice from './AutoFillChoice';
import { apolloService, useConnectorFor } from '../../services/connectorsService';

/* The working part of Apollo.io's panel on AI → Connectors: the API key,
   automatic fill-in, test, disconnect and the log of lookups. Returns the
   panel's Connection section and its footer buttons, so the panel keeps
   one layout for every connector. Owners and admins manage it; everyone
   else sees whether it is connected. */

const fmt = (iso) => {
    try {
        return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    } catch { return ''; }
};
const fmtDay = (iso) => {
    try { return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; }
};

const ACTION = {
    connect: 'Connected', disconnect: 'Disconnected', settings: 'Settings', test: 'Test', company: 'Company lookup',
    search: 'Company search', enrich: 'Company details', auto_fill: 'Filled in automatically', people: 'Decision makers', reveal: 'Contact added',
};

export function useApolloConnection(orgId, { open, onClose }) {
    const { status, role, loaded, error: loadError } = useConnectorFor(orgId, 'apollo');
    const admin = role === 'owner' || role === 'admin';
    const [key, setKey] = useState('');
    const [auto, setAuto] = useState(false);
    const [busy, setBusy] = useState('');
    const [msg, setMsg] = useState(null);       // { tone: 'ok' | 'error', text }
    const [logs, setLogs] = useState(null);
    const [replacing, setReplacing] = useState(false);

    // A fresh panel each time it opens.
    useEffect(() => {
        if (!open) return;
        setKey('');
        setMsg(null);
        setReplacing(false);
        setLogs(null);
        setAuto(!!status?.settings?.auto_fill);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    useEffect(() => {
        if (!open || !status || !admin) return undefined;
        let cancelled = false;
        apolloService.logs(orgId).then((out) => { if (!cancelled) setLogs(out); }).catch(() => { if (!cancelled) setLogs({ events: [], usage: null }); });
        return () => { cancelled = true; };
    }, [open, status, admin, orgId, busy]);

    const run = async (what, fn, okText) => {
        setBusy(what);
        setMsg(null);
        try {
            await fn();
            if (okText) setMsg({ tone: 'ok', text: okText });
            return true;
        } catch (err) {
            setMsg({ tone: 'error', text: err.message });
            return false;
        } finally {
            setBusy('');
        }
    };

    const connect = async () => {
        const ok = await run('connect', () => apolloService.connect(orgId, key, { auto_fill: auto }),
            replacing ? 'The new key works and replaced the old one.' : 'Apollo.io is connected. Fill From Apollo now shows on client and vendor forms.');
        if (ok) { setKey(''); setReplacing(false); }
    };
    const saveAuto = (v) => {
        setAuto(v);
        run('settings', () => apolloService.saveSettings(orgId, { auto_fill: v }), v ? 'New clients and leads will be filled in automatically.' : 'Company details are now looked up only when someone asks.');
    };
    const test = () => run('test', () => apolloService.test(orgId), 'The API key works.');
    const disconnect = async () => {
        const sure = await confirmDialog({
            title: 'Disconnect Apollo.io?',
            message: 'Opstead deletes the API key. Fill From Apollo and automatic fill-in stop for everyone. Company details already saved on clients and vendors stay.',
            confirmLabel: 'Disconnect',
            tone: 'danger',
        });
        if (!sure) return;
        const ok = await run('disconnect', () => apolloService.disconnect(orgId), null);
        if (ok) onClose?.();
    };

    const keyForm = (
        <div className="cn-keyform">
            <label className="cn-field-label" htmlFor="apollo-key">Apollo API Key</label>
            <input id="apollo-key" className="cn-input" type="password" autoComplete="off" spellCheck={false}
                value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste the key from Apollo"
                onKeyDown={(e) => { if (e.key === 'Enter' && key.trim()) { e.preventDefault(); connect(); } }} />
            <div className="cn-field-hint">Opstead checks it with Apollo, then stores it encrypted. It is never shown again.</div>
        </div>
    );

    let section = null;
    if (!loaded) {
        section = <div className="cn-note">Checking the connection…</div>;
    } else if (!status) {
        section = admin ? (
            <div className="cn-connect">
                {loadError && <div className="cn-msg is-error"><AlertTriangle size={14} /> {loadError}</div>}
                {keyForm}
                <div className="cn-field-label">When to Fill In Company Details</div>
                <AutoFillChoice value={auto} onChange={setAuto} disabled={!!busy} />
            </div>
        ) : (
            <div className="cn-note">Not connected. An owner or admin can connect Apollo.io here.</div>
        );
    } else {
        const usage = logs?.usage;
        section = (
            <div className="cn-connect">
                <div className="cn-status">
                    <CheckCircle2 size={16} className="cn-ok" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="cn-status-title">Connected</div>
                        <div className="cn-status-text">
                            Since {fmtDay(status.connected_at)}
                            {status.key_hint ? ` · key ending ${status.key_hint}` : ''}
                            {status.last_used_at ? ` · last used ${fmt(status.last_used_at)}` : ''}
                        </div>
                    </div>
                </div>
                {status.last_error && <div className="cn-msg is-error"><AlertTriangle size={14} /> Last time: {status.last_error}</div>}
                {admin ? (
                    <>
                        <div className="cn-field-label">When to Fill In Company Details</div>
                        <AutoFillChoice value={auto} onChange={saveAuto} disabled={!!busy} />
                        {replacing && keyForm}
                    </>
                ) : (
                    <div className="cn-note">
                        {status.settings?.auto_fill ? 'New clients and leads are filled in automatically.' : 'Use Fill From Apollo on a client or vendor form, or Look Up on a client’s page.'}
                    </div>
                )}
                {admin && usage && (
                    <div className="cn-usage">Last {usage.days} days: {usage.lookups} {usage.lookups === 1 ? 'lookup' : 'lookups'}, about {usage.credits} Apollo {usage.credits === 1 ? 'credit' : 'credits'}.</div>
                )}
                {admin && logs?.events?.length > 0 && (
                    <div className="cn-logs">
                        <div className="cn-field-label">Recent Activity</div>
                        <ul>
                            {logs.events.slice(0, 12).map((e) => (
                                <li key={e.id} className={e.ok ? '' : 'is-fail'}>
                                    <span className="cn-log-when">{fmt(e.created_at)}</span>
                                    <span className="cn-log-what">
                                        <strong>{ACTION[e.action] || e.action}</strong>
                                        {e.detail ? ` · ${e.detail}` : ''}
                                        {e.actor ? ` · ${e.actor}` : ''}
                                    </span>
                                    {e.credits > 0 && <span className="cn-log-credits">{e.credits} cr</span>}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        );
    }

    const message = msg && (
        <div className={`cn-msg ${msg.tone === 'ok' ? 'is-ok' : 'is-error'}`} role={msg.tone === 'ok' ? 'status' : 'alert'}>
            {msg.tone === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {msg.text}
        </div>
    );

    let footer = null;
    if (admin && loaded && !status) {
        footer = <Btn primary onClick={connect} disabled={!key.trim() || !!busy}>{busy === 'connect' ? 'Checking Key…' : 'Add API Key'}</Btn>;
    } else if (admin && status) {
        footer = replacing ? (
            <>
                <Btn onClick={() => { setReplacing(false); setKey(''); }}>Cancel</Btn>
                <Btn primary onClick={connect} disabled={!key.trim() || !!busy}>{busy === 'connect' ? 'Checking Key…' : 'Save New Key'}</Btn>
            </>
        ) : (
            <>
                <Btn danger onClick={disconnect} disabled={!!busy}>{busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</Btn>
                <Btn onClick={() => setReplacing(true)} disabled={!!busy}>Replace Key</Btn>
                <Btn primary onClick={test} disabled={!!busy}>{busy === 'test' ? 'Testing…' : 'Test Connection'}</Btn>
            </>
        );
    }

    return { section: <>{message}{section}</>, footer, connected: !!status };
}
