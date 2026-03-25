import { useState } from 'react';
import { Upload, CheckCircle, ChevronRight, Eye } from 'lucide-react';
import { pdfService } from '../services/pdfService';
import { storageService } from '../services/storageService';
import { useAuth } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';
import { resolveFormImages } from '../utils/imageUtils';
import { CERTIFICATE_TEMPLATES } from '../services/certificateTemplates';
import CertificatePreview from './CertificatePreview';

export default function CertificateForm({ onSuccess }) {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const org = activeOrg || {};
  const [formData, setFormData] = useState({
    template: 'custom',
    recipientName: '',
    achievementTitle: '',
    issuingOrganization: org.company_name || '',
    issueDate: '',
    description: '',
    authorizedSignatory: org.owner_full_name || '',
    signatoryDesignation: org.document_designation || '',
    logo: org.logo_url || null,
    signature: org.signature_url || null,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showBranding, setShowBranding] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileUpload = (e, field) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setFormData(prev => ({ ...prev, [field]: reader.result }));
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const resolved = await resolveFormImages(formData, ['logo', 'signature']);
      await storageService.save(formData, 'certificate', activeOrg?.id, user?.id);
      pdfService.generateCertificate(resolved);
      setTimeout(() => {
        setIsSubmitting(false);
        if (onSuccess) onSuccess();
      }, 800);
    } catch (err) {
      console.error(err);
      alert("Error saving certificate: " + err.message);
      setIsSubmitting(false);
    }
  };

  const handlePreview = async () => {
    const resolved = await resolveFormImages(formData, ['logo', 'signature']);
    pdfService.generateCertificate(resolved, true);
  };

  return (
    <div className="mou-split-layout">

      {/* LEFT: Form */}
      <div className="mou-form-pane">
        <form onSubmit={handleSubmit} className="easy-form animate-in" style={{ maxWidth: '100%' }}>


          {/* 1. Recipient */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">1</div>
              <span className="easy-section-title">Recipient</span>
            </div>
            <div className="easy-row">
              <div className="easy-field full">
                <label className="easy-lbl">Full name</label>
                <input name="recipientName" value={formData.recipientName} onChange={handleChange} required placeholder="Jane Smith" className="easy-inp" />
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">Achievement / certification title</label>
                <input name="achievementTitle" value={formData.achievementTitle} onChange={handleChange} required placeholder="Certificate of Excellence in React Development" className="easy-inp" />
              </div>
            </div>
          </div>

          {/* 2. Organization */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">2</div>
              <span className="easy-section-title">Issuing organization</span>
            </div>
            <div className="easy-row">
              <div className="easy-field">
                <label className="easy-lbl">Organization name</label>
                <input name="issuingOrganization" value={formData.issuingOrganization} onChange={handleChange} required placeholder="Acme Academy" className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Issue date</label>
                <input type="date" name="issueDate" value={formData.issueDate} onChange={handleChange} required className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Organization logo</label>
                <div className="easy-upload-wrap">
                  <input type="file" onChange={(e) => handleFileUpload(e, 'logo')} accept="image/*" />
                  <div className={`easy-upload ${formData.logo ? 'done' : ''}`}>
                    {formData.logo ? <><CheckCircle size={16} /> Logo uploaded</> : <><Upload size={16} /> Choose file</>}
                  </div>
                </div>
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Description</label>
                <textarea name="description" value={formData.description} onChange={handleChange} required placeholder="For outstanding performance..." rows="2" className="easy-inp" style={{ resize: 'none' }} />
              </div>
            </div>
          </div>

          {/* 3. Signatory */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">3</div>
              <span className="easy-section-title">Signatory</span>
            </div>
            <div className="easy-row">
              <div className="easy-field">
                <label className="easy-lbl">Signatory name</label>
                <input name="authorizedSignatory" value={formData.authorizedSignatory} onChange={handleChange} required placeholder="Dr. Robert Johnson" className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Designation</label>
                <input name="signatoryDesignation" value={formData.signatoryDesignation} onChange={handleChange} required placeholder="Program Director" className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Signature</label>
                <div className="easy-upload-wrap">
                  <input type="file" onChange={(e) => handleFileUpload(e, 'signature')} accept="image/*" />
                  <div className={`easy-upload ${formData.signature ? 'done' : ''}`}>
                    {formData.signature ? <><CheckCircle size={16} /> Signature uploaded</> : <><Upload size={16} /> Choose file</>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Submit */}
          <button type="submit" className="easy-submit" disabled={isSubmitting}>
            {isSubmitting ? 'Generating...' : 'Issue Certificate'}
            {!isSubmitting && <ChevronRight size={18} />}
          </button>

          {/* Mobile preview */}
          <button type="button" onClick={handlePreview} className="easy-submit-outline mou-mobile-preview-btn" style={{ marginTop: '0.75rem' }}>
            <Eye size={16} /> Preview as PDF
          </button>

        </form>
      </div>

      {/* RIGHT: Live Preview */}
      <div className="mou-preview-pane">
        <div className="mou-preview-toolbar">
          <span className="mou-preview-toolbar-label">Live Preview</span>
          <button type="button" onClick={handlePreview} className="easy-submit-outline" style={{ padding: '0.375rem 0.875rem', fontSize: '0.75rem', width: 'auto' }}>
            <Eye size={14} /> Open PDF
          </button>
        </div>
        <div className="mou-a4-scroller">
          <CertificatePreview formData={formData} />
        </div>
      </div>


    </div>
  );
}
