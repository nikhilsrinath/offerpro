import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Upload, Check, Loader, AlertCircle, Pencil, Zap, XCircle, KeyRound,
  Eye, EyeOff, ArrowRight, ExternalLink, Trash2, Building2,
} from 'lucide-react';
import { useOrg } from '../context/OrgContext';
import { useAuth } from '../context/AuthContext';
import { emailService } from '../services/emailService';
import { uploadOrgImage } from '../services/imageUploadService';
import { getPlanConfig, DEFAULT_PLAN } from '../services/planConfig';
import { supabase } from '../lib/supabase';
import { Page, Btn, Seg, Bar, Loading, Empty } from './ui/edge';
import { useT, MONO } from './ui/edgeUtils';
import { DIAL_CODES } from '../data/dialCodes';

import StampPreview from './StampPreview';
import PortalJoinCode from './settings/PortalJoinCode';
import ImageEditor from './ImageEditor';

/* ══════════════════════════════════════════════════════════════════════════
   Company profile, in the hub's terminal theme.

   Laid out as a handful of tabs, each a row of side-by-side panels, so nothing
   needs a long scroll. Each tab says how much of it is done, and the header
   jumps to whatever is still missing. Edits collect in one place and are saved
   from a bar that only appears once there is something to save.
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
  company_phone: [/^[\d\s()-]{6,20}$/, 'Enter a valid phone number.'],
  company_website: [/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i, 'Enter a web address like company.com.'],
  gstin: [/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'A GSTIN is 15 characters, e.g. 22AAAAA0000A1Z5.'],
  cin: [/^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/, 'A CIN is 21 characters, e.g. U12345MH2020PTC123456.'],
  upi_id: [/^[\w.-]{2,}@[a-z][\w]{1,}$/i, 'A UPI ID looks like name@bank.'],
  bank_ifsc: [/^[A-Z]{4}0[A-Z0-9]{6}$/, 'An IFSC is 11 characters, e.g. HDFC0001234.'],
  bank_account_number: [/^\d{6,18}$/, 'Account numbers are 6–18 digits.'],
};
const UPPER = new Set(['gstin', 'cin', 'bank_ifsc']);

const PREFERRED_ISO = { 1: 'US', 7: 'RU', 39: 'IT', 44: 'GB', 47: 'NO', 61: 'AU', 212: 'MA', 262: 'RE', 358: 'FI', 590: 'GP', 599: 'CW' };
const DEFAULT_DIAL = '91';
const DIAL_OPTIONS = (() => {
  const byCode = {};
  Object.entries(DIAL_CODES).forEach(([iso, code]) => { (byCode[code] ||= []).push(iso); });
  return Object.entries(byCode)
    .map(([code, isos]) => ({ code, iso: isos.includes(PREFERRED_ISO[code]) ? PREFERRED_ISO[code] : isos[0] }))
    .sort((a, b) => Number(a.code) - Number(b.code));
})();
const DIAL_SET = new Set(DIAL_OPTIONS.map((o) => o.code));

// "+91 98765 43210" → { code: '91', number: '98765 43210' }. A number with no
// recognisable prefix keeps the default country code.
const splitPhone = (value) => {
  const v = String(value || '').trim();
  const m = v.match(/^\+\s*(\d{1,3})(?:[\s-]*)(.*)$/);
  if (!m) return { code: DEFAULT_DIAL, number: v };
  for (let n = Math.min(3, m[1].length); n >= 1; n -= 1) {
    const head = m[1].slice(0, n);
    if (DIAL_SET.has(head)) return { code: head, number: (m[1].slice(n) + (m[2] ? ' ' + m[2] : '')).trim() };
  }
  return { code: DEFAULT_DIAL, number: v };
};

const warningFor = (name, value) => {
  const rule = CHECKS[name];
  if (!rule || !value) return '';
  return rule[0].test(String(value).trim()) ? '' : rule[1];
};

const TABS = [
  { id: 'company', label: 'Company', steps: ['company', 'contact', 'signatory'] },
  { id: 'branding', label: 'Corporate Identity', steps: ['branding', 'stamp'] },
  { id: 'payments', label: 'Payments', steps: ['banking'] },
  { id: 'email', label: 'Email', steps: ['email'] },
  { id: 'workspace', label: 'Account', steps: [] },
];
const TAB_OF = {
  company: 'company', contact: 'company', signatory: 'company',
  branding: 'branding', stamp: 'branding', banking: 'payments', payments: 'payments',
  email: 'email', access: 'workspace', plan: 'workspace', account: 'workspace', workspace: 'workspace',
};

// What each plan is called and what it includes.
const PLAN_SUMMARY = {
  free: { name: 'Demo (Free for 14 Days)', includes: 'Agentrive Workspace + Agentrive Intelligence + Brain with cap limit' },
  pro: { name: 'Basic Model', includes: 'Agentrive Workspace + Agentrive Intelligence (8 Agents) + Brain with cap limit' },
  max: { name: 'Growth Model', includes: 'Agentrive Workspace + Agentrive Intelligence (15 Agents) + Brain' },
  enterprise: { name: 'Enterprise Model', includes: 'Agentrive Workspace + Agentrive Intelligence + Industry Specific Module + Brain' },
};

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
  const { activeOrg, updateOrganization, loading: orgLoading, fetchOrganizations } = useOrg();
  const { user, updatePassword, reauthenticate } = useAuth();
  // A password exists only for people who signed up with an email address.
  // Someone who came in through Google has none here to change.
  const providers = user?.app_metadata?.providers || [user?.app_metadata?.provider].filter(Boolean);
  const googleOnly = providers.length > 0 && !providers.includes('email');

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
  const warn = (name) => {
    if (!touched[name]) return '';
    return warningFor(name, name === 'company_phone' ? splitPhone(form[name]).number : form[name]);
  };

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
  const doneCount = steps.filter((s) => s.done).length;
  const nextStep = steps.find((s) => !s.done);

  const jumpTo = (id, focusField) => {
    setActiveSection(TAB_OF[id] || id);
    setTimeout(() => {
      const target = focusField
        ? document.getElementById(`cp-${focusField}`)
        : document.querySelector('#cp-tabpanel input:not([type=hidden]):not([type=file]), #cp-tabpanel textarea, #cp-tabpanel button.cp-drop');
      if (target) target.focus({ preventScroll: true });
    }, 60);
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

  /* ── saving ────────────────────────────────────────────────────────────── */

  const handleSave = async () => {
    if (!activeOrg || saving) return;
    if (!form.company_name.trim()) { setError('Company name is required.'); jumpTo('company', 'company_name'); return; }
    if (!String(form.company_email || '').trim()) { setError('Contact email is required.'); jumpTo('contact', 'company_email'); return; }
    if (!splitPhone(form.company_phone).number.trim()) { setError('Phone number is required.'); jumpTo('contact', 'company_phone'); return; }
    if (!form.owner_full_name.trim()) { setError('The signatory’s full name is required.'); jumpTo('signatory', 'owner_full_name'); return; }
    if (!String(form.document_designation || '').trim()) { setError('Title on documents is required.'); jumpTo('signatory', 'document_designation'); return; }
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
  const shown = PLAN_SUMMARY[form.plan || DEFAULT_PLAN] || { name: plan.displayName, includes: '' };
  const pct = Math.round((doneCount / steps.length) * 100);
  const stepDone = Object.fromEntries(steps.map((s) => [s.id, s.done]));
  const tabInfo = TABS.map((tb) => {
    const mine = tb.steps.map((id) => stepDone[id]);
    return { ...tb, total: mine.length, done: mine.filter(Boolean).length };
  });
  const tab = TAB_OF[activeSection] || 'company';

  return (
    <Page>
      <div style={{ display: 'grid', gap: 14, maxWidth: 1600, margin: '0 auto', minWidth: 0 }}>

        {/* progress strip */}
        <section style={{
          border: '1px solid ' + t.line, borderRadius: 12, background: t.panelAlt,
          padding: narrow ? 12 : '12px 16px', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10, flexShrink: 0, overflow: 'hidden',
            border: '1px solid ' + t.line, background: t.panel, display: 'grid', placeItems: 'center',
          }}>
            {form.logo_url
              ? <img src={form.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              : <Building2 size={18} strokeWidth={1.6} color={t.faint} />}
          </div>
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 500, letterSpacing: '-0.02em', color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {form.company_name || 'Your company'}
            </div>
            <div style={{ fontSize: 12.5, color: t.dim, marginTop: 2 }}>{doneCount} of {steps.length} steps done</div>
          </div>
          <div style={{ flex: '1 1 160px', maxWidth: 280, minWidth: 120 }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completion">
            <Bar value={doneCount} max={steps.length} height={4} tone={doneCount === steps.length ? t.up : t.text} />
          </div>
          {nextStep && (
            <Btn primary onClick={() => jumpTo(nextStep.id)}>
              {nextStep.todo} <ArrowRight size={13} />
            </Btn>
          )}
        </section>

        {error && <Notice t={t} tone="down" onClose={() => setError('')}>{error}</Notice>}

        {/* tabs */}
        <nav role="tablist" aria-label="Profile sections" className="cp-chips" style={{
          display: 'flex', gap: 4, overflowX: 'auto', borderBottom: '1px solid ' + t.line,
        }}>
          {tabInfo.map((tb) => {
            const on = tb.id === tab;
            const complete = tb.total > 0 && tb.done === tb.total;
            return (
              <button key={tb.id} type="button" role="tab" aria-selected={on} onClick={() => jumpTo(tb.id)} className="cp-tab" style={{
                flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 8, height: 42, padding: '0 14px',
                border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: MONO, fontSize: 13.5,
                color: on ? t.text : t.dim, boxShadow: on ? 'inset 0 -2px 0 ' + t.text : 'none', marginBottom: -1,
              }}>
                {tb.label}
                {tb.total > 0 && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, padding: '1px 7px', borderRadius: 999,
                    border: '1px solid ' + (complete ? t.up : t.line), color: complete ? t.up : t.faint,
                  }}>
                    {complete ? <Check size={10} strokeWidth={2.8} /> : `${tb.done}/${tb.total}`}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div id="cp-tabpanel" role="tabpanel" style={{ display: 'grid', gap: 14, minWidth: 0 }}>

          {tab === 'company' && (
            <PanelGrid min={300}>
              <Panel t={t} title="Company basics" done={stepDone.company}>
                <Fields>
                  <FormField t={t} label="Company name" required htmlFor="cp-company_name" wide>
                    <TextInput t={t} {...bind('company_name')} autoComplete="organization" required />
                  </FormField>
                  <FormField t={t} label="Tagline" htmlFor="cp-company_tagline" wide>
                    <TextInput t={t} {...bind('company_tagline')} />
                  </FormField>
                  <FormField t={t} label="Registered address" htmlFor="cp-company_address" wide>
                    <TextInput t={t} as="textarea" rows={3} {...bind('company_address')} autoComplete="street-address" />
                  </FormField>
                </Fields>
              </Panel>

              <Panel t={t} title="Contact & tax" done={stepDone.contact}>
                <Fields>
                  <FormField t={t} label="Contact email" required htmlFor="cp-company_email" warn={warn('company_email')}>
                    <TextInput t={t} {...bind('company_email')} type="email" inputMode="email" autoComplete="email" />
                  </FormField>
                  <FormField t={t} label="Phone" required htmlFor="cp-company_phone" warn={warn('company_phone')} wide>
                    <PhoneInput t={t} {...bind('company_phone')} onValue={(v) => setField('company_phone', v)} />
                  </FormField>
                  <FormField t={t} label="Website" htmlFor="cp-company_website" warn={warn('company_website')} wide>
                    <TextInput t={t} {...bind('company_website')} inputMode="url" autoComplete="url" />
                  </FormField>
                  <FormField t={t} label="GSTIN" htmlFor="cp-gstin" warn={warn('gstin')}>
                    <TextInput t={t} {...bind('gstin')} maxLength={15} spellCheck={false} mono />
                  </FormField>
                  <FormField t={t} label="CIN" htmlFor="cp-cin" warn={warn('cin')}>
                    <TextInput t={t} {...bind('cin')} maxLength={21} spellCheck={false} mono />
                  </FormField>
                </Fields>
              </Panel>

              <Panel t={t} title="Authorised signatory" done={stepDone.signatory}>
                <Fields>
                  <FormField t={t} label="Full name" required htmlFor="cp-owner_full_name" wide>
                    <TextInput t={t} {...bind('owner_full_name')} autoComplete="name" required />
                  </FormField>
                  <FormField t={t} label="Title on documents" required htmlFor="cp-document_designation" wide>
                    <TextInput t={t} {...bind('document_designation')} list="cp-designations" autoComplete="organization-title" />
                    <datalist id="cp-designations">
                      {['Founder', 'Founder & CEO', 'Director', 'Managing Director', 'CEO', 'HR Manager', 'Head of People'].map((d) => <option key={d} value={d} />)}
                    </datalist>
                  </FormField>
                </Fields>
              </Panel>
            </PanelGrid>
          )}

          {tab === 'branding' && (
            <PanelGrid min={280}>
              <Panel t={t} title="Company logo" done={!!form.logo_url}>
                <Uploader t={t} field="logo_url" label="Logo"
                  url={form.logo_url} busy={uploading.logo_url} height={72}
                  onFile={openFile} onEdit={() => { setEditorImage(form.logo_url); setEditorField('logo_url'); }} onRemove={removeImage} />
              </Panel>
              <Panel t={t} title="Signature" done={!!form.signature_url}>
                <Uploader t={t} field="signature_url" label="Signature"
                  url={form.signature_url} busy={uploading.signature_url} height={72}
                  onFile={openFile} onEdit={() => { setEditorImage(form.signature_url); setEditorField('signature_url'); }} onRemove={removeImage} />
              </Panel>
              <Panel t={t} title="Company stamp" done={stepDone.stamp}>
                <div style={{ marginBottom: 12 }}>
                  <Seg value={form.stamp_type} onChange={(v) => setField('stamp_type', v)}
                    options={[{ id: 'generated', label: 'Generate for me' }, { id: 'uploaded', label: 'Upload my own' }]} />
                </div>
                {form.stamp_type === 'generated' ? (
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <FormField t={t} label="City on the stamp" htmlFor="cp-stamp_city">
                        <TextInput t={t} {...bind('stamp_city')} autoComplete="address-level2" />
                      </FormField>
                    </div>
                    <div style={{
                      width: 104, height: 104, borderRadius: 12, background: '#ffffff', flexShrink: 0,
                      border: '1px solid ' + t.line, display: 'grid', placeItems: 'center',
                    }} aria-label="Stamp preview">
                      <StampPreview companyName={form.company_name} city={form.stamp_city} size={88} />
                    </div>
                  </div>
                ) : (
                  <Uploader t={t} field="stamp_url" label="Stamp image"
                    url={form.stamp_url} busy={uploading.stamp_url} height={72}
                    onFile={openFile} onEdit={() => { setEditorImage(form.stamp_url); setEditorField('stamp_url'); }} onRemove={removeImage} />
                )}
              </Panel>
            </PanelGrid>
          )}

          {tab === 'payments' && (
            <PanelGrid min={320}>
              <Panel t={t} title="UPI" done={!!form.upi_id}>
                <Fields>
                  <FormField t={t} label="UPI ID" htmlFor="cp-upi_id" warn={warn('upi_id')} wide>
                    <TextInput t={t} {...bind('upi_id')} spellCheck={false} autoCapitalize="none" mono />
                  </FormField>
                </Fields>
              </Panel>
              <Panel t={t} title="Bank account" done={!!(form.bank_name && form.bank_account_number && form.bank_ifsc)}>
                <Fields>
                  <FormField t={t} label="Bank name" htmlFor="cp-bank_name">
                    <TextInput t={t} {...bind('bank_name')} />
                  </FormField>
                  <FormField t={t} label="Account type" htmlFor="cp-bank_account_type">
                    <div id="cp-bank_account_type">
                      <Seg value={form.bank_account_type} onChange={(v) => setField('bank_account_type', v)} options={['Current', 'Savings']} />
                    </div>
                  </FormField>
                  <FormField t={t} label="Account number" htmlFor="cp-bank_account_number" warn={warn('bank_account_number')}>
                    <TextInput t={t} {...bind('bank_account_number')} inputMode="numeric" spellCheck={false} mono />
                  </FormField>
                  <FormField t={t} label="IFSC" htmlFor="cp-bank_ifsc" warn={warn('bank_ifsc')}>
                    <TextInput t={t} {...bind('bank_ifsc')} maxLength={11} spellCheck={false} mono />
                  </FormField>
                </Fields>
              </Panel>
            </PanelGrid>
          )}

          {tab === 'email' && (
            <PanelGrid min={340}>
              <Panel t={t} title="Email sending" done={stepDone.email}
                status={!emailStatus.loading && (
                  <StatusLine t={t} ok={emailStatus.configured}>
                    {emailStatus.configured
                      ? `Connected as ${emailStatus.gmail_user}${emailStatus.rotated_at ? ` · saved ${new Date(emailStatus.rotated_at).toLocaleDateString('en-IN')}` : ''}`
                      : 'Not connected — email features are off'}
                  </StatusLine>
                )}>
                <Fields>
                  <FormField t={t} label="Gmail address" htmlFor="cp-gmail_user" warn={warn('gmail_user')}>
                    <TextInput t={t} {...bind('gmail_user')} type="email" inputMode="email" autoComplete="off" />
                  </FormField>
                  <FormField t={t} label="App password" htmlFor="cp-gmail_app_password">
                    <div style={{ position: 'relative' }}>
                      <TextInput t={t} {...bind('gmail_app_password')} type={showAppPassword ? 'text' : 'password'}
                        autoComplete="new-password"
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
              </Panel>
              <Panel t={t} title="How do I get an app password?">
                <ol style={{ margin: 0, padding: '0 0 0 18px', display: 'grid', gap: 8, fontSize: 13.5, lineHeight: 1.6, color: t.dim }}>
                  <li>Turn on <b style={{ color: t.text, fontWeight: 500 }}>2-Step Verification</b> for your Google account. <ExtLink t={t} href="https://myaccount.google.com/signinoptions/two-step-verification">Open 2-Step settings</ExtLink></li>
                  <li>Open <b style={{ color: t.text, fontWeight: 500 }}>App passwords</b>. <ExtLink t={t} href="https://myaccount.google.com/apppasswords">Open App passwords</ExtLink></li>
                  <li>Name it “EdgeOS” and press <b style={{ color: t.text, fontWeight: 500 }}>Create</b>.</li>
                  <li>Copy the 16-character password, paste it here, and press <b style={{ color: t.text, fontWeight: 500 }}>Save & send a test email</b>.</li>
                </ol>
              </Panel>
            </PanelGrid>
          )}

          {tab === 'workspace' && (
            <PanelGrid min={320}>
              <Panel t={t} title="Team access">
                <ActionRow t={t} title="Roles & permissions"
                  action={<Btn onClick={() => navigate('/employees')}>Open Employees <ArrowRight size={13} /></Btn>} />
                <div style={{ height: 1, background: t.lineSoft, margin: '16px 0' }} />
                <SubHead t={t} icon={<KeyRound size={13} />}>Employee portal join code</SubHead>
                <div className="cp-legacy"><PortalJoinCode orgId={activeOrg.id} /></div>
              </Panel>

              <Panel t={t} title="Plan"
                status={<StatusLine t={t} dot={plan.color}>{shown.name}</StatusLine>}>
                <div style={{ fontSize: 13.5, color: t.text, fontWeight: 500 }}>{shown.name}</div>
                <div style={{ fontSize: 13, color: t.dim, marginTop: 6, lineHeight: 1.6 }}>{shown.includes}</div>
                <div style={{ marginTop: 12 }}>
                  <Btn onClick={() => navigate('/pricing')}>Compare plans <ArrowRight size={13} /></Btn>
                </div>
              </Panel>

              <Panel t={t} title="Account & data">
                <div style={{ display: 'grid', gap: 12 }}>
                  <ActionRow t={t} title="Password" note="Change the password you sign in with, when you sign in with an email address."
                    action={!pw.open && <Btn onClick={() => setPw((p) => ({ ...p, open: true }))}><KeyRound size={13} /> Change password</Btn>}>
                    {pw.open && googleOnly && (
                      <div style={{ marginTop: 12 }}>
                        <Notice t={t} tone="down">
                          You signed in with Google, so this account has no email password to change. Manage your password from your Google account.
                        </Notice>
                      </div>
                    )}
                    {pw.open && !googleOnly && (
                      <form onSubmit={handleChangePassword} style={{ marginTop: 12 }}>
                        {pw.error && <div style={{ marginBottom: 10 }}><Notice t={t} tone="down">{pw.error}</Notice></div>}
                        {pw.success && <div style={{ marginBottom: 10 }}><Notice t={t} tone="up">{pw.success}</Notice></div>}
                        <Fields>
                          <FormField t={t} label="Current password" htmlFor="cp-pw-current" wide>
                            <TextInput t={t} id="cp-pw-current" type="password" autoComplete="current-password" required
                              value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} />
                          </FormField>
                          <FormField t={t} label="New password" htmlFor="cp-pw-next">
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
                </div>
              </Panel>
            </PanelGrid>
          )}
        </div>

        {/* ── save bar ───────────────────────────────────────────────── */}
        <div aria-live="polite" style={{
          position: 'sticky', bottom: 0, zIndex: 30, padding: '10px 0 0',
          background: dirty || saving || saved ? `linear-gradient(to bottom, transparent, ${t.panel} 30%)` : 'transparent',
          pointerEvents: dirty || saving || saved ? 'auto' : 'none',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '10px 76px 10px 16px', borderRadius: 12, // right gap keeps the Save button clear of the floating EdgeAI orb
            border: '1px solid ' + t.lineStrong, background: t.panel, boxShadow: t.shadow,
            opacity: dirty || saving || saved ? 1 : 0,
            transform: dirty || saving || saved ? 'none' : 'translateY(10px)',
            transition: 'opacity .18s, transform .22s cubic-bezier(.16,1,.3,1)',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: saved && !dirty ? t.up : t.text }} />
            <span style={{ fontSize: 13.5, color: t.text, flex: 1, minWidth: 140 }}>
              {saved && !dirty ? 'Saved — new documents will use these details.' : 'You have unsaved changes'}
              {!narrow && dirty && <span style={{ color: t.faint, marginLeft: 8, fontSize: 12 }}>Ctrl + S</span>}
            </span>
            {dirty && <Btn onClick={handleDiscard} disabled={saving}>Discard</Btn>}
            {dirty && (
              <Btn primary onClick={handleSave} disabled={saving}>
                {saving ? <><Loader size={13} className="spin-icon" /> Saving…</> : <><Check size={13} /> Save changes</>}
              </Btn>
            )}
          </div>
        </div>
      </div>

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
        .edge-page .cp-tab:hover, .edge-page .cp-iconbtn:hover { color: ${t.text} !important; }
        .edge-page .cp-tab:focus-visible { outline: 2px solid ${t.text}; outline-offset: -2px; border-radius: 6px; }
        .edge-page .cp-chips::-webkit-scrollbar { display: none; }
        .edge-page .cp-legacy { font-family: ${MONO}; }
        .edge-page .cp-legacy table { font-family: ${MONO}; }
        @media (prefers-reduced-motion: reduce) { .edge-page * { transition: none !important; scroll-behavior: auto !important; } }
      `}</style>
    </Page>
  );
}

/* ── pieces ──────────────────────────────────────────────────────────────── */

function PanelGrid({ min = 300, children }) {
  return (
    <div style={{ display: 'grid', gap: 14, alignItems: 'start', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))` }}>
      {children}
    </div>
  );
}

function Panel({ t, title, desc, done, status, children }) {
  return (
    <section style={{ border: '1px solid ' + t.line, borderRadius: 12, background: t.panel, minWidth: 0 }}>
      <header style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', padding: '14px 16px 12px', borderBottom: '1px solid ' + t.lineSoft }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500, letterSpacing: '-0.01em', color: t.text, display: 'flex', alignItems: 'center', gap: 8 }}>
            {title}
            {done !== undefined && (
              <span style={{ fontSize: 11.5, fontWeight: 400, color: done ? t.up : t.faint, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {done ? <><Check size={11} strokeWidth={2.6} /> Done</> : ''}
              </span>
            )}
          </h2>
          {desc && <p style={{ margin: '4px 0 0', fontSize: 12.5, color: t.dim, lineHeight: 1.5 }}>{desc}</p>}
        </div>
        {status}
      </header>
      <div style={{ padding: 16 }}>{children}</div>
    </section>
  );
}

function Fields({ children }) {
  return (
    <div style={{ display: 'grid', gap: '14px 14px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))' }}>
      {children}
    </div>
  );
}

function FormField({ t, label, required, hint, warn, htmlFor, wide, children }) {
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;
  return (
    <div style={{ minWidth: 0, gridColumn: wide ? '1 / -1' : undefined }}>
      <label htmlFor={htmlFor} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 13, color: t.text, marginBottom: 6 }}>
        {label}
        {required && <span aria-hidden="true" style={{ color: t.down }}>*</span>}
      </label>
      {children}
      {(warn || hint) && (
        <div id={hintId} role={warn ? 'alert' : undefined} style={{
          display: 'flex', gap: 5, alignItems: 'flex-start', fontSize: 12, lineHeight: 1.5, marginTop: 5,
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
        color: t.text, fontFamily: MONO, fontSize: 14.5, outline: 'none',
        letterSpacing: mono ? '0.04em' : undefined,
        resize: Tag === 'textarea' ? 'vertical' : undefined, lineHeight: 1.55,
        ...style,
      }}
    />
  );
}

function PhoneInput({ t, value, onValue, onBlur, id, name }) {
  const { code, number } = splitPhone(value);
  const join = (c, n) => (n.trim() ? `+${c} ${n.trim()}` : (c === DEFAULT_DIAL ? '' : `+${c}`));
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <select
        aria-label="Country code" value={code} onBlur={onBlur}
        onChange={(e) => onValue(join(e.target.value, number))}
        className="edge-input cp-input"
        style={{
          width: 104, flexShrink: 0, height: 40, padding: '0 8px', boxSizing: 'border-box',
          background: t.panelAlt, border: '1px solid ' + t.line, borderRadius: 8,
          color: t.text, fontFamily: MONO, fontSize: 14.5, outline: 'none',
        }}
      >
        {DIAL_OPTIONS.map((o) => <option key={o.code} value={o.code}>{`${o.iso} +${o.code}`}</option>)}
      </select>
      <TextInput t={t} id={id} name={name} type="tel" inputMode="tel" autoComplete="tel-national"
        value={number} onBlur={onBlur} onChange={(e) => onValue(join(code, e.target.value))}
        style={{ flex: 1, minWidth: 0 }} />
    </div>
  );
}

function Uploader({ t, field, label, hint, url, busy, height, onFile, onEdit, onRemove }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const pick = () => inputRef.current?.click();
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 13, color: t.text, marginBottom: 6 }}>{label}</div>
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
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: url ? '#6b7275' : t.dim }}>
            <Loader size={14} className="spin-icon" /> Uploading…
          </span>
        ) : url ? (
          <img src={url} alt={label} style={{ maxHeight: height, maxWidth: '100%', objectFit: 'contain' }} />
        ) : (
          <>
            <Upload size={18} strokeWidth={1.7} color={t.dim} />
            <span style={{ fontSize: 13.5, color: t.text }}>Click to choose, or drop an image</span>
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
          <span style={{ fontSize: 12, color: t.faint, lineHeight: 1.5 }}>{hint}</span>
        )}
      </div>
    </div>
  );
}

function StatusLine({ t, ok, dot, children }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: t.dim,
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
      fontSize: 13.5, lineHeight: 1.5, color: t.text,
    }}>
      {tone === 'up'
        ? <Check size={14} color={color} style={{ marginTop: 2, flexShrink: 0 }} />
        : <XCircle size={14} color={color} style={{ marginTop: 2, flexShrink: 0 }} />}
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="cp-iconbtn" style={{
          border: 'none', background: 'transparent', color: t.faint, cursor: 'pointer', fontSize: 16.5, lineHeight: 1, padding: '0 2px',
        }}>×</button>
      )}
    </div>
  );
}

function SubHead({ t, icon, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, color: t.text, marginBottom: 10 }}>
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
          <div style={{ fontSize: 14, color: t.text }}>{title}</div>
          
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

