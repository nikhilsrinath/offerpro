import { useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, ExternalLink, QrCode, ChevronDown, ChevronUp } from 'lucide-react';
import { useOrg } from '../../context/OrgContext';
import { createPortalLink, revokePortalLink, listPortalLinks } from '../../services/portalService';
import { confirmDialog } from '../../services/confirm';
import { Btn, Modal, Status } from '../ui/edge';
import { useT } from '../ui/edgeUtils';

/**
 * The link is minted by the server, so it cannot be built during render: it is
 * a real credential recorded in portal_tokens, with an expiry and a revocation
 * switch. The token string itself is never stored, so an earlier link can be
 * listed and revoked but never shown again — which is why opening this panel
 * issues a fresh one, and why older ones are summarised in a single line with
 * one action instead of a row each.
 *
 * `bare` drops the panel frame for use inside ShareLinkModal, whose header
 * already names the document.
 */
export default function PortalLinkGenerator({ documentId, recipientEmail, link: existingLink, bare = false }) {
  const t = useT();
  const { activeOrg } = useOrg();
  const [fetched, setFetched] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [revoked, setRevoked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  const [history, setHistory] = useState([]);

  // A caller that already minted a link passes it in rather than having a
  // second token issued for the same document.
  const link = fetched || existingLink;

  const loadHistory = useCallback(async () => {
    if (!documentId) return;
    try {
      setHistory(await listPortalLinks({ documentId }));
    } catch {
      // A convenience: failing to load it must not hide the link itself.
      setHistory([]);
    }
  }, [documentId]);

  const issue = useCallback(async () => {
    setError('');
    const result = await createPortalLink({ orgId: activeOrg.id, documentId, recipientEmail });
    setFetched(result);
    setRevoked(false);
    await loadHistory();
  }, [activeOrg?.id, documentId, recipientEmail, loadHistory]);

  useEffect(() => {
    if (existingLink || !documentId || !activeOrg?.id) return undefined;
    let cancelled = false;
    createPortalLink({ orgId: activeOrg.id, documentId, recipientEmail })
      .then((result) => { if (!cancelled) { setFetched(result); loadHistory(); } })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [documentId, activeOrg?.id, recipientEmail, existingLink, loadHistory]);

  useEffect(() => { if (existingLink) loadHistory(); }, [existingLink, loadHistory]);

  const run = async (key, fn, failure) => {
    setBusy(key);
    setError('');
    try { await fn(); } catch (err) { setError(`${failure}: ${err.message}`); } finally { setBusy(''); }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Your browser blocked the clipboard. Select the link and copy it by hand.');
    }
  };

  const handleRevokeCurrent = async () => {
    const ok = await confirmDialog({
      title: 'Revoke this link?',
      message: 'Anyone who has it will no longer be able to open the document. This cannot be undone.',
      confirmLabel: 'Revoke',
      tone: 'danger',
    });
    if (!ok) return;
    run('current', async () => {
      await revokePortalLink(link.jti);
      setRevoked(true);
      setShowQR(false);
      await loadHistory();
    }, 'Could not revoke the link');
  };

  const fmt = (value) => new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  // Earlier links a recipient could still use.
  const older = history.filter((row) => (
    row.jti !== link?.jti && !row.revoked_at && new Date(row.expires_at).getTime() > Date.now()
  ));

  const handleRevokeOlder = async () => {
    const ok = await confirmDialog({
      title: `Revoke ${older.length} older ${older.length === 1 ? 'link' : 'links'}?`,
      message: 'Only the link above will keep working. Anyone holding an older link will need this one.',
      confirmLabel: 'Revoke older links',
      tone: 'danger',
    });
    if (!ok) return;
    run('older', async () => {
      await Promise.all(older.map((row) => revokePortalLink(row.jti)));
      await loadHistory();
      setShowOlder(false);
    }, 'Could not revoke the older links');
  };

  const current = history.find((row) => row.jti === link?.jti);
  const sentTo = current?.recipient_email || recipientEmail;

  const body = (() => {
    if (!link && error) {
      return (
        <div>
          <Status tone="down">Could not create the link</Status>
          <p style={{ margin: '8px 0 12px', fontSize: 11.5, color: t.dim, lineHeight: 1.55 }}>{error}</p>
          <Btn primary disabled={busy === 'new'} onClick={() => run('new', issue, 'Could not create the link')}>
            {busy === 'new' ? 'Trying…' : 'Try again'}
          </Btn>
        </div>
      );
    }

    if (!link) {
      return (
        <div role="status" aria-live="polite">
          <Status tone="mute">Creating a secure link…</Status>
          <div style={{ height: 29, marginTop: 10, borderRadius: 7, background: t.panelAlt, border: '1px solid ' + t.line }} />
        </div>
      );
    }

    return (
      <>
        {/* State, in one line: live or not, for whom, until when. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11, color: t.faint }}>
          {revoked ? <Status tone="down">Revoked</Status> : <Status tone="up">Active</Status>}
          {!revoked && link.expires_at && <span>expires {fmt(link.expires_at)}</span>}
          {!revoked && sentTo && <span>· for {sentTo}</span>}
        </div>

        {revoked ? (
          <div style={{ marginTop: 12 }}>
            <p style={{ margin: '0 0 12px', fontSize: 11.5, color: t.dim, lineHeight: 1.55 }}>
              This link no longer opens the document. Create a new one if the client still needs access.
            </p>
            <Btn primary disabled={busy === 'new'} onClick={() => run('new', issue, 'Could not create a new link')}>
              {busy === 'new' ? 'Creating…' : 'Create a new link'}
            </Btn>
          </div>
        ) : (
          <>
            {/* The link and the one thing most people came to do with it. */}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input
                readOnly
                value={link.url}
                aria-label="Portal link"
                onFocus={(e) => e.target.select()}
                style={{
                  flex: 1, minWidth: 0, height: 29, padding: '0 10px', borderRadius: 7,
                  border: '1px solid ' + t.line, background: t.panelAlt, color: t.dim,
                  fontSize: 11.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  textOverflow: 'ellipsis', outline: 'none',
                }}
              />
              <Btn primary onClick={handleCopy} aria-label={copied ? 'Link copied' : 'Copy link'}>
                {copied ? <><Check size={13} aria-hidden="true" /> Copied</> : <><Copy size={13} aria-hidden="true" /> Copy link</>}
              </Btn>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <Btn size="sm" onClick={() => window.open(link.url, '_blank', 'noopener')}>
                <ExternalLink size={12} aria-hidden="true" /> Open
              </Btn>
              <Btn size="sm" onClick={() => setShowQR((v) => !v)} aria-expanded={showQR}>
                <QrCode size={12} aria-hidden="true" /> {showQR ? 'Hide QR' : 'QR code'}
              </Btn>
              <div style={{ flex: 1 }} />
              <Btn size="sm" danger disabled={busy === 'current'} onClick={handleRevokeCurrent}>
                {busy === 'current' ? 'Revoking…' : 'Revoke'}
              </Btn>
            </div>

            {showQR && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 14, marginTop: 12, padding: 12,
                border: '1px solid ' + t.line, borderRadius: 10, background: t.panelAlt,
              }}>
                <div style={{ background: '#fff', padding: 6, borderRadius: 6, lineHeight: 0 }}>
                  <QRCodeSVG value={link.url} size={112} bgColor="#ffffff" fgColor="#0e1011" level="M" />
                </div>
                <p style={{ margin: 0, fontSize: 11, color: t.dim, lineHeight: 1.55 }}>
                  Scan with a phone camera to open the document.
                </p>
              </div>
            )}
          </>
        )}

        {error && (
          <p role="alert" style={{ margin: '10px 0 0', fontSize: 11, color: t.down, lineHeight: 1.5 }}>{error}</p>
        )}

        {/* Earlier links: one summary line and one action. The list is there
            for the rare case of finding a single link sent to the wrong person. */}
        {older.length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid ' + t.lineSoft }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: t.dim }}>
                {older.length} older {older.length === 1 ? 'link still works' : 'links still work'}
              </span>
              <button
                type="button"
                onClick={() => setShowOlder((v) => !v)}
                aria-expanded={showOlder}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 4px',
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: t.faint,
                  fontFamily: 'inherit', minHeight: 24,
                }}
              >
                {showOlder ? 'Hide' : 'Show'} {showOlder ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
              </button>
              <div style={{ flex: 1 }} />
              <Btn size="sm" danger disabled={busy === 'older'} onClick={handleRevokeOlder}>
                {busy === 'older' ? 'Revoking…' : older.length === 1 ? 'Revoke it' : 'Revoke all'}
              </Btn>
            </div>

            {showOlder && (
              <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, border: '1px solid ' + t.line, borderRadius: 8, overflow: 'hidden' }}>
                {older.map((row, i) => (
                  <li key={row.jti} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '6px 6px 6px 10px',
                    borderTop: i ? '1px solid ' + t.lineSoft : 'none', fontSize: 11,
                  }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: t.text }}>
                      {row.recipient_email || 'No email recorded'}
                    </span>
                    <span style={{ color: t.faint, whiteSpace: 'nowrap' }}>
                      {fmt(row.issued_at)}{row.used_at ? ' · signed' : ''}
                    </span>
                    <Btn
                      size="sm"
                      disabled={busy === row.jti}
                      aria-label={`Revoke link issued ${fmt(row.issued_at)}`}
                      onClick={() => run(row.jti, async () => { await revokePortalLink(row.jti); await loadHistory(); }, 'Could not revoke the link')}
                    >
                      {busy === row.jti ? '…' : 'Revoke'}
                    </Btn>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </>
    );
  })();

  if (bare) return body;

  // Inline, under a form that has just sent the document.
  return (
    <section style={{ border: '1px solid ' + t.line, borderRadius: 10, background: t.panel, overflow: 'hidden' }}>
      <header style={{ padding: '10px 14px', borderBottom: '1px solid ' + t.lineSoft }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: t.text }}>Client link</div>
        <div style={{ fontSize: 10.5, color: t.faint, marginTop: 2 }}>Anyone with this link can view and respond to the document.</div>
      </header>
      <div style={{ padding: 14 }}>{body}</div>
    </section>
  );
}

/** The share dialog the document lists open from their link button. */
export function ShareLinkModal({ open, onClose, documentId, title, recipientEmail }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title || 'Share link'}
      note="Anyone with this link can view and respond to the document."
      width={500}
      footer={<Btn onClick={onClose}>Done</Btn>}
    >
      {open && <PortalLinkGenerator bare documentId={documentId} recipientEmail={recipientEmail} />}
    </Modal>
  );
}
