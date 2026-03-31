import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, ExternalLink, QrCode } from 'lucide-react';
import { useOrg } from '../../context/OrgContext';

export default function PortalLinkGenerator({ documentId, documentType }) {
  const { activeOrg } = useOrg();
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);

  const token = Math.random().toString(36).substring(2, 10);
  const orgId = activeOrg?.id || '';
  const portalUrl = `${window.location.origin}/portal/${documentId}?token=${token}&org=${orgId}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(portalUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="portal-link-gen">
      <div className="portal-link-gen-header">
        <h4>Portal Link Generated</h4>
        <p className="portal-link-gen-sub">Share this link with the recipient</p>
      </div>

      <div className="portal-link-gen-url-box">
        <code className="portal-link-gen-url">{portalUrl}</code>
        <div className="portal-link-gen-actions">
          <button type="button" onClick={handleCopy} className="portal-link-gen-btn primary">
            {copied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy Link</>}
          </button>
          <button type="button" onClick={() => window.open(portalUrl, '_blank')} className="portal-link-gen-btn">
            <ExternalLink size={14} /> Open Link
          </button>
          <button type="button" onClick={() => setShowQR(!showQR)} className="portal-link-gen-btn">
            <QrCode size={14} /> {showQR ? 'Hide' : 'Show'} QR
          </button>
        </div>
      </div>

      {showQR && (
        <div className="portal-link-gen-qr">
          <QRCodeSVG value={portalUrl} size={180} bgColor="#ffffff" fgColor="#0A0A0F" level="M" includeMargin />
          <p className="portal-link-gen-qr-hint">Scan to open on mobile</p>
        </div>
      )}

      <p className="portal-link-gen-expiry">
        Document type: {documentType} · Link does not expire
      </p>
    </div>
  );
}
