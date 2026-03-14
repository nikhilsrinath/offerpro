import { useState, useEffect } from 'react';
import { Upload, CheckCircle, Save, Loader, AlertCircle } from 'lucide-react';
import { useOrg } from '../context/OrgContext';
import { uploadImage } from '../services/imageUploadService';

export default function CompanyProfile() {
  const { activeOrg, updateOrganization } = useOrg();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingSig, setUploadingSig] = useState(false);

  const [form, setForm] = useState({
    company_name: '',
    company_address: '',
    owner_full_name: '',
    document_designation: '',
    company_email: '',
    company_phone: '',
    company_website: '',
    gstin: '',
    logo_url: '',
    signature_url: '',
  });

  useEffect(() => {
    if (activeOrg) {
      setForm({
        company_name: activeOrg.company_name || '',
        company_address: activeOrg.company_address || '',
        owner_full_name: activeOrg.owner_full_name || '',
        document_designation: activeOrg.document_designation || '',
        company_email: activeOrg.company_email || '',
        company_phone: activeOrg.company_phone || '',
        company_website: activeOrg.company_website || '',
        gstin: activeOrg.gstin || '',
        logo_url: activeOrg.logo_url || '',
        signature_url: activeOrg.signature_url || '',
      });
    }
  }, [activeOrg]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    setSaved(false);
  };

  const handleImageUpload = async (e, field) => {
    const file = e.target.files[0];
    if (!file) return;

    const setUploading = field === 'logo_url' ? setUploadingLogo : setUploadingSig;
    setUploading(true);
    setError('');

    try {
      const url = await uploadImage(file);
      setForm(prev => ({ ...prev, [field]: url }));
      setSaved(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
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

  if (!activeOrg) return null;

  return (
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
              <div style={{
                padding: '1rem', background: 'white', borderRadius: '10px',
                marginBottom: '0.5rem', display: 'flex', justifyContent: 'center'
              }}>
                <img src={form.logo_url} alt="Logo" style={{ maxHeight: '64px', maxWidth: '100%', objectFit: 'contain' }} />
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
              <div style={{
                padding: '1rem', background: 'white', borderRadius: '10px',
                marginBottom: '0.5rem', display: 'flex', justifyContent: 'center'
              }}>
                <img src={form.signature_url} alt="Signature" style={{ maxHeight: '48px', maxWidth: '100%', objectFit: 'contain' }} />
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

      {/* Save */}
      <button type="submit" className="easy-submit" disabled={saving}>
        {saving ? <><Loader size={16} className="spin-icon" /> Saving...</>
          : saved ? <><CheckCircle size={16} /> Saved</>
          : <><Save size={16} /> Save profile</>}
      </button>

      <style>{`.spin-icon { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </form>
  );
}
