// NoticeForm: an employee's notice of termination, written like the NDA, MoU
// and agreement templates: the form on the left, the live A4 sheet on the
// right, and a PDF that matches it. Opened from the Payment tab of the
// employee's sheet. Saving files the notice on their record (records,
// type 'termination'), downloads the PDF and makes the link they acknowledge
// it at. Acknowledging only records it: they stay on the team until End.
import { useState } from 'react';
import { ArrowLeft, Upload, CheckCircle, Eye, ChevronRight, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { pdfService } from '../../services/pdfService';
import { documentStore } from '../../services/documentStore';
import { createPortalLink } from '../../services/portalService';
import { useOrg } from '../../context/OrgContext';
import { useLeaveGuard } from '../../hooks/useLeaveGuard';
import { initialNotice, buildNotice, addDays, NOTICE_PAY } from '../../services/noticeModel';
import { resolveFormImages, generateStampPng } from '../../utils/imageUtils';
import A4Stage from '../shared/A4Stage';
import { EditProvider, EditBar } from '../shared/Editable';
import AgreementPreview from '../agreements/AgreementPreview';
import { confirmDialog } from '../../services/confirm';

const IMAGE_FIELDS = ['firstPartySignature', 'companyLogo', 'stampUrl'];

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
 * `emp` is the employee; `notice`, a notice already saved for them, opens it
 * to edit (its form comes back; saving updates the same record).
 */
export default function NoticeForm({ emp, notice = null, onBack }) {
  const { activeOrg } = useOrg();
  const org = activeOrg || {};
  const leave = useLeaveGuard();
  const [formData, setFormData] = useState(() => ({ ...initialNotice(emp, org), ...(notice?.form || {}) }));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);   // { link, linkError }
  const [selected, setSelected] = useState(null);
  // Typed in and not saved: Back asks first.
  const [dirty, setDirty] = useState(false);
  const goBack = async () => {
    if (dirty && !done && !(await confirmDialog({
      title: 'Leave the notice', message: 'What you changed in this notice has not been saved.', confirmLabel: 'Leave',
    }))) return;
    leave.release();
    onBack();
  };

  const set = (name, value) => { setFormData((p) => ({ ...p, [name]: value })); leave.markDirty(); setDirty(true); };
  const handleChange = (e) => set(e.target.name, e.target.value);
  const place = (field, value) => set(field, value);

  // The last working day follows the notice date and period until it is typed.
  const setDates = (name, value) => {
    setFormData((p) => {
      const next = { ...p, [name]: value };
      if (!p.lastDayTyped) next.lastDay = addDays(next.noticeDate, next.noticeDays);
      return next;
    });
    leave.markDirty();
    setDirty(true);
  };

  const handleFileUpload = (e, field) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => set(field, reader.result);
    reader.readAsDataURL(file);
  };

  // ── extra clauses ─────────────────────────────────────────────────────────
  const clauses = formData.clauses || [];
  const setClause = (id, field, value) => set('clauses', clauses.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  const addClause = () => set('clauses', [...clauses, { id: Math.max(0, ...clauses.map((c) => c.id)) + 1, heading: '', body: '' }]);
  const removeClause = (id) => set('clauses', clauses.filter((c) => c.id !== id));
  const moveClause = (index, delta) => {
    const next = [...clauses];
    const [c] = next.splice(index, 1);
    next.splice(index + delta, 0, c);
    set('clauses', next);
  };

  const resolved = async () => {
    const r = await resolveFormImages(formData, IMAGE_FIELDS);
    if (r.stampType === 'generated') r.stampPng = await generateStampPng(r.firstPartyName, r.stampCity);
    return r;
  };
  const handlePreview = async () => pdfService.generateAgreement(await resolved(), true, buildNotice);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formData.lastDay && formData.noticeDate && formData.lastDay < formData.noticeDate) {
      alert('The last working day cannot be before the notice date.');
      return;
    }
    setBusy(true);
    try {
      documentStore.setContext(org.id);
      await documentStore.init();
      const built = buildNotice(formData);
      // The form is kept (without its images, which the org already has) so
      // the notice can be opened and edited again.
      const form = Object.fromEntries(Object.entries(formData).filter(([k]) => !IMAGE_FIELDS.includes(k)));
      const saved = await documentStore.save({
        ...(notice?.id ? { id: notice.id } : {}),
        type: 'termination', status: notice?.status || 'sent',
        title: `${formData.title || 'Notice'} – ${formData.employeeName || emp.studentName || ''}`.trim(),
        issued_to: formData.employeeName || emp.studentName || '',
        recipient_email: emp.email || '', recipient_phone: emp.phone || '',
        current_role: formData.employeeRole, current_department: formData.employeeDepartment,
        employee_id: emp.id,
        company_profile: {
          company_name: org.company_name || '', logo_url: org.logo_url || '',
          company_email: org.company_email || '', company_phone: org.company_phone || '',
          address: org.company_address || '',
        },
        issue_date: formData.noticeDate,
        last_day: formData.lastDay, notice_date: formData.noticeDate,
        notice_days: Number(formData.noticeDays) || 0, notice_pay: formData.noticePay,
        message: formData.reason,
        // Acknowledging it records it; the person stays until End.
        ends_employment: false,
        // What the portal shows: the notice as written here.
        notice: { title: built.title, preamble: built.preamble, clauses: built.clauses },
        form,
      });
      await pdfService.generateAgreement(await resolved(), false, buildNotice);
      leave.release();
      let link = null;
      let linkError = '';
      try {
        ({ url: link } = await createPortalLink({ orgId: org.id, documentId: saved?.id || notice?.id, recipientEmail: emp.email }));
      } catch (err) {
        linkError = err.message || 'The link could not be made.';
      }
      setDone({ link, linkError });
    } catch (err) {
      console.error(err);
      alert(`Error saving the notice: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const head = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <button type="button" className="easy-submit-outline" onClick={goBack}
        style={{ width: 'auto', padding: '0.375rem 0.875rem', fontSize: '0.8125rem' }}>
        <ArrowLeft size={14} /> Back to {emp.studentName || 'the employee'}
      </button>
      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
        {notice ? 'Edit notice' : 'New notice'} · {emp.studentName}
      </span>
    </div>
  );

  if (done) {
    return (
      <div>
        {head}
        <div className="easy-section" style={{ maxWidth: 640 }}>
          <div className="easy-section-title" style={{ marginBottom: 8 }}>The notice is saved and downloaded</div>
          {done.link ? (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 10px' }}>
                Send {emp.studentName || 'them'} this link. They read the notice and acknowledge it there; it is then marked acknowledged on their record. They stay on the team until you press End.
              </p>
              <code style={{ display: 'block', fontSize: 12, wordBreak: 'break-all', padding: '8px 10px', border: '1px solid var(--border-subtle)', borderRadius: 6, marginBottom: 10 }}>{done.link}</code>
              <button type="button" className="easy-submit" style={{ width: 'auto' }} onClick={() => navigator.clipboard.writeText(done.link)}>Copy link</button>
            </>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
              It is on their record, but the link to acknowledge it could not be made: {done.linkError} Open it again from the Payment tab to try once more.
            </p>
          )}
        </div>
      </div>
    );
  }

  let n = 0;
  const next = () => ++n;

  return (
    <div>
      {head}
      <EditProvider selected={selected} onSelect={setSelected} onChange={place}>
      <div className="mou-split-layout">
        <div className="mou-form-pane">
          <form {...leave.formProps} onSubmit={handleSubmit} className="easy-form animate-in" style={{ maxWidth: '100%' }}>

            <Section num={next()} title="Notice">
              <div className="easy-row">
                <div className="easy-field full">
                  <label className="easy-lbl" htmlFor="nt-title">Title</label>
                  <input id="nt-title" name="title" value={formData.title} onChange={handleChange} className="easy-inp" required />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl" htmlFor="nt-date">Notice date</label>
                  <input id="nt-date" type="date" value={formData.noticeDate} onChange={(e) => setDates('noticeDate', e.target.value)} className="easy-inp" required />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl" htmlFor="nt-days">Notice period (days)</label>
                  <input id="nt-days" type="number" min="0" max="365" value={formData.noticeDays} onChange={(e) => setDates('noticeDays', e.target.value)} className="easy-inp" required />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl" htmlFor="nt-last">Last working day</label>
                  <input id="nt-last" type="date" value={formData.lastDay} min={formData.noticeDate || undefined}
                    onChange={(e) => { setFormData((p) => ({ ...p, lastDay: e.target.value, lastDayTyped: true })); setDirty(true); }} className="easy-inp" required />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl" htmlFor="nt-pay">During the notice period</label>
                  <select id="nt-pay" name="noticePay" value={formData.noticePay} onChange={handleChange} className="easy-inp">
                    {Object.entries(NOTICE_PAY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="easy-field full">
                  <label className="easy-lbl" htmlFor="nt-reason">Reason (optional)</label>
                  <textarea id="nt-reason" name="reason" value={formData.reason} onChange={handleChange} rows={3}
                    placeholder="Leave empty to give no reason. Each new line starts a new paragraph."
                    className="easy-inp" style={{ resize: 'vertical', lineHeight: '1.6' }} />
                </div>
                <div className="easy-field full">
                  <span className="easy-lbl">Logo</span>
                  <div className="easy-upload-wrap">
                    <input aria-label="Logo" type="file" onChange={(e) => { if (e.target.files[0]) set('logoAdjust', null); handleFileUpload(e, 'companyLogo'); }} accept="image/*" />
                    <div className={`easy-upload ${formData.companyLogo ? 'done' : ''}`}>
                      {formData.companyLogo ? <><CheckCircle size={16} /> Logo added · choose another</> : <><Upload size={16} /> Upload logo</>}
                    </div>
                  </div>
                </div>
              </div>
            </Section>

            <Section num={next()} title="Employee">
              <div className="easy-row">
                <div className="easy-field">
                  <label className="easy-lbl" htmlFor="nt-name">Name</label>
                  <input id="nt-name" name="employeeName" value={formData.employeeName} onChange={handleChange} className="easy-inp" required />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl" htmlFor="nt-code">Employee ID</label>
                  <input id="nt-code" name="employeeCode" value={formData.employeeCode} onChange={handleChange} className="easy-inp" />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl" htmlFor="nt-role">Designation</label>
                  <input id="nt-role" name="employeeRole" value={formData.employeeRole} onChange={handleChange} className="easy-inp" />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl" htmlFor="nt-dept">Department</label>
                  <input id="nt-dept" name="employeeDepartment" value={formData.employeeDepartment} onChange={handleChange} className="easy-inp" />
                </div>
                <div className="easy-field full">
                  <label className="easy-lbl" htmlFor="nt-addr">Address</label>
                  <textarea id="nt-addr" name="employeeAddress" value={formData.employeeAddress} onChange={handleChange} rows={2}
                    className="easy-inp" style={{ resize: 'none' }} />
                </div>
              </div>
            </Section>

            <Section num={next()} title="Terms">
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                <Switch label="Full and final settlement" on={formData.showSettlement} onToggle={() => set('showSettlement', !formData.showSettlement)} />
                {formData.showSettlement && (
                  <div className="easy-row">
                    <div className="easy-field full">
                      <textarea aria-label="Full and final settlement" name="settlementText" value={formData.settlementText} onChange={handleChange}
                        rows={4} className="easy-inp" style={{ resize: 'vertical', lineHeight: '1.6' }} />
                    </div>
                    <div className="easy-field">
                      <label className="easy-lbl" htmlFor="nt-settle">Paid within (days of the last day)</label>
                      <input id="nt-settle" type="number" min="0" name="settlementDays" value={formData.settlementDays} onChange={handleChange} className="easy-inp" />
                    </div>
                  </div>
                )}
                <Switch label="Return of company property" on={formData.showProperty} onToggle={() => set('showProperty', !formData.showProperty)} />
                {formData.showProperty && (
                  <textarea aria-label="Return of company property" name="propertyText" value={formData.propertyText} onChange={handleChange}
                    rows={3} className="easy-inp" style={{ resize: 'vertical', lineHeight: '1.6' }} />
                )}
                <Switch label="Confidentiality" on={formData.showConfidentiality} onToggle={() => set('showConfidentiality', !formData.showConfidentiality)} />
                {formData.showConfidentiality && (
                  <textarea aria-label="Confidentiality" name="confidentialityText" value={formData.confidentialityText} onChange={handleChange}
                    rows={3} className="easy-inp" style={{ resize: 'vertical', lineHeight: '1.6' }} />
                )}
              </div>
            </Section>

            <Section num={next()} title="Other sections">
              {clauses.map((c, i) => (
                <div key={c.id} className="easy-line-item">
                  <div className="easy-line-num">{i + 1}</div>
                  <div className="easy-line-fields">
                    <input aria-label={`Section ${i + 1} heading`} value={c.heading} onChange={(e) => setClause(c.id, 'heading', e.target.value)}
                      placeholder="Heading, e.g. Non-solicitation" className="easy-inp" style={{ marginBottom: '0.5rem' }} />
                    <textarea aria-label={`Section ${i + 1} text`} value={c.body} onChange={(e) => setClause(c.id, 'body', e.target.value)}
                      placeholder="Paragraph text. Each new line starts a new paragraph."
                      rows={4} className="easy-inp" style={{ resize: 'vertical', lineHeight: '1.6' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <button type="button" className="easy-delete-btn" onClick={() => moveClause(i, -1)} disabled={i === 0}
                      title="Move up" aria-label={`Move section ${i + 1} up`}><ArrowUp size={16} /></button>
                    <button type="button" className="easy-delete-btn" onClick={() => moveClause(i, 1)} disabled={i === clauses.length - 1}
                      title="Move down" aria-label={`Move section ${i + 1} down`}><ArrowDown size={16} /></button>
                    <button type="button" className="easy-delete-btn" onClick={() => removeClause(c.id)}
                      title="Remove" aria-label={`Remove section ${i + 1}`}><Trash2 size={16} /></button>
                  </div>
                </div>
              ))}
              <button type="button" onClick={addClause} className="easy-add-btn">
                <Plus size={16} /> Add Section
              </button>
              <div className="easy-row" style={{ marginTop: '0.75rem' }}>
                <div className="easy-field full">
                  <label className="easy-lbl" htmlFor="nt-close">Closing paragraph</label>
                  <textarea id="nt-close" name="closingText" value={formData.closingText} onChange={handleChange}
                    rows={3} className="easy-inp" style={{ resize: 'vertical', lineHeight: '1.6' }} />
                </div>
              </div>
            </Section>

            <Section num={next()} title="Signed for the company">
              <div className="easy-row">
                <div className="easy-field">
                  <label className="easy-lbl" htmlFor="nt-sn">Name</label>
                  <input id="nt-sn" name="firstPartySignatoryName" value={formData.firstPartySignatoryName} onChange={handleChange} className="easy-inp" required />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl" htmlFor="nt-sd">Designation</label>
                  <input id="nt-sd" name="firstPartySignatoryDesignation" value={formData.firstPartySignatoryDesignation} onChange={handleChange} className="easy-inp" />
                </div>
                <div className="easy-field">
                  <span className="easy-lbl">Signature</span>
                  <div className="easy-upload-wrap">
                    <input aria-label="Signature" type="file" onChange={(e) => handleFileUpload(e, 'firstPartySignature')} accept="image/*" />
                    <div className={`easy-upload ${formData.firstPartySignature ? 'done' : ''}`}>
                      {formData.firstPartySignature ? <><CheckCircle size={16} /> Uploaded</> : <><Upload size={16} /> Upload signature</>}
                    </div>
                  </div>
                </div>
                <div className="easy-field full">
                  <Switch label="Include company stamp" on={formData.showStamp} onToggle={() => set('showStamp', !formData.showStamp)} />
                </div>
              </div>
            </Section>

            <button type="submit" disabled={busy} className="easy-submit">
              {busy ? 'Saving...' : notice ? 'Save & Download Notice' : 'Create & Download Notice'}
              {!busy && <ChevronRight size={18} />}
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
          <div className="edit-bar-row">
            <EditBar
              selected={selected} value={selected && formData[selected.field]}
              onChange={(v) => place(selected.field, v)} onDone={() => setSelected(null)}
              hint="Tap the logo, the signature or the stamp on the page to move or resize it"
            />
          </div>
          <div className="edit-stage" onPointerDown={() => setSelected(null)}>
            <A4Stage>
              <AgreementPreview formData={formData} build={buildNotice} />
            </A4Stage>
          </div>
        </div>
      </div>
      </EditProvider>
    </div>
  );
}
