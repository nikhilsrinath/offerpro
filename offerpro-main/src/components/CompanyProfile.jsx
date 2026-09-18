import { useState, useEffect, useCallback, useMemo, useRef, useContext } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Upload, Check, Loader, AlertCircle, Pencil, Zap, XCircle, Download, KeyRound,
  Eye, EyeOff, ArrowRight, ExternalLink, Trash2, ChevronDown, Building2,
} from 'lucide-react';
import { useOrg } from '../context/OrgContext';
import { useAuth } from '../context/AuthContext';
import { emailService } from '../services/emailService';
import { uploadOrgImage } from '../services/imageUploadService';
import { getPlanConfig, DEFAULT_PLAN } from '../services/planConfig';
import { supabase } from '../lib/supabase';
import { Page, Btn, Seg, Bar, Loading, Empty } from './ui/edge';
import { useT, MONO } from './ui/edgeUtils';

import StampPreview from './StampPreview';
import RolePermissions from './settings/RolePermissions';
import PortalJoinCode from './settings/PortalJoinCode';
import ImageEditor from './ImageEditor';
import { RailSlotContext } from './shell/railSlot';

/* ══════════════════════════════════════════════════════════════════════════
   Company profile, in the hub's terminal theme.

   Laid out as a short checklist rather than one long form: each section says
   whether it is done, the rail jumps to whatever is still missing, and a live
   letterhead shows exactly where each value lands on an issued document. Edits
   collect in one place and are saved from a bar that only appears once there is
   something to save.
   ══════════════════════════════════════════════════════════════════════════ */

const EMPTY_FORM = {
  company_name: '', company_tagline: '', company_address: '',
  owner_full_name: '', document_designation: '',
  company_email: '', company_phone: '', company_website: '',
  gstin: '', cin: '',
  upi_id: '', bank_name: '', bank_account_number: '', bank_ifsc: '', bank_account_type: 'Current',
  logo_url: '', logo_path: '', signature_url: '', signature_path: '',
  stamp_type: 'generated', stamp_url: '', stamp_path: '', stamp_city: '',
  emailjs_service_id: '', emailjs_template_id: '', emailjs_public_key: '',
  gmail_user: '', gmail_app_password: '',
  plan: 'free',
};

const formFromOrg = (org) => Object.fromEntries(
  Object.entries(EMPTY_FORM).map(([k, def]) => [k, org?.[k] || def]),
);

// Soft checks. They explain a likely typo next to the field but never block a
// save — a legitimately unusual value should not lock someone out.
const CHECKS = {
  company_email: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'This does not look like an email address.'],
  gmail_user: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'This does not look like an email address.'],
  company_phone: [/^\+?[\d\s()-]{7,20}$/, 'Use digits, spaces and an optional leading +.'],
  company_website: [/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i, 'Enter a web address like company.com.'],
  gstin: [/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'A GSTIN is 15 characters, e.g. 22AAAAA0000A1Z5.'],
  cin: [/^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/, 'A CIN is 21 characters, e.g. U12345MH2020PTC123456.'],
  upi_id: [/^[\w.-]{2,}@[a-z][\w]{1,}$/i, 'A UPI ID looks like name@bank.'],
  bank_ifsc: [/^[A-Z]{4}0[A-Z0-9]{6}$/, 'An IFSC is 11 characters, e.g. HDFC0001234.'],
  bank_account_number: [/^\d{6,18}$/, 'Account numbers are 6–18 digits.'],
};
const UPPER = new Set(['gstin', 'cin', 'bank_ifsc']);

const warningFor = (name, value) => {
  const rule = CHECKS[name];
  if (!rule || !value) return '';
  return rule[0].test(String(value).trim()) ? '' : rule[1];
};

const PLAN_ROWS = [
  ['offerLetters', 'Offer letters'], ['mou', 'MoU / NDA'], ['invoices', 'Invoices'],
  ['quotations', 'Quotations'], ['aiMessages', 'AI messages'],
];

function useWindowWidth() {
  const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1440));
  useEffect(() => {
    const fn = () => setW(window.innerWidth);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);
  return w;
}

