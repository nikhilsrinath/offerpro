import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeaveGuard } from '../hooks/useLeaveGuard';
import {
  ChevronRight, ChevronDown, Eye, Trash2, ImagePlus, Sparkles, RectangleHorizontal, RectangleVertical, Type, Plus, AlertCircle, X,
  MousePointerClick,
} from 'lucide-react';
import { pdfService } from '../services/pdfService';
import { storageService } from '../services/storageService';
import { useAuth } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';
import { resolveFormImages } from '../utils/imageUtils';
import {
  CERTIFICATE_DEFAULTS, CERTIFICATE_ACCENTS, CERTIFICATE_PAPERS, CERTIFICATE_TITLES,
} from '../services/certificateTemplates';
import CertificatePreview from './CertificatePreview';
import A4Stage from './shared/A4Stage';
import { EditProvider, EditBar } from './shared/Editable';

/* The certificate is made on the certificate itself, the way a design tool
   works: click any line of text and type on it, click the logo, a signature,
   the seal or the artwork to move, resize, replace or remove it. The bar over
   the sheet holds whatever the selected item can do, and, with nothing
   selected, the page's own settings (orientation, colours, issue date) and
   the pieces that can be added back. */

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

// A button that opens the file picker.
function UploadButton({ label, onPick }) {
  return (
    <label className="cert-btn">
      <ImagePlus size={13} aria-hidden="true" /> {label}
      <input type="file" accept="image/*" onChange={onPick} aria-label={label} />
    </label>
  );
}

/* A colour as one button showing it; the choices open under it, the way a
   design tool keeps its toolbar to one line. */
function ColourPick({ label, options, value, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const named = options.find((c) => c.id === value)?.label || 'Custom';
  return (
    <div className="cert-pop" ref={ref}>
      <button type="button" className="cert-tool-btn" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}
        aria-label={`${label}: ${named}`}>
        <span className="cert-dot" style={{ background: value }} aria-hidden="true" /> {label}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div className="cert-pop-panel" role="group" aria-label={label}>
          <div className="cert-swatches compact">
            {options.map((c) => (
              <button
                key={c.id} type="button" title={c.label} aria-label={c.label} aria-pressed={value === c.id}
                className={`cert-swatch ${value === c.id ? 'active' : ''}`}
                style={{ background: c.id }} onClick={() => onPick(c.id)}
              />
            ))}
          </div>
          <label className="cert-pop-custom">
            <input type="color" className="cert-swatch-custom" aria-label={`Custom ${label.toLowerCase()}`}
              value={value} onChange={(e) => onPick(e.target.value)} />
            Custom colour
          </label>
        </div>
      )}
    </div>
  );
}

// What has to be on a certificate before it can be issued, and where it is on the sheet.
const REQUIRED = [
  { field: 'recipientName', item: 'nameAdjust', label: 'Recipient Name', text: 'recipientName', message: "Type the recipient's name on the certificate." },
  { field: 'achievementTitle', item: 'footerAdjust', label: 'Line Under The Description', message: 'Add the programme or achievement in the bar above.' },
  { field: 'issueDate', item: null, message: 'Pick the issue date in the bar above.' },
  { field: 'authorizedSignatory', item: 'signatoryAdjust', label: 'Signatory Name', text: 'authorizedSignatory', message: "Type the signatory's name." },
  { field: 'signatoryDesignation', item: 'signatoryAdjust', label: 'Signatory Name', text: 'signatoryDesignation', message: "Type the signatory's designation." },
];

