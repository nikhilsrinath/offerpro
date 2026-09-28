import React, { useEffect, useRef, useState } from 'react';
import { Btn, Row, Input, Empty, Loading, Panel, Avatar, ConfirmBtn } from '../../ui/edge';
import { useT, MONO } from '../../ui/edgeUtils';
import { useToast } from '../../shared/Toast';
import {
    signedUrl, openObject, uploadLogo, fileError, deleteProjectFiles, MAX_FILE_BYTES,
} from '../../../services/projectFiles';
import { fmtBytes } from '../../../services/projectWorkspace';

/* The small pieces the Client, Vendor and Documents pages are built from,
   on top of the edge kit. */

const tint = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');

/** Loading, "needs 0074", or a retryable error — else the page. */
export function SetupGate({ setup, what, children }) {
    if (setup.state === 'loading') return <Panel><Loading>Loading {what}…</Loading></Panel>;
    if (setup.state === 'missing') {
        return <Panel><Empty>{what[0].toUpperCase() + what.slice(1)} is not set up on this workspace yet. It needs database migration 0074.</Empty></Panel>;
    }
    if (setup.state === 'error') return <Panel><Empty action={<Btn onClick={setup.retry}>Try again</Btn>}>{setup.error}</Empty></Panel>;
    return children;
}

/** A coloured status word: the colour repeats the word, never replaces it. */
export function Badge({ color, children }) {
    const t = useT();
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: '0 8px', borderRadius: 99,
            fontSize: 11.5, whiteSpace: 'nowrap', color: t.text, fontFamily: MONO,
            background: tint(color, t.isDark ? 0.22 : 0.12), border: '1px solid ' + tint(color, 0.5),
        }}>
            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
            {children}
        </span>
    );
}

export function Legend({ items, label = 'Legend' }) {
    return (
        <div role="list" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {items.map((s) => <span key={s.id} role="listitem"><Badge color={s.color}>{s.label}</Badge></span>)}
        </div>
    );
}

export function FieldError({ children }) {
    const t = useT();
    if (!children) return null;
    return <span role="alert" style={{ display: 'block', fontSize: 11.5, color: t.down, marginTop: 4 }}>{children}</span>;
}

/** A label/value line on a detail sheet. */
export function Detail({ label, children }) {
    const t = useT();
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 34%) 1fr', gap: 10, padding: '7px 0', borderBottom: '1px solid ' + t.lineSoft }}>
            <span style={{ fontSize: 11.5, color: t.faint }}>{label}</span>
            <span style={{ fontSize: 13, color: t.text, overflowWrap: 'anywhere', minWidth: 0 }}>{children || <span style={{ color: t.ghost }}>—</span>}</span>
        </div>
    );
}

// Signed logo URLs, kept for a few minutes so a list does not re-sign each render.
const logoCache = new Map();
async function logoUrl(path) {
    const hit = logoCache.get(path);
    if (hit && hit.until > Date.now()) return hit.url;
    const url = await signedUrl(path);
    logoCache.set(path, { url, until: Date.now() + 8 * 60 * 1000 });
    return url;
}

export function Logo({ path, name, size = 32 }) {
    const t = useT();
    const [url, setUrl] = useState(null);
    useEffect(() => {
        let cancelled = false;
        if (path) logoUrl(path).then((u) => { if (!cancelled) setUrl(u); }).catch(() => {});
        return () => { cancelled = true; };
    }, [path]);
    if (!path || !url) return <Avatar name={name || '?'} size={size} />;
    return (
        <img src={url} alt="" width={size} height={size} style={{
            width: size, height: size, borderRadius: Math.round(size / 4.2), objectFit: 'contain',
            border: '1px solid ' + t.line, background: '#fff', flexShrink: 0,
        }} />
    );
}

export function LogoField({ kind, value, name, onChange }) {
    const t = useT();
    const toast = useToast();
    const input = useRef(null);
    const [busy, setBusy] = useState(false);
    const pick = async (file) => {
        if (!file) return;
        setBusy(true);
        try { onChange(await uploadLogo(kind, file)); } catch (e) { toast(fileError(e), 'error'); } finally {
            setBusy(false);
            if (input.current) input.current.value = '';
        }
    };
    return (
        <Row gap={10}>
            <Logo path={value} name={name} size={44} />
            <input ref={input} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} aria-label="Logo image" />
            <Btn size="sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : value ? 'Change logo' : 'Upload logo'}</Btn>
            {value && <Btn size="sm" onClick={() => onChange(null)}>Remove</Btn>}
            <span style={{ fontSize: 11, color: t.faint }}>PNG or JPG, 2 MB at most</span>
        </Row>
    );
}

