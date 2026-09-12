// Announcements.jsx — broadcast to the whole team or one department.
//
// The audience is `department_id`: null means everyone. Who can actually read a
// notice is decided by RLS (0029 §6), not by this screen, so an announcement
// aimed at one department genuinely does not reach the rest.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Megaphone, Plus, Pin, Trash2, Pencil, Loader2, Clock, Building2 } from 'lucide-react';
import { useSection, fmtDate } from '../financial/financeHooks';
import { useToast } from '../shared/Toast';
import { Stat, Modal } from '../financial/financeUi';
import { orgStore } from '../../services/orgStore';
import { announcementService } from '../../services/announcementService';

const BLANK = { title: '', body: '', departmentId: '', isPinned: false, expiresAt: '' };

const isExpired = (a) => !!a.expires_at && new Date(a.expires_at) < new Date();

export default function Announcements() {
  const toast = useToast();
  const departments = useSection('departments');
  const orgId = orgStore.getOrgId();

  const [tab, setTab] = useState('board');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const deptName = useMemo(
    () => Object.fromEntries(departments.map((d) => [d.id, d.name])), [departments],
  );

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      setItems(await announcementService.list(orgId, { includeExpired: true }));
    } catch (err) {
      toast(err.message || 'Could not load announcements.', 'error');
    } finally {
      setLoading(false);
    }
  }, [orgId, toast]);

  useEffect(() => { load(); }, [load]);

  const live = useMemo(() => items.filter((a) => !isExpired(a)), [items]);
  const shown = tab === 'board' ? live : items;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await announcementService.publish(orgId, {
        id: editing.id,
        title: editing.title,
        body: editing.body,
        departmentId: editing.departmentId || null,
        isPinned: editing.isPinned,
        // A date input gives a local calendar day; expire at the end of it.
        expiresAt: editing.expiresAt ? new Date(`${editing.expiresAt}T23:59:59`).toISOString() : null,
      });
      setEditing(null);
      await load();
      toast(editing.id ? 'Announcement updated' : 'Announcement published', 'success');
    } catch (err) {
      toast(err.message || 'Could not publish.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a) => {
    if (!window.confirm(`Delete "${a.title}"? This removes it for everyone.`)) return;
    try {
      await announcementService.remove(a.id);
      setItems((prev) => prev.filter((x) => x.id !== a.id));
      toast('Announcement deleted', 'success');
    } catch (err) {
      toast(err.message || 'Could not delete.', 'error');
    }
  };

  const openEditor = (a) => setEditing(a ? {
    id: a.id,
    title: a.title,
    body: a.body,
    departmentId: a.department_id || '',
    isPinned: a.is_pinned,
    expiresAt: a.expires_at ? a.expires_at.slice(0, 10) : '',
  } : { ...BLANK });

  return (
    <div className="prod-inventory">
      <div className="prod-stats">
        <Stat icon={<Megaphone size={18} />} label="Live announcements" value={live.length} accent="#3b82f6" />
        <Stat icon={<Pin size={18} />} label="Pinned" value={live.filter((a) => a.is_pinned).length} accent="#f59e0b" />
        <Stat icon={<Building2 size={18} />} label="Department-only" value={live.filter((a) => a.department_id).length} />
        <Stat icon={<Clock size={18} />} label="Expired" value={items.length - live.length} />
      </div>

      <div className="prod-toolbar">
        <div className="prod-tabs" style={{ margin: 0 }}>
          <button type="button" className={`pro-chip ${tab === 'board' ? 'active' : ''}`} onClick={() => setTab('board')}>Board</button>
          <button type="button" className={`pro-chip ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>History</button>
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" className="prod-btn-primary" onClick={() => openEditor(null)}>
          <Plus size={14} /> New announcement
        </button>
      </div>

      {loading ? (
        <div className="prod-empty"><Loader2 className="spin" size={18} /> Loading…</div>
      ) : !shown.length ? (
        <div className="prod-empty">
          {tab === 'board' ? 'Nothing on the board. Publish the first announcement.' : 'No announcements yet.'}
        </div>
      ) : (
        <div className="ann-list">
          {shown.map((a) => (
            <article key={a.id} className={`ann-card${a.is_pinned ? ' is-pinned' : ''}${isExpired(a) ? ' is-expired' : ''}`}>
              <header>
                <h4>
                  {a.is_pinned && <Pin size={13} />} {a.title}
                </h4>
                <div className="ann-card-actions">
                  <button type="button" className="prod-btn-ghost" onClick={() => openEditor(a)}>
                    <Pencil size={13} /> Edit
                  </button>
                  <button type="button" className="prod-btn-ghost" onClick={() => remove(a)}>
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              </header>
              <p>{a.body}</p>
              <footer className="prod-perf-meta">
                <span className="prod-tag">
                  {a.department_id ? deptName[a.department_id] || 'Department' : 'Whole team'}
                </span>
                <span>{fmtDate(a.published_at)}</span>
                {a.expires_at && <span>{isExpired(a) ? 'Expired' : 'Expires'} {fmtDate(a.expires_at)}</span>}
              </footer>
            </article>
          ))}
        </div>
      )}

      {editing && (
        <Modal title={editing.id ? 'Edit announcement' : 'New announcement'} onClose={() => setEditing(null)} width="560px">
          <form onSubmit={save}>
            <div className="prod-modal-body">
              <label className="prod-field">
                <span>Title</span>
                <input
                  className="prod-select" value={editing.title} maxLength={200} required
                  placeholder="Office closed on Friday"
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                />
              </label>
              <label className="prod-field">
                <span>Message</span>
                <textarea
                  className="prod-select" rows={6} value={editing.body} required
                  placeholder="What the team needs to know…"
                  onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                />
              </label>
              <div className="prod-form-grid">
                <label className="prod-field">
                  <span>Audience</span>
                  <select
                    className="prod-select" value={editing.departmentId}
                    onChange={(e) => setEditing({ ...editing, departmentId: e.target.value })}
                  >
                    <option value="">Whole team</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name} only</option>)}
                  </select>
                </label>
                <label className="prod-field">
                  <span>Expires (optional)</span>
                  <input
                    type="date" className="prod-select" value={editing.expiresAt}
                    onChange={(e) => setEditing({ ...editing, expiresAt: e.target.value })}
                  />
                </label>
                <label className="prod-field prod-toggle">
                  <input
                    type="checkbox" checked={editing.isPinned}
                    onChange={(e) => setEditing({ ...editing, isPinned: e.target.checked })}
                  />
                  <span>Pin to the top</span>
                </label>
              </div>
              <div className="prod-field-note">
                A department announcement is invisible to everyone outside it — including in
                their portal — not just hidden from this list.
              </div>
            </div>
            <div className="prod-modal-foot">
              <button type="button" className="prod-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="prod-btn-primary" disabled={busy}>
                {busy ? 'Publishing…' : editing.id ? 'Save' : 'Publish'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
