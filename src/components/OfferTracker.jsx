import { useState, useEffect, useMemo } from 'react';
import { onValue, ref as dbRef } from 'firebase/database';
import { db } from '../lib/firebase';
import { documentStore } from '../services/documentStore';
import { emailService } from '../services/emailService';
import { useOrg } from '../context/OrgContext';
import {
  Plus, Mail, MessageSquare, Copy, CheckCircle,
  X, Loader, FileText, AlertCircle, Check, Calendar,
  TrendingUp, ArrowRight, Trash2, AlertTriangle,
} from 'lucide-react';

const STATUS_CONFIG = {
  pending:      { label: 'Pending',      color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  sent:         { label: 'Sent',         color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  viewed:       { label: 'Viewed',       color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
  signed:       { label: 'Accepted',     color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  acknowledged: { label: 'Acknowledged', color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  declined:     { label: 'Declined',     color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
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

  const [activeTab, setActiveTab] = useState('offers');
  const [allDocs, setAllDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [sendingMail, setSendingMail] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [mailState, setMailState] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('date_desc');

  const offers = useMemo(
    () => allDocs.filter((d) => d.type === 'offer_letter'),
    [allDocs]
  );
  const roleChanges = useMemo(
    () => allDocs.filter((d) => d.type === 'role_change'),
    [allDocs]
  );
  const terminations = useMemo(
    () => allDocs.filter((d) => d.type === 'termination'),
    [allDocs]
  );

  const activeList = useMemo(() => {
    let list = activeTab === 'offers' ? offers : activeTab === 'role_changes' ? roleChanges : terminations;
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      list = list.filter((d) =>
        (d.issued_to || '').toLowerCase().includes(t) ||
        (d.recipient_email || '').toLowerCase().includes(t) ||
        (d.role || d.new_role || d.current_role || '').toLowerCase().includes(t) ||
        (d.id || '').toLowerCase().includes(t)
      );
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'date_desc') return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      if (sortBy === 'date_asc')  return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      if (sortBy === 'name_asc')  return (a.issued_to || '').localeCompare(b.issued_to || '');
      if (sortBy === 'name_desc') return (b.issued_to || '').localeCompare(a.issued_to || '');
      if (sortBy === 'status')    return (a.status || '').localeCompare(b.status || '');
      return 0;
    });
  }, [activeTab, offers, roleChanges, terminations, searchTerm, sortBy]);

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
          setAllDocs(all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
        } else {
          setAllDocs(
            documentStore.getAll().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          );
        }
        setLoading(false);
      },
      (err) => {
        console.error('[OfferTracker] Firebase listener error:', err);
        setAllDocs(documentStore.getAll().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
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

  const handleSendMail = async (doc) => {
    if (!doc.recipient_email) {
      alert('No email address saved for this recipient.');
      return;
    }
    setSendingMail(doc.id);
    try {
      const result = await emailService.sendPortalLink({
        recipientEmail: doc.recipient_email,
        recipientName: doc.issued_to,
        role: doc.new_role || doc.role,
        companyName: doc.company_profile?.company_name || activeOrg?.company_name || 'Company',
        portalUrl: portalUrl(doc.id),
        deadline: doc.valid_until || doc.effective_date,
        emailConfig: {
          serviceId: activeOrg?.emailjs_service_id,
          templateId: activeOrg?.emailjs_template_id,
          publicKey: activeOrg?.emailjs_public_key,
        },
      });
      setMailState((p) => ({ ...p, [doc.id]: result.success ? 'ok' : 'fail' }));
      setTimeout(
        () => setMailState((p) => { const n = { ...p }; delete n[doc.id]; return n; }),
        3000
      );
    } finally {
      setSendingMail(null);
    }
  };

  const handleWhatsApp = (doc) => {
    const company = doc.company_profile?.company_name || activeOrg?.company_name || 'Company';
    let msg;
    if (doc.type === 'role_change') {
      msg = [
        `Hello *${doc.issued_to}*,`,
        ``,
        `*${company}* has issued a Role Change Notice for you.`,
        `Your role will be updated from *${doc.current_role || '—'}* to *${doc.new_role || '—'}*.`,
        doc.effective_date ? `Effective date: *${fmtDate(doc.effective_date)}*` : '',
        ``,
        `Please review and acknowledge your role change notice via the link below:`,
        portalUrl(doc.id),
        ``,
        `Best regards,`,
        company,
      ].filter((l) => l !== '').join('\n');
    } else if (doc.type === 'termination') {
      msg = [
        `Hello *${doc.issued_to}*,`,
        ``,
        `*${company}* has issued a Termination Notice for you.`,
        doc.last_day ? `Your last working day is *${fmtDate(doc.last_day)}*.` : '',
        ``,
        `Please review and acknowledge the notice via the link below:`,
        portalUrl(doc.id),
        ``,
        `Best regards,`,
        company,
      ].filter((l) => l !== '').join('\n');
    } else {
      const dl = doc.valid_until ? ` Please respond by *${fmtDate(doc.valid_until)}*.` : '';
      msg = [
        `Hello *${doc.issued_to}*,`,
        ``,
        `*${company}* has sent you an offer letter for the position of *${doc.role}*.${dl}`,
        ``,
        `Please review and e-sign your offer letter securely via the link below:`,
        portalUrl(doc.id),
        ``,
        `Best regards,`,
        company,
      ].join('\n');
    }
    const phone = (doc.recipient_phone || '').replace(/\D/g, '');
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  };

  const handleDelete = (doc) => {
    documentStore.setContext(activeOrg?.id);
    documentStore.delete(doc.id);
    setDeleteConfirm(null);
  };

  const renderActions = (doc, fullWidth = false) => (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      <ActionBtn
        onClick={() => handleCopy(doc.id)}
        title="Copy portal link"
        highlight={copiedId === doc.id}
        highlightColor="#10b981"
        fullWidth={fullWidth}
      >
        {copiedId === doc.id ? <CheckCircle size={14} /> : <Copy size={14} />}
        {fullWidth && <span>{copiedId === doc.id ? 'Copied!' : 'Copy Link'}</span>}
      </ActionBtn>

      <ActionBtn
        onClick={() => handleSendMail(doc)}
        disabled={sendingMail === doc.id}
        title={doc.recipient_email ? `Send email to ${doc.recipient_email}` : 'No email saved'}
        highlight={!!mailState[doc.id]}
        highlightColor={mailState[doc.id] === 'fail' ? '#ef4444' : '#10b981'}
        fullWidth={fullWidth}
      >
        {sendingMail === doc.id
          ? <Loader size={14} className="spin-icon" />
          : mailState[doc.id] === 'ok'
            ? <CheckCircle size={14} />
            : mailState[doc.id] === 'fail'
              ? <AlertCircle size={14} />
              : <Mail size={14} />}
        {fullWidth && <span>
          {sendingMail === doc.id ? 'Sending…' : mailState[doc.id] === 'ok' ? 'Sent!' : mailState[doc.id] === 'fail' ? 'Failed' : 'Email'}
        </span>}
      </ActionBtn>

      <ActionBtn
        onClick={() => handleWhatsApp(doc)}
        title="Send via WhatsApp"
        color="#25d366"
        fullWidth={fullWidth}
      >
        <MessageSquare size={14} />
        {fullWidth && <span>WhatsApp</span>}
      </ActionBtn>

      <ActionBtn
        onClick={() => setDeleteConfirm(doc)}
        title="Delete"
        highlight={false}
        color="#ef4444"
        fullWidth={fullWidth}
      >
        <Trash2 size={14} />
        {fullWidth && <span>Delete</span>}
      </ActionBtn>
    </div>
  );

  // ── Role Change: Mobile Card ──────────────────────────────────────────────
  const renderRCCard = (doc) => (
    <div
      key={doc.id}
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
            {doc.issued_to || '—'}
          </div>
          <div style={{ fontSize: '0.65rem', fontFamily: 'monospace', color: 'var(--text-secondary)', opacity: 0.8 }}>
            {doc.id}
          </div>
          {doc.recipient_email && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {doc.recipient_email}
            </div>
          )}
        </div>
        <StatusPill status={doc.status} />
      </div>

      {/* Role change arrow */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{doc.current_role || '—'}</span>
        <ArrowRight size={13} style={{ color: '#6366f1', flexShrink: 0 }} />
        <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#a5b4fc' }}>{doc.new_role || '—'}</span>
        {doc.new_department && doc.new_department !== doc.current_department && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>· {doc.new_department}</span>
        )}
      </div>

      {/* Dates */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <div style={{ background: 'var(--background)', borderRadius: '0.5rem', padding: '0.5rem 0.625rem' }}>
          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>Issued</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Calendar size={11} style={{ opacity: 0.6 }} />
            {fmtDate(doc.created_at)}
          </div>
        </div>
        <div style={{ background: 'var(--background)', borderRadius: '0.5rem', padding: '0.5rem 0.625rem' }}>
          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>Effective</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Calendar size={11} style={{ opacity: 0.6 }} />
            {fmtDate(doc.effective_date)}
          </div>
        </div>
      </div>

      {doc.new_salary && (
        <div style={{ fontSize: '0.75rem', color: '#a5b4fc', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <TrendingUp size={13} />
          New salary: {doc.new_salary.toLocaleString()} / {doc.salary_frequency || 'month'}
        </div>
      )}

      {doc.acknowledged_at && (
        <div style={{ fontSize: '0.75rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <CheckCircle size={13} />
          Acknowledged on {fmtDate(doc.acknowledged_at)}
        </div>
      )}

      {renderActions(doc, false)}
    </div>
  );

  // ── Termination: Mobile Card ──────────────────────────────────────────────
  const renderTermCard = (doc) => (
    <div
      key={doc.id}
      style={{
        background: 'var(--surface)',
        border: '1px solid rgba(239,68,68,0.2)',
        borderRadius: '0.875rem',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.875rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
            {doc.issued_to || '—'}
          </div>
          <div style={{ fontSize: '0.65rem', fontFamily: 'monospace', color: 'var(--text-secondary)', opacity: 0.8 }}>
            {doc.id}
          </div>
          {doc.recipient_email && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {doc.recipient_email}
            </div>
          )}
        </div>
        <StatusPill status={doc.status} />
      </div>

      {doc.current_role && (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Role: </span>
          {doc.current_role}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <div style={{ background: 'var(--background)', borderRadius: '0.5rem', padding: '0.5rem 0.625rem' }}>
          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>Issued</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Calendar size={11} style={{ opacity: 0.6 }} />
            {fmtDate(doc.created_at)}
          </div>
        </div>
        <div style={{ background: 'rgba(239,68,68,0.06)', borderRadius: '0.5rem', padding: '0.5rem 0.625rem', border: '1px solid rgba(239,68,68,0.15)' }}>
          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>Last Day</div>
          <div style={{ fontSize: '0.78rem', color: '#f87171', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Calendar size={11} style={{ opacity: 0.8 }} />
            {fmtDate(doc.last_day)}
          </div>
        </div>
      </div>

      {doc.acknowledged_at && (
        <div style={{ fontSize: '0.75rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <CheckCircle size={13} />
          Acknowledged on {fmtDate(doc.acknowledged_at)}
        </div>
      )}

      {renderActions(doc, false)}
    </div>
  );

  // ── Offer: Mobile Card (existing) ──────────────────────────────────────────
  const renderOfferCard = (offer) => {
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

        {renderActions(offer, false)}
      </div>
    );
  };

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: isMobile ? '1rem' : '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {activeTab === 'offers' ? 'Offer Letter Tracker' : activeTab === 'role_changes' ? 'Role Change Tracker' : 'Termination Tracker'}
          </h2>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            {activeTab === 'offers'
              ? 'Real-time status — updates instantly when a candidate signs'
              : activeTab === 'role_changes'
              ? 'Track role change notices — updates when the employee acknowledges'
              : 'Track termination notices — auto-archives employee after last working day'}
          </p>
        </div>
        {activeTab === 'offers' && (
          <button className="btn-cinematic" onClick={() => setShowCreate(true)} style={{ flexShrink: 0 }}>
            <Plus size={15} /> New Offer
          </button>
        )}
      </div>

      {/* ── Tab Toggle ── */}
      <div style={{ display: 'flex', gap: '0.375rem', marginBottom: '1.5rem', background: 'var(--surface)', border: '1px solid var(--border-default)', borderRadius: '0.75rem', padding: '0.25rem', width: 'fit-content', flexWrap: 'wrap' }}>
        {[
          { id: 'offers', label: 'Offer Letters', count: offers.length, color: null },
          { id: 'role_changes', label: 'Role Changes', count: roleChanges.length, color: '#6366f1' },
          { id: 'terminations', label: 'Terminations', count: terminations.length, color: '#ef4444' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: activeTab === tab.id ? (tab.color ? `${tab.color}22` : 'var(--background)') : 'none',
              border: activeTab === tab.id ? `1px solid ${tab.color ? `${tab.color}55` : 'var(--border-default)'}` : '1px solid transparent',
              borderRadius: '0.5rem',
              padding: '0.4rem 0.875rem',
              cursor: 'pointer',
              color: activeTab === tab.id ? (tab.color ? (tab.id === 'terminations' ? '#f87171' : '#a5b4fc') : 'var(--text-primary)') : 'var(--text-secondary)',
              fontSize: '0.8125rem',
              fontWeight: activeTab === tab.id ? 700 : 500,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.id === 'role_changes' ? <TrendingUp size={13} /> : tab.id === 'terminations' ? <AlertTriangle size={13} /> : <FileText size={13} />}
            {tab.label}
            {tab.count > 0 && (
              <span style={{
                minWidth: 18, height: 18, borderRadius: '999px',
                background: activeTab === tab.id ? (tab.color ? `${tab.color}33` : 'rgba(255,255,255,0.08)') : 'rgba(255,255,255,0.06)',
                color: activeTab === tab.id ? (tab.color ? (tab.id === 'terminations' ? '#f87171' : '#a5b4fc') : 'var(--text-primary)') : 'var(--text-secondary)',
                fontSize: '0.65rem', fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 4px',
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Search + Sort ── */}
      <div style={{ display: 'flex', gap: '0.625rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
          <FileText size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', pointerEvents: 'none' }} />
          <input
            type="text"
            placeholder={activeTab === 'offers' ? 'Search by name, email, role...' : 'Search by name, role, email...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              paddingLeft: '2rem', height: '36px',
              borderRadius: '0.5rem',
              border: '1px solid var(--border-default)',
              background: 'var(--background)',
              color: 'var(--text-primary)',
              fontSize: '0.8125rem', outline: 'none',
            }}
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          style={{
            height: '36px', padding: '0 0.625rem',
            borderRadius: '0.5rem',
            border: '1px solid var(--border-default)',
            background: 'var(--background)',
            color: 'var(--text-secondary)',
            fontSize: '0.8rem', cursor: 'pointer', outline: 'none', flexShrink: 0,
          }}
        >
          <option value="date_desc">Newest first</option>
          <option value="date_asc">Oldest first</option>
          <option value="name_asc">Name A–Z</option>
          <option value="name_desc">Name Z–A</option>
          <option value="status">By status</option>
        </select>
      </div>

      {/* ── Status summary chips ── */}
      {!loading && activeList.length > 0 && (
        <div style={{ display: 'flex', gap: '0.625rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          {Object.entries(
            activeList.reduce((acc, o) => {
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
      ) : activeList.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', background: 'var(--surface)', borderRadius: '1rem', border: `2px dashed ${activeTab === 'terminations' ? 'rgba(239,68,68,0.2)' : 'var(--border-default)'}` }}>
          {activeTab === 'role_changes' ? <TrendingUp size={40} style={{ color: '#6366f1', opacity: 0.3, marginBottom: '1rem' }} /> : activeTab === 'terminations' ? <AlertTriangle size={40} style={{ color: '#ef4444', opacity: 0.3, marginBottom: '1rem' }} /> : <FileText size={40} style={{ color: 'var(--text-secondary)', opacity: 0.3, marginBottom: '1rem' }} />}
          <p style={{ color: 'var(--text-primary)', fontWeight: 600, margin: '0 0 0.5rem' }}>
            {activeTab === 'role_changes' ? 'No role change notices yet' : activeTab === 'terminations' ? 'No termination notices yet' : 'No offer letters yet'}
          </p>
          <p style={{ color: 'var(--text-secondary)', margin: '0 0 1.5rem', fontSize: '0.8125rem' }}>
            {activeTab === 'role_changes'
              ? 'Issue a role change from the Employee Registry and it will appear here.'
              : activeTab === 'terminations'
              ? 'Issue a termination notice from the Employee Registry and it will appear here.'
              : 'Create an offer and track its acceptance status in real-time.'}
          </p>
          {activeTab === 'offers' && (
            <button className="btn-cinematic" onClick={() => setShowCreate(true)}>
              <Plus size={15} /> Create First Offer
            </button>
          )}
        </div>
      ) : isMobile ? (
        /* ── Mobile: Card Grid ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          {activeList.map((doc) =>
            activeTab === 'role_changes' ? renderRCCard(doc) : activeTab === 'terminations' ? renderTermCard(doc) : renderOfferCard(doc)
          )}
        </div>
      ) : activeTab === 'role_changes' ? (
        /* ── Desktop: Role Change Table ── */
        <div style={{ background: 'var(--surface)', borderRadius: '1rem', border: '1px solid var(--border-default)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--background)', borderBottom: '1px solid var(--border-default)' }}>
                  {['Employee', 'Role Change', 'Department', 'Salary', 'Effective Date', 'Status', 'Actions'].map((h) => (
                    <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roleChanges.map((doc, i) => (
                  <tr
                    key={doc.id}
                    style={{ borderBottom: i < roleChanges.length - 1 ? '1px solid var(--border-default)' : 'none' }}
                  >
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                        {doc.issued_to || '—'}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontFamily: 'monospace', marginTop: '0.1rem' }}>
                        {doc.id}
                      </div>
                      {doc.recipient_email && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                          {doc.recipient_email}
                        </div>
                      )}
                    </td>

                    <td style={{ padding: '0.875rem 1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{doc.current_role || '—'}</span>
                        <ArrowRight size={12} style={{ color: '#6366f1', flexShrink: 0 }} />
                        <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#a5b4fc' }}>{doc.new_role || '—'}</span>
                      </div>
                    </td>

                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {doc.new_department && doc.new_department !== doc.current_department ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{doc.current_department || '—'}</span>
                          <ArrowRight size={11} style={{ color: '#6366f1', flexShrink: 0 }} />
                          <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.8rem' }}>{doc.new_department}</span>
                        </div>
                      ) : (
                        <span>{doc.current_department || '—'}</span>
                      )}
                    </td>

                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {doc.new_salary
                        ? <span style={{ color: '#a5b4fc', fontWeight: 600 }}>{Number(doc.new_salary).toLocaleString()} <span style={{ fontWeight: 400, fontSize: '0.7rem' }}>/ {doc.salary_frequency || 'month'}</span></span>
                        : '—'}
                    </td>

                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {fmtDate(doc.effective_date)}
                    </td>

                    <td style={{ padding: '0.875rem 1rem' }}>
                      <StatusPill status={doc.status} />
                      {doc.acknowledged_at && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
                          Acknowledged {fmtDate(doc.acknowledged_at)}
                        </div>
                      )}
                    </td>

                    <td style={{ padding: '0.875rem 1rem' }}>
                      {renderActions(doc, false)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === 'terminations' ? (
        /* ── Desktop: Termination Table ── */
        <div style={{ background: 'var(--surface)', borderRadius: '1rem', border: '1px solid rgba(239,68,68,0.2)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--background)', borderBottom: '1px solid var(--border-default)' }}>
                  {['Employee', 'Role', 'Last Working Day', 'Issued Date', 'Status', 'Actions'].map((h) => (
                    <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {terminations.map((doc, i) => (
                  <tr
                    key={doc.id}
                    style={{ borderBottom: i < terminations.length - 1 ? '1px solid var(--border-default)' : 'none' }}
                  >
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                        {doc.issued_to || '—'}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontFamily: 'monospace', marginTop: '0.1rem' }}>
                        {doc.id}
                      </div>
                      {doc.recipient_email && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                          {doc.recipient_email}
                        </div>
                      )}
                    </td>

                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {doc.current_role || '—'}
                      {doc.current_department && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>{doc.current_department}</div>
                      )}
                    </td>

                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      <span style={{ color: '#f87171', fontWeight: 600 }}>{fmtDate(doc.last_day)}</span>
                    </td>

                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {fmtDate(doc.created_at)}
                    </td>

                    <td style={{ padding: '0.875rem 1rem' }}>
                      <StatusPill status={doc.status} />
                      {doc.acknowledged_at && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
                          Acknowledged {fmtDate(doc.acknowledged_at)}
                        </div>
                      )}
                    </td>

                    <td style={{ padding: '0.875rem 1rem' }}>
                      {renderActions(doc, false)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ── Desktop: Offer Letter Table ── */
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

      {/* ── Delete Confirmation Modal ── */}
      {deleteConfirm && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '1rem',
              padding: '2rem',
              maxWidth: 420,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1rem',
              textAlign: 'center',
            }}
          >
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(239,68,68,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertTriangle size={24} color="#ef4444" />
            </div>
            <div>
              <h3 style={{ margin: '0 0 0.375rem', fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Delete {deleteConfirm.type === 'role_change' ? 'Role Change Notice' : 'Offer Letter'}?
              </h3>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                This will permanently delete{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{deleteConfirm.id}</strong> for{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{deleteConfirm.issued_to}</strong>.
                The portal link will stop working and this cannot be undone.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', width: '100%' }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                style={{
                  flex: 1, padding: '0.6rem 1rem', borderRadius: '0.5rem',
                  background: 'none', border: '1px solid var(--border-default)',
                  color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                style={{
                  flex: 1, padding: '0.6rem 1rem', borderRadius: '0.5rem',
                  background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)',
                  color: '#ef4444', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                }}
              >
                <Trash2 size={15} /> Delete
              </button>
            </div>
          </div>
        </div>
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
