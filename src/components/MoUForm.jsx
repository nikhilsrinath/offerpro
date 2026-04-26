import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, CheckCircle, Eye, ChevronRight } from 'lucide-react';
import { pdfService } from '../services/pdfService';
import { storageService } from '../services/storageService';
import { useAuth } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';
import { usePlanStatus } from '../hooks/usePlanStatus';
import MoUPreview from './MoUPreview';
import { resolveFormImages, generateStampPng } from '../utils/imageUtils';

export default function MoUForm() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const { currentPlan, planConfig, usage, canCreate, getRemainingCount, getUsagePercent, isAtLimit, refreshUsage } = usePlanStatus();
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
    firstPartyName: org.company_name || '',
    firstPartyIncorporation: 'India',
    firstPartyAddress: org.company_address || '',
    secondPartyName: '',
    secondPartyType: 'company',
    secondPartyIncorporation: 'India',
    secondPartyAddress: '',
    purpose: '',
    scopeAreas: '',
    firstPartyResponsibilities: '',
    secondPartyResponsibilities: '',
    mouTermYears: '2',
    arbitrationCity: '',
    firstPartySignatoryName: org.owner_full_name || '',
    firstPartySignatoryDesignation: org.document_designation || '',
    firstPartySignatoryDate: '',
    firstPartySignature: org.signature_url || null,
    secondPartySignatoryName: '',
    secondPartySignatoryDesignation: '',
    secondPartySignatoryDate: '',
    secondPartySignature: null,
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
    if (!canCreate('mou')) {
      alert(`You've reached your ${planConfig.name} plan limit of ${planConfig.limits.mou} MoUs. Please upgrade to continue.`);
      return;
    }
    setIsSubmitting(true);
    try {
      const resolved = await resolveFormImages(formData, ['firstPartySignature', 'secondPartySignature', 'companyLogo', 'stampUrl']);
      if (resolved.stampType === 'generated') {
        resolved.stampPng = await generateStampPng(resolved.firstPartyName, resolved.stampCity);
      }
      await storageService.save(formData, 'mou', activeOrg?.id, user?.id);
      await pdfService.generateMoU(resolved);
      await refreshUsage();
      setTimeout(() => {
        setIsSubmitting(false);
        navigate('/records');
      }, 800);
    } catch (err) {
      console.error(err);
      alert("Error saving MoU: " + err.message);
      setIsSubmitting(false);
    }
  };

  const handlePreview = async () => {
    const resolved = await resolveFormImages(formData, ['firstPartySignature', 'secondPartySignature', 'companyLogo', 'stampUrl']);
    if (resolved.stampType === 'generated') {
      resolved.stampPng = await generateStampPng(resolved.firstPartyName, resolved.stampCity);
    }
    await pdfService.generateMoU(resolved, true);
  };

  return (
    <div className="mou-split-layout">

      {/* LEFT: Form */}
      <div className="mou-form-pane">
        <form onSubmit={handleSubmit} className="easy-form animate-in" style={{ maxWidth: '100%' }}>

          {/* Plan Usage */}
          {currentPlan !== 'max' && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.75rem 1rem',
              background: 'var(--bg-elevated)',
              borderRadius: '10px',
              marginBottom: '1.5rem',
              fontSize: '0.8125rem',
              border: isAtLimit('mou') ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--border-subtle)'
            }}>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>MoU Documents</span>
              <div style={{ flex: 1, height: '4px', background: 'var(--bg-raised)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  borderRadius: '2px',
                  background: isAtLimit('mou') ? '#ef4444' : getUsagePercent('mou') > 80 ? '#f59e0b' : '#3b82f6',
                  transition: 'width 0.3s',
                  width: `${Math.min(getUsagePercent('mou'), 100)}%`
                }} />
              </div>
              <span style={{ fontWeight: 700, color: isAtLimit('mou') ? '#ef4444' : 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                {usage.mou}/{planConfig.limits.mou === Infinity ? '∞' : planConfig.limits.mou}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>({getRemainingCount('mou')} remaining)</span>
            </div>
          )}

          {isAtLimit('mou') && (
            <div style={{
              textAlign: 'center',
              padding: '1.5rem',
              background: 'rgba(239,68,68,0.04)',
              border: '1px solid rgba(239,68,68,0.15)',
              borderRadius: '12px',
              marginBottom: '1.5rem'
            }}>
              <div style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>⚠️</div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>MoU Limit Reached</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                You've used all {planConfig.limits.mou} MoUs in your {planConfig.name} plan.
              </p>
              <a href="mailto:edgeossuite@gmail.com" className="btn-cinematic" style={{ textDecoration: 'none', padding: '0.75rem 1.5rem', fontSize: '0.875rem' }}>
                Upgrade to {currentPlan === 'free' ? 'Pro' : 'Max'}
              </a>
            </div>
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

          {/* 2. First Party */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">2</div>
              <span className="easy-section-title">First party</span>
            </div>
            <div className="easy-row">
              <div className="easy-field full">
                <label className="easy-lbl">Company / entity name</label>
                <input name="firstPartyName" value={formData.firstPartyName} onChange={handleChange} placeholder="e.g. Auralinks Corporation LLC" className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Country of incorporation</label>
                <input name="firstPartyIncorporation" value={formData.firstPartyIncorporation} onChange={handleChange} placeholder="India" className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Registered office address</label>
                <textarea name="firstPartyAddress" value={formData.firstPartyAddress} onChange={handleChange} placeholder="Full address with PIN code" rows={2} className="easy-inp" style={{ resize: 'none' }} required />
              </div>
            </div>
          </div>

          {/* 3. Second Party */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">3</div>
              <span className="easy-section-title">Second party</span>
            </div>
            <div className="easy-row">
              <div className="easy-field full">
                <label className="easy-lbl">Company / individual name</label>
                <input name="secondPartyName" value={formData.secondPartyName} onChange={handleChange} placeholder="e.g. Beta Labs Private Limited" className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Entity type</label>
                <select name="secondPartyType" value={formData.secondPartyType} onChange={handleChange} className="easy-inp">
                  <option value="company">Company</option>
                  <option value="individual">Individual</option>
                </select>
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Country of incorporation</label>
                <input name="secondPartyIncorporation" value={formData.secondPartyIncorporation} onChange={handleChange} placeholder="India" className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Registered office address</label>
                <textarea name="secondPartyAddress" value={formData.secondPartyAddress} onChange={handleChange} placeholder="Full address with PIN code" rows={2} className="easy-inp" style={{ resize: 'none' }} required />
              </div>
            </div>
          </div>

          {/* 4. Purpose */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">4</div>
              <span className="easy-section-title">Purpose of MoU</span>
            </div>
            <div className="easy-field">
              <label className="easy-lbl">Describe the purpose of this collaboration</label>
              <textarea name="purpose" value={formData.purpose} onChange={handleChange}
                placeholder="e.g. To establish a framework of cooperation for joint development and deployment of AI-powered solutions for the healthcare industry..."
                rows={4} className="easy-inp" style={{ resize: 'vertical' }} required />
            </div>
          </div>

          {/* 5. Scope of Collaboration */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">5</div>
              <span className="easy-section-title">Scope of collaboration</span>
            </div>
            <div className="easy-field">
              <label className="easy-lbl">Enter each collaboration area on a new line</label>
              <textarea name="scopeAreas" value={formData.scopeAreas} onChange={handleChange}
                placeholder={"e.g.\nDevelopment of AI-powered analytics platform\nSharing of technical expertise and knowledge\nJoint exploration of market opportunities\nCo-development of research papers and publications"}
                rows={5} className="easy-inp" style={{ resize: 'vertical', lineHeight: '1.6' }} required />
            </div>
          </div>

          {/* 6. Responsibilities */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">6</div>
              <span className="easy-section-title">Roles & responsibilities</span>
            </div>
            <div className="easy-row">
              <div className="easy-field full">
                <label className="easy-lbl">First party responsibilities (one per line)</label>
                <textarea name="firstPartyResponsibilities" value={formData.firstPartyResponsibilities} onChange={handleChange}
                  placeholder={"e.g.\nProvide technology platform and infrastructure\nParticipate in planning and coordination\nShare relevant knowledge and technical expertise\nFulfill commitments for successful implementation"}
                  rows={4} className="easy-inp" style={{ resize: 'vertical', lineHeight: '1.6' }} required />
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">Second party responsibilities (one per line)</label>
                <textarea name="secondPartyResponsibilities" value={formData.secondPartyResponsibilities} onChange={handleChange}
                  placeholder={"e.g.\nProvide domain expertise and industry knowledge\nSupport implementation of collaborative activities\nCoordinate with First Party for execution\nEnsure timely performance of assigned duties"}
                  rows={4} className="easy-inp" style={{ resize: 'vertical', lineHeight: '1.6' }} required />
              </div>
            </div>
          </div>

          {/* 7. Term & Dispute Resolution */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">7</div>
              <span className="easy-section-title">Term & dispute resolution</span>
            </div>
            <div className="easy-row">
              <div className="easy-field">
                <label className="easy-lbl">MoU term (years)</label>
                <select name="mouTermYears" value={formData.mouTermYears} onChange={handleChange} className="easy-inp">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n} {n === 1 ? 'Year' : 'Years'}</option>)}
                </select>
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Place of arbitration</label>
                <input name="arbitrationCity" value={formData.arbitrationCity} onChange={handleChange} placeholder="e.g. Chennai" className="easy-inp" required />
              </div>
            </div>
          </div>

          {/* 8. Signatories */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">8</div>
              <span className="easy-section-title">Signatories</span>
            </div>

            {/* First Party */}
            <div className="easy-party-label">First Party</div>
            <div className="easy-row">
              <div className="easy-field">
                <label className="easy-lbl">Name</label>
                <input name="firstPartySignatoryName" value={formData.firstPartySignatoryName} onChange={handleChange} placeholder="Full name" className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Designation</label>
                <input name="firstPartySignatoryDesignation" value={formData.firstPartySignatoryDesignation} onChange={handleChange} placeholder="e.g. Managing Director & CEO" className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Signing date</label>
                <input type="date" name="firstPartySignatoryDate" value={formData.firstPartySignatoryDate} onChange={handleChange} className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Signature</label>
                <div className="easy-upload-wrap">
                  <input type="file" onChange={(e) => handleFileUpload(e, 'firstPartySignature')} accept="image/*" />
                  <div className={`easy-upload ${formData.firstPartySignature ? 'done' : ''}`}>
                    {formData.firstPartySignature ? <><CheckCircle size={16} /> Uploaded</> : <><Upload size={16} /> Upload signature</>}
                  </div>
                </div>
                {formData.firstPartySignature && <img src={formData.firstPartySignature} alt="Signature" style={{ height: '28px', marginTop: '0.25rem' }} />}
              </div>
            </div>

            <div className="easy-divider" />

            {/* Second Party */}
            <div className="easy-party-label purple">Second Party</div>
            <div className="easy-row">
              <div className="easy-field">
                <label className="easy-lbl">Name</label>
                <input name="secondPartySignatoryName" value={formData.secondPartySignatoryName} onChange={handleChange} placeholder="Full name" className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Designation</label>
                <input name="secondPartySignatoryDesignation" value={formData.secondPartySignatoryDesignation} onChange={handleChange} placeholder="e.g. CEO / Director" className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Signing date</label>
                <input type="date" name="secondPartySignatoryDate" value={formData.secondPartySignatoryDate} onChange={handleChange} className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Signature</label>
                <div className="easy-upload-wrap">
                  <input type="file" onChange={(e) => handleFileUpload(e, 'secondPartySignature')} accept="image/*" />
                  <div className={`easy-upload ${formData.secondPartySignature ? 'done' : ''}`}>
                    {formData.secondPartySignature ? <><CheckCircle size={16} /> Uploaded</> : <><Upload size={16} /> Upload signature</>}
                  </div>
                </div>
                {formData.secondPartySignature && <img src={formData.secondPartySignature} alt="Signature" style={{ height: '28px', marginTop: '0.25rem' }} />}
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
          <button type="submit" disabled={isSubmitting || isAtLimit('mou')} className="easy-submit">
            {isSubmitting ? 'Generating...' : isAtLimit('mou') ? 'Limit Reached' : 'Save & Download MoU'}
            {!isSubmitting && !isAtLimit('mou') && <ChevronRight size={18} />}
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
          <MoUPreview formData={formData} />
        </div>
      </div>

    </div>
  );
}
