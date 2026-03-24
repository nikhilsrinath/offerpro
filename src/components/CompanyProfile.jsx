import { useState, useEffect } from 'react';
import { Upload, CheckCircle, Save, Loader, AlertCircle, Pencil } from 'lucide-react';
import { useOrg } from '../context/OrgContext';

import StampPreview from './StampPreview';
import ImageEditor from './ImageEditor';

export default function CompanyProfile() {
  const { activeOrg, updateOrganization } = useOrg();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingSig, setUploadingSig] = useState(false);
  const [uploadingStamp, setUploadingStamp] = useState(false);
  const [editorImage, setEditorImage] = useState(null);
  const [editorField, setEditorField] = useState('');

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
