import { useState, useRef, useEffect } from 'react';
import { Package, Search, X, Check } from 'lucide-react';
import { catalogService } from '../../services/catalogService';

/**
 * "Select product" for a single line item on the Quotation, Proforma and
 * Invoice forms.
 *
 * It sits ALONGSIDE manual entry rather than replacing it: picking a product
 * fills the line in and then gets out of the way, so a one-off discount or a
 * custom price is just an edit to the field like any other. Non-catalogue items
 * are typed as they always were.
 *
 * `linkedId` is the line's current catalog_item_id. When it is set the control
 * shows what the line is attributed to and offers to detach it — detaching
 * leaves the typed values alone and only drops the attribution, which is the
 * difference between "we sold something else" and "we sold this, cheaper".
 */
export default function ProductPicker({ linkedId, onSelect, onClear }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef(null);

  // Read straight from the orgStore cache on each render. It is a synchronous
  // map lookup over a list measured in dozens, and doing it here rather than
  // memoising means a product added on the Products page appears in this menu
  // without the form being remounted.
  const products = catalogService.getActive();
  const linked = linkedId ? products.find((p) => p.id === linkedId) : null;

  // Close on an outside click. Without this the panel stays open behind the
  // next line item the user starts typing into.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = (q
    ? products.filter((p) => [p.name, p.sku, p.category, p.description]
      .some((f) => String(f || '').toLowerCase().includes(q)))
    : products
  ).slice(0, 50);

  const money = (n) => (Number(n) || 0).toLocaleString('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 2,
  });

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setQuery(''); }}
        className="prodpick-btn"
        title={linked ? `Billed as: ${linked.name}` : 'Fill this line from the product catalogue'}
      >
        <Package size={13} />
        <span className="prodpick-btn-label">
          {linked ? linked.name : 'Select product'}
        </span>
        {linked && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Unlink product"
            onClick={(e) => { e.stopPropagation(); onClear?.(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onClear?.(); }
            }}
            className="prodpick-unlink"
          >
            <X size={11} />
          </span>
        )}
      </button>

      {open && (
        <div className="prodpick-panel">
          <div className="prodpick-search">
            <Search size={13} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, SKU or category..."
              className="prodpick-search-inp"
            />
          </div>

          {filtered.length === 0 ? (
            <div className="prodpick-empty">
              {products.length === 0
                ? 'No products in the catalogue yet. Add them under Business → Products.'
                : 'Nothing matches that search.'}
            </div>
          ) : (
            <div className="prodpick-list">
              {filtered.map((p) => (
                <div
                  key={p.id}
                  className="prodpick-item"
                  onClick={() => { onSelect(p); setOpen(false); }}
                >
                  <div className="prodpick-item-main">
                    <span className="prodpick-item-name">{p.name}</span>
                    <span className="prodpick-item-meta">
                      {p.sku ? `${p.sku} · ` : ''}
                      {p.category || 'Uncategorised'}
                      {p.hsn_sac ? ` · HSN ${p.hsn_sac}` : ''}
                      {` · ${p.tax_rate}% GST`}
                    </span>
                  </div>
                  <div className="prodpick-item-price">
                    <span>{money(p.unit_price)}</span>
                    <span className="prodpick-item-unit">/ {p.unit}</span>
                  </div>
                  {p.id === linkedId && <Check size={13} className="prodpick-item-check" />}
                </div>
              ))}
            </div>
          )}

          <div className="prodpick-foot">
            Fills description, HSN, rate and tax. Every field stays editable.
          </div>
        </div>
      )}
    </div>
  );
}
