import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, CheckCircle, Eye, ChevronRight, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { pdfService } from '../../services/pdfService';
import { storageService } from '../../services/storageService';
import { useAuth } from '../../context/AuthContext';
import { useOrg } from '../../context/OrgContext';
import { initialAgreement, partiesShown, TEMPLATE_KINDS } from '../../services/agreementModel';
import { resolveFormImages, generateStampPng } from '../../utils/imageUtils';
import A4Stage from '../shared/A4Stage';
import AgreementPreview from './AgreementPreview';
import { useFormProject, useClientAsParty, linkRecordToProject, projectFormNote } from '../projects/projectScope';

const IMAGE_FIELDS = ['firstPartySignature', 'secondPartySignature', 'companyLogo', 'stampUrl'];

function Section({ num, title, children }) {
  return (
    <div className="easy-section">
      <div className="easy-section-head">
        <div className="easy-num">{num}</div>
        <span className="easy-section-title">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Switch({ label, on, onToggle }) {
  return (
    <button type="button" role="switch" aria-checked={!!on}
      className={`easy-switch-row ${on ? 'active' : ''}`} onClick={onToggle}>
      <span className="easy-switch-label">{label}</span>
      <span className="easy-switch-dot" aria-hidden="true" />
    </button>
  );
}

/**
 * Partnership Agreement and Custom Template editors. Both are the same
 * document shape: company header, parties, numbered clauses, signatures and
 * witnesses: and differ in where the clauses come from: a partnership builds
 * them from its terms, a custom template takes them as typed.
 */
export default function AgreementForm({ kind }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const [formData, setFormData] = useState(() => initialAgreement(kind, activeOrg || {}));
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Opened from a project's Documents: the client is the second party, and
  // the saved agreement is put on the project.
  const fromProject = useFormProject('record', '/records');
  useClientAsParty(fromProject.client, setFormData, { name: 'secondPartyName', address: 'secondPartyAddress' });

  // The org can finish loading after the form mounts. When it arrives, fill
  // the letterhead and first-party fields that are still blank.
  const [filledFor, setFilledFor] = useState(activeOrg?.id || null);
  if (activeOrg?.id && activeOrg.id !== filledFor) {
    setFilledFor(activeOrg.id);
    const fromOrg = initialAgreement(kind, activeOrg);
    setFormData((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(fromOrg)) {
        if ((prev[k] === '' || prev[k] == null) && v !== '' && v != null) next[k] = v;
      }
      return next;
    });
  }

  const custom = kind === 'custom';
  const shown = partiesShown(formData);

  const set = (name, value) => setFormData((prev) => ({ ...prev, [name]: value }));
  const handleChange = (e) => set(e.target.name, e.target.value);

  const handleFileUpload = (e, field) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => set(field, reader.result);
    reader.readAsDataURL(file);
  };

  // ── custom clauses ────────────────────────────────────────────────────────
  const setClause = (id, field, value) =>
    set('clauses', formData.clauses.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  const addClause = () =>
    set('clauses', [...formData.clauses, { id: Math.max(0, ...formData.clauses.map((c) => c.id)) + 1, heading: '', body: '' }]);
  const removeClause = (id) => set('clauses', formData.clauses.filter((c) => c.id !== id));
  const moveClause = (index, delta) => {
    const next = [...formData.clauses];
    const [c] = next.splice(index, 1);
    next.splice(index + delta, 0, c);
    set('clauses', next);
  };

  const resolved = async () => {
    const r = await resolveFormImages(formData, IMAGE_FIELDS);
    if (r.stampType === 'generated') r.stampPng = await generateStampPng(r.firstPartyName, r.stampCity);
    return r;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const r = await resolved();
      const saved = await storageService.save(formData, 'agreement', activeOrg?.id, user?.id);
      const linkError = await linkRecordToProject(fromProject.projectId, saved?.id);
      if (linkError) alert(`Saved, but ${linkError}. Link it from the project's Documents.`);
      await pdfService.generateAgreement(r);
      setTimeout(() => {
        setIsSubmitting(false);
        navigate(fromProject.returnTo);
      }, 800);
    } catch (err) {
      console.error(err);
      alert(`Error saving ${TEMPLATE_KINDS[kind].short.toLowerCase()} document: ${err.message}`);
      setIsSubmitting(false);
    }
  };

  const handlePreview = async () => pdfService.generateAgreement(await resolved(), true);

  let n = 0;
  const next = () => ++n;

  return (
    <div className="mou-split-layout">

      <div className="mou-form-pane">
        <form onSubmit={handleSubmit} className="easy-form animate-in" style={{ maxWidth: '100%' }}>

          {fromProject.project && (
            <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{projectFormNote(fromProject.project)}</p>
          )}

          <Section num={next()} title="Document details">
            <div className="easy-row">
              <div className="easy-field full">
                <label className="easy-lbl" htmlFor="agr-title">Title</label>
                <input id="agr-title" name="title" value={formData.title} onChange={handleChange}
                  placeholder={custom ? 'e.g. Service Agreement, Letter of Intent, Declaration' : 'Partnership Agreement'}
                  className="easy-inp" required />
              </div>
              <div className="easy-field">
                <label className="easy-lbl" htmlFor="agr-date">Effective date</label>
                <input id="agr-date" type="date" name="effectiveDate" value={formData.effectiveDate} onChange={handleChange} className="easy-inp" required={!custom} />
              </div>
              <div className="easy-field">
                <label className="easy-lbl" htmlFor="agr-city">City of execution</label>
                <input id="agr-city" name="executionCity" value={formData.executionCity} onChange={handleChange} placeholder="e.g. Chennai" className="easy-inp" required={!custom} />
              </div>
              <div className="easy-field">
                <label className="easy-lbl" htmlFor="agr-state">State</label>
                <input id="agr-state" name="executionState" value={formData.executionState} onChange={handleChange} placeholder="e.g. Tamil Nadu" className="easy-inp" required={!custom} />
              </div>
            </div>
          </Section>

          {custom && (
            <Section num={next()} title="Show on document">
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <Switch label="First party" on={formData.showFirstParty} onToggle={() => set('showFirstParty', !formData.showFirstParty)} />
                <Switch label="Second party" on={formData.showSecondParty} onToggle={() => set('showSecondParty', !formData.showSecondParty)} />
                <Switch label="Witnesses" on={formData.showWitnesses} onToggle={() => set('showWitnesses', !formData.showWitnesses)} />
              </div>
            </Section>
          )}

          {shown.first && (
            <Section num={next()} title="First party">
              <div className="easy-row">
                <div className="easy-field full">
                  <label className="easy-lbl" htmlFor="fp-name">Company / entity name</label>
                  <input id="fp-name" name="firstPartyName" value={formData.firstPartyName} onChange={handleChange} placeholder="e.g. Auralinks Corporation LLC" className="easy-inp" required />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl" htmlFor="fp-inc">Country of incorporation</label>
                  <input id="fp-inc" name="firstPartyIncorporation" value={formData.firstPartyIncorporation} onChange={handleChange} placeholder="India" className="easy-inp" required />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl" htmlFor="fp-addr">Registered office address</label>
                  <textarea id="fp-addr" name="firstPartyAddress" value={formData.firstPartyAddress} onChange={handleChange} placeholder="Full address with PIN code" rows={2} className="easy-inp" style={{ resize: 'none' }} required />
                </div>
              </div>
            </Section>
          )}

          {shown.second && (
            <Section num={next()} title="Second party">
              <div className="easy-row">
                <div className="easy-field full">
                  <label className="easy-lbl" htmlFor="sp-name">Company / individual name</label>
                  <input id="sp-name" name="secondPartyName" value={formData.secondPartyName} onChange={handleChange} placeholder="e.g. Beta Labs Private Limited" className="easy-inp" required />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl" htmlFor="sp-type">Entity type</label>
                  <select id="sp-type" name="secondPartyType" value={formData.secondPartyType} onChange={handleChange} className="easy-inp">
                    <option value="company">Company</option>
                    <option value="individual">Individual</option>
                  </select>
                </div>
                {formData.secondPartyType === 'company' && (
                  <div className="easy-field">
                    <label className="easy-lbl" htmlFor="sp-inc">Country of incorporation</label>
                    <input id="sp-inc" name="secondPartyIncorporation" value={formData.secondPartyIncorporation} onChange={handleChange} placeholder="India" className="easy-inp" required />
                  </div>
                )}
                <div className="easy-field full">
                  <label className="easy-lbl" htmlFor="sp-addr">{formData.secondPartyType === 'individual' ? 'Residential address' : 'Registered office address'}</label>
                  <textarea id="sp-addr" name="secondPartyAddress" value={formData.secondPartyAddress} onChange={handleChange} placeholder="Full address with PIN code" rows={2} className="easy-inp" style={{ resize: 'none' }} required />
                </div>
              </div>
            </Section>
          )}

          {custom ? (
            <Section num={next()} title="Content">
              {formData.clauses.map((c, i) => (
                <div key={c.id} className="easy-line-item">
                  <div className="easy-line-num">{i + 1}</div>
                  <div className="easy-line-fields">
                    <input aria-label={`Clause ${i + 1} heading`} value={c.heading} onChange={(e) => setClause(c.id, 'heading', e.target.value)}
                      placeholder="Heading (optional), e.g. Scope of Work" className="easy-inp" style={{ marginBottom: '0.5rem' }} />
                    <textarea aria-label={`Clause ${i + 1} text`} value={c.body} onChange={(e) => setClause(c.id, 'body', e.target.value)}
                      placeholder="Paragraph text. Each new line starts a new paragraph."
                      rows={4} className="easy-inp" style={{ resize: 'vertical', lineHeight: '1.6' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <button type="button" className="easy-delete-btn" onClick={() => moveClause(i, -1)} disabled={i === 0}
                      title="Move up" aria-label={`Move clause ${i + 1} up`}><ArrowUp size={16} /></button>
                    <button type="button" className="easy-delete-btn" onClick={() => moveClause(i, 1)} disabled={i === formData.clauses.length - 1}
                      title="Move down" aria-label={`Move clause ${i + 1} down`}><ArrowDown size={16} /></button>
                    <button type="button" className="easy-delete-btn" onClick={() => removeClause(c.id)} disabled={formData.clauses.length === 1}
                      title="Remove" aria-label={`Remove clause ${i + 1}`}><Trash2 size={16} /></button>
                  </div>
                </div>
              ))}
              <button type="button" onClick={addClause} className="easy-add-btn">
                <Plus size={16} /> Add section
              </button>
            </Section>
          ) : (
            <>
              <Section num={next()} title="Business of the partnership">
                <div className="easy-row">
                  <div className="easy-field full">
                    <label className="easy-lbl" htmlFor="pt-name">Business name (optional)</label>
                    <input id="pt-name" name="businessName" value={formData.businessName} onChange={handleChange} placeholder="e.g. Auralinks Beta Ventures" className="easy-inp" />
                  </div>
                  <div className="easy-field full">
                    <label className="easy-lbl" htmlFor="pt-purpose">Nature of business</label>
                    <textarea id="pt-purpose" name="businessPurpose" value={formData.businessPurpose} onChange={handleChange}
                      placeholder="e.g. Joint development, marketing and sale of AI-powered analytics software for the healthcare industry"
                      rows={3} className="easy-inp" style={{ resize: 'vertical' }} required />
                  </div>
                </div>
              </Section>

              <Section num={next()} title="Contributions & profit sharing">
                <div className="easy-row">
                  <div className="easy-field full">
                    <label className="easy-lbl" htmlFor="pt-fpc">First party contribution</label>
                    <input id="pt-fpc" name="firstPartyContribution" value={formData.firstPartyContribution} onChange={handleChange} placeholder="e.g. ₹10,00,000 in capital and the technology platform" className="easy-inp" required />
                  </div>
                  <div className="easy-field full">
                    <label className="easy-lbl" htmlFor="pt-spc">Second party contribution</label>
                    <input id="pt-spc" name="secondPartyContribution" value={formData.secondPartyContribution} onChange={handleChange} placeholder="e.g. Sales network, domain expertise and ₹5,00,000" className="easy-inp" required />
                  </div>
                  <div className="easy-field">
                    <label className="easy-lbl" htmlFor="pt-share">First party profit share (%)</label>
                    <input id="pt-share" type="number" min="0" max="100" step="0.01" name="firstPartyShare" value={formData.firstPartyShare} onChange={handleChange} className="easy-inp" required />
                  </div>
                  <div className="easy-field">
                    <label className="easy-lbl" htmlFor="pt-share2">Second party profit share (%)</label>
                    <input id="pt-share2" value={Math.round((100 - Math.min(100, Math.max(0, parseFloat(formData.firstPartyShare) || 0))) * 100) / 100} readOnly className="easy-inp" aria-readonly="true" />
                  </div>
                </div>
              </Section>

              <Section num={next()} title="Roles & responsibilities">
                <div className="easy-row">
                  <div className="easy-field full">
                    <label className="easy-lbl" htmlFor="pt-fpr">First party responsibilities (one per line)</label>
                    <textarea id="pt-fpr" name="firstPartyResponsibilities" value={formData.firstPartyResponsibilities} onChange={handleChange}
                      placeholder={'e.g.\nBuild and maintain the product\nManage hosting and infrastructure'}
                      rows={3} className="easy-inp" style={{ resize: 'vertical', lineHeight: '1.6' }} />
                  </div>
                  <div className="easy-field full">
                    <label className="easy-lbl" htmlFor="pt-spr">Second party responsibilities (one per line)</label>
                    <textarea id="pt-spr" name="secondPartyResponsibilities" value={formData.secondPartyResponsibilities} onChange={handleChange}
                      placeholder={'e.g.\nLead sales and client relationships\nHandle regulatory approvals'}
                      rows={3} className="easy-inp" style={{ resize: 'vertical', lineHeight: '1.6' }} />
                  </div>
                </div>
              </Section>

              <Section num={next()} title="Term & dispute resolution">
                <div className="easy-row">
                  <div className="easy-field">
                    <label className="easy-lbl" htmlFor="pt-term">Term (years)</label>
                    <select id="pt-term" name="termYears" value={formData.termYears} onChange={handleChange} className="easy-inp">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((y) => <option key={y} value={y}>{y} {y === 1 ? 'Year' : 'Years'}</option>)}
                    </select>
                  </div>
                  <div className="easy-field">
                    <label className="easy-lbl" htmlFor="pt-notice">Termination notice (days)</label>
                    <input id="pt-notice" type="number" min="1" name="noticeDays" value={formData.noticeDays} onChange={handleChange} className="easy-inp" required />
                  </div>
                  <div className="easy-field">
                    <label className="easy-lbl" htmlFor="pt-arb">Place of arbitration</label>
                    <input id="pt-arb" name="arbitrationCity" value={formData.arbitrationCity} onChange={handleChange} placeholder="e.g. Chennai" className="easy-inp" required />
                  </div>
                </div>
              </Section>
            </>
          )}

          {(shown.first || shown.second) && (
            <Section num={next()} title="Signatories">
              {[shown.first && 'firstParty', shown.second && 'secondParty'].filter(Boolean).map((p, i) => (
                <div key={p}>
                  {i > 0 && <div className="easy-divider" />}
                  <div className={`easy-party-label ${p === 'secondParty' ? 'purple' : ''}`}>{p === 'firstParty' ? 'First Party' : 'Second Party'}</div>
                  <div className="easy-row">
                    <div className="easy-field">
                      <label className="easy-lbl" htmlFor={`${p}-sn`}>Name</label>
                      <input id={`${p}-sn`} name={`${p}SignatoryName`} value={formData[`${p}SignatoryName`]} onChange={handleChange} placeholder="Full name" className="easy-inp" required />
                    </div>
                    <div className="easy-field">
                      <label className="easy-lbl" htmlFor={`${p}-sd`}>Designation</label>
                      <input id={`${p}-sd`} name={`${p}SignatoryDesignation`} value={formData[`${p}SignatoryDesignation`]} onChange={handleChange} placeholder="e.g. Managing Director" className="easy-inp" />
                    </div>
                    <div className="easy-field">
                      <label className="easy-lbl" htmlFor={`${p}-sdt`}>Signing date</label>
                      <input id={`${p}-sdt`} type="date" name={`${p}SignatoryDate`} value={formData[`${p}SignatoryDate`]} onChange={handleChange} className="easy-inp" />
                    </div>
                    <div className="easy-field">
                      <span className="easy-lbl">Signature</span>
                      <div className="easy-upload-wrap">
                        <input aria-label={`${p === 'firstParty' ? 'First' : 'Second'} party signature`} type="file" onChange={(e) => handleFileUpload(e, `${p}Signature`)} accept="image/*" />
                        <div className={`easy-upload ${formData[`${p}Signature`] ? 'done' : ''}`}>
                          {formData[`${p}Signature`] ? <><CheckCircle size={16} /> Uploaded</> : <><Upload size={16} /> Upload signature</>}
                        </div>
                      </div>
                      {formData[`${p}Signature`] && <img src={formData[`${p}Signature`]} alt="Signature" style={{ height: '28px', marginTop: '0.25rem' }} />}
                    </div>
                    {p === 'firstParty' && (
                      <div className="easy-field full">
                        <Switch label="Include company stamp" on={formData.showStamp} onToggle={() => set('showStamp', !formData.showStamp)} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </Section>
          )}

          <button type="submit" disabled={isSubmitting} className="easy-submit">
            {isSubmitting ? 'Generating...' : 'Save & Download'}
            {!isSubmitting && <ChevronRight size={18} />}
          </button>

          <button type="button" onClick={handlePreview} className="easy-submit-outline mou-mobile-preview-btn" style={{ marginTop: '0.75rem' }}>
            <Eye size={16} /> Preview as PDF
          </button>
        </form>
      </div>

      <div className="mou-preview-pane">
        <div className="mou-preview-toolbar">
          <span className="mou-preview-toolbar-label">Live Preview</span>
          <button type="button" onClick={handlePreview} className="easy-submit-outline" style={{ padding: '0.375rem 0.875rem', fontSize: '0.75rem', width: 'auto' }}>
            <Eye size={14} /> Open PDF
          </button>
        </div>
        <A4Stage>
          <AgreementPreview formData={formData} />
        </A4Stage>
      </div>

    </div>
  );
}