/** Contact persons: name, role, email, phone, with exactly one primary. */
export function ContactsEditor({ contacts, onChange }) {
    const t = useT();
    const set = (i, patch) => onChange(contacts.map((c, k) => (k === i ? { ...c, ...patch } : c)));
    const setPrimary = (i) => onChange(contacts.map((c, k) => ({ ...c, primary: k === i })));
    const remove = (i) => {
        const next = contacts.filter((_, k) => k !== i);
        if (next.length && !next.some((c) => c.primary)) next[0] = { ...next[0], primary: true };
        onChange(next);
    };
    const add = () => onChange([...contacts, { name: '', role: '', email: '', phone: '', primary: contacts.length === 0 }]);
    return (
        <fieldset style={{ border: 'none', padding: 0, margin: 0, minWidth: 0 }}>
            <legend style={{ padding: 0, fontSize: 10.5, letterSpacing: '0.09em', color: t.faint, marginBottom: 6 }}>CONTACT PERSONS</legend>
            <div style={{ display: 'grid', gap: 8 }}>
                {contacts.map((c, i) => (
                    <div key={i} style={{ border: '1px solid ' + t.line, borderRadius: 8, padding: 8, display: 'grid', gap: 6 }}>
                        <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                            <Input aria-label={`Contact ${i + 1} name`} placeholder="Name *" value={c.name} onChange={(e) => set(i, { name: e.target.value })} />
                            <Input aria-label={`Contact ${i + 1} role`} placeholder="Role" value={c.role} onChange={(e) => set(i, { role: e.target.value })} />
                            <Input aria-label={`Contact ${i + 1} email`} type="email" placeholder="Email" value={c.email} onChange={(e) => set(i, { email: e.target.value })} />
                            <Input aria-label={`Contact ${i + 1} phone`} type="tel" placeholder="Phone" value={c.phone} onChange={(e) => set(i, { phone: e.target.value })} />
                        </div>
                        <Row gap={10}>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: t.dim, cursor: 'pointer', minHeight: 24 }}>
                                <input type="radio" name="primary-contact" checked={!!c.primary} onChange={() => setPrimary(i)} />
                                Primary contact
                            </label>
                            <div style={{ flex: 1 }} />
                            <Btn size="sm" onClick={() => remove(i)} aria-label={`Remove contact ${i + 1}`}>Remove</Btn>
                        </Row>
                    </div>
                ))}
                <div><Btn size="sm" onClick={add}>Add a contact person</Btn></div>
            </div>
        </fieldset>
    );
}

/** Files chosen in a form, uploaded when the form saves. */
export function FilePicker({ files, onChange, label = 'Attachments' }) {
    const t = useT();
    const toast = useToast();
    const input = useRef(null);
    const add = (list) => {
        const ok = [...list].filter((f) => {
            if (f.size > MAX_FILE_BYTES) { toast(`${f.name} is over 50 MB.`, 'error'); return false; }
            return true;
        });
        onChange([...files, ...ok]);
        if (input.current) input.current.value = '';
    };
    return (
        <div>
            <span style={{ display: 'block', fontSize: 10.5, letterSpacing: '0.09em', color: t.faint, marginBottom: 5 }}>{label.toUpperCase()}</span>
            <div style={{ display: 'grid', gap: 5 }}>
                {files.map((f, i) => (
                    <Row key={`${f.name}-${i}`} gap={8} style={{ border: '1px solid ' + t.line, borderRadius: 7, padding: '4px 4px 4px 10px' }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                        <span style={{ fontSize: 11, color: t.faint }}>{fmtBytes(f.size)}</span>
                        <Btn size="sm" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, k) => k !== i))}>Remove</Btn>
                    </Row>
                ))}
                <input ref={input} type="file" multiple hidden onChange={(e) => add(e.target.files || [])} aria-label={label} />
                <div><Btn size="sm" onClick={() => input.current?.click()}>Add files</Btn></div>
            </div>
        </div>
    );
}

/** Files already attached to something, each openable, removable with permission. */
export function AttachedFiles({ files, canRemove }) {
    const t = useT();
    const toast = useToast();
    if (!files.length) return null;
    return (
        <ul aria-label="Attached files" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {files.map((f) => (
                <li key={f.id} style={{ display: 'inline-flex', gap: 4 }}>
                    <Btn size="sm" aria-label={`Open ${f.name}`} onClick={() => openObject(f.storage_path).catch((e) => toast(fileError(e), 'error'))}>
                        <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                        <span style={{ color: t.faint, fontSize: 11 }}>{fmtBytes(f.size_bytes)}</span>
                    </Btn>
                    {canRemove && (
                        <ConfirmBtn label="Remove" title={`Remove ${f.name}?`} message="The file is deleted from the project, with its versions."
                            onConfirm={() => deleteProjectFiles([f]).catch((e) => toast(fileError(e), 'error'))} />
                    )}
                </li>
            ))}
        </ul>
    );
}

/** A labelled group of filters/toolbars under a panel header. */
export function Bar({ children }) {
    const t = useT();
    return <div style={{ padding: '10px 13px', borderBottom: '1px solid ' + t.lineSoft }}><Row gap={8} wrap>{children}</Row></div>;
}
