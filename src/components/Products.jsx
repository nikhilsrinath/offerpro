import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Plus, Search, Package, Pencil, Archive, ArchiveRestore, Trash2,
  TrendingUp, X, AlertTriangle, IndianRupee, Boxes, Tag,
} from 'lucide-react';
import { useOrg } from '../context/OrgContext';
import { catalogService, UNIT_OPTIONS, TAX_RATES } from '../services/catalogService';

const money = (n, digits = 0) => (Number(n) || 0).toLocaleString('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: digits,
});

const qty = (n) => {
  const v = Number(n) || 0;
  // Quantities are numeric(14,3): show the decimals only when there are any,
  // so "12" does not render as "12.000" on a list of whole units.
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '');
};

const fmtDate = (d) => (d
  ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—');

const BLANK = {
  name: '', sku: '', description: '', category: '',
  unit_price: '', unit: 'Nos', hsn_sac: '', tax_rate: 18,
  track_inventory: false, stock_qty: '', low_stock_at: '',
};

// Presets for the performance range. `from` is computed at click time, not at
// module load, so a session left open overnight does not keep yesterday's window.
const RANGES = [
  { id: 'all', label: 'All time', from: () => null },
  { id: 'quarter', label: 'This quarter', from: () => {
    const n = new Date();
    return new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1);
  } },
  { id: 'month', label: 'This month', from: () => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  } },
  { id: 'year', label: 'This year', from: () => new Date(new Date().getFullYear(), 0, 1) },
];

const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

