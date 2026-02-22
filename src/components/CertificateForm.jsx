import { useState } from 'react';
import { Award, Camera, User, Calendar, Building, Download, CheckCircle } from 'lucide-react';
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
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, [field]: reader.result }));
      };
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

  const SectionHeader = ({ icon: Icon, title }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '1.25rem', paddingBottom: '0.5rem', borderBottom: '1.5px solid var(--background)' }}>
      <Icon size={18} color="var(--primary)" strokeWidth={2.5} />
      <span style={{ fontWeight: 800, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.025em', color: 'var(--primary)' }}>{title}</span>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      
      {/* 1. Recipient Details */}
      <section className="card">
        <SectionHeader icon={User} title="Recipient Details" />
        <div className="form-grid">
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label>Recipient Full Name</label>
            <input name="recipientName" value={formData.recipientName} onChange={handleChange} required placeholder="Jane Smith" />
          </div>
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label>Achievement / Certification Title</label>
            <input name="achievementTitle" value={formData.achievementTitle} onChange={handleChange} required placeholder="Certificate of Excellence in React Development" />
          </div>
        </div>
      </section>

      {/* 2. Organization Profile */}
      <section className="card">
        <SectionHeader icon={Building} title="Issuing Organization" />
        <div className="form-grid">
          <div className="form-group">
            <label>Organization Name</label>
            <input name="issuingOrganization" value={formData.issuingOrganization} onChange={handleChange} required placeholder="Acme Academy" />
          </div>
          <div className="form-group">
            <label>Issue Date</label>
            <input type="date" name="issueDate" value={formData.issueDate} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label>Upload Logo</label>
            <div style={{ position: 'relative' }}>
              <input type="file" onChange={(e) => handleFileUpload(e, 'logo')} accept="image/*" style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer', zIndex: 10 }} />
              <div className="btn btn-outline" style={{ width: '100%', justifyContent: 'center', fontSize: '0.8rem', height: '42px', borderStyle: 'dashed' }}>
                <Camera size={16} /> {formData.logo ? 'Logo Updated' : 'Select File'}
              </div>
            </div>
          </div>
          <div className="form-group">
            <label>Achievement Description</label>
            <textarea name="description" value={formData.description} onChange={handleChange} required placeholder="For outstanding performance..." rows="2" />
          </div>
        </div>
      </section>

      {/* 3. Authority Signing */}
      <section className="card">
        <SectionHeader icon={Award} title="Authorized Signatory" />
        <div className="form-grid">
          <div className="form-group">
            <label>Signatory Name</label>
            <input name="authorizedSignatory" value={formData.authorizedSignatory} onChange={handleChange} required placeholder="Dr. Robert Johnson" />
          </div>
          <div className="form-group">
            <label>Designation</label>
            <input name="signatoryDesignation" value={formData.signatoryDesignation} onChange={handleChange} required placeholder="Program Director" />
          </div>
          <div className="form-group">
            <label>Upload Signature</label>
            <div style={{ position: 'relative' }}>
              <input type="file" onChange={(e) => handleFileUpload(e, 'signature')} accept="image/*" style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer', zIndex: 10 }} />
              <div className="btn btn-outline" style={{ width: '100%', justifyContent: 'center', fontSize: '0.8rem', height: '42px', borderStyle: 'dotted' }}>
                <Camera size={16} /> {formData.signature ? 'Signature Uploaded' : 'Upload Signature'}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div style={{ marginTop: '0.5rem' }}>
        <button type="submit" className="btn btn-primary" style={{ width: '100%', fontSize: '1rem', height: '56px' }} disabled={isSubmitting}>
          {isSubmitting ? 'Generating...' : 'Issue Certificate'}
        </button>
      </div>

    </form>
  );
}
