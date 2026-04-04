import { useState, useEffect } from 'react';
import { onValue, ref as dbRef } from 'firebase/database';
import { db } from '../lib/firebase';
import { documentStore } from '../services/documentStore';
import { emailService } from '../services/emailService';
import { useOrg } from '../context/OrgContext';
import {
  Plus, Mail, MessageSquare, Copy, CheckCircle,
  X, Loader, FileText, AlertCircle, Check, Calendar,
} from 'lucide-react';

const STATUS_CONFIG = {
  pending:  { label: 'Pending',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  sent:     { label: 'Sent',     color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  viewed:   { label: 'Viewed',   color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
  signed:   { label: 'Accepted', color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  declined: { label: 'Declined', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
};

function useWindowWidth() {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const handler = () => setW(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return w;
}

function StatusPill({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
      padding: '0.25rem 0.625rem', borderRadius: '20px',
      background: cfg.bg, color: cfg.color,
      fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
      {cfg.label}
    </span>
  );
}

function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

function ActionBtn({ children, onClick, disabled, title, highlight, highlightColor, color, fullWidth }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: highlight ? `${highlightColor || '#10b981'}18` : 'none',
        border: `1px solid ${highlight ? (highlightColor || '#10b981') : 'var(--border-default)'}`,
        borderRadius: '0.5rem',
        padding: fullWidth ? '0.6rem 0.75rem' : '0.35rem 0.5rem',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: highlight ? (highlightColor || '#10b981') : (color || 'var(--text-secondary)'),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: '0.375rem',
        transition: 'all 0.15s',
        opacity: disabled ? 0.5 : 1,
        flexShrink: fullWidth ? 0 : 1,
        flex: fullWidth ? 1 : undefined,
        fontSize: fullWidth ? '0.8rem' : undefined,
        fontWeight: fullWidth ? 600 : undefined,
      }}
    >
      {children}
    </button>
  );
}

export default function OfferTracker() {
  const { activeOrg } = useOrg();
  const winW = useWindowWidth();
  const isMobile = winW < 768;

  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [sendingMail, setSendingMail] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [mailState, setMailState] = useState({});

  const portalUrl = (docId) =>
    `${window.location.origin}/portal/${docId}?org=${activeOrg?.id || ''}`;

  useEffect(() => {
    if (!activeOrg?.id) return;
    documentStore.setContext(activeOrg.id);
    documentStore.init();

    const path = `records/${activeOrg.id}/_fin_docs`;
    const unsubscribe = onValue(
      dbRef(db, path),
      (snap) => {
        if (snap.exists()) {
          const all = Object.values(snap.val());
          setOffers(
            all
              .filter((d) => d.type === 'offer_letter')
              .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          );
        } else {
          setOffers(
            documentStore.getAll().filter((d) => d.type === 'offer_letter')
          );
        }
        setLoading(false);
      },
      (err) => {
        console.error('[OfferTracker] Firebase listener error:', err);
        setOffers(documentStore.getAll().filter((d) => d.type === 'offer_letter'));
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [activeOrg?.id]);

  const handleCopy = async (docId) => {
    await navigator.clipboard.writeText(portalUrl(docId));
    setCopiedId(docId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSendMail = async (offer) => {
    if (!offer.recipient_email) {
      alert('No email address saved for this candidate.');
      return;
    }
    setSendingMail(offer.id);
    try {
      const result = await emailService.sendPortalLink({
        recipientEmail: offer.recipient_email,
        recipientName: offer.issued_to,
        role: offer.role,
        companyName: offer.company_profile?.company_name || activeOrg?.company_name || 'Company',
        portalUrl: portalUrl(offer.id),
        deadline: offer.valid_until,
        emailConfig: {
          serviceId: activeOrg?.emailjs_service_id,
          templateId: activeOrg?.emailjs_template_id,
          publicKey: activeOrg?.emailjs_public_key,
        },
      });
      setMailState((p) => ({ ...p, [offer.id]: result.success ? 'ok' : 'fail' }));
      setTimeout(
        () => setMailState((p) => { const n = { ...p }; delete n[offer.id]; return n; }),
        3000
      );
    } finally {
      setSendingMail(null);
    }
  };

  const handleWhatsApp = (offer) => {
    const company = offer.company_profile?.company_name || activeOrg?.company_name || 'Company';
    const dl = offer.valid_until ? ` Please respond by *${fmtDate(offer.valid_until)}*.` : '';
    const msg = [
      `Hello *${offer.issued_to}*,`,
      ``,
      `*${company}* has sent you an offer letter for the position of *${offer.role}*.${dl}`,
      ``,
      `Please review and e-sign your offer letter securely via the link below:`,
      portalUrl(offer.id),
      ``,
      `Best regards,`,
      company,
    ].join('\n');
    const phone = (offer.recipient_phone || '').replace(/\D/g, '');
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  };

  const renderActions = (offer, fullWidth = false) => (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      <ActionBtn
        onClick={() => handleCopy(offer.id)}
        title="Copy portal link"
        highlight={copiedId === offer.id}
        highlightColor="#10b981"
        fullWidth={fullWidth}
      >
        {copiedId === offer.id ? <CheckCircle size={14} /> : <Copy size={14} />}
        {fullWidth && <span>{copiedId === offer.id ? 'Copied!' : 'Copy Link'}</span>}
      </ActionBtn>

      <ActionBtn
        onClick={() => handleSendMail(offer)}
        disabled={sendingMail === offer.id}
        title={offer.recipient_email ? `Send email to ${offer.recipient_email}` : 'No email saved'}
        highlight={!!mailState[offer.id]}
        highlightColor={mailState[offer.id] === 'fail' ? '#ef4444' : '#10b981'}
        fullWidth={fullWidth}
      >
        {sendingMail === offer.id
          ? <Loader size={14} className="spin-icon" />
          : mailState[offer.id] === 'ok'
            ? <CheckCircle size={14} />
            : mailState[offer.id] === 'fail'
              ? <AlertCircle size={14} />
              : <Mail size={14} />}
        {fullWidth && <span>
          {sendingMail === offer.id ? 'Sending…' : mailState[offer.id] === 'ok' ? 'Sent!' : mailState[offer.id] === 'fail' ? 'Failed' : 'Email'}
        </span>}
      </ActionBtn>

      <ActionBtn
        onClick={() => handleWhatsApp(offer)}
        title="Send via WhatsApp"
        color="#25d366"
        fullWidth={fullWidth}
      >
        <MessageSquare size={14} />
        {fullWidth && <span>WhatsApp</span>}
      </ActionBtn>
    </div>
  );

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.75rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: isMobile ? '1rem' : '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Offer Letter Tracker
          </h2>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            Real-time status — updates instantly when a candidate signs
          </p>
        </div>
        <button className="btn-cinematic" onClick={() => setShowCreate(true)} style={{ flexShrink: 0 }}>
          <Plus size={15} /> New Offer
        </button>
      </div>

      {/* ── Status summary chips ── */}
      {!loading && offers.length > 0 && (
        <div style={{ display: 'flex', gap: '0.625rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          {Object.entries(
            offers.reduce((acc, o) => {
              const k = o.status || 'pending';
              acc[k] = (acc[k] || 0) + 1;
              return acc;
            }, {})
          ).map(([status, count]) => {
            const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
            return (
              <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', padding: '0.3rem 0.75rem', borderRadius: '20px', background: cfg.bg, color: cfg.color, fontSize: '0.75rem', fontWeight: 600 }}>
                <span style={{ fontWeight: 700 }}>{count}</span> {cfg.label}
              </span>
            );
          })}
        </div>
      )}

      {/* ── Content ── */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem', gap: '0.75rem', color: 'var(--text-secondary)' }}>
          <Loader size={18} className="spin-icon" />
          <span style={{ fontSize: '0.875rem' }}>Loading...</span>
        </div>
      ) : offers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', background: 'var(--surface)', borderRadius: '1rem', border: '2px dashed var(--border-default)' }}>
          <FileText size={40} style={{ color: 'var(--text-secondary)', opacity: 0.3, marginBottom: '1rem' }} />
          <p style={{ color: 'var(--text-primary)', fontWeight: 600, margin: '0 0 0.5rem' }}>No offer letters yet</p>
          <p style={{ color: 'var(--text-secondary)', margin: '0 0 1.5rem', fontSize: '0.8125rem' }}>
            Create an offer and track its acceptance status in real-time.
          </p>
          <button className="btn-cinematic" onClick={() => setShowCreate(true)}>
            <Plus size={15} /> Create First Offer
          </button>
        </div>
      ) : isMobile ? (
        /* ── Mobile: Card Grid ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          {offers.map((offer) => {
            const typeLabel = offer.offer_type === 'fulltime' ? 'Full-Time' : 'Internship';
            const typeColor = offer.offer_type === 'fulltime' ? '#3b82f6' : '#8b5cf6';
            return (
              <div
                key={offer.id}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border-default)',
                  borderRadius: '0.875rem',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.875rem',
                }}
              >
                {/* Card top: name + status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
                      {offer.issued_to || '—'}
                    </div>
                    <div style={{ fontSize: '0.65rem', fontFamily: 'monospace', color: 'var(--text-secondary)', opacity: 0.8 }}>
                      {offer.id}
                    </div>
                    {offer.recipient_email && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {offer.recipient_email}
                      </div>
                    )}
                  </div>
                  <StatusPill status={offer.status} />
                </div>

                {/* Role + type badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {offer.role || '—'}
                  </span>
                  <span style={{
                    fontSize: '0.65rem', fontWeight: 700, padding: '0.15rem 0.5rem',
                    borderRadius: '20px', background: `${typeColor}18`, color: typeColor,
                    whiteSpace: 'nowrap',
                  }}>
                    {typeLabel}
                  </span>
                  {offer.department && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      · {offer.department}
                    </span>
                  )}
                </div>

                {/* Dates row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <div style={{ background: 'var(--background)', borderRadius: '0.5rem', padding: '0.5rem 0.625rem' }}>
                    <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>Issued</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Calendar size={11} style={{ opacity: 0.6 }} />
                      {fmtDate(offer.issue_date)}
                    </div>
                  </div>
                  <div style={{ background: 'var(--background)', borderRadius: '0.5rem', padding: '0.5rem 0.625rem' }}>
                    <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>Deadline</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Calendar size={11} style={{ opacity: 0.6 }} />
                      {fmtDate(offer.valid_until)}
                    </div>
                  </div>
                </div>

                {/* Signed/declined info */}
                {offer.signed_at && (
                  <div style={{ fontSize: '0.75rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <CheckCircle size={13} />
                    Signed on {fmtDate(offer.signed_at)}
                  </div>
                )}
                {offer.decline_reason && (
                  <div style={{ fontSize: '0.75rem', color: '#ef4444', display: 'flex', alignItems: 'flex-start', gap: '0.35rem' }}>
                    <AlertCircle size={13} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                    <span>{offer.decline_reason}</span>
                  </div>
                )}

                {/* Action buttons — full width, touch-friendly */}
                {renderActions(offer, true)}
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Desktop: Table ── */
        <div style={{ background: 'var(--surface)', borderRadius: '1rem', border: '1px solid var(--border-default)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--background)', borderBottom: '1px solid var(--border-default)' }}>
                  {['Candidate', 'Role / Department', 'Issued', 'Deadline', 'Status', 'Actions'].map((h) => (
                    <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {offers.map((offer, i) => (
                  <tr
                    key={offer.id}
                    style={{ borderBottom: i < offers.length - 1 ? '1px solid var(--border-default)' : 'none' }}
                  >
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                        {offer.issued_to || '—'}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontFamily: 'monospace', marginTop: '0.1rem' }}>
                        {offer.id}
                      </div>
                      {offer.recipient_email && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                          {offer.recipient_email}
                        </div>
                      )}
                    </td>

                    <td style={{ padding: '0.875rem 1rem' }}>
                      <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                        {offer.role || '—'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                        {[offer.department, offer.offer_type === 'fulltime' ? 'Full-Time' : 'Internship'].filter(Boolean).join(' · ')}
                      </div>
                    </td>

                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {fmtDate(offer.issue_date)}
                    </td>

                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {fmtDate(offer.valid_until)}
                    </td>

                    <td style={{ padding: '0.875rem 1rem' }}>
                      <StatusPill status={offer.status} />
                      {offer.signed_at && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
                          Signed {fmtDate(offer.signed_at)}
                        </div>
                      )}
                      {offer.decline_reason && (
                        <div style={{ fontSize: '0.68rem', color: '#ef4444', marginTop: '0.3rem', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={offer.decline_reason}>
                          {offer.decline_reason}
                        </div>
                      )}
                    </td>

                    <td style={{ padding: '0.875rem 1rem' }}>
                      {renderActions(offer, false)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Create Offer Modal ── */}
      {showCreate && (
        <CreateOfferModal
          activeOrg={activeOrg}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}

// ── Create Offer Modal ────────────────────────────────────────────────────────

function CreateOfferModal({ activeOrg, onClose }) {
  const winW = useWindowWidth();
  const isMobile = winW < 640;

  const [form, setForm] = useState({
    offerType: 'internship',
    studentName: '',
    email: '',
    phone: '',
    role: '',
    department: '',
    supervisorName: '',
    startDate: '',
    endDate: '',
    acceptanceDeadline: '',
    isPaid: false,
    stipend: '',
    currency: 'INR',
    paymentFrequency: 'Monthly',
    responsibilities: '',
  });
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);

  const onChg = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((p) => ({ ...p, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.studentName.trim() || !form.role.trim()) return;
    setSaving(true);
    try {
      documentStore.setContext(activeOrg?.id);
      await documentStore.init();
      const docId = documentStore.nextId('OL');
      const today = new Date().toISOString().split('T')[0];
      const doc = {
        id: docId,
        type: 'offer_letter',
        status: 'pending',
        issued_to: form.studentName.trim(),
        recipient_email: form.email.trim(),
        recipient_phone: form.phone.trim(),
        role: form.role.trim(),
        department: form.department.trim(),
        offer_type: form.offerType,
        start_date: form.startDate,
        end_date: form.offerType === 'internship' ? form.endDate : '',
        salary: form.isPaid ? form.stipend : null,
        currency: form.currency,
        payment_frequency: form.paymentFrequency,
        is_paid: form.isPaid,
        responsibilities: form.responsibilities.trim(),
        supervisor: form.supervisorName.trim(),
        valid_until: form.acceptanceDeadline,
        issue_date: today,
        created_at: new Date().toISOString(),
        company_profile: {
          company_name: activeOrg?.company_name || '',
          address: activeOrg?.company_address || '',
          email: activeOrg?.company_email || '',
          phone: activeOrg?.company_phone || '',
          logo_url: activeOrg?.logo_url || '',
          signature_url: activeOrg?.signature_url || '',
          company_tagline: activeOrg?.company_tagline || '',
          authorized_person: activeOrg?.owner_full_name || '',
          authorized_designation: activeOrg?.document_designation || '',
        },
      };
      documentStore.save(doc);
      const url = `${window.location.origin}/portal/${docId}?org=${activeOrg?.id || ''}`;
      setCreated({ docId, portalUrl: url });
    } catch (err) {
      alert('Failed to create offer: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(created.portalUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '0.5rem 0.75rem', borderRadius: '0.5rem',
    border: '1px solid var(--border-default)',
    background: 'var(--background)', color: 'var(--text-primary)',
    fontSize: '0.875rem', outline: 'none',
  };
  const labelStyle = { fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem' };
  const sectionLabel = { fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 0.75rem' };
  const grid2 = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '0.75rem' };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? '0' : '1rem' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border-default)',
        borderRadius: isMobile ? '1rem 1rem 0 0' : '1rem',
        width: '100%',
        maxWidth: isMobile ? '100%' : '580px',
        maxHeight: isMobile ? '92vh' : '92vh',
        display: 'flex',
        flexDirection: 'column',
      }}>

        {/* Modal header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.25rem', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {created ? 'Offer Created' : 'New Offer Letter'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '0.25rem', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {created ? (
          /* ── Success state ── */
          <div style={{ padding: '2rem 1.25rem', textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(16,185,129,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
              <Check size={28} color="#10b981" />
            </div>
            <h4 style={{ margin: '0 0 0.375rem', color: 'var(--text-primary)', fontSize: '1.125rem' }}>Offer Created!</h4>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', margin: '0 0 1.5rem', lineHeight: 1.6 }}>
              It will appear in the tracker instantly. Share the portal link below with <strong>{form.studentName}</strong> so they can view and sign it.
            </p>
            <div style={{ background: 'var(--background)', border: '1px solid var(--border-default)', borderRadius: '0.5rem', padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.7rem', color: 'var(--text-primary)', wordBreak: 'break-all', marginBottom: '1.25rem', textAlign: 'left', lineHeight: 1.6 }}>
              {created.portalUrl}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexDirection: isMobile ? 'column' : 'row' }}>
              <button onClick={handleCopy} className="btn-cinematic" style={{ flex: 1 }}>
                {copied ? <><CheckCircle size={14} /> Copied!</> : <><Copy size={14} /> Copy Portal Link</>}
              </button>
              <button onClick={onClose} className="btn-cinematic btn-secondary" style={{ flex: 1 }}>
                Done
              </button>
            </div>
          </div>
        ) : (
          /* ── Form ── */
          <form onSubmit={handleCreate} style={{ overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* Offer type toggle */}
            <div className="easy-toggle-bar" style={{ margin: 0 }}>
              {['internship', 'fulltime'].map((type) => (
                <button
                  key={type} type="button"
                  onClick={() => setForm((p) => ({ ...p, offerType: type }))}
                  className={`easy-toggle-btn ${form.offerType === type ? 'active' : ''}`}
                >
                  {type === 'internship' ? 'Internship' : 'Full-Time'}
                </button>
              ))}
            </div>

            {/* Candidate */}
            <div>
              <p style={sectionLabel}>Candidate Details</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div>
                  <label style={labelStyle}>Full name *</label>
                  <input name="studentName" value={form.studentName} onChange={onChg} required placeholder="e.g. Jane Doe" style={inputStyle} />
                </div>
                <div style={grid2}>
                  <div>
                    <label style={labelStyle}>Email</label>
                    <input type="email" name="email" value={form.email} onChange={onChg} placeholder="jane@example.com" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>WhatsApp phone</label>
                    <input name="phone" value={form.phone} onChange={onChg} placeholder="+91 9876543210" style={inputStyle} />
                  </div>
                </div>
              </div>
            </div>

            {/* Role & Timeline */}
            <div>
              <p style={sectionLabel}>Role & Timeline</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={grid2}>
                  <div>
                    <label style={labelStyle}>Job title / role *</label>
                    <input name="role" value={form.role} onChange={onChg} required placeholder="e.g. Software Engineer" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Department</label>
                    <input name="department" value={form.department} onChange={onChg} placeholder="e.g. Engineering" style={inputStyle} />
                  </div>
                </div>
                <div style={grid2}>
                  <div>
                    <label style={labelStyle}>Start date</label>
                    <input type="date" name="startDate" value={form.startDate} onChange={onChg} style={inputStyle} />
                  </div>
                  {form.offerType === 'internship' ? (
                    <div>
                      <label style={labelStyle}>End date</label>
                      <input type="date" name="endDate" value={form.endDate} onChange={onChg} style={inputStyle} />
                    </div>
                  ) : (
                    <div>
                      <label style={labelStyle}>Reporting supervisor</label>
                      <input name="supervisorName" value={form.supervisorName} onChange={onChg} placeholder="e.g. John Smith" style={inputStyle} />
                    </div>
                  )}
                </div>
                <div>
                  <label style={labelStyle}>Response deadline</label>
                  <input type="date" name="acceptanceDeadline" value={form.acceptanceDeadline} onChange={onChg} style={inputStyle} />
                </div>
              </div>
            </div>

            {/* Compensation */}
            <div>
              <div
                className={`easy-switch-row ${form.isPaid ? 'active' : ''}`}
                onClick={() => setForm((p) => ({ ...p, isPaid: !p.isPaid }))}
                style={{ marginBottom: form.isPaid ? '0.75rem' : 0 }}
              >
                <span className="easy-switch-label">
                  {form.offerType === 'internship' ? 'Paid internship' : 'Paid position'}
                </span>
                <div className="easy-switch-dot" />
              </div>
              {form.isPaid && (
                <div style={grid2}>
                  <div>
                    <label style={labelStyle}>Amount</label>
                    <input type="number" name="stipend" value={form.stipend} onChange={onChg} placeholder="0" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Currency / Frequency</label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <select name="currency" value={form.currency} onChange={onChg} style={{ ...inputStyle, flex: 1 }}>
                        <option value="INR">INR</option>
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                      </select>
                      <select name="paymentFrequency" value={form.paymentFrequency} onChange={onChg} style={{ ...inputStyle, flex: 1.5 }}>
                        <option value="Monthly">Monthly</option>
                        <option value="Once">One-time</option>
                        {form.offerType === 'fulltime' && <option value="Annual">Annual (CTC)</option>}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Submit */}
            <button type="submit" className="easy-submit" disabled={saving} style={{ margin: 0 }}>
              {saving
                ? <><Loader size={16} className="spin-icon" /> Creating...</>
                : <><Plus size={16} /> Create Offer & Add to Tracker</>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
