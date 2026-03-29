import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2 } from 'lucide-react';

const PAYMENT_MODES = ['UPI', 'NEFT', 'IMPS', 'Cheque'];

export default function PaymentConfirmationForm({ amount, invoiceId, onSubmit }) {
  const [form, setForm] = useState({
    transactionId: '',
    paymentDate: new Date().toISOString().split('T')[0],
    amountPaid: amount || 0,
    paymentMode: 'UPI',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState({});

  const validate = () => {
    const errs = {};
    if (!form.transactionId.trim()) errs.transactionId = 'Transaction ID / UTR is required';
    if (!form.paymentDate) errs.paymentDate = 'Payment date is required';
    if (!form.amountPaid || form.amountPaid <= 0) errs.amountPaid = 'Amount must be greater than 0';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    await new Promise(r => setTimeout(r, 1200));
    setSubmitting(false);
    setSubmitted(true);
    onSubmit?.({ ...form, invoiceId, submittedAt: new Date().toISOString() });
  };

  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="payment-conf-success"
      >
        <div className="payment-conf-success-icon">
          <Check size={32} />
        </div>
        <h3>Payment Confirmation Submitted</h3>
        <p>You'll receive a receipt once verified by the issuer.</p>
      </motion.div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="payment-conf-form">
      <h4 className="payment-conf-title">Confirm Your Payment</h4>

      <div className="payment-conf-field">
        <label>Transaction ID / UTR Number</label>
        <input
          type="text"
          value={form.transactionId}
          onChange={(e) => setForm({ ...form, transactionId: e.target.value })}
          placeholder="e.g. NEFT20260327XXXXX"
          className={errors.transactionId ? 'error' : ''}
        />
        {errors.transactionId && <span className="payment-conf-error">{errors.transactionId}</span>}
      </div>

      <div className="payment-conf-row">
        <div className="payment-conf-field">
          <label>Payment Date</label>
          <input
            type="date"
            value={form.paymentDate}
            onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
            className={errors.paymentDate ? 'error' : ''}
          />
          {errors.paymentDate && <span className="payment-conf-error">{errors.paymentDate}</span>}
        </div>
        <div className="payment-conf-field">
          <label>Amount Paid (₹)</label>
          <input
            type="number"
            value={form.amountPaid}
            onChange={(e) => setForm({ ...form, amountPaid: Number(e.target.value) })}
            min="0"
            className={errors.amountPaid ? 'error' : ''}
          />
          {errors.amountPaid && <span className="payment-conf-error">{errors.amountPaid}</span>}
        </div>
      </div>

      <div className="payment-conf-field">
        <label>Payment Mode</label>
        <div className="payment-conf-modes">
          {PAYMENT_MODES.map(mode => (
            <button
              key={mode}
              type="button"
              className={`payment-conf-mode-btn ${form.paymentMode === mode ? 'active' : ''}`}
              onClick={() => setForm({ ...form, paymentMode: mode })}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <button type="submit" disabled={submitting} className="payment-conf-submit">
        {submitting ? <><Loader2 size={16} className="spin" /> Submitting...</> : 'Submit Payment Confirmation'}
      </button>
    </form>
  );
}
