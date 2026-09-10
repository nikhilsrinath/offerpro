import { useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, ExternalLink, QrCode, AlertCircle, Ban, RotateCcw, Loader } from 'lucide-react';
import { useOrg } from '../../context/OrgContext';
import { createPortalLink, revokePortalLink, listPortalLinks } from '../../services/portalService';

/**
 * The link is minted by the server now, so it cannot be built during render:
 * it is a real credential recorded in portal_tokens, with an expiry and a
 * revocation switch. Previously this component produced
 * `Math.random().toString(36).substring(2, 10)` on every render — a different
 * "token" each time, checked by nothing.
 *
 * Revoking is part of this component because the promise has to be kept where it
 * is made. The header below has always told the user a link "can be revoked
 * later"; until this button existed that was simply untrue — the database had the
 * column and the policy, and nothing in the app ever wrote to it.
 */
export default function PortalLinkGenerator({ documentId, documentType, recipientEmail, link: existingLink }) {
  const { activeOrg } = useOrg();
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [fetched, setFetched] = useState(null);
  const [error, setError] = useState('');
  const [revoking, setRevoking] = useState('');
  const [revokedJtis, setRevokedJtis] = useState([]);
  const [history, setHistory] = useState([]);

  // A caller that already minted a link passes it in rather than having a
  // second token issued for the same document.
  const link = existingLink || fetched;
  const currentRevoked = link ? revokedJtis.includes(link.jti) : false;

  const loadHistory = useCallback(async () => {
    if (!documentId) return;
    try {
      setHistory(await listPortalLinks({ documentId }));
    } catch {
      // The list is a convenience. Failing to load it must not hide the link the
      // user came here for.
      setHistory([]);
    }
  }, [documentId]);

  useEffect(() => {
    if (existingLink || !documentId || !activeOrg?.id) return undefined;

    let cancelled = false;
    createPortalLink({ orgId: activeOrg.id, documentId, recipientEmail })
      .then((result) => { if (!cancelled) { setFetched(result); loadHistory(); } })
      .catch((err) => { if (!cancelled) setError(err.message); });

    return () => { cancelled = true; };
  }, [documentId, activeOrg?.id, recipientEmail, existingLink, loadHistory]);

  useEffect(() => { if (existingLink) loadHistory(); }, [existingLink, loadHistory]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(link.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (jti) => {
    setRevoking(jti);
    setError('');
    try {
      await revokePortalLink(jti);
      setRevokedJtis((prev) => [...prev, jti]);
      await loadHistory();
    } catch (err) {
      setError(`Could not revoke the link: ${err.message}`);
    } finally {
      setRevoking('');
    }
  };

  // Issuing a replacement is the other half of revoking: the recipient still
  // needs a way in, and a revoked token can never be reinstated.
  const handleReissue = async () => {
    setRevoking('new');
    setError('');
    try {
      const result = await createPortalLink({ orgId: activeOrg.id, documentId, recipientEmail });
      setFetched(result);
      setRevokedJtis((prev) => prev.filter((j) => j !== result.jti));
      await loadHistory();
    } catch (err) {
      setError(`Could not create a new link: ${err.message}`);
    } finally {
      setRevoking('');
    }
  };

  if (error && !link) {
    return (
      <div className="portal-link-gen">
        <div className="portal-link-gen-header">
          <h4><AlertCircle size={14} /> Could not create the link</h4>
          <p className="portal-link-gen-sub">{error}</p>
        </div>
      </div>
    );
  }

  if (!link) {
    return (
      <div className="portal-link-gen">
        <div className="portal-link-gen-header">
          <h4>Creating secure link…</h4>
          <p className="portal-link-gen-sub">This link is registered against the document and can be revoked later.</p>
        </div>
      </div>
    );
  }

  const fmt = (value) => new Date(value).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  // Links other than the one on screen that a recipient could still use.
  const otherLive = history.filter((t) => (
    t.jti !== link.jti
    && !t.revoked_at
    && new Date(t.expires_at).getTime() > Date.now()
  ));

  return (
    <div className="portal-link-gen">
      <div className="portal-link-gen-header">
        <h4>{currentRevoked ? 'Portal Link Revoked' : 'Portal Link Generated'}</h4>
        <p className="portal-link-gen-sub">
          {currentRevoked
            ? 'This link no longer opens the document. Create a new one if the recipient still needs access.'
            : 'Share this link with the recipient'}
        </p>
      </div>

      {!currentRevoked && (
        <div className="portal-link-gen-url-box">
          <code className="portal-link-gen-url">{link.url}</code>
          <div className="portal-link-gen-actions">
            <button type="button" onClick={handleCopy} className="portal-link-gen-btn primary">
              {copied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy Link</>}
            </button>
            <button type="button" onClick={() => window.open(link.url, '_blank')} className="portal-link-gen-btn">
              <ExternalLink size={14} /> Open Link
            </button>
            <button type="button" onClick={() => setShowQR(!showQR)} className="portal-link-gen-btn">
              <QrCode size={14} /> {showQR ? 'Hide' : 'Show'} QR
            </button>
            <button
              type="button"
              onClick={() => handleRevoke(link.jti)}
              disabled={revoking === link.jti}
              className="portal-link-gen-btn"
            >
              {revoking === link.jti
                ? <><Loader size={14} className="spin-icon" /> Revoking…</>
                : <><Ban size={14} /> Revoke</>}
            </button>
          </div>
        </div>
      )}

      {currentRevoked && (
        <div className="portal-link-gen-actions">
          <button
            type="button"
            onClick={handleReissue}
            disabled={revoking === 'new'}
            className="portal-link-gen-btn primary"
          >
            {revoking === 'new'
              ? <><Loader size={14} className="spin-icon" /> Creating…</>
              : <><RotateCcw size={14} /> Create a new link</>}
          </button>
        </div>
      )}

      {error && (
        <p className="portal-link-gen-expiry" style={{ color: '#ef4444' }}>
          <AlertCircle size={12} /> {error}
        </p>
      )}

      {showQR && !currentRevoked && (
        <div className="portal-link-gen-qr">
          <QRCodeSVG value={link.url} size={180} bgColor="#ffffff" fgColor="#0A0A0F" level="M" includeMargin />
          <p className="portal-link-gen-qr-hint">Scan to open on mobile</p>
        </div>
      )}

      <p className="portal-link-gen-expiry">
        Document type: {documentType}
        {!currentRevoked && link.expires_at ? ` · Expires ${fmt(link.expires_at)}` : ''}
      </p>

      {/* Earlier links stay valid until they expire or are revoked. An admin who
          emailed one to the wrong address needs to see it to kill it. */}
      {otherLive.length > 0 && (
        <div className="portal-link-gen-history">
          <p className="portal-link-gen-sub">
            {otherLive.length} earlier {otherLive.length === 1 ? 'link' : 'links'} for this document
            {otherLive.length === 1 ? ' still works:' : ' still work:'}
          </p>
          {otherLive.map((t) => (
            <div key={t.jti} className="portal-link-gen-history-row">
              <span>
                {t.recipient_email || 'no address recorded'}
                {` · issued ${fmt(t.issued_at)} · expires ${fmt(t.expires_at)}`}
                {t.used_at ? ' · already signed' : ''}
              </span>
              <button
                type="button"
                onClick={() => handleRevoke(t.jti)}
                disabled={revoking === t.jti}
                className="portal-link-gen-btn"
              >
                {revoking === t.jti
                  ? <><Loader size={14} className="spin-icon" /> Revoking…</>
                  : <><Ban size={14} /> Revoke</>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