export default function CompanyProfile() {
  const t = useT();
  const navigate = useNavigate();
  const winW = useWindowWidth();
  const railSlot = useContext(RailSlotContext);
  const { activeOrg, updateOrganization, loading: orgLoading, fetchOrganizations } = useOrg();
  const { updatePassword, reauthenticate } = useAuth();

  const [form, setForm] = useState(EMPTY_FORM);
  const [baseline, setBaseline] = useState(EMPTY_FORM);
  const [touched, setTouched] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState({});
  const [editorImage, setEditorImage] = useState(null);
  const [editorField, setEditorField] = useState('');
  const [testingEmail, setTestingEmail] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showAppPassword, setShowAppPassword] = useState(false);
  // org_secrets cannot be read by any client role, so the App Password box is
  // always blank on load and `activeOrg` carries neither field. Without asking
  // the server, the screen looks unconfigured even when email works.
  const [emailStatus, setEmailStatus] = useState({ loading: true, configured: false, gmail_user: '', rotated_at: null });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [pw, setPw] = useState({ open: false, current: '', next: '', confirm: '', error: '', success: '', busy: false });
  const [activeSection, setActiveSection] = useState('company');

  const dirty = useMemo(
    () => Object.keys(EMPTY_FORM).some((k) => (form[k] || '') !== (baseline[k] || '')),
    [form, baseline],
  );
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Reload from the org when switching org, or when nothing local would be
  // lost. A background refresh must not wipe what someone is halfway through.
  const loadedOrgId = useRef(null);
  useEffect(() => {
    if (!activeOrg) return;
    if (loadedOrgId.current === activeOrg.id && dirtyRef.current) return;
    loadedOrgId.current = activeOrg.id;
    const next = formFromOrg(activeOrg);
    setForm((prev) => ({ ...next, gmail_user: next.gmail_user || prev.gmail_user }));
    setBaseline((prev) => ({ ...next, gmail_user: next.gmail_user || prev.gmail_user }));
  }, [activeOrg]);

  // Ask the server what email settings exist. The GET reports the address and
  // whether a password is on file; it never returns the password itself.
  const refreshEmailStatus = useCallback(async () => {
    if (!activeOrg?.id) return;
    const off = { loading: false, configured: false, gmail_user: '', rotated_at: null };
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/org-secrets?org_id=${encodeURIComponent(activeOrg.id)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json().catch(() => ({}));
      // A plain member gets a 403. Not an error worth showing — the email
      // fields are admin-only anyway.
      if (!res.ok || !data.success) { setEmailStatus(off); return; }
      setEmailStatus({
        loading: false,
        configured: Boolean(data.configured),
        gmail_user: data.gmail_user || '',
        rotated_at: data.rotated_at || null,
      });
      // Show the stored address rather than an empty box, and treat it as the
      // saved value so it does not count as an unsaved edit.
      const stored = data.gmail_user || '';
      setForm((prev) => (prev.gmail_user ? prev : { ...prev, gmail_user: stored }));
      setBaseline((prev) => (prev.gmail_user ? prev : { ...prev, gmail_user: stored }));
    } catch {
      setEmailStatus(off);
    }
  }, [activeOrg?.id]);

  useEffect(() => { refreshEmailStatus(); }, [refreshEmailStatus]);

  const setField = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: UPPER.has(name) ? value.toUpperCase() : value }));
    setSaved(false);
  };
  const bind = (name) => ({
    id: `cp-${name}`,
    name,
    value: form[name],
    onChange: (e) => setField(name, e.target.value),
    onBlur: () => setTouched((p) => ({ ...p, [name]: true })),
  });
  const warn = (name) => (touched[name] ? warningFor(name, form[name]) : '');

  /* ── progress ──────────────────────────────────────────────────────────── */

  const steps = useMemo(() => [
    { id: 'company', label: 'Company basics', done: !!(form.company_name && form.company_address), todo: 'Add your registered address' },
    { id: 'contact', label: 'Contact & tax', done: !!(form.company_email && form.company_phone), todo: 'Add a contact email and phone' },
    { id: 'signatory', label: 'Signatory', done: !!(form.owner_full_name && form.document_designation), todo: 'Name who signs your documents' },
    { id: 'branding', label: 'Logo & signature', done: !!(form.logo_url && form.signature_url), todo: form.logo_url ? 'Upload a signature' : 'Upload your logo' },
    { id: 'stamp', label: 'Company stamp', done: form.stamp_type === 'generated' ? !!form.stamp_city : !!form.stamp_url, todo: 'Finish your company stamp' },
    { id: 'banking', label: 'Payments', done: !!(form.upi_id || (form.bank_name && form.bank_account_number && form.bank_ifsc)), todo: 'Add UPI or bank details' },
    { id: 'email', label: 'Email sending', done: emailStatus.configured, todo: 'Connect Gmail to send documents' },
  ], [form, emailStatus.configured]);
  const extras = [
    { id: 'access', label: 'Team access' },
    { id: 'plan', label: 'Plan' },
    { id: 'account', label: 'Account & data' },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const nextStep = steps.find((s) => !s.done);

  const jumpTo = (id, focusField) => {
    const el = document.getElementById(`cp-sec-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const target = focusField
      ? document.getElementById(`cp-${focusField}`)
      : el.querySelector('input:not([type=hidden]):not([type=file]), textarea, button.cp-drop');
    if (target) setTimeout(() => target.focus({ preventScroll: true }), 350);
  };

  // Arriving from the hub's "Finish your profile" dot, which links to
  // /profile#<section>. The scroll waits a frame for the sections to exist.
  const { hash } = useLocation();
  useEffect(() => {
    const id = (hash || '').replace('#', '');
    if (!id || !activeOrg) return undefined;
    const timer = setTimeout(() => jumpTo(id), 80);
    return () => clearTimeout(timer);
  }, [hash, activeOrg]);

  // Highlight the section in view. The observer clips against the shell's own
  // scroll area, so the default viewport root is correct here.
  useEffect(() => {
    if (!activeOrg || typeof IntersectionObserver === 'undefined') return undefined;
    const obs = new IntersectionObserver((entries) => {
      const hit = entries.filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (hit) setActiveSection(hit.target.id.replace('cp-sec-', ''));
    }, { rootMargin: '-15% 0px -70% 0px' });
    document.querySelectorAll('[id^="cp-sec-"]').forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [activeOrg]);

  /* ── saving ────────────────────────────────────────────────────────────── */

  const handleSave = async () => {
    if (!activeOrg || saving) return;
    if (!form.company_name.trim()) { setError('Company name is required.'); jumpTo('company', 'company_name'); return; }
    if (!form.owner_full_name.trim()) { setError('The signatory’s full name is required.'); jumpTo('signatory', 'owner_full_name'); return; }
    setSaving(true);
    setError('');
    try {
      await updateOrganization(activeOrg.id, form);
      const sentPassword = Boolean(form.gmail_app_password);
      // The password is now in org_secrets and can never be read back, so the
      // box is cleared rather than left implying it is still held here.
      const next = { ...form, gmail_app_password: '' };
      setForm(next);
      setBaseline(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      if (sentPassword || form.gmail_user !== emailStatus.gmail_user) refreshEmailStatus();
    } catch (err) {
      setError('Could not save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setForm(baseline);
    setTouched({});
    setError('');
  };

  // Ctrl/Cmd+S saves, and leaving the tab with edits pending asks first.
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirtyRef.current) saveRef.current();
      }
    };
    const onUnload = (e) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

  /* ── images ────────────────────────────────────────────────────────────── */

  const IMAGE_FIELDS = {
    logo_url: { kind: 'logo', pathField: 'logo_path' },
    signature_url: { kind: 'signature', pathField: 'signature_path' },
    stamp_url: { kind: 'stamp', pathField: 'stamp_path' },
  };

  const openFile = (file, field) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Choose an image file — PNG, JPG or WebP.'); return; }
    const reader = new FileReader();
    reader.onload = () => { setEditorImage(reader.result); setEditorField(field); };
    reader.readAsDataURL(file);
  };

  // The editor hands back a full-resolution PNG data URL. Compress it to WebP
  // and put it in Storage now rather than at save time, so the user sees the
  // real stored image (and any failure) immediately.
  const handleEditorSave = async (editedBase64) => {
    const field = editorField;
    const spec = IMAGE_FIELDS[field];
    setEditorImage(null);
    setEditorField('');
    if (!spec || !activeOrg) return;

    setUploading((p) => ({ ...p, [field]: true }));
    setError('');
    try {
      const { path, url } = await uploadOrgImage({ orgId: activeOrg.id, kind: spec.kind, source: editedBase64 });
      setForm((prev) => ({ ...prev, [spec.pathField]: path, [field]: url }));
      setSaved(false);
      // The previous object is deliberately left in place. Every issued
      // document embeds a company_profile snapshot pointing at the image it was
      // signed with, so deleting it would strip the logo and signature off
      // records that already went out.
    } catch (err) {
      setError(err.message || 'Could not upload that image.');
    } finally {
      setUploading((p) => ({ ...p, [field]: false }));
    }
  };

  const removeImage = (field) => {
    setForm((prev) => ({ ...prev, [field]: '', [IMAGE_FIELDS[field].pathField]: '' }));
    setSaved(false);
  };

  /* ── email ─────────────────────────────────────────────────────────────── */

  const testEmailDisabled = testingEmail || !(emailStatus.configured || (form.gmail_user && form.gmail_app_password));

  // The server tests the credentials it has stored, never credentials posted
  // with the request — see api/email.js. So new settings are saved first,
  // keeping the test a single click.
  const handleTestEmail = async () => {
    if (!activeOrg) return;
    const flash = (r) => { setTestResult(r); setTimeout(() => setTestResult(null), 8000); };
    const hasUnsaved = Boolean(form.gmail_app_password)
      || (form.gmail_user && form.gmail_user !== emailStatus.gmail_user);

    if (!hasUnsaved && !emailStatus.configured) {
      flash({ success: false, message: 'Enter both your Gmail address and App Password first.' });
      return;
    }
    if (hasUnsaved && (!form.gmail_user || !form.gmail_app_password)) {
      flash({ success: false, message: 'Enter both your Gmail address and App Password to save a new connection.' });
      return;
    }

    setTestingEmail(true);
    setTestResult(null);

    if (hasUnsaved) {
      try {
        await updateOrganization(activeOrg.id, form);
        const next = { ...form, gmail_app_password: '' };
        setForm(next);
        setBaseline(next);
        await refreshEmailStatus();
      } catch (err) {
        flash({ success: false, message: 'Could not save the email settings: ' + err.message });
        setTestingEmail(false);
        return;
      }
    }

    const result = await emailService.testConnection({
      orgId: activeOrg.id,
      gmailUser: form.gmail_user || emailStatus.gmail_user,
    });
    flash(result);
    setTestingEmail(false);
  };

  /* ── account ───────────────────────────────────────────────────────────── */

  // Fetched rather than linked, because the endpoint needs the access token on
  // an Authorization header and a plain <a href> cannot send one.
  const handleExport = async () => {
    if (!activeOrg?.id) return;
    setExporting(true);
    setExportError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Your session has expired. Sign in again.');
      const res = await fetch(`/api/export?org_id=${encodeURIComponent(activeOrg.id)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `edgeos-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked later: released synchronously, Safari cancels the download.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    const fail = (msg) => setPw((p) => ({ ...p, error: msg, success: '' }));
    if (pw.next.length < 6) return fail('The new password must be at least 6 characters.');
    if (pw.next !== pw.confirm) return fail('The two new passwords do not match.');
    setPw((p) => ({ ...p, busy: true, error: '', success: '' }));
    try {
      await reauthenticate(pw.current);
      await updatePassword(pw.next);
      setPw({ open: true, current: '', next: '', confirm: '', error: '', success: 'Password updated.', busy: false });
      setTimeout(() => setPw((p) => ({ ...p, open: false, success: '' })), 2000);
    } catch (err) {
      const wrong = err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential';
      setPw((p) => ({ ...p, busy: false, error: wrong ? 'Your current password is incorrect.' : (err.message || 'Could not update the password.') }));
    }
    return undefined;
  };

  /* ── layout ────────────────────────────────────────────────────────────── */

  // Inside the shell the section list lives in its sidebar; standalone it
  // falls back to a column of its own, and on a phone to a row of chips.
  const inShellRail = !!railSlot;
  const wide = winW >= (inShellRail ? 1280 : 1380);
  const withRail = inShellRail || winW >= 980;
  const narrow = winW < 640;

  if (!activeOrg) {
    return (
      <Page>
        {orgLoading ? <Loading>Loading your company profile…</Loading> : (
          <Empty action={<Btn onClick={fetchOrganizations}>Retry</Btn>}>
            We could not find an organization linked to your account.
          </Empty>
        )}
      </Page>
    );
  }

  const plan = getPlanConfig(form.plan || DEFAULT_PLAN);
  const pct = Math.round((doneCount / steps.length) * 100);
  const sectionDone = Object.fromEntries(steps.map((s) => [s.id, s.done]));

  const sp = { t, narrow };

  const sectionNav = (
          <nav aria-label="Profile sections" style={inShellRail ? { display: 'grid', gap: 2, fontFamily: MONO } : { position: 'sticky', top: 0, display: 'grid', gap: 2 }}>
            <RailHead t={t}>SET UP · {doneCount}/{steps.length}</RailHead>
            {steps.map((s, i) => (
              <RailItem key={s.id} t={t} active={activeSection === s.id} onClick={() => jumpTo(s.id)}
                marker={s.done ? <Check size={11} strokeWidth={2.6} /> : i + 1} done={s.done}>{s.label}</RailItem>
            ))}
            <RailHead t={t} style={{ marginTop: 14 }}>MORE</RailHead>
            {extras.map((s) => (
              <RailItem key={s.id} t={t} active={activeSection === s.id} onClick={() => jumpTo(s.id)}
                marker="·">{s.label}</RailItem>
            ))}
          </nav>
  );
  const chipNav = (
          <nav aria-label="Profile sections" className="cp-chips" style={{
            position: 'sticky', top: 0, zIndex: 25, background: t.panel,
            display: 'flex', gap: 6, overflowX: 'auto', padding: '8px 0', margin: '-8px 0 0',
            borderBottom: '1px solid ' + t.lineSoft,
          }}>
            {[...steps, ...extras].map((s) => (
              <button key={s.id} type="button" onClick={() => jumpTo(s.id)} className="cp-chip" style={{
                flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6,
                height: 32, padding: '0 11px', borderRadius: 999, cursor: 'pointer', fontFamily: MONO, fontSize: 11.5,
                border: '1px solid ' + (activeSection === s.id ? t.lineStrong : t.line),
                background: activeSection === s.id ? t.panelAlt : t.panel,
                color: activeSection === s.id ? t.text : t.dim,
              }}>
                {s.done && <Check size={11} strokeWidth={2.6} style={{ color: t.up }} />}
                {s.label}
              </button>
            ))}
          </nav>
  );


  return (
    <Page>
      <div style={{
        display: 'grid', gap: 20, alignItems: 'start', maxWidth: 1480, margin: '0 auto',
        gridTemplateColumns: [withRail && !inShellRail && '200px', 'minmax(0,1fr)', wide && '340px'].filter(Boolean).join(' '),
      }}>

        {withRail && !inShellRail && sectionNav}
        {!withRail && chipNav}

        {/* ── main column ──────────────────────────────────────────────── */}
        <main style={{ display: 'grid', gap: 16, minWidth: 0 }}>

          {/* progress header */}
          <section style={{
            border: '1px solid ' + t.line, borderRadius: 12, background: t.panelAlt,
            padding: narrow ? 14 : '16px 18px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: 11, flexShrink: 0, overflow: 'hidden',
              border: '1px solid ' + t.line, background: t.panel, display: 'grid', placeItems: 'center',
            }}>
              {form.logo_url
                ? <img src={form.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                : <Building2 size={20} strokeWidth={1.6} color={t.faint} />}
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 500, letterSpacing: '-0.02em', color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {form.company_name || 'Your company'}
              </div>
              <div style={{ fontSize: 11.5, color: t.dim, marginTop: 3, lineHeight: 1.5 }}>
                {doneCount === steps.length
                  ? 'All set — every document you create is filled in from here.'
                  : `${doneCount} of ${steps.length} steps done. Everything here is auto-filled into offers, invoices, MoUs and certificates.`}
              </div>
              <div style={{ marginTop: 10, maxWidth: 420 }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completion">
                <Bar value={doneCount} max={steps.length} height={4} tone={doneCount === steps.length ? t.up : t.text} />
              </div>
            </div>
            {nextStep && (
              <Btn primary onClick={() => jumpTo(nextStep.id)}>
                {nextStep.todo} <ArrowRight size={13} />
              </Btn>
            )}
          </section>

          {error && (
            <Notice t={t} tone="down" onClose={() => setError('')}>{error}</Notice>
          )}

          {!wide && (
            <details className="cp-details" style={{ border: '1px solid ' + t.line, borderRadius: 12, background: t.panel }}>
              <summary style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', cursor: 'pointer',
                fontSize: 12, color: t.text, listStyle: 'none',
              }}>
                <ChevronDown size={14} className="cp-caret" color={t.faint} />
                Preview on a document
                <span style={{ fontSize: 10.5, color: t.faint, marginLeft: 'auto' }}>updates as you type</span>
              </summary>
              <div style={{ padding: '0 16px 16px' }}>
                <Letterhead form={form} onJump={jumpTo} />
              </div>
            </details>
          )}

          {/* 1. company */}
          <Section {...sp} id="company" n={1} done={sectionDone.company} title="Company basics"
            desc="Your legal name and registered address, as they should read on a signed document.">
            <Fields narrow={narrow}>
              <FormField t={t} label="Company name" required htmlFor="cp-company_name" wide>
                <TextInput t={t} {...bind('company_name')} placeholder="Acme International Pvt. Ltd." autoComplete="organization" required />
              </FormField>
              <FormField t={t} label="Tagline" htmlFor="cp-company_tagline" hint="Optional. Shown under your name on the letterhead." wide>
                <TextInput t={t} {...bind('company_tagline')} placeholder="Innovation meets excellence" />
              </FormField>
              <FormField t={t} label="Registered address" htmlFor="cp-company_address" wide>
                <TextInput t={t} as="textarea" rows={3} {...bind('company_address')} placeholder={'Building, street\nCity, State PIN'} autoComplete="street-address" />
              </FormField>
            </Fields>
          </Section>

          {/* 2. contact */}
          <Section {...sp} id="contact" n={2} done={sectionDone.contact} title="Contact & tax"
            desc="How recipients reach you, and the registration numbers invoices must carry.">
            <Fields narrow={narrow}>
              <FormField t={t} label="Contact email" htmlFor="cp-company_email" warn={warn('company_email')}>
                <TextInput t={t} {...bind('company_email')} type="email" inputMode="email" autoComplete="email" placeholder="hello@company.com" />
              </FormField>
              <FormField t={t} label="Phone" htmlFor="cp-company_phone" warn={warn('company_phone')}>
                <TextInput t={t} {...bind('company_phone')} type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" />
              </FormField>
              <FormField t={t} label="Website" htmlFor="cp-company_website" hint="Optional" warn={warn('company_website')} wide>
                <TextInput t={t} {...bind('company_website')} inputMode="url" autoComplete="url" placeholder="company.com" />
              </FormField>
              <FormField t={t} label="GSTIN" htmlFor="cp-gstin" hint="Optional · 15 characters" warn={warn('gstin')}>
                <TextInput t={t} {...bind('gstin')} maxLength={15} placeholder="22AAAAA0000A1Z5" spellCheck={false} mono />
              </FormField>
              <FormField t={t} label="CIN" htmlFor="cp-cin" hint="Optional · 21 characters" warn={warn('cin')}>
                <TextInput t={t} {...bind('cin')} maxLength={21} placeholder="U12345MH2020PTC123456" spellCheck={false} mono />
              </FormField>
            </Fields>
          </Section>

          {/* 3. signatory */}
          <Section {...sp} id="signatory" n={3} done={sectionDone.signatory} title="Authorised signatory"
            desc="The person whose name and title appear above the signature line.">
            <Fields narrow={narrow}>
              <FormField t={t} label="Full name" required htmlFor="cp-owner_full_name">
                <TextInput t={t} {...bind('owner_full_name')} placeholder="Priya Sharma" autoComplete="name" required />
              </FormField>
              <FormField t={t} label="Title on documents" htmlFor="cp-document_designation">
                <TextInput t={t} {...bind('document_designation')} placeholder="Founder & CEO" list="cp-designations" autoComplete="organization-title" />
                <datalist id="cp-designations">
                  {['Founder', 'Founder & CEO', 'Director', 'Managing Director', 'CEO', 'HR Manager', 'Head of People'].map((d) => <option key={d} value={d} />)}
                </datalist>
              </FormField>
            </Fields>
          </Section>

          {/* 4. branding */}
          <Section {...sp} id="branding" n={4} done={sectionDone.branding} title="Logo & signature"
            desc="Drop an image or click to choose one. You can crop and clean it up before it is saved.">
            <Fields narrow={narrow}>
              <Uploader t={t} field="logo_url" label="Company logo" hint="PNG with a transparent background works best."
                url={form.logo_url} busy={uploading.logo_url} height={72}
                onFile={openFile} onEdit={() => { setEditorImage(form.logo_url); setEditorField('logo_url'); }} onRemove={removeImage} />
              <Uploader t={t} field="signature_url" label="Signature" hint="Sign on white paper and photograph it, or sign on a tablet."
                url={form.signature_url} busy={uploading.signature_url} height={56}
                onFile={openFile} onEdit={() => { setEditorImage(form.signature_url); setEditorField('signature_url'); }} onRemove={removeImage} />
            </Fields>
          </Section>

          {/* 5. stamp */}
          <Section {...sp} id="stamp" n={5} done={sectionDone.stamp} title="Company stamp"
            desc="We can draw a round stamp from your company name, or you can upload your own.">
            <div style={{ marginBottom: 14 }}>
              <Seg value={form.stamp_type} onChange={(v) => setField('stamp_type', v)}
                options={[{ id: 'generated', label: 'Generate for me' }, { id: 'uploaded', label: 'Upload my own' }]} />
            </div>
            {form.stamp_type === 'generated' ? (
              <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <FormField t={t} label="City on the stamp" htmlFor="cp-stamp_city" hint="Printed around the bottom edge.">
                    <TextInput t={t} {...bind('stamp_city')} placeholder="Chennai" autoComplete="address-level2" />
                  </FormField>
                </div>
                <div style={{
                  width: 150, height: 150, borderRadius: 12, background: '#ffffff',
                  border: '1px solid ' + t.line, display: 'grid', placeItems: 'center', flexShrink: 0,
                }} aria-label="Stamp preview">
                  <StampPreview companyName={form.company_name} city={form.stamp_city} size={128} />
                </div>
              </div>
            ) : (
              <Fields narrow={narrow}>
                <Uploader t={t} field="stamp_url" label="Stamp image" hint="A scan of your rubber stamp, cropped close."
                  url={form.stamp_url} busy={uploading.stamp_url} height={110}
                  onFile={openFile} onEdit={() => { setEditorImage(form.stamp_url); setEditorField('stamp_url'); }} onRemove={removeImage} />
              </Fields>
            )}
          </Section>

          {/* 6. banking */}
          <Section {...sp} id="banking" n={6} done={sectionDone.banking} title="Payments"
            desc="Used for the UPI QR code and bank block on invoices, quotations and the client portal. UPI alone is enough.">
            <Fields narrow={narrow}>
              <FormField t={t} label="UPI ID" htmlFor="cp-upi_id" warn={warn('upi_id')} wide>
                <TextInput t={t} {...bind('upi_id')} placeholder="company@okhdfcbank" spellCheck={false} autoCapitalize="none" mono />
              </FormField>
              <FormField t={t} label="Bank name" htmlFor="cp-bank_name">
                <TextInput t={t} {...bind('bank_name')} placeholder="HDFC Bank" />
              </FormField>
              <FormField t={t} label="Account type" htmlFor="cp-bank_account_type">
                <div id="cp-bank_account_type">
                  <Seg value={form.bank_account_type} onChange={(v) => setField('bank_account_type', v)} options={['Current', 'Savings']} />
                </div>
              </FormField>
              <FormField t={t} label="Account number" htmlFor="cp-bank_account_number" warn={warn('bank_account_number')}>
                <TextInput t={t} {...bind('bank_account_number')} inputMode="numeric" placeholder="50100123456789" spellCheck={false} mono />
              </FormField>
              <FormField t={t} label="IFSC" htmlFor="cp-bank_ifsc" hint="11 characters" warn={warn('bank_ifsc')}>
                <TextInput t={t} {...bind('bank_ifsc')} maxLength={11} placeholder="HDFC0001234" spellCheck={false} mono />
              </FormField>
            </Fields>
          </Section>

          {/* 7. email */}
          <Section {...sp} id="email" n={7} done={sectionDone.email} title="Email sending"
            desc="Connect a Gmail account so EdgeOS can send offer letters, reminders and follow-ups from your address."
            status={!emailStatus.loading && (
              <StatusLine t={t} ok={emailStatus.configured}>
                {emailStatus.configured
                  ? `Connected as ${emailStatus.gmail_user}${emailStatus.rotated_at ? ` · saved ${new Date(emailStatus.rotated_at).toLocaleDateString('en-IN')}` : ''}`
                  : 'Not connected — email features are off'}
              </StatusLine>
            )}>
            <Fields narrow={narrow}>
              <FormField t={t} label="Gmail address" htmlFor="cp-gmail_user" warn={warn('gmail_user')}>
                <TextInput t={t} {...bind('gmail_user')} type="email" inputMode="email" autoComplete="off" placeholder="you@gmail.com" />
              </FormField>
              <FormField t={t} label="App password" htmlFor="cp-gmail_app_password"
                hint={emailStatus.configured ? 'Leave blank to keep the saved one. Stored encrypted; never shown again.' : '16 characters from Google. Stored encrypted; never shown again.'}>
                <div style={{ position: 'relative' }}>
                  <TextInput t={t} {...bind('gmail_app_password')} type={showAppPassword ? 'text' : 'password'}
                    autoComplete="new-password" placeholder={emailStatus.configured ? '•••• •••• •••• ••••' : 'xxxx xxxx xxxx xxxx'}
                    spellCheck={false} mono style={{ paddingRight: 42 }} />
                  <button type="button" onClick={() => setShowAppPassword((v) => !v)} className="cp-iconbtn"
                    aria-label={showAppPassword ? 'Hide app password' : 'Show app password'}
                    style={{
                      position: 'absolute', right: 4, top: 4, width: 32, height: 32, borderRadius: 6,
                      border: 'none', background: 'transparent', color: t.faint, cursor: 'pointer', display: 'grid', placeItems: 'center',
                    }}>
                    {showAppPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </FormField>
            </Fields>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
              <Btn onClick={handleTestEmail} disabled={testEmailDisabled}>
                {testingEmail ? <><Loader size={13} className="spin-icon" /> Sending test…</> : <><Zap size={13} /> Save & send a test email</>}
              </Btn>
            </div>
            {testResult && (
              <div style={{ marginTop: 10 }}>
                <Notice t={t} tone={testResult.success ? 'up' : 'down'}>{testResult.message}</Notice>
              </div>
            )}

            <details className="cp-details" style={{ marginTop: 14, border: '1px solid ' + t.lineSoft, borderRadius: 10, background: t.panelAlt }}>
              <summary style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', cursor: 'pointer', fontSize: 12, color: t.text, listStyle: 'none' }}>
                <ChevronDown size={14} className="cp-caret" color={t.faint} />
                How do I get an app password?
                <span style={{ fontSize: 10.5, color: t.faint, marginLeft: 'auto' }}>about 2 minutes</span>
              </summary>
              <ol style={{ margin: 0, padding: '2px 14px 14px 36px', display: 'grid', gap: 8, fontSize: 12, lineHeight: 1.6, color: t.dim }}>
                <li>Turn on <b style={{ color: t.text, fontWeight: 500 }}>2-Step Verification</b> for your Google account. <ExtLink t={t} href="https://myaccount.google.com/signinoptions/two-step-verification">Open 2-Step settings</ExtLink></li>
                <li>Open <b style={{ color: t.text, fontWeight: 500 }}>App passwords</b>. <ExtLink t={t} href="https://myaccount.google.com/apppasswords">Open App passwords</ExtLink></li>
                <li>Name it “EdgeOS” and press <b style={{ color: t.text, fontWeight: 500 }}>Create</b>.</li>
                <li>Copy the 16-character password, paste it above, and press <b style={{ color: t.text, fontWeight: 500 }}>Save & send a test email</b>.</li>
                <li style={{ listStyle: 'none', marginLeft: -22, color: t.faint, fontSize: 11 }}>
                  An app password is not your Google login password, and you can revoke it from the same page at any time.
                </li>
              </ol>
            </details>
          </Section>

          {/* team access */}
          <Section {...sp} id="access" title="Team access"
            desc="What each role can do, and how employees join their self-service portal.">
            <SubHead t={t}>Roles & permissions</SubHead>
            <div className="cp-legacy"><RolePermissions orgId={activeOrg.id} /></div>
            <div style={{ height: 1, background: t.lineSoft, margin: '18px 0' }} />
            <SubHead t={t} icon={<KeyRound size={13} />}>Employee portal join code</SubHead>
            <div className="cp-legacy"><PortalJoinCode orgId={activeOrg.id} /></div>
          </Section>

          {/* plan */}
          <Section {...sp} id="plan" title="Plan"
            desc="What your current plan includes."
            status={<StatusLine t={t} dot={plan.color}>{plan.displayName}</StatusLine>}>
            <div style={{
              display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${narrow ? 120 : 130}px, 1fr))`,
              border: '1px solid ' + t.line, borderRadius: 10, overflow: 'hidden',
            }}>
              {PLAN_ROWS.map(([key, label]) => {
                const v = plan.limits[key];
                return (
                  <div key={key} style={{ padding: '12px 14px', borderRight: '1px solid ' + t.lineSoft, borderBottom: '1px solid ' + t.lineSoft }}>
                    <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.03em', color: t.text }}>{v === Infinity ? '∞' : v}</div>
                    <div style={{ fontSize: 10.5, color: t.faint, marginTop: 4 }}>{label}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 12 }}>
              <Btn onClick={() => navigate('/pricing')}>Compare plans <ArrowRight size={13} /></Btn>
            </div>
          </Section>

          {/* account */}
          <Section {...sp} id="account" title="Account & data"
            desc="Your sign-in password, and a full copy of your organization’s data.">
            <div style={{ display: 'grid', gap: 12 }}>
              <ActionRow t={t} title="Password" note="Change the password you sign in with."
                action={!pw.open && <Btn onClick={() => setPw((p) => ({ ...p, open: true }))}><KeyRound size={13} /> Change password</Btn>}>
                {pw.open && (
                  <form onSubmit={handleChangePassword} style={{ marginTop: 12 }}>
                    {pw.error && <div style={{ marginBottom: 10 }}><Notice t={t} tone="down">{pw.error}</Notice></div>}
                    {pw.success && <div style={{ marginBottom: 10 }}><Notice t={t} tone="up">{pw.success}</Notice></div>}
                    <Fields narrow={narrow} cols={narrow ? 1 : 3}>
                      <FormField t={t} label="Current password" htmlFor="cp-pw-current">
                        <TextInput t={t} id="cp-pw-current" type="password" autoComplete="current-password" required
                          value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} />
                      </FormField>
                      <FormField t={t} label="New password" htmlFor="cp-pw-next" hint="At least 6 characters">
                        <TextInput t={t} id="cp-pw-next" type="password" autoComplete="new-password" required minLength={6}
                          value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} />
                      </FormField>
                      <FormField t={t} label="Repeat new password" htmlFor="cp-pw-confirm"
                        warn={pw.confirm && pw.next !== pw.confirm ? 'Does not match yet.' : ''}>
                        <TextInput t={t} id="cp-pw-confirm" type="password" autoComplete="new-password" required minLength={6}
                          value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} />
                      </FormField>
                    </Fields>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <Btn primary type="submit" disabled={pw.busy}>
                        {pw.busy ? <><Loader size={13} className="spin-icon" /> Updating…</> : 'Update password'}
                      </Btn>
                      <Btn onClick={() => setPw({ open: false, current: '', next: '', confirm: '', error: '', success: '', busy: false })}>Cancel</Btn>
                    </div>
                  </form>
                )}
              </ActionRow>
              <ActionRow t={t} title="Export all data"
                note="One JSON file with every client, employee, document, payment and the activity log, plus 7-day links to your uploads. Email credentials are left out."
                action={<Btn onClick={handleExport} disabled={exporting}>
                  {exporting ? <><Loader size={13} className="spin-icon" /> Preparing…</> : <><Download size={13} /> Export</>}
                </Btn>}>
                {exportError && <div style={{ marginTop: 10 }}><Notice t={t} tone="down">{exportError}</Notice></div>}
              </ActionRow>
            </div>
          </Section>

          {/* ── save bar ───────────────────────────────────────────────── */}
          <div aria-live="polite" style={{
            position: 'sticky', bottom: 0, zIndex: 30, padding: '10px 0 0',
            background: dirty || saving || saved ? `linear-gradient(to bottom, transparent, ${t.panel} 30%)` : 'transparent',
            pointerEvents: dirty || saving || saved ? 'auto' : 'none',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              padding: '10px 12px 10px 16px', borderRadius: 12,
              border: '1px solid ' + t.lineStrong, background: t.panel, boxShadow: t.shadow,
              opacity: dirty || saving || saved ? 1 : 0,
              transform: dirty || saving || saved ? 'none' : 'translateY(10px)',
              transition: 'opacity .18s, transform .22s cubic-bezier(.16,1,.3,1)',
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: saved && !dirty ? t.up : t.text }} />
              <span style={{ fontSize: 12, color: t.text, flex: 1, minWidth: 140 }}>
                {saved && !dirty ? 'Saved — new documents will use these details.' : 'You have unsaved changes'}
                {!narrow && dirty && <span style={{ color: t.faint, marginLeft: 8, fontSize: 10.5 }}>Ctrl + S</span>}
              </span>
              {dirty && <Btn onClick={handleDiscard} disabled={saving}>Discard</Btn>}
              {dirty && (
                <Btn primary onClick={handleSave} disabled={saving}>
                  {saving ? <><Loader size={13} className="spin-icon" /> Saving…</> : <><Check size={13} /> Save changes</>}
                </Btn>
              )}
            </div>
          </div>
        </main>

        {/* ── live preview ─────────────────────────────────────────────── */}
        {wide && (
          <aside style={{ position: 'sticky', top: 0 }} aria-label="Document preview">
            <RailHead t={t}>PREVIEW ON A DOCUMENT</RailHead>
            <Letterhead form={form} onJump={jumpTo} />
            <p style={{ fontSize: 10.5, color: t.faint, lineHeight: 1.6, margin: '10px 2px 0' }}>
              Updates as you type. Click a dashed box to fill it in.
            </p>
          </aside>
        )}
      </div>

      {inShellRail && createPortal(sectionNav, railSlot)}

      {editorImage && (
        <ImageEditor imageSrc={editorImage} onSave={handleEditorSave}
          onCancel={() => { setEditorImage(null); setEditorField(''); }} />
      )}

      <style>{`
        .edge-page .cp-input { transition: border-color .15s, box-shadow .15s; }
        .edge-page .cp-input:hover { border-color: ${t.lineStrong}; }
        .edge-page .cp-input:focus { border-color: ${t.text} !important; box-shadow: 0 0 0 3px ${t.isDark ? 'rgba(255,255,255,.08)' : 'rgba(14,16,17,.08)'}; }
        .edge-page .cp-input:focus-visible { outline: none; }
        .edge-page .cp-input::placeholder { color: ${t.faint}; opacity: .7; }
        .edge-page .cp-input[aria-invalid="true"] { border-color: ${t.down}; }
        .edge-page .cp-drop:hover, .edge-page .cp-drop.over { border-color: ${t.text} !important; background: ${t.raised} !important; }
        .edge-page .cp-rail:hover { color: ${t.text} !important; background: ${t.panelAlt} !important; }
        .edge-page .cp-chip:hover, .edge-page .cp-iconbtn:hover { color: ${t.text} !important; }
        .edge-page .cp-chips::-webkit-scrollbar { display: none; }
        .edge-page .cp-details summary::-webkit-details-marker { display: none; }
        .edge-page .cp-caret { transition: transform .18s; transform: rotate(-90deg); flex-shrink: 0; }
        .edge-page .cp-details[open] > summary .cp-caret { transform: none; }
        .edge-page .cp-jump:hover { border-color: #0e1011 !important; color: #0e1011 !important; }
        .edge-page .cp-legacy { font-family: ${MONO}; }
        .edge-page .cp-legacy table { font-family: ${MONO}; }
        .edge-page [id^="cp-sec-"] { scroll-margin-top: ${withRail ? 8 : 60}px; }
        @media (prefers-reduced-motion: reduce) { .edge-page * { transition: none !important; scroll-behavior: auto !important; } }
      `}</style>
    </Page>
  );
}

