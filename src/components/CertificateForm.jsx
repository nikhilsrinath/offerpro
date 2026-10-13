import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, CheckCircle, ChevronRight, Eye, Trash2, ImagePlus, Sparkles, RectangleHorizontal, RectangleVertical } from 'lucide-react';
import { pdfService } from '../services/pdfService';
import { storageService } from '../services/storageService';
import { useAuth } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';
import { resolveFormImages } from '../utils/imageUtils';
import {
  CERTIFICATE_DEFAULTS, CERTIFICATE_ACCENTS, CERTIFICATE_TITLES, certificateYear, certificateFooter,
} from '../services/certificateTemplates';
import CertificatePreview from './CertificatePreview';
import A4Stage from './shared/A4Stage';
import ImageAdjust from './shared/ImageAdjust';

const IMAGE_FIELDS = ['logo', 'signature', 'secondSignature', 'art', 'stampUrl'];

const STAMP_POSITIONS = [
  { id: 'bottom-right', label: 'Bottom Right' },
  { id: 'bottom-center', label: 'Bottom Centre' },
  { id: 'title', label: 'Beside Title' },
  { id: 'art', label: 'On Artwork' },
];

/* A picked file as a data URL. With `max`, a large photo is first brought down
   to that many pixels on its long side, so the saved certificate stays small. */
const readImage = (file, max) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = reject;
  reader.onloadend = () => {
    if (!max) { resolve(reader.result); return; }
    const img = new Image();
    img.onerror = () => resolve(reader.result);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      if (k === 1 && file.size < 600 * 1024) { resolve(reader.result); return; }
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * k);
      canvas.height = Math.round(img.naturalHeight * k);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

/* An upload that can be taken off again, and readjusted while it is there. */
function ImageField({ label, value, onPick, onRemove, adjust, onAdjust }) {
  return (
    <div className="easy-field full">
      <label className="easy-lbl">{label}</label>
      <div className="easy-upload-wrap">
        <input aria-label={label} type="file" onChange={onPick} accept="image/*" />
        <div className={`easy-upload ${value ? 'done' : ''}`}>
          {value ? <><CheckCircle size={16} /> {label} added · choose another</> : <><Upload size={16} /> Choose file</>}
        </div>
      </div>
      {value && (
        <div className="cert-img-actions">
          <button type="button" className="cert-btn danger" onClick={onRemove} aria-label={`Remove ${label.toLowerCase()}`}>
            <Trash2 size={13} aria-hidden="true" /> Remove
          </button>
          <ImageAdjust label={label} value={adjust} onChange={onAdjust} />
        </div>
      )}
    </div>
  );
}