export default function Products() {
  const { activeOrg } = useOrg();
  const [tab, setTab] = useState('catalog');
  // orgStore is an in-memory cache hydrated once at login, so the catalogue is
  // a synchronous read rather than a fetch. Deriving it instead of holding it
  // in state keeps the list honest after a write; `version` is what a mutation
  // bumps to force the re-read.
  const [version, setVersion] = useState(0);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [showArchived, setShowArchived] = useState(false);

  const [editing, setEditing] = useState(null);   // catalogue row, or BLANK for new
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [range, setRange] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [rangedPerf, setRangedPerf] = useState([]);
  const [perfLoading, setPerfLoading] = useState(false);

  const loading = !activeOrg;
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  // `version` is a cache-invalidation token, not a value this reads — orgStore
  // is mutable and outside React, so bumping it is how a write here becomes a
  // re-read. The lint rule cannot see that and calls it unnecessary.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => (activeOrg ? catalogService.getAll() : []), [activeOrg, version]);

  // ── Performance ────────────────────────────────────────────────────────────
  // All-time needs no query at all: units_sold, revenue, revenue_paid and
  // last_sold_at are already on each row, maintained by trigger. Only a
  // narrower window has to be asked for, and that is aggregated in Postgres by
  // catalog_performance() — summing line items in the browser would mean
  // shipping the whole ledger over to do it.
  const allTimePerf = useMemo(
    () => items.filter((p) => !p.archived_at).map((p) => ({
      id: p.id, name: p.name, sku: p.sku, category: p.category,
      units_sold: p.units_sold, revenue: p.revenue,
      revenue_paid: p.revenue_paid, invoice_count: p.invoice_count,
      last_sold_at: p.last_sold_at,
    })),
    [items]
  );

  useEffect(() => {
    if (tab !== 'performance' || range === 'all' || !activeOrg) return undefined;

    let cancelled = false;
    (async () => {
      setPerfLoading(true);
      const preset = RANGES.find((r) => r.id === range);
      const from = range === 'custom' ? (customFrom || null) : iso(preset?.from());
      const to = range === 'custom' ? (customTo || null) : null;
      const rows = await catalogService.performance(activeOrg.id, from, to);
      if (!cancelled) { setRangedPerf(rows); setPerfLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [tab, range, customFrom, customTo, activeOrg, version]);

  const perf = range === 'all' ? allTimePerf : rangedPerf;

  const categories = useMemo(
    () => [...new Set(items.map((p) => (p.category || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b)),
    [items]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((p) => {
      if (showArchived ? !p.archived_at : !!p.archived_at) return false;
      if (category !== 'all' && (p.category || '') !== category) return false;
      if (!q) return true;
      return [p.name, p.sku, p.category, p.description, p.hsn_sac]
        .some((f) => String(f || '').toLowerCase().includes(q));
    });
  }, [items, search, category, showArchived]);

  const totals = useMemo(() => {
    const active = items.filter((p) => !p.archived_at);
    return {
      count: active.length,
      revenue: active.reduce((a, p) => a + (Number(p.revenue) || 0), 0),
      collected: active.reduce((a, p) => a + (Number(p.revenue_paid) || 0), 0),
      lowStock: active.filter((p) =>
        p.track_inventory && p.low_stock_at != null
        && Number(p.stock_qty) <= Number(p.low_stock_at)).length,
    };
  }, [items]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const handleSave = async (e) => {
    e.preventDefault();
    if (!editing?.name?.trim()) { setFormError('A name is required.'); return; }

    setSaving(true);
    setFormError('');
    try {
      const payload = {
        ...editing,
        name: editing.name.trim(),
        sku: (editing.sku || '').trim(),
        unit_price: Number(editing.unit_price) || 0,
        tax_rate: Number(editing.tax_rate) || 0,
        stock_qty: editing.track_inventory ? (Number(editing.stock_qty) || 0) : 0,
        low_stock_at: editing.track_inventory && editing.low_stock_at !== ''
          ? Number(editing.low_stock_at) : null,
      };
      if (editing.id) await catalogService.update(editing.id, payload);
      else await catalogService.create(payload);
      setEditing(null);
      reload();
    } catch (err) {
      // 23505 is the partial unique index on (org_id, lower(sku)) — worth
      // naming, because "duplicate key value violates..." tells nobody which
      // field to fix.
      setFormError(err?.code === '23505'
        ? 'That SKU is already used by another product.'
        : `Could not save: ${err.message}`);
    }
    setSaving(false);
  };

  const handleArchive = async (p) => {
    try {
      if (p.archived_at) await catalogService.restore(p.id);
      else await catalogService.archive(p.id);
      reload();
    } catch (err) { alert(`Could not archive: ${err.message}`); }
  };

  const handleDelete = async (p) => {
    if (!window.confirm(
      `Permanently delete "${p.name}"?\n\nThis cannot be undone. Archive it instead if you may want the record back.`
    )) return;
    try { await catalogService.destroy(p.id); reload(); }
    catch (err) { alert(`Could not delete: ${err.message}`); }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '8rem 2rem' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="pro-spinner" />
          <p style={{ color: 'var(--text-muted)', marginTop: '1rem', fontSize: '0.875rem' }}>
            Loading catalogue...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '100%' }}>
      {/* Summary */}
      <div className="prod-stats">
        <Stat icon={<Boxes size={15} />} label="Products" value={totals.count} />
        <Stat icon={<TrendingUp size={15} />} label="Billed" value={money(totals.revenue)} />
        <Stat icon={<IndianRupee size={15} />} label="Collected" value={money(totals.collected)} accent="var(--success)" />
        {totals.lowStock > 0 && (
          <Stat icon={<AlertTriangle size={15} />} label="Low stock" value={totals.lowStock} accent="var(--gold)" />
        )}
      </div>

      {/* Tabs */}
      <div className="prod-tabs">
        <button className={`pro-chip ${tab === 'catalog' ? 'active' : ''}`} onClick={() => setTab('catalog')}>
          Catalogue
        </button>
        <button className={`pro-chip ${tab === 'performance' ? 'active' : ''}`} onClick={() => setTab('performance')}>
          Product Performance
        </button>
      </div>

      {tab === 'catalog' ? (
        <>
          <div className="prod-toolbar">
            <div className="prod-search">
              <Search size={14} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, SKU, category or HSN..."
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="prod-search-clear">
                  <X size={13} />
                </button>
              )}
            </div>

            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="prod-select"
            >
              <option value="all">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>

            <button
              className={`pro-chip ${showArchived ? 'active' : ''}`}
              onClick={() => setShowArchived((v) => !v)}
            >
              <Archive size={12} /> Archived
            </button>

            <button className="prod-add-btn" onClick={() => { setEditing({ ...BLANK }); setFormError(''); }}>
              <Plus size={15} /> New product
            </button>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              archived={showArchived}
              filtered={!!search || category !== 'all'}
              onAdd={() => { setEditing({ ...BLANK }); setFormError(''); }}
            />
          ) : (
            <div className="prod-grid">
              {filtered.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  onEdit={() => { setEditing({ ...p }); setFormError(''); }}
                  onArchive={() => handleArchive(p)}
                  onDelete={() => handleDelete(p)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <PerformanceView
          rows={perf}
          loading={perfLoading}
          range={range}
          setRange={setRange}
          customFrom={customFrom}
          setCustomFrom={setCustomFrom}
          customTo={customTo}
          setCustomTo={setCustomTo}
        />
      )}

      {editing && (
        <ProductForm
          value={editing}
          setValue={setEditing}
          onSubmit={handleSave}
          onClose={() => setEditing(null)}
          saving={saving}
          error={formError}
          categories={categories}
        />
      )}
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Stat({ icon, label, value, accent }) {
  return (
    <div className="prod-stat">
      <div className="prod-stat-icon" style={accent ? { color: accent } : undefined}>{icon}</div>
      <div>
        <div className="prod-stat-value" style={accent ? { color: accent } : undefined}>{value}</div>
        <div className="prod-stat-label">{label}</div>
      </div>
    </div>
  );
}

function ProductCard({ product: p, onEdit, onArchive, onDelete }) {
  const low = p.track_inventory && p.low_stock_at != null
    && Number(p.stock_qty) <= Number(p.low_stock_at);
  // Hard delete is offered only for a product nothing has been billed against.
  // Anything else must be archived: the FK is ON DELETE SET NULL, so deleting a
  // sold product would leave its invoices intact but strip their attribution.
  const neverSold = !p.invoice_count;

  return (
    <div className={`prod-card ${p.archived_at ? 'archived' : ''}`}>
      <div className="prod-card-head">
        <div className="prod-card-title">
          <Package size={14} />
          <span>{p.name}</span>
        </div>
        <div className="prod-card-actions">
          <button onClick={onEdit} title="Edit"><Pencil size={13} /></button>
          <button onClick={onArchive} title={p.archived_at ? 'Restore' : 'Archive'}>
            {p.archived_at ? <ArchiveRestore size={13} /> : <Archive size={13} />}
          </button>
          {neverSold && (
            <button onClick={onDelete} title="Delete permanently" className="danger">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="prod-card-tags">
        {p.sku && <span className="prod-tag mono">{p.sku}</span>}
        {p.category && <span className="prod-tag"><Tag size={9} /> {p.category}</span>}
        {p.hsn_sac && <span className="prod-tag">HSN {p.hsn_sac}</span>}
        <span className="prod-tag">{p.tax_rate}% GST</span>
      </div>

      {p.description && <p className="prod-card-desc">{p.description}</p>}

      <div className="prod-card-price">
        <span className="prod-card-amount">{money(p.unit_price, 2)}</span>
        <span className="prod-card-unit">per {p.unit}</span>
      </div>

      {p.track_inventory && (
        <div className={`prod-card-stock ${low ? 'low' : ''}`}>
          {low && <AlertTriangle size={11} />}
          {qty(p.stock_qty)} {p.unit} in stock
          {p.low_stock_at != null && ` · reorder at ${qty(p.low_stock_at)}`}
        </div>
      )}

      <div className="prod-card-sales">
        <div><strong>{qty(p.units_sold)}</strong> sold</div>
        <div><strong>{money(p.revenue)}</strong> billed</div>
        <div className="prod-card-lastsold">Last sold {fmtDate(p.last_sold_at)}</div>
      </div>
    </div>
  );
}

function EmptyState({ archived, filtered, onAdd }) {
  return (
    <div className="prod-empty">
      <Package size={30} />
      {archived ? (
        <p>No archived products.</p>
      ) : filtered ? (
        <p>No products match that search.</p>
      ) : (
        <>
          <p>Your product catalogue is empty.</p>
          <span>
            Add what you sell, and it becomes selectable on every quotation,
            proforma and invoice — with its HSN code, rate and tax rate filled in.
          </span>
          <button className="prod-add-btn" onClick={onAdd}>
            <Plus size={15} /> Add your first product
          </button>
        </>
      )}
    </div>
  );
}

function ProductForm({ value, setValue, onSubmit, onClose, saving, error, categories }) {
  const set = (k, v) => setValue((prev) => ({ ...prev, [k]: v }));

  return (
    <div className="prod-modal-backdrop" onClick={onClose}>
      <div className="prod-modal" onClick={(e) => e.stopPropagation()}>
        <div className="prod-modal-head">
          <h3>{value.id ? 'Edit product' : 'New product'}</h3>
          <button type="button" onClick={onClose}><X size={16} /></button>
        </div>

        <form onSubmit={onSubmit} className="prod-modal-body">
          {error && <div className="prod-form-error">{error}</div>}

          <div className="prod-form-grid">
            <div className="prod-field full">
              <label>Name *</label>
              <input
                value={value.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. IoT Gateway Module"
                autoFocus
                required
              />
            </div>

            <div className="prod-field">
              <label>SKU / code</label>
              <input
                value={value.sku || ''}
                onChange={(e) => set('sku', e.target.value)}
                placeholder="e.g. IOT-GW-01"
              />
            </div>

            <div className="prod-field">
              <label>Category</label>
              <input
                value={value.category || ''}
                onChange={(e) => set('category', e.target.value)}
                placeholder="e.g. Hardware"
                list="prod-categories"
              />
              <datalist id="prod-categories">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>

            <div className="prod-field full">
              <label>Description</label>
              <textarea
                value={value.description || ''}
                onChange={(e) => set('description', e.target.value)}
                rows={2}
                placeholder="Shown as the default line-item description on documents"
              />
            </div>

            <div className="prod-field">
              <label>Unit price (₹)</label>
              <input
                type="number" min="0" step="0.01"
                value={value.unit_price}
                onChange={(e) => set('unit_price', e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className="prod-field">
              <label>Unit of measurement</label>
              <select value={value.unit} onChange={(e) => set('unit', e.target.value)}>
                {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>

            <div className="prod-field">
              <label>HSN / SAC code</label>
              <input
                value={value.hsn_sac || ''}
                onChange={(e) => set('hsn_sac', e.target.value)}
                placeholder="e.g. 8517"
              />
            </div>

            <div className="prod-field">
              <label>Tax rate</label>
              <div className="prod-rate-chips">
                {TAX_RATES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`easy-chip ${Number(value.tax_rate) === r ? 'active' : ''}`}
                    onClick={() => set('tax_rate', r)}
                  >
                    {r}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Inventory is opt-in — a services business has no stock, and a
              zero on every row is worse than no field at all. */}
          <div className="prod-inventory">
            <label className="prod-toggle">
              <input
                type="checkbox"
                checked={!!value.track_inventory}
                onChange={(e) => set('track_inventory', e.target.checked)}
              />
              <span>Track stock for this product</span>
            </label>

            {value.track_inventory && (
              <div className="prod-form-grid" style={{ marginTop: '0.75rem' }}>
                <div className="prod-field">
                  <label>Quantity on hand</label>
                  <input
                    type="number" min="0" step="0.001"
                    value={value.stock_qty}
                    onChange={(e) => set('stock_qty', e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="prod-field">
                  <label>Low-stock warning at</label>
                  <input
                    type="number" min="0" step="0.001"
                    value={value.low_stock_at ?? ''}
                    onChange={(e) => set('low_stock_at', e.target.value)}
                    placeholder="Optional"
                  />
                </div>
                <p className="prod-field-note full">
                  Stock is a figure you maintain here. Billing a product does not
                  decrement it — there is nowhere yet to record goods received or
                  returned, and a count that only ever falls would drift out of
                  step with the shelf within a month.
                </p>
              </div>
            )}
          </div>

          <div className="prod-modal-foot">
            <button type="button" onClick={onClose} className="prod-btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="prod-btn-primary">
              {saving ? 'Saving...' : value.id ? 'Save changes' : 'Add product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PerformanceView({
  rows, loading, range, setRange, customFrom, setCustomFrom, customTo, setCustomTo,
}) {
  const ranked = useMemo(
    () => [...rows].sort((a, b) => b.revenue - a.revenue || b.units_sold - a.units_sold),
    [rows]
  );
  const max = ranked[0]?.revenue || 0;
  const totalRevenue = ranked.reduce((a, r) => a + r.revenue, 0);
  const totalUnits = ranked.reduce((a, r) => a + r.units_sold, 0);

  return (
    <>
      <div className="prod-toolbar">
        {RANGES.map((r) => (
          <button
            key={r.id}
            className={`pro-chip ${range === r.id ? 'active' : ''}`}
            onClick={() => setRange(r.id)}
          >
            {r.label}
          </button>
        ))}
        <button
          className={`pro-chip ${range === 'custom' ? 'active' : ''}`}
          onClick={() => setRange('custom')}
        >
          Custom
        </button>
        {range === 'custom' && (
          <div className="prod-range">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span>to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        )}
      </div>

      <p className="prod-perf-note">
        Counts a product once the invoice carrying it has been issued — sent,
        viewed, overdue, part-paid or paid. Drafts, quotations and proformas are
        excluded, and <strong>Collected</strong> narrows to invoices marked paid.
      </p>

      {loading ? (
        <div style={{ padding: '4rem', textAlign: 'center' }}><div className="pro-spinner" /></div>
      ) : ranked.length === 0 ? (
        <div className="prod-empty">
          <TrendingUp size={30} />
          <p>Nothing sold in this period.</p>
          <span>
            Sales appear here once a product is picked on an invoice line and that
            invoice is issued.
          </span>
        </div>
      ) : (
        <div className="prod-perf-table-wrap">
          <table className="prod-perf-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Product</th>
                <th className="num">Units</th>
                <th className="num">Billed</th>
                <th className="num">Collected</th>
                <th className="num">Invoices</th>
                <th>Last sold</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => (
                <tr key={r.id}>
                  <td className="prod-perf-rank">{i + 1}</td>
                  <td>
                    <div className="prod-perf-name">{r.name}</div>
                    <div className="prod-perf-meta">
                      {r.sku ? `${r.sku} · ` : ''}{r.category || 'Uncategorised'}
                    </div>
                    {/* Share-of-revenue bar: the ranking is the point of this
                        table, and a number column alone does not show it. */}
                    <div className="prod-perf-bar">
                      <div style={{ width: max ? `${Math.max((r.revenue / max) * 100, 1)}%` : '0%' }} />
                    </div>
                  </td>
                  <td className="num">{qty(r.units_sold)}</td>
                  <td className="num strong">{money(r.revenue)}</td>
                  <td className="num" style={{ color: 'var(--success)' }}>{money(r.revenue_paid)}</td>
                  <td className="num">{r.invoice_count}</td>
                  <td className="prod-perf-date">{fmtDate(r.last_sold_at)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total</td>
                <td className="num">{qty(totalUnits)}</td>
                <td className="num strong">{money(totalRevenue)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