/* ── pieces ──────────────────────────────────────────────────────────────── */

function RailHead({ t, children, style }) {
  return <div style={{ fontSize: 9.5, letterSpacing: '0.1em', color: t.faint, padding: '4px 10px 8px', ...style }}>{children}</div>;
}

function RailItem({ t, active, done, marker, onClick, children }) {
  return (
    <button type="button" onClick={onClick} className="cp-rail edge-navitem" aria-current={active ? 'true' : undefined} style={{
      display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 36, padding: '0 10px',
      borderRadius: 8, border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: MONO, fontSize: 12,
      background: active ? t.panelAlt : 'transparent', color: active ? t.text : t.dim,
      boxShadow: active ? 'inset 2px 0 0 ' + t.text : 'none', transition: 'color .14s, background .14s',
    }}>
      <span style={{
        width: 20, height: 20, borderRadius: 999, flexShrink: 0, display: 'grid', placeItems: 'center',
        fontSize: 10, border: '1px solid ' + (done ? t.up : t.line),
        background: done ? t.up : 'transparent', color: done ? (t.isDark ? '#050506' : '#fff') : t.faint,
      }}>{marker}</span>
      <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</span>
      {done && <span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>complete</span>}
    </button>
  );
}

function Section({ t, narrow, id, n, done, title, desc, status, children }) {
  return (
    <section id={`cp-sec-${id}`} aria-labelledby={`cp-sec-${id}-title`} style={{
      border: '1px solid ' + t.line, borderRadius: 12, background: t.panel, minWidth: 0,
    }}>
      <header style={{
        display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap',
        padding: narrow ? '14px 14px 12px' : '16px 18px 14px', borderBottom: '1px solid ' + t.lineSoft,
      }}>
        {n !== undefined && (
          <span aria-hidden="true" style={{
            width: 24, height: 24, borderRadius: 999, flexShrink: 0, marginTop: 1, display: 'grid', placeItems: 'center',
            fontSize: 11, border: '1px solid ' + (done ? t.up : t.lineStrong),
            background: done ? t.up : 'transparent', color: done ? (t.isDark ? '#050506' : '#fff') : t.dim,
          }}>{done ? <Check size={12} strokeWidth={2.6} /> : n}</span>
        )}
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <h2 id={`cp-sec-${id}-title`} style={{ margin: 0, fontSize: 14, fontWeight: 500, letterSpacing: '-0.01em', color: t.text }}>
            {title}
            {n !== undefined && <span style={{ fontSize: 10.5, fontWeight: 400, color: done ? t.up : t.faint, marginLeft: 10 }}>{done ? 'Done' : 'To do'}</span>}
          </h2>
          {desc && <p style={{ margin: '4px 0 0', fontSize: 11.5, color: t.dim, lineHeight: 1.55 }}>{desc}</p>}
        </div>
        {status}
      </header>
      <div style={{ padding: narrow ? 14 : 18 }}>{children}</div>
    </section>
  );
}

