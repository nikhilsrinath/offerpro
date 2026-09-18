import { QRCodeSVG } from 'qrcode.react';

export default function UPIQRGenerator({ upiId, payeeName, amount, transactionNote, size = 200 }) {
  const upiString = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}${amount ? `&am=${amount}` : ''}&cu=INR${transactionNote ? `&tn=${encodeURIComponent(transactionNote)}` : ''}`;

  return (
    <div className="upi-qr-generator">
      <div className="upi-qr-code-wrap">
        <QRCodeSVG
          value={upiString}
          size={size}
          bgColor="#ffffff"
          fgColor="#1a1a2e"
          level="H"
          includeMargin={true}
        />
      </div>
      <div className="upi-qr-id-row">
        <span className="upi-qr-id-label">UPI ID:</span>
        <code className="upi-qr-id-value">{upiId}</code>
        <button
          type="button"
          className="upi-qr-copy-btn"
          onClick={() => {
            navigator.clipboard.writeText(upiId);
          }}
        >
          Copy
        </button>
      </div>
      <p className="upi-qr-hint">Scan with any UPI app — GPay, PhonePe, Paytm</p>
      <div className="upi-qr-logos">
        <span className="upi-qr-logo-pill">GPay</span>
        <span className="upi-qr-logo-pill">PhonePe</span>
        <span className="upi-qr-logo-pill">Paytm</span>
      </div>
    </div>
  );
}
