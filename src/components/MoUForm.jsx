import { useState } from 'react';
import { Shield, Building, FileText, Lock, Clock, Gavel, Users, Camera, Eye, ChevronRight, AlertTriangle, Mail } from 'lucide-react';
import { pdfService } from '../services/pdfService';
import { storageService } from '../services/storageService';
import { useAuth } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';
import NdaPreview from './NdaPreview';
import { useTrialStatus, TRIAL_LIMITS } from '../hooks/useTrialStatus';

export default function MoUForm({ onSuccess }) {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const { usage, canCreate, isTrialExpired, refreshUsage } = useTrialStatus();
  const [formData, setFormData] = useState({
    docType: 'nda',

    // Agreement
    effectiveDate: '',
    executionCity: '',
    executionState: '',

    // Disclosing Party
    disclosingPartyName: '',
    disclosingPartyIncorporation: 'India',
    disclosingPartyAddress: '',

    // Receiving Party
    receivingPartyName: '',
    receivingPartyIncorporation: 'India',
    receivingPartyAddress: '',

    // Transaction
    proposedTransaction: '',
    purposeOfDisclosure: '',
    specificConfidentialItems: '',

    // Terms
    obligationYears: '5',
    nonSolicitationYears: '1',

    // Dispute Resolution
    arbitrationCity: '',
    arbitrationState: '',

    // Signatories
    disclosingSignatoryName: '',
    disclosingSignatoryDesignation: '',
    disclosingSignatoryDate: '',
    disclosingSignature: null,

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
    if (!canCreate('mou')) return;
    setIsSubmitting(true);
    try {
      await storageService.save(formData, 'mou', activeOrg?.id, user?.id);
      pdfService.generateMoU(formData);
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

  const limitReached = !canCreate('mou');
  const fillPercent = (usage.mou / TRIAL_LIMITS.mou) * 100;
  const fillClass = usage.mou >= TRIAL_LIMITS.mou ? 'full' : '';

  const handlePreview = () => {
    pdfService.generateMoU(formData, true);
  };

  const docLabel = formData.docType === 'mou' ? 'MoU' : 'NDA';

  return (
    <div className="mou-split-layout">

      {/* LEFT: Form Pane */}
      <div className="mou-form-pane">
        <form onSubmit={handleSubmit} className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Usage Indicator */}
          <div className="usage-indicator">
            <span className="usage-indicator-label">MoU / NDA</span>
            <div className="usage-indicator-bar">
              <div className={`usage-indicator-fill ${fillClass}`} style={{ width: `${Math.min(fillPercent, 100)}%` }} />
            </div>
            <span className="usage-indicator-count">{usage.mou}/{TRIAL_LIMITS.mou}</span>
          </div>

          {limitReached && (
            <div className="limit-reached-alert">
              <AlertTriangle size={32} />
              <h3>{isTrialExpired ? 'Trial Expired' : 'MoU/NDA Limit Reached'}</h3>
              <p>{isTrialExpired ? 'Your 7-day free trial has ended.' : `You've used your ${TRIAL_LIMITS.mou} MoU/NDA document in the free trial.`} Contact our sales team to upgrade.</p>
              <a href="mailto:sales@offerpro.com" className="btn-cinematic" style={{ textDecoration: 'none', padding: '0.75rem 2rem' }}>
                <Mail size={16} /> Contact Sales
              </a>
            </div>
          )}

          {/* Document Type Toggle */}
          <div className="nda-type-toggle">
            <button
              type="button"
              className={`nda-type-toggle-btn ${formData.docType === 'nda' ? 'active' : ''}`}
              onClick={() => setFormData(prev => ({ ...prev, docType: 'nda' }))}
            >
              Non-Disclosure Agreement
            </button>
            <button
              type="button"
              className={`nda-type-toggle-btn ${formData.docType === 'mou' ? 'active' : ''}`}
              onClick={() => setFormData(prev => ({ ...prev, docType: 'mou' }))}
            >
              Memorandum of Understanding
            </button>
          </div>

          {/* Agreement Details */}
          <div className="pro-card">
            <div className="pro-section-header">
              <div className="pro-section-icon" style={{ background: 'rgba(16,185,129,0.1)', color: '#34d399' }}><Shield size={18} /></div>
              <div>
                <h3 className="pro-section-title">Agreement Details</h3>
                <p className="pro-section-sub">Date and place of execution</p>
              </div>
            </div>
            <div className="form-grid">
              <div>
                <label className="pro-label">Effective Date</label>
                <input type="date" name="effectiveDate" value={formData.effectiveDate} onChange={handleChange} className="pro-input" required />
              </div>
              <div>
                <label className="pro-label">City of Execution</label>
                <input name="executionCity" value={formData.executionCity} onChange={handleChange} placeholder="e.g. Chennai" className="pro-input" required />
              </div>
              <div>
                <label className="pro-label">State</label>
                <input name="executionState" value={formData.executionState} onChange={handleChange} placeholder="e.g. Tamil Nadu" className="pro-input" required />
              </div>
            </div>
          </div>

          {/* Disclosing Party */}
          <div className="pro-card">
            <div className="pro-section-header">
              <div className="pro-section-icon" style={{ background: 'rgba(59,130,246,0.1)', color: '#60a5fa' }}><Building size={18} /></div>
              <div>
                <h3 className="pro-section-title">Disclosing Party</h3>
                <p className="pro-section-sub">Entity sharing confidential information</p>
              </div>
            </div>
            <div className="form-grid">
              <div style={{ gridColumn: 'span 2' }}>
                <label className="pro-label">Company / Entity Name</label>
                <input name="disclosingPartyName" value={formData.disclosingPartyName} onChange={handleChange} placeholder="e.g. Acme Technologies Pvt Ltd" className="pro-input" required />
              </div>
              <div>
                <label className="pro-label">Country of Incorporation</label>
                <input name="disclosingPartyIncorporation" value={formData.disclosingPartyIncorporation} onChange={handleChange} placeholder="India" className="pro-input" required />
              </div>
              <div>
                <label className="pro-label">Registered Office Address</label>
                <textarea name="disclosingPartyAddress" value={formData.disclosingPartyAddress} onChange={handleChange} placeholder="Full registered office address with PIN code" rows={2} className="pro-input" style={{ resize: 'none' }} required />
              </div>
            </div>
          </div>

          {/* Receiving Party */}
          <div className="pro-card">
            <div className="pro-section-header">
              <div className="pro-section-icon" style={{ background: 'rgba(139,92,246,0.1)', color: '#a78bfa' }}><Building size={18} /></div>
              <div>
                <h3 className="pro-section-title">Receiving Party</h3>
                <p className="pro-section-sub">Entity receiving confidential information</p>
              </div>
            </div>
            <div className="form-grid">
              <div style={{ gridColumn: 'span 2' }}>
                <label className="pro-label">Company / Entity Name</label>
                <input name="receivingPartyName" value={formData.receivingPartyName} onChange={handleChange} placeholder="e.g. Beta Labs Private Limited" className="pro-input" required />
              </div>
              <div>
                <label className="pro-label">Country of Incorporation</label>
                <input name="receivingPartyIncorporation" value={formData.receivingPartyIncorporation} onChange={handleChange} placeholder="India" className="pro-input" required />
              </div>
              <div>
                <label className="pro-label">Registered Office Address</label>
                <textarea name="receivingPartyAddress" value={formData.receivingPartyAddress} onChange={handleChange} placeholder="Full registered office address with PIN code" rows={2} className="pro-input" style={{ resize: 'none' }} required />
              </div>
            </div>
          </div>

          {/* Proposed Transaction & Purpose */}
          <div className="pro-card">
            <div className="pro-section-header">
              <div className="pro-section-icon" style={{ background: 'rgba(245,158,11,0.1)', color: '#fbbf24' }}><FileText size={18} /></div>
              <div>
                <h3 className="pro-section-title">Transaction & Purpose</h3>
                <p className="pro-section-sub">Describe the deal and why information is being shared</p>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label className="pro-label">Proposed Transaction</label>
                <textarea name="proposedTransaction" value={formData.proposedTransaction} onChange={handleChange}
                  placeholder="e.g. proposes to provide [Receiving Party Name] with a sample unit of its product for evaluation, to assess potential bulk purchase and future commercial engagement. (Note: Disclosing Party name is auto-prepended)"
                  rows={3} className="pro-input" style={{ resize: 'none' }} required />
              </div>
              <div>
                <label className="pro-label">Purpose of Disclosing Confidential Information</label>
                <textarea name="purposeOfDisclosure" value={formData.purposeOfDisclosure} onChange={handleChange}
                  placeholder="e.g. [Disclosing Party] is sharing confidential information solely to enable [Receiving Party] to evaluate the technical capabilities, performance, and commercial viability of the product for potential bulk procurement and future business collaboration."
                  rows={3} className="pro-input" style={{ resize: 'none' }} required />
              </div>
            </div>
          </div>

          {/* Specific Confidential Information */}
          <div className="pro-card">
            <div className="pro-section-header">
              <div className="pro-section-icon" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171' }}><Lock size={18} /></div>
              <div>
                <h3 className="pro-section-title">Specific Confidential Items</h3>
                <p className="pro-section-sub">Enter each item on a new line — these become bullet points in the {docLabel}</p>
              </div>
            </div>
            <div>
              <label className="pro-label">Confidential Items</label>
              <textarea name="specificConfidentialItems" value={formData.specificConfidentialItems} onChange={handleChange}
                placeholder={"e.g.\nThe physical product sample provided for evaluation\nProprietary hardware architecture and board design\nInternal circuit design concepts and engineering logic\nFirmware behavior, embedded logic, and system functionality\nTechnical documentation, user guides, and evaluation materials\nCommercial pricing, bulk procurement terms, and business discussions"}
                rows={6} className="pro-input" style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: '1.6' }} required />
            </div>
          </div>

          {/* Terms & Duration */}
          <div className="pro-card">
            <div className="pro-section-header">
              <div className="pro-section-icon" style={{ background: 'rgba(6,182,212,0.1)', color: '#22d3ee' }}><Clock size={18} /></div>
              <div>
                <h3 className="pro-section-title">Terms & Duration</h3>
                <p className="pro-section-sub">Obligation and non-solicitation periods</p>
              </div>
            </div>
            <div className="form-grid">
              <div>
                <label className="pro-label">Confidentiality Obligation (Years)</label>
                <select name="obligationYears" value={formData.obligationYears} onChange={handleChange} className="pro-input">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n} {n === 1 ? 'Year' : 'Years'}</option>)}
                </select>
              </div>
              <div>
                <label className="pro-label">Non-Solicitation Period (Years)</label>
                <select name="nonSolicitationYears" value={formData.nonSolicitationYears} onChange={handleChange} className="pro-input">
                  {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} {n === 1 ? 'Year' : 'Years'}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Dispute Resolution */}
          <div className="pro-card">
            <div className="pro-section-header">
              <div className="pro-section-icon" style={{ background: 'rgba(100,116,139,0.1)', color: '#94a3b8' }}><Gavel size={18} /></div>
              <div>
                <h3 className="pro-section-title">Dispute Resolution</h3>
                <p className="pro-section-sub">Arbitration and court jurisdiction location</p>
              </div>
            </div>
            <div className="form-grid">
              <div>
                <label className="pro-label">Arbitration City</label>
                <input name="arbitrationCity" value={formData.arbitrationCity} onChange={handleChange} placeholder="e.g. Chennai" className="pro-input" required />
              </div>
              <div>
                <label className="pro-label">Arbitration State</label>
                <input name="arbitrationState" value={formData.arbitrationState} onChange={handleChange} placeholder="e.g. Tamil Nadu" className="pro-input" required />
              </div>
            </div>
          </div>

          {/* Signatories */}
          <div className="pro-card">
            <div className="pro-section-header">
              <div className="pro-section-icon" style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8' }}><Users size={18} /></div>
              <div>
                <h3 className="pro-section-title">Authorized Signatories</h3>
                <p className="pro-section-sub">Representatives signing on behalf of each party</p>
              </div>
            </div>

            {/* Disclosing Party Signatory */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.875rem' }}>
                Disclosing Party
              </div>
              <div className="form-grid">
                <div>
                  <label className="pro-label">Signatory Name</label>
                  <input name="disclosingSignatoryName" value={formData.disclosingSignatoryName} onChange={handleChange} placeholder="Full name" className="pro-input" required />
                </div>
                <div>
                  <label className="pro-label">Designation</label>
                  <input name="disclosingSignatoryDesignation" value={formData.disclosingSignatoryDesignation} onChange={handleChange} placeholder="e.g. CEO / Director" className="pro-input" required />
                </div>
                <div>
                  <label className="pro-label">Signing Date</label>
                  <input type="date" name="disclosingSignatoryDate" value={formData.disclosingSignatoryDate} onChange={handleChange} className="pro-input" required />
                </div>
                <div>
                  <label className="pro-label">Upload Signature</label>
                  <div style={{ position: 'relative' }}>
                    <input type="file" onChange={(e) => handleFileUpload(e, 'disclosingSignature')} accept="image/*" style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer', zIndex: 10 }} />
                    <div className="pro-add-item-btn" style={{ height: '42px', margin: 0, borderStyle: 'dotted' }}>
                      <Camera size={16} /> {formData.disclosingSignature ? 'Signature Uploaded' : 'Upload Signature'}
                    </div>
                    {formData.disclosingSignature && (
                      <img src={formData.disclosingSignature} alt="Signature" style={{ height: '28px', display: 'block', margin: '0.25rem auto' }} />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '0.5rem 0 1.5rem' }} />

            {/* Receiving Party Signatory */}
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.875rem' }}>
                Receiving Party
              </div>
              <div className="form-grid">
                <div>
                  <label className="pro-label">Signatory Name</label>
                  <input name="receivingSignatoryName" value={formData.receivingSignatoryName} onChange={handleChange} placeholder="Full name" className="pro-input" required />
                </div>
                <div>
                  <label className="pro-label">Designation</label>
                  <input name="receivingSignatoryDesignation" value={formData.receivingSignatoryDesignation} onChange={handleChange} placeholder="e.g. CEO / Director" className="pro-input" required />
                </div>
                <div>
                  <label className="pro-label">Signing Date</label>
                  <input type="date" name="receivingSignatoryDate" value={formData.receivingSignatoryDate} onChange={handleChange} className="pro-input" required />
                </div>
                <div>
                  <label className="pro-label">Upload Signature</label>
                  <div style={{ position: 'relative' }}>
                    <input type="file" onChange={(e) => handleFileUpload(e, 'receivingSignature')} accept="image/*" style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer', zIndex: 10 }} />
                    <div className="pro-add-item-btn" style={{ height: '42px', margin: 0, borderStyle: 'dotted' }}>
                      <Camera size={16} /> {formData.receivingSignature ? 'Signature Uploaded' : 'Upload Signature'}
                    </div>
                    {formData.receivingSignature && (
                      <img src={formData.receivingSignature} alt="Signature" style={{ height: '28px', display: 'block', margin: '0.25rem auto' }} />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <button type="submit" disabled={isSubmitting || limitReached} className="btn btn-primary pro-btn" style={{ height: '52px', width: '100%' }}>
            {isSubmitting ? 'Generating...' : limitReached ? 'Limit Reached' : `Save & Download ${docLabel}`}
            {!isSubmitting && !limitReached && <ChevronRight size={18} />}
          </button>

          {/* Mobile-only preview button */}
          <button type="button" onClick={handlePreview} className="btn btn-outline pro-btn mou-mobile-preview-btn" style={{ height: '44px', width: '100%' }}>
            <Eye size={18} /> Preview as PDF
          </button>

        </form>
      </div>

      {/* RIGHT: Live Preview Pane */}
      <div className="mou-preview-pane">
        <div className="mou-preview-toolbar">
          <span className="mou-preview-toolbar-label">
            <FileText size={14} /> Live Preview
          </span>
          <button type="button" onClick={handlePreview} className="btn btn-outline" style={{ padding: '0.375rem 0.875rem', fontSize: '0.75rem', height: '32px' }}>
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