function Fields({ children, narrow, cols = 2 }) {
  return (
    <div style={{ display: 'grid', gap: '14px 16px', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : `repeat(${cols}, minmax(0,1fr))` }}>
      {children}
    </div>
  );
}

function FormField({ t, label, required, hint, warn, htmlFor, wide, children }) {
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;
  return (
    <div style={{ minWidth: 0, gridColumn: wide ? '1 / -1' : undefined }}>
      <label htmlFor={htmlFor} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11.5, color: t.text, marginBottom: 6 }}>
        {label}
        {required && <span style={{ color: t.faint, fontSize: 10.5 }}>required</span>}
      </label>
      {children}
      {(warn || hint) && (
        <div id={hintId} role={warn ? 'alert' : undefined} style={{
          display: 'flex', gap: 5, alignItems: 'flex-start', fontSize: 10.5, lineHeight: 1.5, marginTop: 5,
          color: warn ? t.down : t.faint,
        }}>
          {warn && <AlertCircle size={11} style={{ marginTop: 2, flexShrink: 0 }} />}
          {warn || hint}
        </div>
      )}
    </div>
  );
}

function TextInput({ t, as, mono, style, ...props }) {
  const Tag = as || 'input';
  const warnId = props.id ? `${props.id}-hint` : undefined;
  return (
    <Tag
      {...props}
      aria-describedby={warnId}
      className="edge-input cp-input"
      style={{
        width: '100%', boxSizing: 'border-box',
        height: Tag === 'textarea' ? undefined : 40,
        padding: Tag === 'textarea' ? '10px 12px' : '0 12px',
        background: t.panelAlt, border: '1px solid ' + t.line, borderRadius: 8,
        color: t.text, fontFamily: MONO, fontSize: 13, outline: 'none',
        letterSpacing: mono ? '0.04em' : undefined,
        resize: Tag === 'textarea' ? 'vertical' : undefined, lineHeight: 1.55,
        ...style,
      }}
    />
  );
}

