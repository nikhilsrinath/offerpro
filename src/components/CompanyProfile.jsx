import { useState, useEffect } from 'react';
import { Upload, CheckCircle, Save, Loader, AlertCircle, Pencil, Sun, Moon, Mail, Zap, XCircle, Key } from 'lucide-react';
import { useOrg } from '../context/OrgContext';
import { useAuth } from '../context/AuthContext';
import { emailService } from '../services/emailService';

import StampPreview from './StampPreview';
import ImageEditor from './ImageEditor';

export default function CompanyProfile({ theme, onToggleTheme }) {
  const { activeOrg, updateOrganization } = useOrg();
  const { user, updatePassword, reauthenticate } = useAuth();
  const [saving, setSaving] = useState(false);
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingSig, setUploadingSig] = useState(false);
  const [uploadingStamp, setUploadingStamp] = useState(false);
  const [editorImage, setEditorImage] = useState(null);
  const [editorField, setEditorField] = useState('');
  const [testingEmail, setTestingEmail] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const [form, setForm] = useState({
    company_name: '',
    company_tagline: '',
    company_address: '',
    owner_full_name: '',
    document_designation: '',
    company_email: '',
    company_phone: '',
    company_website: '',
    gstin: '',
    cin: '',
    upi_id: '',
    bank_name: '',
    bank_account_number: '',
    bank_ifsc: '',
    bank_account_type: 'Current',
    logo_url: '',
    signature_url: '',
    stamp_type: 'generated',
    stamp_url: '',
    stamp_city: '',
    emailjs_service_id: '',
    emailjs_template_id: '',
    emailjs_public_key: '',
    gmail_user: '',
    gmail_app_password: '',
    plan: 'free',
  });

  useEffect(() => {
    if (activeOrg) {
      const formData = {
        company_name: activeOrg.company_name || '',
        company_tagline: activeOrg.company_tagline || '',
        company_address: activeOrg.company_address || '',
        owner_full_name: activeOrg.owner_full_name || '',
        document_designation: activeOrg.document_designation || '',
        company_email: activeOrg.company_email || '',
        company_phone: activeOrg.company_phone || '',
        company_website: activeOrg.company_website || '',
        gstin: activeOrg.gstin || '',
        cin: activeOrg.cin || '',
        upi_id: activeOrg.upi_id || '',
        bank_name: activeOrg.bank_name || '',
        bank_account_number: activeOrg.bank_account_number || '',
        bank_ifsc: activeOrg.bank_ifsc || '',
        bank_account_type: activeOrg.bank_account_type || 'Current',
        logo_url: activeOrg.logo_url || '',
        signature_url: activeOrg.signature_url || '',
        stamp_type: activeOrg.stamp_type || 'generated',
        stamp_url: activeOrg.stamp_url || '',
        stamp_city: activeOrg.stamp_city || '',
        emailjs_service_id: activeOrg.emailjs_service_id || '',
        emailjs_template_id: activeOrg.emailjs_template_id || '',
        emailjs_public_key: activeOrg.emailjs_public_key || '',
        gmail_user: activeOrg.gmail_user || '',
        gmail_app_password: activeOrg.gmail_app_password || '',
        plan: activeOrg.plan || 'free',
      };
      setForm(formData);
      // orgStore handles caching — no localStorage write needed
    }
  }, [activeOrg]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    setSaved(false);
  };

  const handleImageUpload = (e, field) => {
    const file = e.target.files[0];
    if (!file) return;
    // Read file to base64 and open editor
    const reader = new FileReader();
    reader.onload = () => {
      setEditorImage(reader.result);
      setEditorField(field);
    };
    reader.readAsDataURL(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  };

  const handleEditorSave = (editedBase64) => {
    const field = editorField;
    setEditorImage(null);
    setEditorField('');
    setForm(prev => ({ ...prev, [field]: editedBase64 }));
    setSaved(false);
  };

  const handleEditorCancel = () => {
    setEditorImage(null);
    setEditorField('');
  };

  const openEditorForExisting = (field) => {
    const url = form[field];
    if (url) {
      setEditorImage(url);
      setEditorField(field);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!activeOrg) return;
    setSaving(true);
    setError('');
    try {
      await updateOrganization(activeOrg.id, form);
      // orgStore cache is updated via updateOrganization → orgStore.updateProfile
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    setTestingEmail(true);
    setTestResult(null);
    const result = await emailService.testConnection({
      gmailUser: form.gmail_user,
      appPassword: form.gmail_app_password,
    });
    setTestResult(result);
    setTestingEmail(false);
    setTimeout(() => setTestResult(null), 8000);
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    setChangingPassword(true);
    try {
      await reauthenticate(currentPassword);
      await updatePassword(newPassword);
      setPasswordSuccess('Password updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setShowPasswordChange(false);
        setPasswordSuccess('');
      }, 2000);
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setPasswordError('Current password is incorrect');
      } else {
        setPasswordError(err.message || 'Failed to update password');
      }
    } finally {
      setChangingPassword(false);
    }
  };

  if (!activeOrg) return null;

  return (
    <>
    <form onSubmit={handleSave} className="easy-form animate-in">

      <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '2rem', lineHeight: 1.6 }}>
        These details are auto-filled into all your documents — offer letters, invoices, MoUs, and certificates.
      </p>

      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px',
          marginBottom: '1.5rem', fontSize: '0.8125rem', color: '#f87171'
        }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* 1. Company */}
      <div className="easy-section">
        <div className="easy-section-head">
          <div className="easy-num">1</div>
          <span className="easy-section-title">Company information</span>
        </div>
        <div className="easy-row">
          <div className="easy-field full">
            <label className="easy-lbl">Company name</label>
            <input name="company_name" value={form.company_name} onChange={handleChange}
              required placeholder="Acme International Ltd." className="easy-inp" />
          </div>
          <div className="easy-field full">
            <label className="easy-lbl">Company tagline</label>
            <input name="company_tagline" value={form.company_tagline} onChange={handleChange}
              placeholder="e.g. Innovation Meets Excellence" className="easy-inp" />
          </div>
          <div className="easy-field full">
            <label className="easy-lbl">Registered address</label>
            <textarea name="company_address" value={form.company_address} onChange={handleChange}
              placeholder="Full registered office address" rows={2} className="easy-inp" style={{ resize: 'none' }} />
          </div>
          <div className="easy-field">
            <label className="easy-lbl">Company email</label>
            <input type="email" name="company_email" value={form.company_email} onChange={handleChange}
              placeholder="hello@company.com" className="easy-inp" />
          </div>
          <div className="easy-field">
            <label className="easy-lbl">Company phone</label>
            <input name="company_phone" value={form.company_phone} onChange={handleChange}
              placeholder="+91 ..." className="easy-inp" />
          </div>
          <div className="easy-field">
            <label className="easy-lbl">Website</label>
            <input name="company_website" value={form.company_website} onChange={handleChange}
              placeholder="https://..." className="easy-inp" />
          </div>
          <div className="easy-field">
            <label className="easy-lbl">GSTIN</label>
            <input name="gstin" value={form.gstin} onChange={handleChange}
              placeholder="22AAAAA0000A1Z5" maxLength={15} className="easy-inp"
              style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }} />
          </div>
          <div className="easy-field">
            <label className="easy-lbl">CIN (Corporate Identity Number)</label>
            <input name="cin" value={form.cin} onChange={handleChange}
              placeholder="U12345MH2020PTC123456" maxLength={21} className="easy-inp"
              style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }} />
          </div>
        </div>
      </div>

      {/* 2. Plan Limits - Read Only */}
      <div className="easy-section">
        <div className="easy-section-head">
          <div className="easy-num">2</div>
          <span className="easy-section-title">Current Plan: {form.plan === 'free' ? 'Free' : form.plan === 'pro' ? 'Pro' : 'Max'}</span>
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
          Your current plan limits. Contact admin to upgrade.
        </p>

        {/* Plan Features Summary */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '0.75rem',
          padding: '1rem',
          background: 'var(--bg-elevated)',
          borderRadius: '10px',
          border: '1px solid var(--border-subtle)'
        }}>
          {(() => {
            const planLimits = {
              free: { offerLetters: 5, mou: 1, nda: 1, invoices: 5, quotations: 5, aiMessages: 10 },
              pro: { offerLetters: 25, mou: 5, nda: 5, invoices: 20, quotations: 20, aiMessages: 50 },
              max: { offerLetters: '∞', mou: '∞', nda: '∞', invoices: '∞', quotations: '∞', aiMessages: '∞' }
            };
            const limits = planLimits[form.plan] || planLimits.free;
            const features = [
              { label: 'Offer Letters', value: limits.offerLetters },
              { label: 'MoU / NDA', value: limits.mou },
              { label: 'Invoices', value: limits.invoices },
              { label: 'Quotations', value: limits.quotations },
              { label: 'AI Messages', value: limits.aiMessages },
            ];
            return features.map((f, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>{f.label}</div>
                <div style={{ fontSize: '1.125rem', fontWeight: 700, color: form.plan === 'max' ? '#10b981' : 'var(--text-primary)' }}>{f.value}</div>
              </div>
            ));
          })()}
        </div>
      </div>

      {/* 3. Payment & Banking */}
      <div className="easy-section">
        <div className="easy-section-head">
          <div className="easy-num">3</div>
          <span className="easy-section-title">Payment & Banking</span>
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
          These details are used to generate UPI QR codes and display bank info on invoices, quotations, and the recipient portal.
        </p>
        <div className="easy-row">
          <div className="easy-field">
            <label className="easy-lbl">UPI ID</label>
            <input name="upi_id" value={form.upi_id} onChange={handleChange}
              placeholder="yourname@upi" className="easy-inp"
              style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }} />
          </div>
          <div className="easy-field">
            <label className="easy-lbl">Bank name</label>
            <input name="bank_name" value={form.bank_name} onChange={handleChange}
              placeholder="e.g. HDFC Bank" className="easy-inp" />
          </div>
          <div className="easy-field">
            <label className="easy-lbl">Account number</label>
            <input name="bank_account_number" value={form.bank_account_number} onChange={handleChange}
              placeholder="e.g. 1234567890123" className="easy-inp"
              style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }} />
          </div>
          <div className="easy-field">
            <label className="easy-lbl">IFSC code</label>
            <input name="bank_ifsc" value={form.bank_ifsc} onChange={handleChange}
              placeholder="e.g. HDFC0001234" className="easy-inp"
              style={{ textTransform: 'uppercase', fontFamily: 'monospace', letterSpacing: '0.05em' }} />
          </div>
          <div className="easy-field">
            <label className="easy-lbl">Account type</label>
            <select name="bank_account_type" value={form.bank_account_type} onChange={handleChange} className="easy-inp">
              <option value="Current">Current</option>
              <option value="Savings">Savings</option>
            </select>
          </div>
        </div>
      </div>

      {/* 4. Authorized Person */}
      <div className="easy-section">
        <div className="easy-section-head">
          <div className="easy-num">4</div>
          <span className="easy-section-title">Authorized person</span>
        </div>
        <div className="easy-row">
          <div className="easy-field">
            <label className="easy-lbl">Full name</label>
            <input name="owner_full_name" value={form.owner_full_name} onChange={handleChange}
              required placeholder="John Doe" className="easy-inp" />
          </div>
          <div className="easy-field">
            <label className="easy-lbl">Designation on documents</label>
            <input name="document_designation" value={form.document_designation} onChange={handleChange}
              placeholder="Founder / HR Manager / CEO" className="easy-inp" />
          </div>
        </div>
      </div>

      {/* 5. Branding */}
      <div className="easy-section">
        <div className="easy-section-head">
          <div className="easy-num">5</div>
          <span className="easy-section-title">Logo & signature</span>
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
          Upload your company logo and authorized signature. These will be hosted online and auto-filled into every document you create.
        </p>
        <div className="easy-row">
          {/* Logo */}
          <div className="easy-field">
            <label className="easy-lbl">Company logo</label>
            {form.logo_url && (
              <div className="img-preview-wrap">
                <img src={form.logo_url} alt="Logo" style={{ maxHeight: '64px', maxWidth: '100%', objectFit: 'contain' }} />
                <button type="button" className="edit-btn" onClick={() => openEditorForExisting('logo_url')} title="Edit image">
                  <Pencil size={14} />
                </button>
              </div>
            )}
            <div className="easy-upload-wrap">
              <input type="file" onChange={(e) => handleImageUpload(e, 'logo_url')} accept="image/*" disabled={uploadingLogo} />
              <div className={`easy-upload ${form.logo_url ? 'done' : ''}`}>
                {uploadingLogo ? <><Loader size={16} className="spin-icon" /> Uploading...</>
                  : form.logo_url ? <><CheckCircle size={16} /> Change logo</>
                  : <><Upload size={16} /> Upload logo</>}
              </div>
            </div>
          </div>

          {/* Signature */}
          <div className="easy-field">
            <label className="easy-lbl">Authorized signature</label>
            {form.signature_url && (
              <div className="img-preview-wrap">
                <img src={form.signature_url} alt="Signature" style={{ maxHeight: '48px', maxWidth: '100%', objectFit: 'contain' }} />
                <button type="button" className="edit-btn" onClick={() => openEditorForExisting('signature_url')} title="Edit image">
                  <Pencil size={14} />
                </button>
              </div>
            )}
            <div className="easy-upload-wrap">
              <input type="file" onChange={(e) => handleImageUpload(e, 'signature_url')} accept="image/*" disabled={uploadingSig} />
              <div className={`easy-upload ${form.signature_url ? 'done' : ''}`}>
                {uploadingSig ? <><Loader size={16} className="spin-icon" /> Uploading...</>
                  : form.signature_url ? <><CheckCircle size={16} /> Change signature</>
                  : <><Upload size={16} /> Upload signature</>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 6. Company Stamp */}
      <div className="easy-section">
        <div className="easy-section-head">
          <div className="easy-num">6</div>
          <span className="easy-section-title">Company stamp</span>
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
          Add a company stamp to your documents. Auto-generate a circular stamp or upload a custom image.
        </p>

        <div className="stamp-type-toggle" style={{ marginBottom: '1.25rem' }}>
          <button type="button"
            className={`stamp-type-toggle-btn ${form.stamp_type === 'generated' ? 'active' : ''}`}
            onClick={() => { setForm(prev => ({ ...prev, stamp_type: 'generated' })); setSaved(false); }}>
            Auto-generate
          </button>
          <button type="button"
            className={`stamp-type-toggle-btn ${form.stamp_type === 'uploaded' ? 'active' : ''}`}
            onClick={() => { setForm(prev => ({ ...prev, stamp_type: 'uploaded' })); setSaved(false); }}>
            Upload custom
          </button>
        </div>

        {form.stamp_type === 'generated' ? (
          <div className="easy-row">
            <div className="easy-field">
              <label className="easy-lbl">City (shown on stamp)</label>
              <input name="stamp_city" value={form.stamp_city} onChange={handleChange}
                placeholder="e.g. Chennai" className="easy-inp" />
            </div>
            <div className="easy-field full">
              <label className="easy-lbl">Stamp preview</label>
              <div className="stamp-preview-box">
                <StampPreview
                  companyName={form.company_name}
                  city={form.stamp_city}
                  size={160}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="easy-row">
            <div className="easy-field">
              <label className="easy-lbl">Upload stamp image</label>
              {form.stamp_url && (
                <div className="img-preview-wrap">
                  <img src={form.stamp_url} alt="Stamp" style={{ maxHeight: '100px', maxWidth: '100%', objectFit: 'contain' }} />
                  <button type="button" className="edit-btn" onClick={() => openEditorForExisting('stamp_url')} title="Edit image">
                    <Pencil size={14} />
                  </button>
                </div>
              )}
              <div className="easy-upload-wrap">
                <input type="file" onChange={(e) => handleImageUpload(e, 'stamp_url')} accept="image/*" disabled={uploadingStamp} />
                <div className={`easy-upload ${form.stamp_url ? 'done' : ''}`}>
                  {uploadingStamp ? <><Loader size={16} className="spin-icon" /> Uploading...</>
                    : form.stamp_url ? <><CheckCircle size={16} /> Change stamp</>
                    : <><Upload size={16} /> Upload stamp</>}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 7. Appearance */}
      <div className="easy-section">
        <div className="easy-section-head">
          <div className="easy-num">7</div>
          <span className="easy-section-title">Appearance</span>
        </div>
        <div className="theme-toggle-row">
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>Theme</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Switch between light and dark mode</div>
          </div>
          <button type="button" className="theme-toggle-btn" onClick={onToggleTheme} aria-label="Toggle theme">
            <div className={`theme-toggle-track ${theme === 'dark' ? 'dark' : ''}`}>
              <Sun size={14} className="theme-toggle-icon sun" />
              <Moon size={14} className="theme-toggle-icon moon" />
              <div className="theme-toggle-thumb" />
            </div>
          </button>
        </div>
      </div>

      {/* 8. Email Configuration (Gmail SMTP) */}
      <div className="easy-section">
        <div className="easy-section-head">
          <div className="easy-num">8</div>
          <span className="easy-section-title">Email Configuration</span>
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1.25rem', lineHeight: 1.6 }}>
          Connect your Gmail to send offer letters, notifications, and follow-ups directly from EdgeOS. All email features in the app use this one connection.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1fr) minmax(0,1fr)', gap: '1.25rem' }}>
          {/* Left: form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', minWidth: 0 }}>
            <div className="easy-field">
              <label className="easy-lbl">Gmail Address</label>
              <input
                name="gmail_user"
                type="email"
                value={form.gmail_user}
                onChange={handleChange}
                placeholder="you@gmail.com"
                className="easy-inp"
                autoComplete="off"
              />
            </div>

            <div className="easy-field">
              <label className="easy-lbl">
                App Password
                <span style={{ fontSize: '0.6875rem', fontWeight: 500, color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                  16 characters from Google
                </span>
              </label>
              <input
                name="gmail_app_password"
                type="password"
                value={form.gmail_app_password}
                onChange={handleChange}
                placeholder="xxxx xxxx xxxx xxxx"
                className="easy-inp"
                autoComplete="new-password"
                style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }}
              />
              <p style={{ margin: '0.375rem 0 0', fontSize: '0.6875rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Stored securely in your organization profile. Never displayed after saving.
              </p>
            </div>

            <button
              type="button"
              onClick={handleTestEmail}
              disabled={!form.gmail_user || !form.gmail_app_password || testingEmail}
              style={{
                padding: '0.625rem 1rem', borderRadius: '10px', border: '1px solid var(--border-default)',
                background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontWeight: 600,
                fontSize: '0.8125rem', cursor: (!form.gmail_user || !form.gmail_app_password) ? 'not-allowed' : 'pointer',
                fontFamily: 'var(--font-main)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: '0.5rem',
                opacity: (!form.gmail_user || !form.gmail_app_password) ? 0.4 : 1,
              }}
            >
              {testingEmail ? <><Loader size={14} className="spin-icon" /> Sending test email…</> : <><Zap size={14} /> Send Test Email</>}
            </button>

            {testResult && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                padding: '0.75rem 1rem',
                background: testResult.success ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
                border: `1px solid ${testResult.success ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}`,
                borderRadius: '8px', fontSize: '0.8125rem',
                color: testResult.success ? '#10b981' : '#ef4444', fontWeight: 600, lineHeight: 1.5,
              }}>
                {testResult.success
                  ? <CheckCircle size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
                  : <XCircle    size={14} style={{ marginTop: '2px', flexShrink: 0 }} />}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>

          {/* Right: instructions */}
          <div style={{
            background: 'var(--bg-raised)', border: '1px solid var(--border-subtle)',
            borderRadius: '10px', padding: '1rem 1.25rem',
            fontSize: '0.8125rem', lineHeight: 1.7, color: 'var(--text-secondary)', minWidth: 0,
          }}>
            <strong style={{
              color: 'var(--text-primary)', display: 'flex', alignItems: 'center',
              gap: '0.375rem', marginBottom: '0.625rem',
            }}>
              <Key size={14} /> How to get an App Password
            </strong>
            <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <li>
                Enable <strong>2-Step Verification</strong> on your Google account (required to generate App Passwords).{' '}
                <a href="https://myaccount.google.com/signinoptions/two-step-verification" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>
                  Open 2-Step settings
                </a>
              </li>
              <li>
                Go to <strong>Google Account → Security → App Passwords</strong>.{' '}
                <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>
                  Open App Passwords
                </a>
              </li>
              <li>
                Type any app name (e.g. "EdgeOS") and click <strong>Create</strong>.
              </li>
              <li>
                Copy the <strong>16-character password</strong> Google gives you.
              </li>
              <li>
                Paste it into the <strong>App Password</strong> field on the left and hit <strong>Send Test Email</strong>.
              </li>
            </ol>

            <div style={{
              marginTop: '0.875rem', padding: '0.625rem 0.875rem',
              background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.12)',
              borderRadius: '8px', fontSize: '0.75rem', lineHeight: 1.55,
            }}>
              <strong style={{ color: '#3b82f6' }}>Note:</strong> App Passwords are different from your Google login password. They can be revoked anytime from the same Google page.
            </div>
          </div>
        </div>
      </div>

      {/* 9. Account Settings */}
      <div className="easy-section">
        <div className="easy-section-head">
          <div className="easy-num">9</div>
          <span className="easy-section-title">Account Settings</span>
        </div>
        {!showPasswordChange ? (
          <button
            type="button"
            onClick={() => setShowPasswordChange(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem 1rem',
              background: 'var(--bg-raised)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '10px',
              color: 'var(--text-secondary)',
              fontSize: '0.875rem',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <Key size={16} />
            Change Password
          </button>
        ) : (
          <form onSubmit={handleChangePassword} style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '10px',
            padding: '1.25rem'
          }}>
            {passwordError && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px',
                marginBottom: '1rem', fontSize: '0.8125rem', color: '#f87171'
              }}>
                <AlertCircle size={14} /> {passwordError}
              </div>
            )}
            {passwordSuccess && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.75rem 1rem', background: 'rgba(34,197,94,0.08)',
                border: '1px solid rgba(34,197,94,0.2)', borderRadius: '8px',
                marginBottom: '1rem', fontSize: '0.8125rem', color: '#22c55e'
              }}>
                <CheckCircle size={14} /> {passwordSuccess}
              </div>
            )}
            <div className="easy-row">
              <div className="easy-field">
                <label className="easy-lbl">Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  placeholder="Enter current password"
                  className="easy-inp"
                />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="Enter new password"
                  className="easy-inp"
                />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="Confirm new password"
                  className="easy-inp"
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button type="submit" className="easy-submit" disabled={changingPassword}>
                {changingPassword ? <><Loader size={14} className="spin-icon" /> Updating...</> : 'Update Password'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPasswordChange(false);
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                  setPasswordError('');
                }}
                style={{
                  padding: '0.625rem 1.25rem',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '10px',
                  color: 'var(--text-secondary)',
                  fontSize: '0.875rem',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Save */}
      <button type="submit" className="easy-submit" disabled={saving}>
        {saving ? <><Loader size={16} className="spin-icon" /> Saving...</>
          : saved ? <><CheckCircle size={16} /> Saved</>
          : <><Save size={16} /> Save profile</>}
      </button>

    </form>

    {editorImage && (
      <ImageEditor
        imageSrc={editorImage}
        onSave={handleEditorSave}
        onCancel={handleEditorCancel}
      />
    )}
    </>
  );
}
