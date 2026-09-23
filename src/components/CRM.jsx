import { useState, useEffect, useMemo, useRef } from 'react';
import { DialogSheet } from './ui/edge';
import {
  Plus, X, Edit3, Trash2, Search, GripVertical,
  User, Phone, Mail, Building2, StickyNote, ChevronRight, FileSpreadsheet, Link2, Upload,
} from 'lucide-react';
import { orgStore } from '../services/orgStore';
import { useOrg } from '../context/OrgContext';
import { supabase } from '../lib/supabase';
import { rowsToLeads } from '../lib/leadImport';

const COLUMNS = [
  { id: 'lead',      label: 'Lead',      color: '#6366f1' },
  { id: 'contacted', label: 'Contacted', color: '#f59e0b' },
  { id: 'deal',      label: 'Deal',      color: '#10b981' },
  { id: 'not_deal',  label: 'Not Deal',  color: '#ef4444' },
];

const EMPTY_LEAD = {
  person_name: '', email: '', phone: '', company_name: '', notes: '',
};

const STAGE_IDS = new Set(COLUMNS.map(c => c.id));

const FIELD_LABELS = {
  company_name: 'Company', person_name: 'Contact', first_name: 'First name', last_name: 'Last name',
  email: 'Email', phone: 'Phone', stage: 'Stage', value: 'Value', notes: 'Notes',
};

// The last sheet link is remembered per org so "Fetch again" is one click.
const sheetUrlKey = (orgId) => `crm_sheet_url_${orgId}`;
function readSavedSheetUrl(orgId) {
  try { return localStorage.getItem(sheetUrlKey(orgId)) || ''; } catch { return ''; }
}
function saveSheetUrl(orgId, url) {
  try { localStorage.setItem(sheetUrlKey(orgId), url); } catch { /* storage unavailable */ }
}

// The pipeline column lives in crm_leads.stage. Leads written before this
// component used the column carry it as `status` inside the jsonb `extra`
// instead, and their `stage` was left at the 'lead' default — so fall back to
// `status` only when `stage` still reads as the default. Both are written
// together now, which makes the fallback a no-op for anything saved since.
function leadStage(lead) {
  if (lead.stage && lead.stage !== 'lead' && STAGE_IDS.has(lead.stage)) return lead.stage;
  if (STAGE_IDS.has(lead.status)) return lead.status;
  return 'lead';
}

function useWindowWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const fn = () => setW(window.innerWidth);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);
  return w;
}