function Uploader({ t, field, label, hint, url, busy, height, onFile, onEdit, onRemove }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const pick = () => inputRef.current?.click();
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11.5, color: t.text, marginBottom: 6 }}>{label}</div>
      <input ref={inputRef} type="file" accept="image/*" hidden
        onChange={(e) => { onFile(e.target.files[0], field); e.target.value = ''; }} />
      <button
        type="button" onClick={pick} disabled={busy}
        className={'cp-drop' + (over ? ' over' : '')}
        aria-label={url ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0], field); }}
        style={{
          width: '100%', minHeight: height + 40, padding: 14, borderRadius: 10, cursor: busy ? 'wait' : 'pointer',
          border: '1.5px dashed ' + (url ? t.line : t.lineStrong),
          background: url ? '#ffffff' : t.panelAlt, fontFamily: MONO,
          display: 'grid', placeItems: 'center', gap: 6, transition: 'border-color .15s, background .15s',
        }}
      >
        {busy ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: url ? '#6b7275' : t.dim }}>
            <Loader size={14} className="spin-icon" /> Uploading…
          </span>
        ) : url ? (
          <img src={url} alt={label} style={{ maxHeight: height, maxWidth: '100%', objectFit: 'contain' }} />
        ) : (
          <>
            <Upload size={18} strokeWidth={1.7} color={t.dim} />
            <span style={{ fontSize: 12, color: t.text }}>Click to choose, or drop an image</span>
          </>
        )}
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {url ? (
          <>
            <Btn size="sm" onClick={onEdit} disabled={busy}><Pencil size={11} /> Crop & adjust</Btn>
            <Btn size="sm" onClick={pick} disabled={busy}><Upload size={11} /> Replace</Btn>
            <Btn size="sm" danger onClick={() => onRemove(field)} disabled={busy}><Trash2 size={11} /> Remove</Btn>
          </>
        ) : (
          <span style={{ fontSize: 10.5, color: t.faint, lineHeight: 1.5 }}>{hint}</span>
        )}
      </div>
    </div>
  );
}

