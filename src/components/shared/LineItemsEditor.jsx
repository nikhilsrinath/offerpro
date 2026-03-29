import { Plus, Trash2 } from 'lucide-react';

const UNITS = ['Hrs', 'Units', 'Nos', 'Kg', 'Ltr'];
const GST_RATES = [0, 5, 12, 18, 28];

export default function LineItemsEditor({
  items,
  onItemsChange,
  showHSN = true,
  showGST = true,
  showUnit = true,
  currency = '₹',
}) {
  const handleAdd = () => {
    onItemsChange([
      ...items,
      {
        id: Date.now(),
        description: '',
        hsnCode: '',
        quantity: 1,
        unit: 'Nos',
        rate: 0,
        gstRate: 18,
      },
    ]);
  };

  const handleRemove = (id) => {
    if (items.length <= 1) return;
    onItemsChange(items.filter((i) => i.id !== id));
  };

  const handleChange = (id, field, value) => {
    onItemsChange(
      items.map((item) =>
        item.id === id
          ? {
              ...item,
              [field]:
                field === 'description' || field === 'hsnCode' || field === 'unit'
                  ? value
                  : value === ''
                  ? ''
                  : Number(value),
            }
          : item
      )
    );
  };

  const getLineTotal = (item) => {
    const taxable = (item.quantity || 0) * (item.rate || 0);
    const gst = showGST ? taxable * ((item.gstRate || 0) / 100) : 0;
    return taxable + gst;
  };

  return (
    <div className="line-items-editor">
      <div className="line-items-header">
        <span className="line-items-col desc">Description</span>
        {showHSN && <span className="line-items-col hsn">HSN/SAC</span>}
        <span className="line-items-col qty">Qty</span>
        {showUnit && <span className="line-items-col unit">Unit</span>}
        <span className="line-items-col rate">Rate ({currency})</span>
        {showGST && <span className="line-items-col gst">GST %</span>}
        <span className="line-items-col total">Total</span>
        <span className="line-items-col action"></span>
      </div>

      {items.map((item, index) => {
        const taxable = (item.quantity || 0) * (item.rate || 0);
        return (
          <div key={item.id} className="line-items-row">
            <div className="line-items-col desc">
              <input
                type="text"
                value={item.description}
                onChange={(e) => handleChange(item.id, 'description', e.target.value)}
                placeholder={`Item ${index + 1}`}
                className="easy-inp"
              />
            </div>
            {showHSN && (
              <div className="line-items-col hsn">
                <input
                  type="text"
                  value={item.hsnCode || ''}
                  onChange={(e) => handleChange(item.id, 'hsnCode', e.target.value)}
                  placeholder="998314"
                  className="easy-inp"
                />
              </div>
            )}
            <div className="line-items-col qty">
              <input
                type="number"
                value={item.quantity}
                min="1"
                onChange={(e) => handleChange(item.id, 'quantity', e.target.value)}
                className="easy-inp"
              />
            </div>
            {showUnit && (
              <div className="line-items-col unit">
                <select
                  value={item.unit || 'Nos'}
                  onChange={(e) => handleChange(item.id, 'unit', e.target.value)}
                  className="easy-inp"
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="line-items-col rate">
              <input
                type="number"
                value={item.rate}
                min="0"
                onChange={(e) => handleChange(item.id, 'rate', e.target.value)}
                className="easy-inp"
              />
            </div>
            {showGST && (
              <div className="line-items-col gst">
                <select
                  value={item.gstRate || 0}
                  onChange={(e) => handleChange(item.id, 'gstRate', e.target.value)}
                  className="easy-inp"
                >
                  {GST_RATES.map((r) => (
                    <option key={r} value={r}>
                      {r}%
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="line-items-col total">
              <span className="line-items-amount">
                {currency}
                {getLineTotal(item).toLocaleString('en-IN')}
              </span>
              {showGST && taxable > 0 && (
                <span className="line-items-gst-detail">
                  +{currency}
                  {(taxable * ((item.gstRate || 0) / 100)).toLocaleString('en-IN')} GST
                </span>
              )}
            </div>
            <div className="line-items-col action">
              <button
                type="button"
                onClick={() => handleRemove(item.id)}
                className="line-items-delete"
                disabled={items.length <= 1}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        );
      })}

      <button type="button" onClick={handleAdd} className="line-items-add">
        <Plus size={15} /> Add Line Item
      </button>
    </div>
  );
}
