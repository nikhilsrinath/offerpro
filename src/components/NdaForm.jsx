import { useState } from 'react';
import { Upload, CheckCircle, Eye, ChevronRight, AlertTriangle, Mail } from 'lucide-react';
import { pdfService } from '../services/pdfService';
import { storageService } from '../services/storageService';
import { useAuth } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';
import NdaPreview from './NdaPreview';
import { useTrialStatus, TRIAL_LIMITS } from '../hooks/useTrialStatus';
import { resolveFormImages, generateStampPng } from '../utils/imageUtils';

export default function NdaForm({ onSuccess }) {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const { usage, canCreate, isTrialExpired, isPremium, refreshUsage } = useTrialStatus();
  const org = activeOrg || {};
  const [formData, setFormData] = useState({
    effectiveDate: '',
    executionCity: '',
    executionState: '',
    companyLogo: org.logo_url || null,
    companyTagline: org.company_tagline || '',
    cin: org.cin || '',
    companyPhone: org.company_phone || '',
    companyEmail: org.company_email || '',
    companyWebsite: org.company_website || '',
    stampType: org.stamp_type || 'generated',
    stampUrl: org.stamp_url || '',
    stampCity: org.stamp_city || '',
    showStamp: true,
    disclosingPartyName: org.company_name || '',
    disclosingPartyIncorporation: 'India',
    disclosingPartyAddress: org.company_address || '',
    receivingPartyName: '',
    receivingPartyIncorporation: 'India',
    receivingPartyAddress: '',
    proposedTransaction: '',
    purposeOfDisclosure: '',
    specificConfidentialItems: '',
    obligationYears: '5',
    nonSolicitationYears: '1',
    arbitrationCity: '',
    arbitrationState: '',
    disclosingSignatoryName: org.owner_full_name || '',
    disclosingSignatoryDesignation: org.document_designation || '',
    disclosingSignatoryDate: '',
    disclosingSignature: org.signature_url || null,
    receivingSignatoryName: '',
    receivingSignatoryDesignation: '',
    receivingSignatoryDate: '',
    receivingSignature: null,
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
    if (!canCreate('nda')) return;
    setIsSubmitting(true);
    try {
      const resolved = await resolveFormImages(formData, ['disclosingSignature', 'receivingSignature', 'companyLogo', 'stampUrl']);
      if (resolved.stampType === 'generated') {
        resolved.stampPng = await generateStampPng(resolved.disclosingPartyName, resolved.stampCity);
      }
      await storageService.save(formData, 'nda', activeOrg?.id, user?.id);
      await pdfService.generateNda(resolved);
      await refreshUsage();
      setTimeout(() => {
        setIsSubmitting(false);
        if (onSuccess) onSuccess();
      }, 800);
    } catch (err) {
      console.error(err);
      alert("Error saving NDA: " + err.message);
      setIsSubmitting(false);
    }
  };

  const limitReached = !canCreate('nda');
  const fillPercent = (usage.nda / TRIAL_LIMITS.nda) * 100;
  const fillClass = usage.nda >= TRIAL_LIMITS.nda ? 'full' : '';

  const handlePreview = async () => {
    const resolved = await resolveFormImages(formData, ['disclosingSignature', 'receivingSignature', 'companyLogo', 'stampUrl']);
    if (resolved.stampType === 'generated') {
      resolved.stampPng = await generateStampPng(resolved.disclosingPartyName, resolved.stampCity);
    }
    await pdfService.generateNda(resolved, true);
  };

  return (
    <div className="mou-split-layout">

      {/* LEFT: Form */}
      <div className="mou-form-pane">
        <form onSubmit={handleSubmit} className="easy-form animate-in" style={{ maxWidth: '100%' }}>

          {/* Usage */}
          {!isPremium && (
            <>
              <div className="easy-usage">
                <span className="easy-usage-label">NDA</span>
                <div className="easy-usage-bar">
                  <div className={`easy-usage-fill ${fillClass}`} style={{ width: `${Math.min(fillPercent, 100)}%` }} />
                </div>
                <span className="easy-usage-count">{usage.nda}/{TRIAL_LIMITS.nda}</span>
              </div>

              {limitReached && (
                <div className="easy-limit-alert">
                  <AlertTriangle size={28} />
                  <h3>{isTrialExpired ? 'Trial Expired' : 'NDA Limit Reached'}</h3>
                  <p>{isTrialExpired ? 'Your 7-day free trial has ended.' : `You've used your ${TRIAL_LIMITS.nda} NDA document(s) in the free trial.`} Contact our sales team to upgrade.</p>
                  <a href="mailto:sales@offerpro.com" className="btn-cinematic" style={{ textDecoration: 'none', padding: '0.75rem 2rem' }}>
                    <Mail size={16} /> Contact Sales
                  </a>
                </div>
              )}
            </>
          )}

          {/* 1. Agreement Details */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">1</div>
              <span className="easy-section-title">Agreement details</span>
            </div>
            <div className="easy-row">
              <div className="easy-field">
                <label className="easy-lbl">Effective date</label>
                <input type="date" name="effectiveDate" value={formData.effectiveDate} onChange={handleChange} className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">City of execution</label>
                <input name="executionCity" value={formData.executionCity} onChange={handleChange} placeholder="e.g. Chennai" className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">State</label>
                <input name="executionState" value={formData.executionState} onChange={handleChange} placeholder="e.g. Tamil Nadu" className="easy-inp" required />
              </div>
            </div>
          </div>

          {/* 2. Disclosing Party */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">2</div>
              <span className="easy-section-title">Disclosing party</span>
            </div>
            <div className="easy-row">
              <div className="easy-field full">
                <label className="easy-lbl">Company / entity name</label>
                <input name="disclosingPartyName" value={formData.disclosingPartyName} onChange={handleChange} placeholder="e.g. Acme Technologies Pvt Ltd" className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Country of incorporation</label>
                <input name="disclosingPartyIncorporation" value={formData.disclosingPartyIncorporation} onChange={handleChange} placeholder="India" className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Registered office address</label>
                <textarea name="disclosingPartyAddress" value={formData.disclosingPartyAddress} onChange={handleChange} placeholder="Full address with PIN code" rows={2} className="easy-inp" style={{ resize: 'none' }} required />
              </div>
            </div>
          </div>

          {/* 3. Receiving Party */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">3</div>
              <span className="easy-section-title">Receiving party</span>
            </div>
            <div className="easy-row">
              <div className="easy-field full">
                <label className="easy-lbl">Company / entity name</label>
                <input name="receivingPartyName" value={formData.receivingPartyName} onChange={handleChange} placeholder="e.g. Beta Labs Private Limited" className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Country of incorporation</label>
                <input name="receivingPartyIncorporation" value={formData.receivingPartyIncorporation} onChange={handleChange} placeholder="India" className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Registered office address</label>
                <textarea name="receivingPartyAddress" value={formData.receivingPartyAddress} onChange={handleChange} placeholder="Full address with PIN code" rows={2} className="easy-inp" style={{ resize: 'none' }} required />
              </div>
            </div>
          </div>

          {/* 4. Transaction & Purpose */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">4</div>
              <span className="easy-section-title">Transaction & purpose</span>
            </div>
            <div className="easy-row">
              <div className="easy-field full">
                <label className="easy-lbl">Proposed transaction</label>
                <textarea name="proposedTransaction" value={formData.proposedTransaction} onChange={handleChange}
                  placeholder="e.g. proposes to provide [Receiving Party Name] with a sample unit of its product for evaluation..."
                  rows={3} className="easy-inp" style={{ resize: 'none' }} required />
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">Purpose of disclosure</label>
                <textarea name="purposeOfDisclosure" value={formData.purposeOfDisclosure} onChange={handleChange}
                  placeholder="e.g. sharing confidential information solely to enable evaluation..."
                  rows={3} className="easy-inp" style={{ resize: 'none' }} required />
              </div>
            </div>
          </div>

          {/* 5. Confidential Items */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">5</div>
              <span className="easy-section-title">Confidential items</span>
            </div>
            <div className="easy-field">
              <label className="easy-lbl">Enter each item on a new line</label>
              <textarea name="specificConfidentialItems" value={formData.specificConfidentialItems} onChange={handleChange}
                placeholder={"e.g.\nThe physical product sample provided for evaluation\nProprietary hardware architecture and board design\nInternal circuit design concepts\nFirmware behavior and system functionality\nTechnical documentation and user guides\nCommercial pricing and business discussions"}
                rows={6} className="easy-inp" style={{ resize: 'vertical', lineHeight: '1.6' }} required />
            </div>
          </div>

          {/* 6. Terms */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">6</div>
              <span className="easy-section-title">Terms & duration</span>
            </div>
            <div className="easy-row">
              <div className="easy-field">
                <label className="easy-lbl">Confidentiality obligation (years)</label>
                <select name="obligationYears" value={formData.obligationYears} onChange={handleChange} className="easy-inp">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n} {n === 1 ? 'Year' : 'Years'}</option>)}
                </select>
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Non-solicitation period (years)</label>
                <select name="nonSolicitationYears" value={formData.nonSolicitationYears} onChange={handleChange} className="easy-inp">
                  {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} {n === 1 ? 'Year' : 'Years'}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* 7. Dispute Resolution */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">7</div>
              <span className="easy-section-title">Dispute resolution</span>
            </div>
            <div className="easy-row">
              <div className="easy-field">
                <label className="easy-lbl">Arbitration city</label>
                <input name="arbitrationCity" value={formData.arbitrationCity} onChange={handleChange} placeholder="e.g. Chennai" className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Arbitration state</label>
                <input name="arbitrationState" value={formData.arbitrationState} onChange={handleChange} placeholder="e.g. Tamil Nadu" className="easy-inp" required />
              </div>
            </div>
          </div>

          {/* 8. Signatories */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">8</div>
              <span className="easy-section-title">Signatories</span>
            </div>

            {/* Disclosing Party */}
            <div className="easy-party-label">Disclosing Party</div>
            <div className="easy-row">
              <div className="easy-field">
                <label className="easy-lbl">Name</label>
                <input name="disclosingSignatoryName" value={formData.disclosingSignatoryName} onChange={handleChange} placeholder="Full name" className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Designation</label>
                <input name="disclosingSignatoryDesignation" value={formData.disclosingSignatoryDesignation} onChange={handleChange} placeholder="e.g. CEO / Director" className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Signing date</label>
                <input type="date" name="disclosingSignatoryDate" value={formData.disclosingSignatoryDate} onChange={handleChange} className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Signature</label>
                <div className="easy-upload-wrap">
                  <input type="file" onChange={(e) => handleFileUpload(e, 'disclosingSignature')} accept="image/*" />
                  <div className={`easy-upload ${formData.disclosingSignature ? 'done' : ''}`}>
                    {formData.disclosingSignature ? <><CheckCircle size={16} /> Uploaded</> : <><Upload size={16} /> Upload signature</>}
                  </div>
                </div>
                {formData.disclosingSignature && <img src={formData.disclosingSignature} alt="Signature" style={{ height: '28px', marginTop: '0.25rem' }} />}
              </div>
            </div>

            <div className="easy-divider" />

            {/* Receiving Party */}
            <div className="easy-party-label purple">Receiving Party</div>
            <div className="easy-row">
              <div className="easy-field">
                <label className="easy-lbl">Name</label>
                <input name="receivingSignatoryName" value={formData.receivingSignatoryName} onChange={handleChange} placeholder="Full name" className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Designation</label>
                <input name="receivingSignatoryDesignation" value={formData.receivingSignatoryDesignation} onChange={handleChange} placeholder="e.g. CEO / Director" className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Signing date</label>
                <input type="date" name="receivingSignatoryDate" value={formData.receivingSignatoryDate} onChange={handleChange} className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Signature</label>
                <div className="easy-upload-wrap">
                  <input type="file" onChange={(e) => handleFileUpload(e, 'receivingSignature')} accept="image/*" />
                  <div className={`easy-upload ${formData.receivingSignature ? 'done' : ''}`}>
                    {formData.receivingSignature ? <><CheckCircle size={16} /> Uploaded</> : <><Upload size={16} /> Upload signature</>}
                  </div>
                </div>
                {formData.receivingSignature && <img src={formData.receivingSignature} alt="Signature" style={{ height: '28px', marginTop: '0.25rem' }} />}
              </div>
              <div className="easy-field full">
                <div
                  className={`easy-switch-row ${formData.showStamp ? 'active' : ''}`}
                  onClick={() => handleChange({ target: { name: 'showStamp', checked: !formData.showStamp, type: 'checkbox' } })}
                  style={{ marginTop: '0.5rem' }}
                >
                  <span className="easy-switch-label">Include company stamp</span>
                  <div className="easy-switch-dot" />
                </div>
              </div>
            </div>
          </div>

          {/* Submit */}
          <button type="submit" disabled={isSubmitting || (limitReached && !isPremium)} className="easy-submit">
            {isSubmitting ? 'Generating...' : (limitReached && !isPremium) ? 'Limit Reached' : 'Save & Download NDA'}
            {!isSubmitting && !(limitReached && !isPremium) && <ChevronRight size={18} />}
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
          <span className="mou-preview-toolbar-label">
            Live Preview
          </span>
          <button type="button" onClick={handlePreview} className="easy-submit-outline" style={{ padding: '0.375rem 0.875rem', fontSize: '0.75rem', width: 'auto' }}>
            <Eye size={14} /> Open PDF
          </button>
        </div>
        <div className="mou-a4-scroller">
          <NdaPreview formData={formData} />
        </div>
      </div>

    </div>
  );
}