function StatusLine({ t, ok, dot, children }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, color: t.dim,
      padding: '5px 10px', borderRadius: 999, border: '1px solid ' + t.line, background: t.panelAlt,
      maxWidth: '100%', minWidth: 0,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: dot || (ok ? t.up : t.ghost) }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
    </span>
  );
}

function Notice({ t, tone, children, onClose }) {
  const color = tone === 'up' ? t.up : t.down;
  return (
    <div role={tone === 'down' ? 'alert' : 'status'} style={{
      display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 12px', borderRadius: 9,
      border: '1px solid ' + t.line, borderLeft: '3px solid ' + color, background: t.panelAlt,
      fontSize: 12, lineHeight: 1.5, color: t.text,
    }}>
      {tone === 'up'
        ? <Check size={14} color={color} style={{ marginTop: 2, flexShrink: 0 }} />
        : <XCircle size={14} color={color} style={{ marginTop: 2, flexShrink: 0 }} />}
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="cp-iconbtn" style={{
          border: 'none', background: 'transparent', color: t.faint, cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 2px',
        }}>×</button>
      )}
    </div>
  );
}

function SubHead({ t, icon, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: t.text, marginBottom: 10 }}>
      {icon && <span style={{ color: t.faint, display: 'grid' }}>{icon}</span>}
      {children}
    </div>
  );
}

