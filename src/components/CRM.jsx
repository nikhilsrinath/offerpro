import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus, X, Edit3, Trash2, Search, GripVertical,
  User, Phone, Mail, Building2, StickyNote, ChevronRight,
} from 'lucide-react';
import { orgStore } from '../services/orgStore';
import { useOrg } from '../context/OrgContext';

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
            <button onClick={() => openEdit(lead)} title="Edit">
              <Edit3 size={12} />
            </button>
            <button onClick={() => handleDelete(lead)} title="Delete">
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
            <input
              type="text"
              placeholder="Search leads..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="easy-inp"
              style={{ paddingLeft: '2rem', height: '36px', fontSize: '0.8rem' }}
            />
          </div>
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
      </div>
    );
  }

  // ── DESKTOP LAYOUT ────────────────────────────────────────────────────────────

  function renderModal() {
    return (
      <div className="customer-modal-overlay" onClick={() => setModalOpen(false)}>
        <div className="customer-modal" onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>
              {editingLead ? 'Edit Lead' : 'Add Lead'}
            </h3>
            <button onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '0.25rem' }}>
              <X size={20} />
            </button>
          </div>
          <form onSubmit={handleSave}>
            <div className="easy-row" style={{ gap: '1rem' }}>
              <div className="easy-field full">
                <label className="easy-lbl">Company Name *</label>
                <input required type="text" placeholder="e.g. Acme Corp" value={formData.company_name}
                  onChange={e => setFormData({ ...formData, company_name: e.target.value })} className="easy-inp" />
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">Contact Person *</label>
                <input required type="text" placeholder="e.g. John Doe" value={formData.person_name}
                  onChange={e => setFormData({ ...formData, person_name: e.target.value })} className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Email</label>
                <input type="email" placeholder="john@acme.com" value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })} className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Phone</label>
                <input type="text" placeholder="+91 ..." value={formData.phone}
                  onChange={e => setFormData({ ...formData, phone: e.target.value })} className="easy-inp" />
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">Notes</label>
                <textarea
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
        </div>
      </div>
    );
  }

  return (
    <div className="crm-page">
      {/* Desktop Toolbar */}
      <div className="crm-toolbar">
        <div style={{ position: 'relative', flex: 1, minWidth: '160px', maxWidth: '320px' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
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
                >
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
    </div>
  );
}
