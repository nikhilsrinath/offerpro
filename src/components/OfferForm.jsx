import { useState } from 'react';
import { Upload, Download, CheckCircle, Camera, Building, User, Calendar, CreditCard, ChevronRight } from 'lucide-react';
import { pdfService } from '../services/pdfService';
import { storageService } from '../services/storageService';

export default function OfferForm({ onSuccess }) {
  const [formData, setFormData] = useState({
    offerType: 'internship', // 'internship' or 'fulltime'
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
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, companyLogo: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSignatureUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, signature: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      storageService.save(formData);
      pdfService.generateOfferLetter(formData);
      setTimeout(() => {
        setIsSubmitting(false);
        if (onSuccess) onSuccess();
      }, 800);
    } catch (err) {
      console.error(err);
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
      
      {/* 0. Offer Type Selector */}
      {/* 1. Offer Type Selection - Segmented Control */}
      <div style={{ 
        display: 'flex', 
        background: 'var(--background)', 
        padding: '4px', 
        borderRadius: 'var(--radius-md)', 
        marginBottom: '2.5rem',
        border: '1px solid var(--border)',
        width: 'fit-content',
        margin: '0 auto 2.5rem'
      }}>
        {['internship', 'fulltime'].map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setOfferType(type)}
            style={{ 
              padding: '0.625rem 1.75rem', 
              borderRadius: 'calc(var(--radius-md) - 3px)',
              border: 'none',
              fontSize: '0.75rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              cursor: 'pointer',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              background: formData.offerType === type ? 'var(--primary)' : 'transparent',
              color: formData.offerType === type ? 'white' : 'var(--text-muted)',
              boxShadow: formData.offerType === type ? 'var(--shadow-md)' : 'none',
              minWidth: '120px'
            }}
          >
            {type === 'internship' ? 'Internship' : 'Full-Time'}
          </button>
        ))}
      </div>

      {/* 1. Organization Setup */}
      <section className="card">
        <SectionHeader icon={Building} title="Organization Profile" />
        <div className="grid grid-2">
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>Legal Entity Name</label>
            <input name="companyName" value={formData.companyName} onChange={handleChange} required placeholder="Acme International Ltd." />
          </div>
          <div className="form-group">
            <label>Company Address</label>
            <textarea name="companyAddress" value={formData.companyAddress} onChange={handleChange} required placeholder="Full registered address" rows="2" />
          </div>
          <div className="form-group">
            <label>Upload Logo</label>
            <div style={{ position: 'relative' }}>
              <input type="file" onChange={handleLogoUpload} accept="image/*" style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer', zIndex: 10 }} />
              <div className="btn btn-outline" style={{ width: '100%', justifyContent: 'center', fontSize: '0.8rem', height: '42px', borderStyle: 'dashed' }}>
                <Camera size={16} /> {formData.companyLogo ? 'Logo Updated' : 'Select File'}
              </div>
              {formData.companyLogo && <div className="text-center" style={{ marginTop: '0.25rem', fontSize: '0.7rem', color: 'var(--success)', fontWeight: 700 }}>VERIFIED ✓</div>}
            </div>
          </div>
          <div className="form-group">
            <label>Authorized Name</label>
            <input name="authorizedPersonName" value={formData.authorizedPersonName} onChange={handleChange} required placeholder="John Doe" />
          </div>
          <div className="form-group">
            <label>Digital Signature</label>
            <div style={{ position: 'relative' }}>
              <input type="file" onChange={handleSignatureUpload} accept="image/*" style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer', zIndex: 10 }} />
              <div className="btn btn-outline" style={{ width: '100%', justifyContent: 'center', fontSize: '0.8rem', height: '42px', borderStyle: 'dotted' }}>
                <Camera size={16} /> {formData.signature ? 'Signature Uploaded' : 'Upload Signature'}
              </div>
              {formData.signature && <img src={formData.signature} alt="Signature" style={{ height: '30px', marginTop: '0.25rem', display: 'block', margin: '0.25rem auto' }} />}
            </div>
          </div>
          <div className="form-group">
            <label>Official Title</label>
            <input name="authorizedPersonDesignation" value={formData.authorizedPersonDesignation} onChange={handleChange} required placeholder="CEO / Manager" />
          </div>
        </div>
      </section>

      {/* 2. Candidate Profile */}
      <section className="card">
        <SectionHeader icon={User} title="Candidate Profile" />
        <div className="grid grid-2">
          <div className="form-group">
            <label>{formData.offerType === 'internship' ? 'Intern Name' : 'Employee Name'}</label>
            <input name="studentName" value={formData.studentName} onChange={handleChange} required placeholder="Full Name" />
          </div>
          <div className="form-group">
             <label>Personal Address</label>
             <input name="studentAddress" value={formData.studentAddress} onChange={handleChange} required placeholder="Street / City" />
          </div>
          <div className="form-group">
            <label>Email ID</label>
            <input type="email" name="email" value={formData.email} onChange={handleChange} placeholder="example@gmail.com" />
          </div>
          <div className="form-group">
            <label>Contact Num</label>
            <input name="phone" value={formData.phone} onChange={handleChange} placeholder="+123..." />
          </div>
        </div>
      </section>

      {/* 3. Job Terms */}
      <section className="card">
        <SectionHeader icon={Calendar} title="Contract Terms" />
        <div className="grid grid-2">
          <div className="form-group">
            <label>Job Title / Role</label>
            <input name="role" value={formData.role} onChange={handleChange} required placeholder="e.g. Finance Manager" />
          </div>
          <div className="form-group">
            <label>Team / Dept</label>
            <input name="department" value={formData.department} onChange={handleChange} required placeholder="e.g. Operations" />
          </div>
          
          <div className="form-group">
            <label>Starting Date</label>
            <input type="date" name="startDate" value={formData.startDate} onChange={handleChange} required />
          </div>

          {formData.offerType === 'internship' && (
            <div className="form-group">
              <label>Ending Date</label>
              <input type="date" name="endDate" value={formData.endDate} onChange={handleChange} required />
            </div>
          )}

          <div className="form-group">
            <label>Reporting Supervisor</label>
            <input name="supervisorName" value={formData.supervisorName} onChange={handleChange} required placeholder="Reports to..." />
          </div>

          <div className="form-group">
            <label>Reply Deadline</label>
            <input type="date" name="acceptanceDeadline" value={formData.acceptanceDeadline} onChange={handleChange} required />
          </div>
        </div>
        <div className="form-group">
            <label>Detailed Responsibilities</label>
            <textarea name="responsibilities" value={formData.responsibilities} onChange={handleChange} required placeholder="Key responsibilities and goals..." rows="3" />
        </div>
      </section>

      {/* 4. Financials */}
      <section className="card">
        <SectionHeader icon={CreditCard} title="Payroll Details" />
        <div 
          onClick={() => handleChange({ target: { name: 'isPaid', checked: !formData.isPaid, type: 'checkbox' } })}
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            padding: '1rem', 
            background: formData.isPaid ? 'var(--primary)' : 'var(--background)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            marginBottom: formData.isPaid ? '1rem' : 0
          }}
        >
          <span style={{ fontWeight: 700, color: formData.isPaid ? 'white' : 'var(--text-muted)' }}>
            {formData.offerType === 'internship' ? 'PAID INTERNSHIP' : 'PAID POSITION'}
          </span>
          <div style={{ width: '24px', height: '24px', background: formData.isPaid ? 'var(--accent)' : '#CBD5E1', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {formData.isPaid && <CheckCircle size={16} color="white" />}
          </div>
        </div>

        {formData.isPaid && (
          <div className="grid grid-2 animate-in">
            <div className="form-group">
              <label>{formData.offerType === 'internship' ? 'Stipend Amount' : 'Salary Amount'}</label>
              <input type="number" name="stipend" value={formData.stipend} onChange={handleChange} required placeholder="0.00" />
            </div>
            <div className="form-group">
              <label>Currency / Freq</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <select name="currency" value={formData.currency} onChange={handleChange} style={{ flex: 1 }}>
                  <option value="INR">INR</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
                <select name="paymentFrequency" value={formData.paymentFrequency} onChange={handleChange} style={{ flex: 1.5 }}>
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
      </section>

      <div style={{ marginTop: '0.5rem' }}>
        <button type="submit" className="btn btn-primary" style={{ width: '100%', fontSize: '1rem', height: '56px' }} disabled={isSubmitting}>
          {isSubmitting ? 'Syncing...' : 'Finalize & Download'}
        </button>
      </div>

    </form>
  );
}