function ActionRow({ t, title, note, action, children }) {
  return (
    <div style={{ border: '1px solid ' + t.lineSoft, borderRadius: 10, padding: '12px 14px', background: t.panelAlt }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={{ fontSize: 12.5, color: t.text }}>{title}</div>
          <div style={{ fontSize: 11, color: t.faint, marginTop: 3, lineHeight: 1.55 }}>{note}</div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function ExtLink({ t, href, children }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" style={{
      color: t.text, textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: t.lineStrong,
      display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap',
    }}>
      {children} <ExternalLink size={10} />
    </a>
  );
}

function Gap({ label, onClick, style }) {
  return (
    <button type="button" onClick={onClick} className="cp-jump" style={{
      border: '1px dashed #c2c9cc', borderRadius: 6, background: 'transparent', color: '#959c9f',
      fontFamily: MONO, fontSize: 9.5, cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 4, ...style,
    }}>+ {label}</button>
  );
}

/* A miniature of the letterhead and sign-off every document is built from.
   Always paper-white, because that is what the recipient sees. Anything still
   missing is a dashed box that jumps to the field that fills it. */
function Letterhead({ form, onJump }) {
  const ink = '#0e1011';
  const soft = '#6b7275';
  const rule = '#e3e6e7';
  const contact = [form.company_email, form.company_phone, form.company_website].filter(Boolean).join('  ·  ');
  const stamp = form.stamp_type === 'uploaded'
    ? (form.stamp_url ? <img src={form.stamp_url} alt="" style={{ width: 70, height: 70, objectFit: 'contain' }} /> : <Gap label="Stamp" onClick={() => onJump('stamp')} style={{ width: 70, height: 70, borderRadius: 999 }} />)
    : <div style={{ opacity: 0.9 }}><StampPreview companyName={form.company_name} city={form.stamp_city} size={70} /></div>;

  return (
    <div style={{
      background: '#ffffff', color: ink, borderRadius: 10, border: '1px solid ' + rule,
      padding: 18, fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
      boxShadow: '0 12px 30px -18px rgba(20,28,32,.35)', aspectRatio: '1 / 1.3', display: 'flex', flexDirection: 'column',
      maxWidth: 420,
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {form.logo_url
          ? <img src={form.logo_url} alt="" style={{ width: 48, height: 48, objectFit: 'contain', flexShrink: 0 }} />
          : <Gap label="Logo" onClick={() => onJump('branding')} style={{ width: 48, height: 48, flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
          <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.25, wordBreak: 'break-word' }}>
            {form.company_name || <span style={{ color: '#c2c9cc' }}>Company name</span>}
          </div>
          {form.company_tagline && <div style={{ fontSize: 9, color: soft, marginTop: 2, fontStyle: 'italic' }}>{form.company_tagline}</div>}
          <div style={{ fontSize: 8.5, color: soft, marginTop: 5, lineHeight: 1.5, whiteSpace: 'pre-line' }}>
            {form.company_address || <button type="button" onClick={() => onJump('company', 'company_address')} className="cp-jump" style={{ border: 'none', background: 'none', padding: 0, color: '#959c9f', fontSize: 8.5, cursor: 'pointer', fontFamily: MONO }}>+ Address</button>}
          </div>
          {contact && <div style={{ fontSize: 8, color: soft, marginTop: 3, wordBreak: 'break-word' }}>{contact}</div>}
          {form.gstin && <div style={{ fontSize: 8, color: soft, marginTop: 2 }}>GSTIN {form.gstin}</div>}
        </div>
      </div>
      <div style={{ height: 2, background: ink, margin: '12px 0 14px' }} />
      <div style={{ display: 'grid', gap: 7, flex: 1, alignContent: 'start' }}>
        {[62, 100, 94, 100, 78, 0, 100, 88, 55].map((w, i) => (
          <div key={i} style={{ height: w ? 5 : 4, width: w + '%', borderRadius: 3, background: '#eef0f1' }} />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, marginTop: 12 }}>
        <div style={{ minWidth: 0 }}>
          {form.signature_url
            ? <img src={form.signature_url} alt="" style={{ height: 34, maxWidth: 130, objectFit: 'contain', display: 'block' }} />
            : <Gap label="Signature" onClick={() => onJump('branding')} style={{ width: 120, height: 34 }} />}
          <div style={{ width: 130, height: 1, background: ink, margin: '4px 0 5px' }} />
          <div style={{ fontSize: 9.5, fontWeight: 600 }}>{form.owner_full_name || <span style={{ color: '#c2c9cc' }}>Signatory name</span>}</div>
          <div style={{ fontSize: 8.5, color: soft }}>{form.document_designation || 'Title'}</div>
        </div>
        {stamp}
      </div>
      {form.upi_id && (
        <div style={{ marginTop: 10, paddingTop: 7, borderTop: '1px solid ' + rule, fontSize: 8, color: soft }}>
          Pay via UPI · {form.upi_id}
        </div>
      )}
    </div>
  );
}