export default function CRM() {
  const { activeOrg } = useOrg();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingLead, setEditingLead] = useState(null);
  const [formData, setFormData] = useState(EMPTY_LEAD);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [dragOverCol, setDragOverCol] = useState(null);
  const [mobileTab, setMobileTab] = useState('lead');
  const [moveMenuId, setMoveMenuId] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importState, setImportState] = useState({ phase: 'idle' });
  const [importMode, setImportMode] = useState('link');
  const [importFileName, setImportFileName] = useState('');
  const [fileDragOver, setFileDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const dragItem = useRef(null);
  const winW = useWindowWidth();
  const isMobile = winW < 768;

  useEffect(() => {
    if (!activeOrg?.id) { setLoading(false); return; }
    const unsub = orgStore.listenSection('crm_leads', () => {
      setLeads(orgStore.getSectionAsList('crm_leads'));
      setLoading(false);
    });
    setLeads(orgStore.getSectionAsList('crm_leads'));
    setLoading(false);
    return unsub;
  }, [activeOrg?.id]);

  const grouped = useMemo(() => {
    const map = { lead: [], contacted: [], deal: [], not_deal: [] };
    const term = searchTerm.toLowerCase();
    leads.forEach(l => {
      if (term && !(l.company_name || '').toLowerCase().includes(term)
        && !(l.person_name || '').toLowerCase().includes(term)
        && !(l.email || '').toLowerCase().includes(term)) return;
      map[leadStage(l)].push(l);
    });
    Object.values(map).forEach(arr => arr.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    return map;
  }, [leads, searchTerm]);

  // ── CRUD ──────────────────────────────────────────────────────────────────────
  const openAdd = (status = 'lead') => {
    setEditingLead(null);
    setFormData({ ...EMPTY_LEAD, _stage: status });
    setModalOpen(true);
  };

  const openEdit = (lead) => {
    setEditingLead(lead);
    setFormData({
      person_name: lead.person_name || '',
      email: lead.email || '',
      phone: lead.phone || '',
      company_name: lead.company_name || '',
      notes: lead.notes || '',
    });
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const now = new Date().toISOString();
      if (editingLead) {
        await orgStore.updateItem('crm_leads', editingLead.id, {
          ...formData, updated_at: now,
        });
      } else {
        const { _stage, ...fields } = formData;
        const stage = _stage || 'lead';
        // Only `stage` is sent. The clients.status column is derived from it by
        // the crm_leads adapter in orgStore; passing a second `status` alongside
        // it used to land in the clients.extra jsonb and shadow the real column.
        await orgStore.addItem('crm_leads', {
          ...fields,
          stage,
          created_at: now,
          updated_at: now,
        });
      }
      setModalOpen(false);
    } catch (err) {
      alert('Error saving lead: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (lead) => {
    if (!window.confirm(`Delete lead "${lead.company_name || lead.person_name}"?`)) return;
    try {
      await orgStore.removeItem('crm_leads', lead.id);
    } catch (err) {
      alert('Error deleting lead: ' + err.message);
    }
  };

  // Moving a card is now one update to one row.
  //
  // Under the split tables, dragging to "Deal" also upserted a copy of the lead
  // into `customers` — entity-decision.md §5 row 5 marks that copy as deleted by
  // the merge. Since 0016 both screens read `clients`, so the stage change IS the
  // promotion: the crm_leads adapter maps stage 'deal' to status 'active', which
  // is exactly what the Customers page filters on. The old call also wrote
  // `status` into the jsonb side-channel on its way through.
  const moveToColumn = async (leadId, newStage) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;
    if (leadStage(lead) === newStage) return;
    setMoveMenuId(null);
    try {
      await orgStore.updateItem('crm_leads', leadId, {
        stage: newStage,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      alert('Error moving lead: ' + err.message);
    }
  };

  // ── Import from a spreadsheet link or a local file ─────────────────────────────
  const openImport = () => {
    setImportUrl(readSavedSheetUrl(activeOrg?.id));
    setImportState({ phase: 'idle' });
    setImportFileName('');
    setImportOpen(true);
  };

  const switchImportMode = (mode) => {
    if (importState.phase === 'fetching' || importState.phase === 'importing') return;
    setImportMode(mode);
    setImportState({ phase: 'idle' });
  };

  // A file from the user's machine is parsed in the browser; only the resulting
  // leads are saved, the file itself never leaves the device.
  const readSheetFile = async (file) => {
    if (!file) return;
    setImportFileName(file.name);
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setImportState({ phase: 'error', error: 'Please choose an .xlsx, .xls or .csv file.' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setImportState({ phase: 'error', error: 'The file is larger than 10 MB.' });
      return;
    }
    setImportState({ phase: 'fetching' });
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.SheetNames[0];
      if (!sheet) throw new Error('The file has no sheets.');
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { defval: '', raw: false });
      setImportState({
        phase: 'preview', sheet, total: rows.length, truncated: rows.length > 5000,
        ...rowsToLeads(rows.slice(0, 5000), leads),
      });
    } catch (err) {
      setImportState({ phase: 'error', error: err.message || 'The file could not be read as a spreadsheet.' });
    }
  };

  const fetchSheet = async (e) => {
    e?.preventDefault();
    const url = importUrl.trim();
    if (!url) return;
    setImportState({ phase: 'fetching' });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Your session has expired. Please sign in again.');
      const res = await fetch('/api/sheet-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ org_id: activeOrg.id, url }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || `Request failed (${res.status})`);
      saveSheetUrl(activeOrg.id, url);
      setImportState({
        phase: 'preview', sheet: body.sheet, total: body.total, truncated: body.truncated,
        ...rowsToLeads(body.rows, leads),
      });
    } catch (err) {
      setImportState({ phase: 'error', error: err.message });
    }
  };

  const runImport = async () => {
    const now = new Date().toISOString();
    const toAdd = importState.leads.map(l => ({ ...l, created_at: now, updated_at: now }));
    setImportState(s => ({ ...s, phase: 'importing', done: 0 }));
    try {
      const added = await orgStore.addItems('crm_leads', toAdd, {
        onProgress: (done) => setImportState(s => ({ ...s, done })),
      });
      setImportState(s => ({ ...s, phase: 'done', added: added.length }));
    } catch (err) {
      setImportState(s => ({ ...s, phase: 'error', error: 'Import failed: ' + err.message }));
    }
  };

  // ── Drag & Drop (desktop only) ────────────────────────────────────────────────
  const onDragStart = (e, lead) => {
    dragItem.current = lead.id;
    e.dataTransfer.effectAllowed = 'move';
    if (e.target) e.target.style.opacity = '0.5';
  };

  const onDragEnd = (e) => {
    if (e.target) e.target.style.opacity = '1';
    dragItem.current = null;
    setDragOverCol(null);
  };

  const onDragOver = (e, colId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverCol !== colId) setDragOverCol(colId);
  };

  const onDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOverCol(null);
  };

  const onDrop = (e, colId) => {
    e.preventDefault();
    setDragOverCol(null);
    if (dragItem.current) {
      moveToColumn(dragItem.current, colId);
      dragItem.current = null;
    }
  };

  // ── Card renderer (shared between mobile & desktop) ───────────────────────────
  const renderCard = (lead, colId) => {
    const otherCols = COLUMNS.filter(c => c.id !== colId);
    return (
      <div
        key={lead.id}
        className="crm-card"
        draggable={!isMobile}
        onDragStart={!isMobile ? (e) => onDragStart(e, lead) : undefined}
        onDragEnd={!isMobile ? onDragEnd : undefined}
      >
        <div className="crm-card-top">
          {!isMobile && (
            <div className="crm-card-grip">
              <GripVertical size={12} />
            </div>
          )}
          <div className="crm-card-actions" style={isMobile ? { opacity: 1 } : undefined}>
            <button onClick={() => openEdit(lead)} title="Edit" aria-label="Edit">
              <Edit3 size={12} />
            </button>
            <button onClick={() => handleDelete(lead)} title="Delete" aria-label="Delete">
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        <div className="crm-card-company">
          <Building2 size={13} />
          {lead.company_name || 'Unnamed'}
        </div>
        <div className="crm-card-person">
          <User size={12} />
          {lead.person_name || '—'}
        </div>
        {lead.email && (
          <div className="crm-card-detail">
            <Mail size={11} /> {lead.email}
          </div>
        )}
        {lead.phone && (
          <div className="crm-card-detail">
            <Phone size={11} /> {lead.phone}
          </div>
        )}
        {lead.notes && (
          <div className="crm-card-notes">
            <StickyNote size={11} />
            <span>{lead.notes}</span>
          </div>
        )}

        {/* Move-to buttons (mobile) or inline on desktop hover */}
        <div className="crm-card-move">
          {isMobile ? (
            moveMenuId === lead.id ? (
              <div className="crm-move-options">
                {otherCols.map(c => (
                  <button
                    key={c.id}
                    onClick={() => moveToColumn(lead.id, c.id)}
                    style={{ '--move-color': c.color }}
                    className="crm-move-btn"
                  >
                    <span className="crm-move-dot" style={{ background: c.color }} />
                    {c.label}
                  </button>
                ))}
                <button onClick={() => setMoveMenuId(null)} className="crm-move-btn crm-move-cancel">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="crm-move-trigger"
                onClick={() => setMoveMenuId(lead.id)}
              >
                Move to <ChevronRight size={12} />
              </button>
            )
          ) : (
            <div className="crm-move-options-desktop">
              {otherCols.map(c => (
                <button
                  key={c.id}
                  onClick={() => moveToColumn(lead.id, c.id)}
                  className="crm-move-btn-desktop"
                  title={`Move to ${c.label}`}
                >
                  <span className="crm-move-dot" style={{ background: c.color }} />
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '8rem 2rem' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="pro-spinner" />
          <p style={{ color: 'var(--text-muted)', marginTop: '1rem', fontSize: '0.875rem' }}>Loading CRM...</p>
        </div>
      </div>
    );
  }

  // ── MOBILE LAYOUT ─────────────────────────────────────────────────────────────
  if (isMobile) {
    const activeCol = COLUMNS.find(c => c.id === mobileTab) || COLUMNS[0];
    const items = grouped[mobileTab] || [];

    return (
      <div className="crm-page crm-mobile">
        {/* Mobile Toolbar */}
        <div className="crm-toolbar-mobile">
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input aria-label="Search leads"
              type="text"
              placeholder="Search leads..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="easy-inp"
              style={{ paddingLeft: '2rem', height: '36px', fontSize: '0.8rem' }}
            />
          </div>
          <button onClick={openImport} className="easy-submit-outline" title="Import Excel" aria-label="Import Excel" style={{ width: 'auto', padding: '0.45rem 0.6rem', fontSize: '0.78rem' }}>
            <FileSpreadsheet size={15} />
          </button>
          <button onClick={() => openAdd(mobileTab)} className="easy-submit" style={{ width: 'auto', padding: '0.45rem 0.875rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
            <Plus size={15} /> Add
          </button>
        </div>

        {/* Column Tab Switcher */}
        <div className="crm-tabs">
          {COLUMNS.map(col => {
            const count = (grouped[col.id] || []).length;
            const isActive = mobileTab === col.id;
            return (
              <button
                key={col.id}
                className={`crm-tab${isActive ? ' active' : ''}`}
                onClick={() => { setMobileTab(col.id); setMoveMenuId(null); }}
                style={{ '--tab-color': col.color }}
              >
                <span className="crm-tab-dot" style={{ background: col.color }} />
                <span className="crm-tab-label">{col.label}</span>
                <span className="crm-tab-count">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Cards List */}
        <div className="crm-mobile-list">
          {items.length === 0 ? (
            <div className="crm-empty-mobile">
              <Building2 size={32} strokeWidth={1} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
              <span>{searchTerm ? 'No matching leads' : `No ${activeCol.label.toLowerCase()} leads`}</span>
            </div>
          ) : (
            items.map(lead => renderCard(lead, mobileTab))
          )}
        </div>

        {/* Modal */}
        {modalOpen && renderModal()}
        {importOpen && renderImportModal()}
      </div>
    );
  }

  // ── DESKTOP LAYOUT ────────────────────────────────────────────────────────────

  function renderModal() {
    return (
      <div className="customer-modal-overlay" onClick={() => setModalOpen(false)}>
        <DialogSheet className="customer-modal" labelledBy="lead-form-title" onClose={() => setModalOpen(false)}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
            <h3 id="lead-form-title" style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>
              {editingLead ? 'Edit Lead' : 'Add Lead'}
            </h3>
            <button type="button" aria-label="Close" title="Close (Esc)" onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '0.25rem' }}>
              <X aria-hidden="true" size={20} />
            </button>
          </div>
          <form onSubmit={handleSave}>
            <div className="easy-row" style={{ gap: '1rem' }}>
              <div className="easy-field full">
                <label className="easy-lbl">Company Name *</label>
                <input aria-label="Company Name" required type="text" placeholder="e.g. Acme Corp" value={formData.company_name}
                  onChange={e => setFormData({ ...formData, company_name: e.target.value })} className="easy-inp" />
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">Contact Person *</label>
                <input aria-label="Contact Person" required type="text" placeholder="e.g. John Doe" value={formData.person_name}
                  onChange={e => setFormData({ ...formData, person_name: e.target.value })} className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Email</label>
                <input aria-label="Email" type="email" placeholder="john@acme.com" value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })} className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Phone</label>
                <input aria-label="Phone" type="text" placeholder="+91 ..." value={formData.phone}
                  onChange={e => setFormData({ ...formData, phone: e.target.value })} className="easy-inp" />
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">Notes</label>
                <textarea aria-label="Notes"
                  placeholder="Any notes about this lead..."
                  value={formData.notes}
                  onChange={e => setFormData({ ...formData, notes: e.target.value })}
                  className="easy-inp"
                  rows={3}
                  style={{ resize: 'vertical', minHeight: '70px' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button type="submit" disabled={saving} className="easy-submit" style={{ flex: 1 }}>
                {saving ? 'Saving...' : editingLead ? 'Update Lead' : 'Add Lead'}
              </button>
              <button type="button" onClick={() => setModalOpen(false)} className="easy-submit-outline" style={{ flex: 0.5 }}>
                Cancel
              </button>
            </div>
          </form>
        </DialogSheet>
      </div>
    );
  }

  function renderImportModal() {
    const st = importState;
    const busy = st.phase === 'fetching' || st.phase === 'importing';
    const close = () => { if (!busy) setImportOpen(false); };
    const hasPreview = st.leads && ['preview', 'importing', 'done'].includes(st.phase);
    const muted = { color: 'var(--text-muted)', fontSize: '0.8125rem' };
    const cell = { padding: '0.4rem 0.6rem', whiteSpace: 'nowrap' };
    return (
      <div className="customer-modal-overlay" onClick={close}>
        <DialogSheet className="customer-modal" labelledBy="lead-import-title" onClose={close} style={{ maxWidth: 640 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h3 id="lead-import-title" style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>Import leads from Excel</h3>
            <button type="button" aria-label="Close" title="Close (Esc)" onClick={close} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '0.25rem' }}>
              <X aria-hidden="true" size={20} />
            </button>
          </div>

          <div className="crm-tabs" role="tablist" aria-label="Import source" style={{ marginBottom: '1rem' }}>
            {[{ id: 'link', label: 'Paste link', Icon: Link2 }, { id: 'file', label: 'Upload file', Icon: Upload }].map(({ id, label, Icon }) => (
              <button key={id} type="button" role="tab" aria-selected={importMode === id} disabled={busy}
                className={`crm-tab${importMode === id ? ' active' : ''}`}
                style={{ '--tab-color': '#6366f1' }}
                onClick={() => switchImportMode(id)}>
                <Icon size={14} aria-hidden="true" />
                <span className="crm-tab-label">{label}</span>
              </button>
            ))}
          </div>

          {importMode === 'file' ? (
            <div>
              <input ref={fileInputRef} type="file" hidden
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                onChange={e => { readSheetFile(e.target.files?.[0]); e.target.value = ''; }} />
              <button type="button" disabled={busy}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setFileDragOver(true); }}
                onDragLeave={() => setFileDragOver(false)}
                onDrop={e => { e.preventDefault(); setFileDragOver(false); readSheetFile(e.dataTransfer.files?.[0]); }}
                style={{
                  width: '100%', padding: '1.5rem 1rem', borderRadius: 10, cursor: busy ? 'default' : 'pointer',
                  border: `2px dashed ${fileDragOver ? '#6366f1' : 'var(--border-color, rgba(128,128,128,0.35))'}`,
                  background: fileDragOver ? 'rgba(99,102,241,0.08)' : 'transparent', color: 'inherit',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem',
                }}>
                <Upload size={22} aria-hidden="true" style={{ color: '#6366f1' }} />
                <strong style={{ fontSize: '0.875rem' }}>
                  {st.phase === 'fetching' ? 'Reading file…' : importFileName || 'Choose an Excel file'}
                </strong>
                <span style={muted}>
                  {importFileName && st.phase !== 'fetching' ? 'Click to choose a different file' : 'or drag and drop it here · .xlsx, .xls, .csv up to 10 MB'}
                </span>
              </button>
              <p style={{ ...muted, margin: '0.5rem 0 0', lineHeight: 1.5 }}>
                The first sheet is read and its first row must be headers (e.g. Name, Company, Email, Phone, Status, Notes).
                Leads already on the board are skipped.
              </p>
            </div>
          ) : (
          <form onSubmit={fetchSheet}>
            <label className="easy-lbl" htmlFor="lead-import-url">Excel / Google Sheets link</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input id="lead-import-url" type="url" required className="easy-inp" style={{ flex: 1, minWidth: 0 }}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={importUrl} disabled={busy}
                onChange={e => setImportUrl(e.target.value)} />
              <button type="submit" disabled={busy || !importUrl.trim()} className="easy-submit" style={{ width: 'auto', padding: '0.5rem 1rem', whiteSpace: 'nowrap' }}>
                {st.phase === 'fetching' ? 'Fetching…' : st.phase === 'idle' ? 'Fetch' : 'Fetch again'}
              </button>
            </div>
            <p style={{ ...muted, margin: '0.5rem 0 0', lineHeight: 1.5 }}>
              Works with Google Sheets, OneDrive/SharePoint, Dropbox, or any direct .xlsx/.csv link shared
              as &ldquo;Anyone with the link can view&rdquo;. The first sheet is read and its first row must be headers
              (e.g. Name, Company, Email, Phone, Status, Notes). Leads already on the board are skipped, so fetching again is safe.
            </p>
          </form>
          )}

          {st.phase === 'error' && (
            <div role="alert" style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: '0.8125rem' }}>
              {st.error}
            </div>
          )}

          {hasPreview && (
            <div style={{ marginTop: '1.25rem' }}>
              <div style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                Sheet <strong>{st.sheet}</strong>: {st.total} rows → <strong>{st.leads.length} new leads</strong>
                {st.skippedDuplicate > 0 && <>, {st.skippedDuplicate} already exist</>}
                {st.skippedEmpty > 0 && <>, {st.skippedEmpty} empty</>}
                {st.truncated && <> (only the first 5000 rows were read)</>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '0.75rem' }}>
                {Object.entries(st.mapping).filter(([h]) => !h.startsWith('__EMPTY')).map(([h, f]) => (
                  <span key={h} className="crm-summary-pill">
                    {h} → <strong>{f ? FIELD_LABELS[f] : 'Notes'}</strong>
                  </span>
                ))}
              </div>
              {st.leads.length > 0 && (
                <div style={{ overflow: 'auto', maxHeight: 220, border: '1px solid var(--border-color, rgba(128,128,128,0.2))', borderRadius: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                    <thead>
                      <tr>{['Company', 'Contact', 'Email', 'Phone', 'Stage'].map(h => (
                        <th key={h} style={{ ...cell, ...muted, textAlign: 'left', fontSize: '0.72rem' }}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {st.leads.slice(0, 8).map((l, i) => (
                        <tr key={i} style={{ borderTop: '1px solid var(--border-color, rgba(128,128,128,0.15))' }}>
                          <td style={cell}>{l.company_name || '—'}</td>
                          <td style={cell}>{l.person_name || '—'}</td>
                          <td style={cell}>{l.email || '—'}</td>
                          <td style={cell}>{l.phone || '—'}</td>
                          <td style={cell}>{COLUMNS.find(c => c.id === l.stage)?.label}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {st.leads.length > 8 && <div style={{ ...muted, padding: '0.4rem 0.6rem' }}>…and {st.leads.length - 8} more</div>}
                </div>
              )}

              {st.phase === 'done' && (
                <div role="status" style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: 8, background: 'rgba(16,185,129,0.1)', color: '#10b981', fontSize: '0.875rem' }}>
                  Imported {st.added} leads.
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
                {st.phase !== 'done' && (
                  <button type="button" onClick={runImport} disabled={busy || st.leads.length === 0} className="easy-submit" style={{ flex: 1 }}>
                    {st.phase === 'importing'
                      ? `Importing… ${st.done || 0}/${st.leads.length}`
                      : st.leads.length === 0 ? 'Nothing new to import' : `Import ${st.leads.length} leads`}
                  </button>
                )}
                <button type="button" onClick={close} disabled={busy} className="easy-submit-outline" style={{ flex: st.phase === 'done' ? 1 : 0.5 }}>
                  {st.phase === 'done' ? 'Done' : 'Cancel'}
                </button>
              </div>
            </div>
          )}
        </DialogSheet>
      </div>
    );
  }

  return (
    <div className="crm-page">
      {/* Desktop Toolbar */}
      <div className="crm-toolbar">
        <div style={{ position: 'relative', flex: 1, minWidth: '160px', maxWidth: '320px' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input aria-label="Search leads"
            type="text"
            placeholder="Search leads..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="easy-inp"
            style={{ paddingLeft: '2rem', height: '38px', fontSize: '0.8125rem' }}
          />
        </div>
        {/* Summary pills */}
        <div className="crm-summary-pills">
          {COLUMNS.map(col => (
            <div key={col.id} className="crm-summary-pill" style={{ '--pill-color': col.color }}>
              <span className="crm-move-dot" style={{ background: col.color }} />
              <span>{col.label}</span>
              <strong>{(grouped[col.id] || []).length}</strong>
            </div>
          ))}
        </div>
        <button onClick={openImport} className="easy-submit-outline" style={{ width: 'auto', padding: '0.5rem 1rem', fontSize: '0.8125rem', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          <FileSpreadsheet size={16} /> Import Excel
        </button>
        <button onClick={() => openAdd('lead')} className="easy-submit" style={{ width: 'auto', padding: '0.5rem 1.125rem', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
          <Plus size={16} /> Add Lead
        </button>
      </div>

      {/* Kanban Board */}
      <div className="crm-board">
        {COLUMNS.map(col => {
          const items = grouped[col.id] || [];
          const isOver = dragOverCol === col.id;
          return (
            <div
              key={col.id}
              className={`crm-column${isOver ? ' drag-over' : ''}`}
              onDragOver={e => onDragOver(e, col.id)}
              onDragLeave={onDragLeave}
              onDrop={e => onDrop(e, col.id)}
              style={{ '--col-color': col.color }}
            >
              <div className="crm-column-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="crm-column-dot" style={{ background: col.color }} />
                  <span className="crm-column-title">{col.label}</span>
                  <span className="crm-column-count">{items.length}</span>
                </div>
                <button
                  onClick={() => openAdd(col.id)}
                  className="crm-col-add-btn"
                  title={`Add to ${col.label}`}
                 aria-label={`Add to ${col.label}`}>
                  <Plus size={14} />
                </button>
              </div>

              <div className="crm-column-body">
                {items.length === 0 ? (
                  <div className="crm-empty-col">
                    {searchTerm ? 'No matches' : 'Drop leads here'}
                  </div>
                ) : items.map(lead => renderCard(lead, col.id))}
              </div>
            </div>
          );
        })}
      </div>

      {modalOpen && renderModal()}
      {importOpen && renderImportModal()}
    </div>
  );
}
