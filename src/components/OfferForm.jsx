import { useState } from 'react';
import { Upload, Download, CheckCircle, Camera, Building, User, Calendar, CreditCard, ChevronRight } from 'lucide-react';
import { pdfService } from '../services/pdfService';
import { storageService } from '../services/storageService';
import { useAuth } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';

export default function OfferForm({ onSuccess }) {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const [formData, setFormData] = useState({
    offerType: 'internship',
    companyName: '',
    companyAddress: '',
    companyLogo: null,
    authorizedPersonName: '',
    authorizedPersonDesignation: '',
    contactEmail: '',
    contactPhone: '',
    studentName: '',
    signature: null,
    studentAddress: '',
    email: '',
    phone: '',
    role: '',
    department: '',
    supervisorName: '',
    responsibilities: '',
    startDate: '',
    endDate: '',
    acceptanceDeadline: '',
    isPaid: false,
    stipend: '',
    currency: 'INR',
    paymentFrequency: 'Monthly'
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const setOfferType = (type) => setFormData(prev => ({ ...prev, offerType: type }));

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setFormData(prev => ({ ...prev, companyLogo: reader.result }));
      reader.readAsDataURL(file);
    }
  };

  const handleSignatureUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setFormData(prev => ({ ...prev, signature: reader.result }));
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await storageService.save(formData, 'offer', activeOrg?.id, user?.id);
      pdfService.generateOfferLetter(formData);
      setTimeout(() => {
        setIsSubmitting(false);
        if (onSuccess) onSuccess();
      }, 800);
    } catch (err) {
      console.error(err);
      alert("Error saving offer: " + err.message);
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '100%' }}>

      {/* Offer Type Toggle */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.03)', padding: '4px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
          {['internship', 'fulltime'].map((type) => (
            <button key={type} type="button" onClick={() => setOfferType(type)}
              className={`pro-chip ${formData.offerType === type ? 'active' : ''}`}
              style={{ minWidth: '110px', textAlign: 'center', borderRadius: '8px' }}>
              {type === 'internship' ? 'Internship' : 'Full-Time'}
            </button>
          ))}
        </div>
      </div>

      {/* Organization Profile */}
      <div className="pro-card">
        <div className="pro-section-header">
          <div className="pro-section-icon"><Building size={18} /></div>
          <div>
            <h3 className="pro-section-title">Organization Profile</h3>
            <p className="pro-section-sub">Company details for the offer letter header</p>
          </div>
        </div>
        <div className="form-grid">
          <div style={{ gridColumn: 'span 2' }}>
            <label className="pro-label">Legal Entity Name</label>
            <input name="companyName" value={formData.companyName} onChange={handleChange} required placeholder="Acme International Ltd." className="pro-input" />
          </div>
          <div>
            <label className="pro-label">Company Address</label>
            <textarea name="companyAddress" value={formData.companyAddress} onChange={handleChange} required placeholder="Full registered address" rows="2" className="pro-input" style={{ resize: 'none' }} />
          </div>
          <div>
            <label className="pro-label">Upload Logo</label>
            <div style={{ position: 'relative' }}>
              <input type="file" onChange={handleLogoUpload} accept="image/*" style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer', zIndex: 10 }} />
              <div className="pro-add-item-btn" style={{ height: '42px', margin: 0, borderStyle: 'dashed' }}>
                <Camera size={16} /> {formData.companyLogo ? 'Logo Uploaded' : 'Select File'}
              </div>
              {formData.companyLogo && <div style={{ marginTop: '0.25rem', fontSize: '0.7rem', color: '#10b981', fontWeight: 700, textAlign: 'center' }}>VERIFIED</div>}
            </div>
          </div>
          <div>
            <label className="pro-label">Authorized Person</label>
            <input name="authorizedPersonName" value={formData.authorizedPersonName} onChange={handleChange} required placeholder="John Doe" className="pro-input" />
          </div>
          <div>
            <label className="pro-label">Digital Signature</label>
            <div style={{ position: 'relative' }}>
              <input type="file" onChange={handleSignatureUpload} accept="image/*" style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer', zIndex: 10 }} />
              <div className="pro-add-item-btn" style={{ height: '42px', margin: 0, borderStyle: 'dotted' }}>
                <Camera size={16} /> {formData.signature ? 'Signature Uploaded' : 'Upload Signature'}
              </div>
              {formData.signature && <img src={formData.signature} alt="Signature" style={{ height: '28px', marginTop: '0.25rem', display: 'block', margin: '0.25rem auto' }} />}
            </div>
          </div>
          <div>
            <label className="pro-label">Official Title</label>
            <input name="authorizedPersonDesignation" value={formData.authorizedPersonDesignation} onChange={handleChange} required placeholder="CEO / Manager" className="pro-input" />
          </div>
        </div>
      </div>

      {/* Candidate Profile */}
      <div className="pro-card">
        <div className="pro-section-header">
          <div className="pro-section-icon" style={{ background: 'rgba(139,92,246,0.1)', color: '#a78bfa' }}><User size={18} /></div>
          <div>
            <h3 className="pro-section-title">Candidate Profile</h3>
            <p className="pro-section-sub">{formData.offerType === 'internship' ? 'Intern' : 'Employee'} personal details</p>
          </div>
        </div>
        <div className="form-grid">
          <div>
            <label className="pro-label">{formData.offerType === 'internship' ? 'Intern Name' : 'Employee Name'}</label>
            <input name="studentName" value={formData.studentName} onChange={handleChange} required placeholder="Full Name" className="pro-input" />
          </div>
          <div>
            <label className="pro-label">Personal Address</label>
            <input name="studentAddress" value={formData.studentAddress} onChange={handleChange} required placeholder="Street / City" className="pro-input" />
          </div>
          <div>
            <label className="pro-label">Email ID</label>
            <input type="email" name="email" value={formData.email} onChange={handleChange} placeholder="example@gmail.com" className="pro-input" />
          </div>
          <div>
            <label className="pro-label">Contact Number</label>
            <input name="phone" value={formData.phone} onChange={handleChange} placeholder="+91 ..." className="pro-input" />
          </div>
        </div>
      </div>

      {/* Contract Terms */}
      <div className="pro-card">
        <div className="pro-section-header">
          <div className="pro-section-icon" style={{ background: 'rgba(16,185,129,0.1)', color: '#34d399' }}><Calendar size={18} /></div>
          <div>
            <h3 className="pro-section-title">Contract Terms</h3>
            <p className="pro-section-sub">Role, timeline, and reporting structure</p>
          </div>
        </div>
        <div className="form-grid">
          <div>
            <label className="pro-label">Job Title / Role</label>
            <input name="role" value={formData.role} onChange={handleChange} required placeholder="e.g. Finance Manager" className="pro-input" />
          </div>
          <div>
            <label className="pro-label">Team / Department</label>
            <input name="department" value={formData.department} onChange={handleChange} required placeholder="e.g. Operations" className="pro-input" />
          </div>
          <div>
            <label className="pro-label">Starting Date</label>
            <input type="date" name="startDate" value={formData.startDate} onChange={handleChange} required className="pro-input" />
          </div>
          {formData.offerType === 'internship' && (
            <div>
              <label className="pro-label">Ending Date</label>
              <input type="date" name="endDate" value={formData.endDate} onChange={handleChange} required className="pro-input" />
            </div>
          )}
          <div>
            <label className="pro-label">Reporting Supervisor</label>
            <input name="supervisorName" value={formData.supervisorName} onChange={handleChange} required placeholder="Reports to..." className="pro-input" />
          </div>
          <div>
            <label className="pro-label">Reply Deadline</label>
            <input type="date" name="acceptanceDeadline" value={formData.acceptanceDeadline} onChange={handleChange} required className="pro-input" />
          </div>
        </div>
        <div style={{ marginTop: '1.25rem' }}>
          <label className="pro-label">Detailed Responsibilities</label>
          <textarea name="responsibilities" value={formData.responsibilities} onChange={handleChange} required placeholder="Key responsibilities and goals..." rows="3" className="pro-input" style={{ resize: 'none' }} />
        </div>
      </div>

      {/* Payroll */}
      <div className="pro-card">
        <div className="pro-section-header">
          <div className="pro-section-icon" style={{ background: 'rgba(245,158,11,0.1)', color: '#fbbf24' }}><CreditCard size={18} /></div>
          <div>
            <h3 className="pro-section-title">Payroll Details</h3>
            <p className="pro-section-sub">Compensation and payment structure</p>
          </div>
        </div>

        <div
          onClick={() => handleChange({ target: { name: 'isPaid', checked: !formData.isPaid, type: 'checkbox' } })}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.875rem 1.25rem',
            background: formData.isPaid ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${formData.isPaid ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.06)'}`,
            borderRadius: '12px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            marginBottom: formData.isPaid ? '1.25rem' : 0
          }}
        >
          <span style={{ fontWeight: 700, fontSize: '0.8125rem', color: formData.isPaid ? '#60a5fa' : 'rgba(255,255,255,0.4)' }}>
            {formData.offerType === 'internship' ? 'PAID INTERNSHIP' : 'PAID POSITION'}
          </span>
          <div style={{
            width: '22px', height: '22px',
            background: formData.isPaid ? '#3b82f6' : 'rgba(255,255,255,0.1)',
            borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s'
          }}>
            {formData.isPaid && <CheckCircle size={14} color="white" />}
          </div>
        </div>

        {formData.isPaid && (
          <div className="form-grid animate-in">
            <div>
              <label className="pro-label">{formData.offerType === 'internship' ? 'Stipend Amount' : 'Salary Amount'}</label>
              <input type="number" name="stipend" value={formData.stipend} onChange={handleChange} required placeholder="0.00" className="pro-input" />
            </div>
            <div>
              <label className="pro-label">Currency / Frequency</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <select name="currency" value={formData.currency} onChange={handleChange} className="pro-input" style={{ flex: 1 }}>
                  <option value="INR">INR</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
                <select name="paymentFrequency" value={formData.paymentFrequency} onChange={handleChange} className="pro-input" style={{ flex: 1.5 }}>
                  <option value="Monthly">Monthly</option>
                  {formData.offerType === 'internship' ? (
                    <option value="Once">One-time</option>
                  ) : (
                    <option value="Annual">Annual (CTC)</option>
                  )}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Submit */}
      <button type="submit" className="btn btn-primary pro-btn" style={{ width: '100%', height: '52px', fontSize: '0.9375rem' }} disabled={isSubmitting}>
        {isSubmitting ? 'Generating...' : 'Finalize & Download'}
        {!isSubmitting && <ChevronRight size={18} />}
      </button>
    </form>
  );
}