export default function CertificateForm() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const org = activeOrg || {};
  const [formData, setFormData] = useState({
    template: 'custom',
    orientation: CERTIFICATE_DEFAULTS.orientation,
    accentColor: CERTIFICATE_DEFAULTS.accentColor,
    art: null,          // an image of the person's own; none is the sample drawing
    artHidden: false,   // the artwork band taken off the sheet altogether
    showStamp: true,
    stampPosition: 'bottom-right',
    stampType: org.stamp_type || 'generated',
    stampUrl: org.stamp_url || '',
    stampCity: org.stamp_city || '',
    stampCompany: org.company_name || '',
    certificateTitle: CERTIFICATE_DEFAULTS.certificateTitle,
    introLine: CERTIFICATE_DEFAULTS.introLine,
    recipientName: '',
    achievementTitle: '',
    issuingOrganization: org.company_name || '',
    location: org.city || '',
    issueDate: '',
    yearLabel: '',
    description: '',
    footerLine: '',
    authorizedSignatory: org.owner_full_name || '',
    signatoryDesignation: org.document_designation || '',
    secondSignatory: '',
    secondDesignation: '',
    logo: org.logo_url || null,
    signature: org.signature_url || null,
    secondSignature: null,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const set = (patch) => setFormData((prev) => ({ ...prev, ...patch }));
  const handleChange = (e) => set({ [e.target.name]: e.target.value });

  // Picking a file again after removing it must fire, so the input is emptied.
  const pick = (field, max) => async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = await readImage(file, max);
      set(field === 'art' ? { art: data, artHidden: false, artAdjust: null } : { [field]: data, [field + 'Adjust']: null });
    } catch (err) {
      console.error(err);
      alert('That image could not be read. Try a PNG or JPG.');
    }
  };
  const remove = (field) => () => set({ [field]: null, [field + 'Adjust']: null });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const resolved = await resolveFormImages(formData, IMAGE_FIELDS);
      await storageService.save(formData, 'certificate', activeOrg?.id, user?.id);
      await pdfService.generateCertificate(resolved);
      setTimeout(() => {
        setIsSubmitting(false);
        navigate('/records');
      }, 800);
    } catch (err) {
      console.error(err);
      alert("Error saving certificate: " + err.message);
      setIsSubmitting(false);
    }
  };

  const handlePreview = async () => {
    const resolved = await resolveFormImages(formData, IMAGE_FIELDS);
    pdfService.generateCertificate(resolved, true);
  };

  const portrait = formData.orientation === 'portrait';
  const artState = formData.artHidden ? 'none' : formData.art ? 'custom' : 'sample';
  const artNote = {
    sample: 'Sample artwork, in your accent colour',
    custom: 'Your image, cropped to fill the band',
    none: 'No artwork: the text takes the whole sheet',
  }[artState];
  // The stamp cannot sit on artwork that has been taken off the sheet.
  // Nor in the bottom right once a second signatory signs there: it moves to the centre.
  const hasSecond = !!(formData.secondSignatory || formData.secondDesignation || formData.secondSignature);
  const stampPositions = STAMP_POSITIONS.filter((p) => (p.id !== 'art' || !formData.artHidden) && (p.id !== 'bottom-right' || !hasSecond));
  const stampPosition = stampPositions.some((p) => p.id === formData.stampPosition) ? formData.stampPosition : hasSecond ? 'bottom-center' : 'bottom-right';

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
                <input aria-label="Full name" name="recipientName" value={formData.recipientName} onChange={handleChange} required placeholder="Jane Smith" className="easy-inp" />
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">Programme / achievement</label>
                <input aria-label="Programme / achievement" name="achievementTitle" value={formData.achievementTitle} onChange={handleChange} required placeholder="React Development Bootcamp" className="easy-inp" />
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">Description</label>
                <textarea aria-label="Description" name="description" value={formData.description} onChange={handleChange} placeholder="For outstanding performance..." rows="3" className="easy-inp" style={{ resize: 'vertical' }} />
              </div>
            </div>
          </div>

          {/* 2. Design */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">2</div>
              <span className="easy-section-title">Design</span>
            </div>
            <div className="easy-row">
              <div className="easy-field">
                <span className="easy-lbl" id="cert-orient">Orientation</span>
                <div className="cert-seg" role="group" aria-labelledby="cert-orient">
                  <button type="button" aria-pressed={!portrait} className={!portrait ? 'active' : ''} onClick={() => set({ orientation: 'landscape' })}>
                    <RectangleHorizontal size={14} aria-hidden="true" /> Landscape
                  </button>
                  <button type="button" aria-pressed={portrait} className={portrait ? 'active' : ''} onClick={() => set({ orientation: 'portrait' })}>
                    <RectangleVertical size={14} aria-hidden="true" /> Portrait
                  </button>
                </div>
              </div>
              <div className="easy-field">
                <span className="easy-lbl" id="cert-accent">Accent colour</span>
                <div className="cert-swatches" role="group" aria-labelledby="cert-accent">
                  {CERTIFICATE_ACCENTS.map((c) => (
                    <button
                      key={c.id} type="button" title={c.label} aria-label={c.label} aria-pressed={formData.accentColor === c.id}
                      className={`cert-swatch ${formData.accentColor === c.id ? 'active' : ''}`}
                      style={{ background: c.id }} onClick={() => set({ accentColor: c.id })}
                    />
                  ))}
                  <input type="color" className="cert-swatch-custom" aria-label="Custom accent colour" title="Custom colour"
                    value={formData.accentColor} onChange={(e) => set({ accentColor: e.target.value })} />
                </div>
              </div>

              <div className="easy-field full">
                <span className="easy-lbl" id="cert-art">Artwork</span>
                <div className="cert-art" role="group" aria-labelledby="cert-art">
                  <div className={`cert-art-thumb ${portrait ? 'wide' : ''} ${artState}`} aria-hidden="true"
                    style={artState === 'none' ? undefined : {
                      backgroundColor: formData.accentColor,
                      backgroundImage: formData.art ? `url("${formData.art}")` : undefined,
                    }}>
                    {artState === 'sample' && <Sparkles size={16} />}
                  </div>
                  <div className="cert-art-side">
                    <div className="cert-art-note" aria-live="polite">{artNote}</div>
                    <div className="cert-art-btns">
                      <label className="cert-btn">
                        <ImagePlus size={13} aria-hidden="true" /> {formData.art ? 'Change Image' : 'Upload Image'}
                        <input type="file" accept="image/*" onChange={pick('art', 1800)} aria-label="Upload artwork image" />
                      </label>
                      {artState !== 'sample' && (
                        <button type="button" className="cert-btn" onClick={() => set({ art: null, artAdjust: null, artHidden: false })}>
                          <Sparkles size={13} aria-hidden="true" /> Use Sample
                        </button>
                      )}
                      {artState !== 'none' && (
                        <button type="button" className="cert-btn danger" onClick={() => set({ art: null, artAdjust: null, artHidden: true })}>
                          <Trash2 size={13} aria-hidden="true" /> Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {artState === 'custom' && (
                  <ImageAdjust label="Artwork" value={formData.artAdjust} onChange={(v) => set({ artAdjust: v })} />
                )}
              </div>

              <div className="easy-field full">
                <button
                  type="button" role="switch" aria-checked={!!formData.showStamp}
                  className={`easy-switch-row ${formData.showStamp ? 'active' : ''}`}
                  onClick={() => set({ showStamp: !formData.showStamp })}
                >
                  <span className="easy-switch-label">Include company stamp</span>
                  <span className="easy-switch-dot" aria-hidden="true" />
                </button>
              </div>
              {formData.showStamp && (
                <div className="easy-field full">
                  <span className="easy-lbl" id="cert-stamp-pos">Stamp position</span>
                  <div className="cert-seg" role="group" aria-labelledby="cert-stamp-pos">
                    {stampPositions.map((p) => (
                      <button key={p.id} type="button" aria-pressed={stampPosition === p.id} className={stampPosition === p.id ? 'active' : ''}
                        onClick={() => set({ stampPosition: p.id, stampAdjust: null })}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <ImageAdjust label="Round Seal" value={formData.stampAdjust} onChange={(v) => set({ stampAdjust: v })} />
                </div>
              )}

              <div className="easy-field full">
                <label className="easy-lbl">Certificate title</label>
                <input aria-label="Certificate title" name="certificateTitle" list="cert-titles" value={formData.certificateTitle} onChange={handleChange} placeholder={CERTIFICATE_DEFAULTS.certificateTitle} className="easy-inp" />
                <datalist id="cert-titles">
                  {CERTIFICATE_TITLES.map((title) => <option key={title} value={title} />)}
                </datalist>
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">Line above the name</label>
                <input aria-label="Line above the name" name="introLine" value={formData.introLine} onChange={handleChange} placeholder={CERTIFICATE_DEFAULTS.introLine} className="easy-inp" />
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">Line under the description</label>
                <input aria-label="Line under the description" name="footerLine" value={formData.footerLine} onChange={handleChange} placeholder={certificateFooter({ ...formData, footerLine: '' })} className="easy-inp" />
                <span className="cert-hint">Left empty, it is written from the programme, organization and location.</span>
              </div>
            </div>
          </div>

          {/* 3. Organization */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">3</div>
              <span className="easy-section-title">Issuing Organization</span>
            </div>
            <div className="easy-row">
              <div className="easy-field full">
                <label className="easy-lbl">{formData.logo ? 'Organization name (optional)' : 'Organization name'}</label>
                <input aria-label="Organization name" name="issuingOrganization" value={formData.issuingOrganization} onChange={handleChange} required={!formData.logo} placeholder="Acme Academy" className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Location</label>
                <input aria-label="Location" name="location" value={formData.location} onChange={handleChange} placeholder="Bengaluru" className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Issue date</label>
                <input aria-label="Issue date" type="date" name="issueDate" value={formData.issueDate} onChange={handleChange} required className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Year on the artwork</label>
                <input aria-label="Year on the artwork" name="yearLabel" value={formData.yearLabel} onChange={handleChange} maxLength={4} inputMode="numeric" placeholder={certificateYear({ ...formData, yearLabel: '' })} className="easy-inp" />
              </div>
              <ImageField
                label="Logo" value={formData.logo} onPick={pick('logo')} onRemove={remove('logo')}
                adjust={formData.logoAdjust} onAdjust={(v) => set({ logoAdjust: v })}
              />
            </div>
          </div>

          {/* 4. Signatories */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">4</div>
              <span className="easy-section-title">Signatories</span>
            </div>
            <div className="easy-row">
              <div className="easy-field">
                <label className="easy-lbl">Signatory name</label>
                <input aria-label="Signatory name" name="authorizedSignatory" value={formData.authorizedSignatory} onChange={handleChange} required placeholder="Dr. Robert Johnson" className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Designation</label>
                <input aria-label="Designation" name="signatoryDesignation" value={formData.signatoryDesignation} onChange={handleChange} required placeholder="Program Director" className="easy-inp" />
              </div>
              <ImageField
                label="Signature" value={formData.signature} onPick={pick('signature')} onRemove={remove('signature')}
                adjust={formData.signatureAdjust} onAdjust={(v) => set({ signatureAdjust: v })}
              />

              <div className="easy-field">
                <label className="easy-lbl">Second signatory (optional)</label>
                <input aria-label="Second signatory name" name="secondSignatory" value={formData.secondSignatory} onChange={handleChange} placeholder="Priya Menon" className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Designation</label>
                <input aria-label="Second signatory designation" name="secondDesignation" value={formData.secondDesignation} onChange={handleChange} placeholder="Vice President" className="easy-inp" />
              </div>
              <ImageField
                label="Second signature" value={formData.secondSignature} onPick={pick('secondSignature')} onRemove={remove('secondSignature')}
                adjust={formData.secondSignatureAdjust} onAdjust={(v) => set({ secondSignatureAdjust: v })}
              />
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
        <A4Stage>
          <CertificatePreview formData={formData} />
        </A4Stage>
      </div>


    </div>
  );
}
