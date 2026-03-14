export default function InvoicePreview({ formData, totals, isInterState }) {
  return (
    <div className="a4-sheet inv-preview">
      {/* Navy Header */}
      <div className="inv-header">
        <div className="inv-header-title">TAX INVOICE</div>
        <div className="inv-header-number">{formData.invoiceNumber || ''}</div>
      </div>

      {/* FROM / BILL TO */}
      <div className="inv-parties">
        <div className="inv-party-col">
          <div className="inv-party-label">FROM</div>
          <div className="inv-party-name">{formData.orgName || 'Your Organization'}</div>
          {formData.sellerGSTIN && <div className="inv-party-detail">GSTIN: {formData.sellerGSTIN}</div>}
          {formData.sellerState && <div className="inv-party-detail">State: {formData.sellerState}</div>}
        </div>
        <div className="inv-party-col inv-party-right">
          <div className="inv-party-label">BILL TO</div>
          <div className="inv-party-name">{formData.clientName || 'Client Name'}</div>
          {formData.clientEmail && <div className="inv-party-detail">{formData.clientEmail}</div>}
          {formData.clientAddress && <div className="inv-party-detail">{formData.clientAddress}</div>}
          {formData.buyerGSTIN && <div className="inv-party-detail">GSTIN: {formData.buyerGSTIN}</div>}
          {formData.buyerState && <div className="inv-party-detail">State: {formData.buyerState}</div>}
        </div>
      </div>

      {/* Dates Bar */}
      <div className="inv-dates-bar">
        <span>Invoice Date: {formData.invoiceDate || '-'}</span>
        {formData.sellerState && formData.buyerState && (
          <span>Supply Type: {isInterState ? 'Inter-State' : 'Intra-State'}</span>
        )}
        <span>Due Date: {formData.dueDate || '-'}</span>
      </div>

      {/* Items Table */}
      <table className="inv-table">
        <thead>
          <tr>
            <th className="inv-th-left">Description</th>
            <th>HSN/SAC</th>
            <th>Qty</th>
            <th>Rate</th>
            <th className="inv-th-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {(formData.items || []).map((item, i) => {
            const lineTotal = (item.quantity || 0) * (item.price || 0);
            return (
              <tr key={i}>
                <td>{item.description || '-'}</td>
                <td className="inv-td-muted">{item.hsnCode || '-'}</td>
                <td>{item.quantity || 0}</td>
                <td>{'\u20B9'}{(item.price || 0).toLocaleString()}</td>
                <td className="inv-td-amount">{'\u20B9'}{lineTotal.toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Totals */}
      <div className="inv-totals">
        <div className="inv-total-row">
          <span>Subtotal:</span>
          <span>{'\u20B9'}{(totals.subtotal || 0).toLocaleString()}</span>
        </div>
        {formData.discountRate > 0 && (
          <div className="inv-total-row" style={{ color: '#ef4444' }}>
            <span>Discount ({formData.discountRate}%):</span>
            <span>-{'\u20B9'}{(totals.discountAmount || 0).toLocaleString()}</span>
          </div>
        )}
        <div className="inv-total-row">
          <span>Taxable Amount:</span>
          <span>{'\u20B9'}{(totals.taxableAmount || 0).toLocaleString()}</span>
        </div>
        <div className="inv-total-divider" />
        {isInterState ? (
          <div className="inv-total-row inv-total-gst">
            <span>IGST @ {formData.gstRate || 0}%:</span>
            <span>{'\u20B9'}{(totals.igst || 0).toLocaleString()}</span>
          </div>
        ) : (
          <>
            <div className="inv-total-row inv-total-gst">
              <span>CGST @ {(formData.gstRate || 0) / 2}%:</span>
              <span>{'\u20B9'}{(totals.cgst || 0).toLocaleString()}</span>
            </div>
            <div className="inv-total-row inv-total-gst">
              <span>SGST @ {(formData.gstRate || 0) / 2}%:</span>
              <span>{'\u20B9'}{(totals.sgst || 0).toLocaleString()}</span>
            </div>
          </>
        )}
        <div className="inv-total-divider inv-total-divider-bold" />
        <div className="inv-total-row inv-total-grand">
          <span>TOTAL AMOUNT:</span>
          <span>{'\u20B9'}{(totals.grandTotal || 0).toLocaleString()}</span>
        </div>
      </div>

      {/* Notes */}
      {formData.notes && (
        <div className="inv-notes">
          <div className="inv-notes-label">NOTES / TERMS:</div>
          <div className="inv-notes-text">{formData.notes}</div>
        </div>
      )}

      {/* Footer */}
      <div className="inv-footer">
        This is a computer-generated invoice. Generated via OfferPro Suite.
      </div>
    </div>
  );
}
