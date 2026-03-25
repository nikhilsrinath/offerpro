import { useState, useEffect } from 'react';
import { Upload, CheckCircle, Save, Loader, AlertCircle, Pencil, Sun, Moon, Mail, Zap, XCircle } from 'lucide-react';
import { useOrg } from '../context/OrgContext';
import { emailService } from '../services/emailService';

import StampPreview from './StampPreview';
import ImageEditor from './ImageEditor';

export default function CompanyProfile({ theme, onToggleTheme }) {
  const { activeOrg, updateOrganization } = useOrg();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingSig, setUploadingSig] = useState(false);
  const [uploadingStamp, setUploadingStamp] = useState(false);
  const [editorImage, setEditorImage] = useState(null);
  const [editorField, setEditorField] = useState('');
  const [testingEmail, setTestingEmail] = useState(false);
  const [testResult, setTestResult] = useState(null);

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
    logo_url: '',
    signature_url: '',
    stamp_type: 'generated',
    stamp_url: '',
    stamp_city: '',
    emailjs_service_id: '',
    emailjs_template_id: '',
    emailjs_public_key: '',
  });

  useEffect(() => {
    if (activeOrg) {
      setForm({
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
        logo_url: activeOrg.logo_url || '',
        signature_url: activeOrg.signature_url || '',
        stamp_type: activeOrg.stamp_type || 'generated',
        stamp_url: activeOrg.stamp_url || '',
        stamp_city: activeOrg.stamp_city || '',
        emailjs_service_id: activeOrg.emailjs_service_id || '',
        emailjs_template_id: activeOrg.emailjs_template_id || '',
        emailjs_public_key: activeOrg.emailjs_public_key || '',
      });
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
      serviceId: form.emailjs_service_id,
      templateId: form.emailjs_template_id,
      publicKey: form.emailjs_public_key,
    });
    setTestResult(result);
    setTestingEmail(false);
    setTimeout(() => setTestResult(null), 8000);
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

      {/* 2. Authorized Person */}
      <div className="easy-section">
        <div className="easy-section-head">
          <div className="easy-num">2</div>
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

      {/* 3. Branding */}
      <div className="easy-section">
        <div className="easy-section-head">
          <div className="easy-num">3</div>
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

      {/* 4. Company Stamp */}
      <div className="easy-section">
        <div className="easy-section-head">
          <div className="easy-num">4</div>
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

      {/* 5. Appearance */}
      <div className="easy-section">
        <div className="easy-section-head">
          <div className="easy-num">5</div>
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

      {/* 6. Email Integration */}
      <div className="easy-section">
        <div className="easy-section-head">
          <div className="easy-num">6</div>
          <span className="easy-section-title">Email Integration</span>
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1.25rem', lineHeight: 1.6 }}>
          Send offer letters directly to employees via email using <strong>EmailJS</strong> — a free service that works right from the browser. No backend or scripts needed.
        </p>

        <div className="easy-row">
          <div className="easy-field">
            <label className="easy-lbl">Service ID</label>
            <input
              name="emailjs_service_id"
              value={form.emailjs_service_id}
              onChange={handleChange}
              placeholder="e.g. service_abc123"
              className="easy-inp"
              style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}
            />
          </div>
          <div className="easy-field">
            <label className="easy-lbl">Template ID</label>
            <input
              name="emailjs_template_id"
              value={form.emailjs_template_id}
              onChange={handleChange}
              placeholder="e.g. template_xyz789"
              className="easy-inp"
              style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}
            />
          </div>
        </div>
        <div className="easy-row">
          <div className="easy-field full">
            <label className="easy-lbl">Public Key</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                name="emailjs_public_key"
                value={form.emailjs_public_key}
                onChange={handleChange}
                placeholder="e.g. user_aBcDeFgHiJk"
                className="easy-inp"
                style={{ fontFamily: 'monospace', fontSize: '0.8125rem', flex: 1 }}
              />
              <button
                type="button"
                onClick={handleTestEmail}
                disabled={!form.emailjs_service_id || !form.emailjs_template_id || !form.emailjs_public_key || testingEmail}
                style={{
                  padding: '0 1rem', borderRadius: '10px', border: '1px solid var(--border-default)',
                  background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontWeight: 600,
                  fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'var(--font-main)',
                  display: 'flex', alignItems: 'center', gap: '0.375rem', whiteSpace: 'nowrap',
                  opacity: (!form.emailjs_service_id || !form.emailjs_template_id || !form.emailjs_public_key) ? 0.4 : 1,
                }}
              >
                {testingEmail ? <><Loader size={13} className="spin-icon" /> Testing</> : <><Zap size={13} /> Test</>}
              </button>
            </div>
          </div>
        </div>

        {testResult && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
            marginTop: '0.75rem', padding: '0.75rem 1rem',
            background: testResult.success ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
            border: `1px solid ${testResult.success ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}`,
            borderRadius: '8px', fontSize: '0.8125rem',
            color: testResult.success ? '#10b981' : '#ef4444', fontWeight: 600
          }}>
            {testResult.success ? <CheckCircle size={14} style={{ marginTop: '1px', flexShrink: 0 }} /> : <XCircle size={14} style={{ marginTop: '1px', flexShrink: 0 }} />}
            <span>{testResult.message}</span>
          </div>
        )}

        <div style={{
          background: 'var(--bg-raised)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
          padding: '1rem 1.25rem',
          marginTop: '0.75rem',
          fontSize: '0.8125rem',
          lineHeight: 1.7,
          color: 'var(--text-secondary)'
        }}>
          <strong style={{ color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.5rem' }}>
            <Mail size={14} /> Setup Instructions (5 min)
          </strong>
          <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
            <li>Go to <a href="https://www.emailjs.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>emailjs.com</a> and <strong>create a free account</strong></li>
            <li>Click <strong>"Add New Service"</strong> → choose <strong>Gmail</strong> → connect your Gmail account → note the <strong>Service ID</strong></li>
            <li>Go to <strong>"Email Templates"</strong> → click <strong>"Create New Template"</strong></li>
            <li>Set <strong>Subject</strong> to: <code style={{ background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: '4px', fontSize: '0.75rem' }}>{'{{subject}}'}</code></li>
            <li>Set <strong>Body</strong> (Content) to: <code style={{ background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: '4px', fontSize: '0.75rem' }}>{'{{{message}}}'}</code> <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>(triple braces for HTML)</span></li>
            <li>In <strong>"To Email"</strong> field, put: <code style={{ background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: '4px', fontSize: '0.75rem' }}>{'{{to_email}}'}</code></li>
            <li>Click <strong>Save</strong> → note the <strong>Template ID</strong></li>
            <li>Go to <strong>Account → General</strong> → copy your <strong>Public Key</strong></li>
            <li>Paste all three values above → click <strong>Test</strong></li>
          </ol>

          <div style={{
            marginTop: '0.75rem', padding: '0.75rem 1rem',
            background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.12)',
            borderRadius: '8px', fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.6
          }}>
            <strong style={{ color: '#3b82f6' }}>Free tier:</strong> 200 emails/month, 2 templates. More than enough for most teams.
          </div>
        </div>
      </div>

      {/* Save */}
      <button type="submit" className="easy-submit" disabled={saving}>
        {saving ? <><Loader size={16} className="spin-icon" /> Saving...</>
          : saved ? <><CheckCircle size={16} /> Saved</>
          : <><Save size={16} /> Save profile</>}
      </button>

      <style>{`.spin-icon { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
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