export default function CertificateForm({ switcher }) {
  const navigate = useNavigate();
  // Leaving with the document half filled in asks first; saving it does not.
  const leave = useLeaveGuard();
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const org = activeOrg || {};
  const [formData, setFormData] = useState({
    template: 'custom',
    orientation: CERTIFICATE_DEFAULTS.orientation,
    accentColor: CERTIFICATE_DEFAULTS.accentColor,
    paperColor: CERTIFICATE_DEFAULTS.paperColor,
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
    secondShown: false, // a second signatory added from the bar, before anything is typed for them
    secondSignatory: '',
    secondDesignation: '',
    logo: org.logo_url || null,
    signature: org.signature_url || null,
    secondSignature: null,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  // What is picked on the sheet ({ field, label, text, zoom }), and the text being typed on.
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [problem, setProblem] = useState('');

  const set = (patch) => { setFormData((prev) => ({ ...prev, ...patch })); leave.markDirty(); setProblem(''); };
  const place = (field, value) => set({ [field]: value });
  const choose = (next) => {
    setSelected(next);
    if (!next || next.field !== selected?.field) setEditing(null);
  };

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
  const remove = (field) => () => { set({ [field]: null, [field + 'Adjust']: null }); choose(null); };

  const handleSubmit = async () => {
    const empty = (f) => !String(formData[f] || '').trim();
    const needs = [...REQUIRED];
    if (!formData.logo) needs.push({ field: 'issuingOrganization', item: 'orgAdjust', label: 'Company Name', text: 'issuingOrganization', message: 'Type the company name on the certificate.' });
    // A line under the description typed by hand stands in for the programme.
    const gap = needs.find((n) => empty(n.field) && !(n.field === 'achievementTitle' && !empty('footerLine')));
    if (gap) {
      setProblem(gap.message);
      setSelected(gap.item ? { field: gap.item, label: gap.label, text: gap.text } : null);
      setEditing(gap.text || null);
      return;
    }
    setIsSubmitting(true);
    try {
      const resolved = await resolveFormImages(formData, IMAGE_FIELDS);
      await storageService.save(formData, 'certificate', activeOrg?.id, user?.id);
      await pdfService.generateCertificate(resolved);
      leave.release();
      setTimeout(() => {
        setIsSubmitting(false);
        navigate('/documents/records');
      }, 800);
    } catch (err) {
      console.error(err);
      alert("Error saving certificate: " + err.message);
      setIsSubmitting(false);
    }
  };

  const handlePreview = async () => {
    choose(null);
    const resolved = await resolveFormImages(formData, IMAGE_FIELDS);
    pdfService.generateCertificate(resolved, true);
  };

  const portrait = formData.orientation === 'portrait';
  // The stamp cannot sit on artwork that has been taken off the sheet.
  // Nor in the bottom right once a second signatory signs there: it moves to the centre.
  // Without artwork a lone signatory signs in the centre, so the stamp cannot go there.
  const hasSecond = !!(formData.secondShown || formData.secondSignatory || formData.secondDesignation || formData.secondSignature);
  const stampPositions = STAMP_POSITIONS.filter((p) => (p.id !== 'art' || !formData.artHidden)
    && (p.id !== 'bottom-right' || !hasSecond)
    && (p.id !== 'bottom-center' || hasSecond || !formData.artHidden));
  const stampPosition = stampPositions.some((p) => p.id === formData.stampPosition) ? formData.stampPosition : hasSecond ? 'bottom-center' : 'bottom-right';

  const dateInput = (
    <label className="cert-tool">
      <span className="cert-tool-lbl">Issue Date</span>
      <input type="date" className="cert-tool-inp" aria-label="Issue date" value={formData.issueDate}
        onChange={(e) => set({ issueDate: e.target.value })} />
    </label>
  );
  const typeButton = selected?.text && (
    <button type="button" className="edit-bar-text" onClick={() => setEditing(selected.text)}>
      <Type size={13} aria-hidden="true" /> Edit Text
    </button>
  );

  // What the selected item can do, beside moving and resizing it.
  const tools = (() => {
    switch (selected?.field) {
      case 'logoAdjust':
        return <>
          <UploadButton label="Replace Logo" onPick={pick('logo')} />
          <button type="button" className="cert-btn danger" onClick={remove('logo')}><Trash2 size={13} aria-hidden="true" /> Remove</button>
        </>;
      case 'placeAdjust':
        return <>{typeButton}{dateInput}</>;
      case 'titleAdjust':
        return <>
          {typeButton}
          <select className="cert-tool-inp" aria-label="Choose a title" value=""
            onChange={(e) => e.target.value && set({ certificateTitle: e.target.value })}>
            <option value="">Choose A Title…</option>
            {CERTIFICATE_TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </>;
      case 'footerAdjust':
        return <>
          {typeButton}
          <label className="cert-tool">
            <span className="cert-tool-lbl">Programme</span>
            <input className="cert-tool-inp wide" aria-label="Programme or achievement" placeholder="React Development Bootcamp"
              value={formData.achievementTitle} onChange={(e) => set({ achievementTitle: e.target.value })} />
          </label>
          {formData.footerLine && (
            <button type="button" className="cert-btn" onClick={() => set({ footerLine: '' })}>
              <Sparkles size={13} aria-hidden="true" /> Write It For Me
            </button>
          )}
        </>;
      case 'signatureAdjust':
      case 'signatoryAdjust':
        return <>
          {typeButton}
          <UploadButton label={formData.signature ? 'Replace Signature' : 'Add Signature'} onPick={pick('signature')} />
          {formData.signature && (
            <button type="button" className="cert-btn danger" onClick={remove('signature')}><Trash2 size={13} aria-hidden="true" /> Remove Signature</button>
          )}
        </>;
      case 'secondSignatureAdjust':
      case 'secondSignatoryAdjust':
        return <>
          {typeButton}
          <UploadButton label={formData.secondSignature ? 'Replace Signature' : 'Add Signature'} onPick={pick('secondSignature')} />
          <button type="button" className="cert-btn danger" onClick={() => {
            set({
              secondShown: false, secondSignatory: '', secondDesignation: '', secondSignature: null,
              secondSignatureAdjust: null, secondSignatoryAdjust: null,
            });
            choose(null);
          }}><Trash2 size={13} aria-hidden="true" /> Remove Signatory</button>
        </>;
      case 'stampAdjust':
        return <>
          <select className="cert-tool-inp" aria-label="Seal position" value={stampPosition}
            onChange={(e) => set({ stampPosition: e.target.value, stampAdjust: null })}>
            {stampPositions.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <button type="button" className="cert-btn danger" onClick={() => { set({ showStamp: false }); choose(null); }}>
            <Trash2 size={13} aria-hidden="true" /> Remove
          </button>
        </>;
      case 'artAdjust':
        return <>
          <UploadButton label={formData.art ? 'Replace Image' : 'Use My Image'} onPick={pick('art', 1800)} />
          {formData.art && (
            <button type="button" className="cert-btn" onClick={() => set({ art: null, artAdjust: null })}>
              <Sparkles size={13} aria-hidden="true" /> Use Sample
            </button>
          )}
          {!formData.art && (
            <input type="color" className="cert-swatch-custom" aria-label="Artwork colour" title="Artwork colour"
              value={formData.accentColor} onChange={(e) => set({ accentColor: e.target.value })} />
          )}
          <button type="button" className="cert-btn danger" onClick={() => { set({ art: null, artAdjust: null, artHidden: true }); choose(null); }}>
            <Trash2 size={13} aria-hidden="true" /> Remove Artwork
          </button>
        </>;
      default:
        return typeButton || null;
    }
  })();

  // With nothing selected: the page itself, and what can be put back on it.
  const pageTools = (
    <div className="cert-tools" role="group" aria-label="Page">
      <div className="cert-seg" role="group" aria-label="Orientation">
        <button type="button" aria-pressed={!portrait} className={!portrait ? 'active' : ''} onClick={() => set({ orientation: 'landscape' })}
          title="Landscape" aria-label="Landscape">
          <RectangleHorizontal size={15} aria-hidden="true" />
        </button>
        <button type="button" aria-pressed={portrait} className={portrait ? 'active' : ''} onClick={() => set({ orientation: 'portrait' })}
          title="Portrait" aria-label="Portrait">
          <RectangleVertical size={15} aria-hidden="true" />
        </button>
      </div>
      <ColourPick label="Accent" options={CERTIFICATE_ACCENTS} value={formData.accentColor} onPick={(c) => set({ accentColor: c })} />
      <ColourPick label="Background" options={CERTIFICATE_PAPERS} value={formData.paperColor} onPick={(c) => set({ paperColor: c })} />
      {dateInput}
      <span className="cert-tools-sep" aria-hidden="true" />
      {!formData.logo && <UploadButton label="Add Logo" onPick={pick('logo')} />}
      {formData.artHidden && (
        <button type="button" className="cert-btn" onClick={() => set({ artHidden: false })}><Plus size={13} aria-hidden="true" /> Add Artwork</button>
      )}
      {!formData.showStamp && (
        <button type="button" className="cert-btn" onClick={() => set({ showStamp: true })}><Plus size={13} aria-hidden="true" /> Add Seal</button>
      )}
      {!hasSecond && (
        <button type="button" className="cert-btn" onClick={() => {
          set({ secondShown: true });
          setSelected({ field: 'secondSignatoryAdjust', label: 'Second Signatory Name', text: 'secondSignatory' });
          setEditing('secondSignatory');
        }}><Plus size={13} aria-hidden="true" /> Add Signatory</button>
      )}
    </div>
  );

  return (
    <EditProvider
      selected={selected} onSelect={choose} onChange={place}
      editing={editing} onEdit={setEditing} onText={(field, value) => set({ [field]: value })}
    >
    <div className="cert-editor">
      <div className="cert-head">
        {switcher}
        <span className="cert-head-hint">
          <MousePointerClick size={13} aria-hidden="true" /> Click anything on the certificate to edit it
        </span>
        <div className="cert-actions">
          <button type="button" onClick={handlePreview} className="cert-act">
            <Eye size={14} aria-hidden="true" /> Preview PDF
          </button>
          <button type="button" onClick={handleSubmit} className="cert-act primary" disabled={isSubmitting}>
            {isSubmitting ? 'Generating…' : 'Issue Certificate'}
            {!isSubmitting && <ChevronRight size={15} aria-hidden="true" />}
          </button>
        </div>
      </div>
      <div className="cert-body">
        <div className="cert-bar">
          {selected ? (
            <EditBar
              selected={selected} value={formData[selected.field]}
              onChange={(v) => place(selected.field, v)} onDone={() => choose(null)}
            >
              {tools}
            </EditBar>
          ) : pageTools}
        </div>
        {problem && (
          <div className="cert-problem" role="alert">
            <AlertCircle size={14} aria-hidden="true" /> {problem}
            <button type="button" aria-label="Dismiss" onClick={() => setProblem('')}><X size={13} aria-hidden="true" /></button>
          </div>
        )}
        {/* A tap anywhere on the paper but an item lets go of the selection. */}
        <div className="edit-stage cert-stage" onPointerDown={() => choose(null)}>
          <A4Stage fit="page">
            <CertificatePreview formData={formData} />
          </A4Stage>
        </div>
      </div>
    </div>
    </EditProvider>
  );
}
