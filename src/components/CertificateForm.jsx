import { useState } from 'react';
import { Award, Camera, User, Calendar, Building, ChevronRight } from 'lucide-react';
import { pdfService } from '../services/pdfService';
import { storageService } from '../services/storageService';
import { useAuth } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';

export default function CertificateForm({ onSuccess }) {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const [formData, setFormData] = useState({
    recipientName: '',
    achievementTitle: '',
    issuingOrganization: '',
    issueDate: '',
    description: '',
    authorizedSignatory: '',
    signatoryDesignation: '',
    logo: null,
    signature: null,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

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
      await storageService.save(formData, 'certificate', activeOrg?.id, user?.id);
      pdfService.generateCertificate(formData);
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

  return (
    <form onSubmit={handleSubmit} className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '100%' }}>

      {/* Recipient */}
      <div className="pro-card">
        <div className="pro-section-header">
          <div className="pro-section-icon" style={{ background: 'rgba(245,158,11,0.1)', color: '#fbbf24' }}><User size={18} /></div>
          <div>
            <h3 className="pro-section-title">Recipient Details</h3>
            <p className="pro-section-sub">Person receiving the certificate</p>
          </div>
        </div>
        <div className="form-grid">
          <div style={{ gridColumn: 'span 2' }}>
            <label className="pro-label">Recipient Full Name</label>
            <input name="recipientName" value={formData.recipientName} onChange={handleChange} required placeholder="Jane Smith" className="pro-input" />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label className="pro-label">Achievement / Certification Title</label>
            <input name="achievementTitle" value={formData.achievementTitle} onChange={handleChange} required placeholder="Certificate of Excellence in React Development" className="pro-input" />
          </div>
        </div>
      </div>

      {/* Organization */}
      <div className="pro-card">
        <div className="pro-section-header">
          <div className="pro-section-icon"><Building size={18} /></div>
          <div>
            <h3 className="pro-section-title">Issuing Organization</h3>
            <p className="pro-section-sub">Details of the certifying body</p>
          </div>
        </div>
        <div className="form-grid">
          <div>
            <label className="pro-label">Organization Name</label>
            <input name="issuingOrganization" value={formData.issuingOrganization} onChange={handleChange} required placeholder="Acme Academy" className="pro-input" />
          </div>
          <div>
            <label className="pro-label">Issue Date</label>
            <input type="date" name="issueDate" value={formData.issueDate} onChange={handleChange} required className="pro-input" />
          </div>
          <div>
            <label className="pro-label">Upload Logo</label>
            <div style={{ position: 'relative' }}>
              <input type="file" onChange={(e) => handleFileUpload(e, 'logo')} accept="image/*" style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer', zIndex: 10 }} />
              <div className="pro-add-item-btn" style={{ height: '42px', margin: 0, borderStyle: 'dashed' }}>
                <Camera size={16} /> {formData.logo ? 'Logo Uploaded' : 'Select File'}
              </div>
            </div>
          </div>
          <div>
            <label className="pro-label">Achievement Description</label>
            <textarea name="description" value={formData.description} onChange={handleChange} required placeholder="For outstanding performance..." rows="2" className="pro-input" style={{ resize: 'none' }} />
          </div>
        </div>
      </div>

      {/* Signatory */}
      <div className="pro-card">
        <div className="pro-section-header">
          <div className="pro-section-icon" style={{ background: 'rgba(16,185,129,0.1)', color: '#34d399' }}><Award size={18} /></div>
          <div>
            <h3 className="pro-section-title">Authorized Signatory</h3>
            <p className="pro-section-sub">Person signing the certificate</p>
          </div>
        </div>
        <div className="form-grid">
          <div>
            <label className="pro-label">Signatory Name</label>
            <input name="authorizedSignatory" value={formData.authorizedSignatory} onChange={handleChange} required placeholder="Dr. Robert Johnson" className="pro-input" />
          </div>
          <div>
            <label className="pro-label">Designation</label>
            <input name="signatoryDesignation" value={formData.signatoryDesignation} onChange={handleChange} required placeholder="Program Director" className="pro-input" />
          </div>
          <div>
            <label className="pro-label">Upload Signature</label>
            <div style={{ position: 'relative' }}>
              <input type="file" onChange={(e) => handleFileUpload(e, 'signature')} accept="image/*" style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer', zIndex: 10 }} />
              <div className="pro-add-item-btn" style={{ height: '42px', margin: 0, borderStyle: 'dotted' }}>
                <Camera size={16} /> {formData.signature ? 'Signature Uploaded' : 'Upload Signature'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <button type="submit" className="btn btn-primary pro-btn" style={{ width: '100%', height: '52px', fontSize: '0.9375rem' }} disabled={isSubmitting}>
        {isSubmitting ? 'Generating...' : 'Issue Certificate'}
        {!isSubmitting && <ChevronRight size={18} />}
      </button>
    </form>
  );
}
