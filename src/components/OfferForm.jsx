import { useState } from 'react';
import { Upload, CheckCircle, ChevronRight, Eye, AlertTriangle, Mail } from 'lucide-react';
import { pdfService } from '../services/pdfService';
import { storageService } from '../services/storageService';
import { useAuth } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';
import { useTrialStatus, TRIAL_LIMITS } from '../hooks/useTrialStatus';
import { resolveFormImages, generateStampPng } from '../utils/imageUtils';
import OfferPreview from './OfferPreview';

export default function OfferForm({ onSuccess }) {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const { usage, canCreate, isTrialExpired, trialDaysLeft, refreshUsage } = useTrialStatus();
  const org = activeOrg || {};
  const [formData, setFormData] = useState({
    offerType: 'internship',
    companyName: org.company_name || '',
    companyTagline: org.company_tagline || '',
    companyAddress: org.company_address || '',
    companyLogo: org.logo_url || null,
    cin: org.cin || '',
    companyWebsite: org.company_website || '',
    authorizedPersonName: org.owner_full_name || '',
    authorizedPersonDesignation: org.document_designation || '',
    contactEmail: org.company_email || '',
    contactPhone: org.company_phone || '',
    stampType: org.stamp_type || 'generated',
    stampUrl: org.stamp_url || '',
    stampCity: org.stamp_city || '',
    studentName: '',
    signature: org.signature_url || null,
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
    if (!canCreate('offer')) return;
    setIsSubmitting(true);
    try {
      const resolved = await resolveFormImages(formData, ['companyLogo', 'signature', 'stampUrl']);
      if (resolved.stampType === 'generated') {
        resolved.stampPng = await generateStampPng(resolved.companyName, resolved.stampCity);
      }
      await storageService.save(formData, 'offer', activeOrg?.id, user?.id);
      await pdfService.generateOfferLetter(resolved);
      await refreshUsage();
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

  const handlePreview = async () => {
    const resolved = await resolveFormImages(formData, ['companyLogo', 'signature', 'stampUrl']);
    if (resolved.stampType === 'generated') {
      resolved.stampPng = await generateStampPng(resolved.companyName, resolved.stampCity);
    }
    await pdfService.generateOfferLetter(resolved, true);
  };

  const limitReached = !canCreate('offer');
  const fillPercent = (usage.offer / TRIAL_LIMITS.offer) * 100;
  const fillClass = usage.offer >= TRIAL_LIMITS.offer ? 'full' : usage.offer >= TRIAL_LIMITS.offer - 1 ? 'warning' : '';

  return (
    <div className="mou-split-layout">

      {/* LEFT: Form */}
      <div className="mou-form-pane">
        <form onSubmit={handleSubmit} className="easy-form animate-in" style={{ maxWidth: '100%' }}>

          {/* Usage */}
          <div className="easy-usage">
            <span className="easy-usage-label">Offer Letters</span>
            <div className="easy-usage-bar">
              <div className={`easy-usage-fill ${fillClass}`} style={{ width: `${Math.min(fillPercent, 100)}%` }} />
            </div>
            <span className="easy-usage-count">{usage.offer}/{TRIAL_LIMITS.offer}</span>
          </div>

          {limitReached && (
            <div className="easy-limit-alert">
              <AlertTriangle size={28} />
              <h3>{isTrialExpired ? 'Trial Expired' : 'Offer Letter Limit Reached'}</h3>
              <p>{isTrialExpired ? 'Your 7-day free trial has ended.' : `You've used all ${TRIAL_LIMITS.offer} offer letters in your free trial.`} Contact our sales team to upgrade.</p>
              <a href="mailto:sales@offerpro.com" className="btn-cinematic" style={{ textDecoration: 'none', padding: '0.75rem 2rem' }}>
                <Mail size={16} /> Contact Sales
              </a>
            </div>
          )}

          {/* Type Toggle */}
          <div className="easy-toggle-bar">
            {['internship', 'fulltime'].map((type) => (
              <button key={type} type="button" onClick={() => setOfferType(type)}
                className={`easy-toggle-btn ${formData.offerType === type ? 'active' : ''}`}>
                {type === 'internship' ? 'Internship' : 'Full-Time'}
              </button>
            ))}
          </div>

          {/* 1. Company */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">1</div>
              <span className="easy-section-title">Company details</span>
            </div>
            <div className="easy-row">
              <div className="easy-field full">
                <label className="easy-lbl">Company name</label>
                <input name="companyName" value={formData.companyName} onChange={handleChange} required placeholder="Acme International Ltd." className="easy-inp" />
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">Company address</label>
                <textarea name="companyAddress" value={formData.companyAddress} onChange={handleChange} required placeholder="Full registered address" rows="2" className="easy-inp" style={{ resize: 'none' }} />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Authorized person</label>
                <input name="authorizedPersonName" value={formData.authorizedPersonName} onChange={handleChange} required placeholder="John Doe" className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Their title</label>
                <input name="authorizedPersonDesignation" value={formData.authorizedPersonDesignation} onChange={handleChange} required placeholder="CEO / Manager" className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Company logo</label>
                <div className="easy-upload-wrap">
                  <input type="file" onChange={handleLogoUpload} accept="image/*" />
                  <div className={`easy-upload ${formData.companyLogo ? 'done' : ''}`}>
                    {formData.companyLogo ? <><CheckCircle size={16} /> Logo uploaded</> : <><Upload size={16} /> Choose file</>}
                  </div>
                </div>
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Digital signature</label>
                <div className="easy-upload-wrap">
                  <input type="file" onChange={handleSignatureUpload} accept="image/*" />
                  <div className={`easy-upload ${formData.signature ? 'done' : ''}`}>
                    {formData.signature ? <><CheckCircle size={16} /> Signature uploaded</> : <><Upload size={16} /> Choose file</>}
                  </div>
                </div>
                {formData.signature && <img src={formData.signature} alt="Signature" style={{ height: '28px', marginTop: '0.25rem' }} />}
              </div>
            </div>
          </div>

          {/* 2. Candidate */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">2</div>
              <span className="easy-section-title">{formData.offerType === 'internship' ? 'Intern' : 'Employee'} details</span>
            </div>
            <div className="easy-row">
              <div className="easy-field">
                <label className="easy-lbl">Full name</label>
                <input name="studentName" value={formData.studentName} onChange={handleChange} required placeholder="Full Name" className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Address</label>
                <input name="studentAddress" value={formData.studentAddress} onChange={handleChange} required placeholder="Street / City" className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Email</label>
                <input type="email" name="email" value={formData.email} onChange={handleChange} placeholder="example@gmail.com" className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Phone</label>
                <input name="phone" value={formData.phone} onChange={handleChange} placeholder="+91 ..." className="easy-inp" />
              </div>
            </div>
          </div>

          {/* 3. Role & Dates */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">3</div>
              <span className="easy-section-title">Role & timeline</span>
            </div>
            <div className="easy-row">
              <div className="easy-field">
                <label className="easy-lbl">Job title / role</label>
                <input name="role" value={formData.role} onChange={handleChange} required placeholder="e.g. Finance Manager" className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Department</label>
                <input name="department" value={formData.department} onChange={handleChange} required placeholder="e.g. Operations" className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Start date</label>
                <input type="date" name="startDate" value={formData.startDate} onChange={handleChange} required className="easy-inp" />
              </div>
              {formData.offerType === 'internship' && (
                <div className="easy-field">
                  <label className="easy-lbl">End date</label>
                  <input type="date" name="endDate" value={formData.endDate} onChange={handleChange} required className="easy-inp" />
                </div>
              )}
              <div className="easy-field">
                <label className="easy-lbl">Reporting supervisor</label>
                <input name="supervisorName" value={formData.supervisorName} onChange={handleChange} required placeholder="Reports to..." className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Reply deadline</label>
                <input type="date" name="acceptanceDeadline" value={formData.acceptanceDeadline} onChange={handleChange} required className="easy-inp" />
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">Responsibilities</label>
                <textarea name="responsibilities" value={formData.responsibilities} onChange={handleChange} required placeholder="Key responsibilities and goals..." rows="3" className="easy-inp" style={{ resize: 'none' }} />
              </div>
            </div>
          </div>

          {/* 4. Compensation */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">4</div>
              <span className="easy-section-title">Compensation</span>
            </div>

            <div
              className={`easy-switch-row ${formData.isPaid ? 'active' : ''}`}
              onClick={() => handleChange({ target: { name: 'isPaid', checked: !formData.isPaid, type: 'checkbox' } })}
            >
              <span className="easy-switch-label">
                {formData.offerType === 'internship' ? 'Paid internship' : 'Paid position'}
              </span>
              <div className="easy-switch-dot" />
            </div>

            {formData.isPaid && (
              <div className="easy-row animate-in" style={{ marginTop: '1.25rem' }}>
                <div className="easy-field">
                  <label className="easy-lbl">{formData.offerType === 'internship' ? 'Stipend amount' : 'Salary amount'}</label>
                  <input type="number" name="stipend" value={formData.stipend} onChange={handleChange} required placeholder="0.00" className="easy-inp" />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl">Currency & frequency</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <select name="currency" value={formData.currency} onChange={handleChange} className="easy-inp" style={{ flex: 1 }}>
                      <option value="INR">INR</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                    <select name="paymentFrequency" value={formData.paymentFrequency} onChange={handleChange} className="easy-inp" style={{ flex: 1.5 }}>
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
          <button type="submit" className="easy-submit" disabled={isSubmitting || limitReached}>
            {isSubmitting ? 'Generating...' : limitReached ? 'Limit Reached' : 'Finalize & Download'}
            {!isSubmitting && !limitReached && <ChevronRight size={18} />}
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
          <OfferPreview formData={formData} />
        </div>
      </div>

    </div>
  );
}
