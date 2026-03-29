import DocumentHeader from './DocumentHeader';
import StampPreview from './StampPreview';

export default function OfferPreview({ formData }) {
  const formatDate = (dateStr) => {
    if (!dateStr) return '___________';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const day = date.getDate();
    const month = date.toLocaleString('en-GB', { month: 'long' });
    const year = date.getFullYear();
    let suffix = 'th';
    if (day % 10 === 1 && day !== 11) suffix = 'st';
    else if (day % 10 === 2 && day !== 12) suffix = 'nd';
    else if (day % 10 === 3 && day !== 13) suffix = 'rd';
    return `${day}${suffix} ${month} ${year}`;
  };

  const isFT = formData.offerType === 'fulltime';
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="a4-sheet offer-preview">
      {/* Professional Header */}
      <DocumentHeader formData={formData} />

      {/* Date */}
      <p className="offer-text" style={{ marginTop: '1.8em' }}>Date: {formatDate(today)}</p>

      {/* Recipient */}
      <p className="offer-bold">To,</p>
      <p className="offer-bold">{formData.studentName || '___________'}</p>
      <p className="offer-small">{formData.studentAddress || ''}</p>

      {/* Subject */}
      <p className="offer-subject">
        {isFT ? 'Subject: Offer of Full-Time Employment' : 'Subject: Internship Offer Letter'}
      </p>

      {/* Salutation */}
      <p className="offer-bold" style={{ marginTop: '0.5em' }}>Dear {formData.studentName || '___________'},</p>

      {/* Body */}
      {isFT ? (
        <>
          <p className="offer-para">
            We are pleased to offer you the position of <strong>{formData.role || '___________'}</strong> at <strong>{formData.companyName || '___________'}</strong>, effective <strong>{formatDate(formData.startDate)}</strong>. You will be associated with the <strong>{formData.department || '___________'}</strong> and will report to <strong>{formData.supervisorName || '___________'}</strong>.
          </p>
          <p className="offer-para">
            In this role, you will be responsible for {formData.responsibilities || '___________'}, contributing to the company&rsquo;s strategic, operational, and financial objectives.
          </p>
          <p className="offer-para">
            This is a full-time employment position. You will receive {formData.paymentFrequency === 'Annual' ? 'an annual compensation' : 'a compensation'} of <strong>{formData.stipend || '___'} {formData.currency}</strong>, payable as per company policy, along with applicable benefits.
          </p>
          <p className="offer-para">
            You are required to maintain the highest standards of professional conduct and confidentiality during and after your employment with the company. Your employment will be governed by company policies and applicable laws.
          </p>
          <p className="offer-para">
            To confirm your acceptance of this offer, please reply to this email with your confirmation by <strong>{formatDate(formData.acceptanceDeadline)}</strong>.
          </p>
          <p className="offer-para">
            We look forward to your association and contributions to {formData.companyName || '___________'}.
          </p>
        </>
      ) : (
        <>
          <p className="offer-para">
            We are pleased to offer you the position of <strong>{formData.role || '___________'}</strong> at <strong>{formData.companyName || '___________'}</strong>. This internship will commence on <strong>{formatDate(formData.startDate)}</strong> and conclude on <strong>{formatDate(formData.endDate)}</strong>. You will be associated with the <strong>{formData.department || '___________'}</strong> and report to <strong>{formData.supervisorName || '___________'}</strong>.
          </p>
          <p className="offer-para">
            Your responsibilities will include {formData.responsibilities || '___________'}.{' '}
            {formData.isPaid
              ? `This is a paid internship. You will receive a stipend of ${formData.stipend || '___'} ${formData.currency}, disbursed on a ${formData.paymentFrequency} basis.`
              : 'This is an unpaid internship. No financial remuneration or benefits will be provided by the organization.'
            }{' '}This offer does not guarantee permanent employment.
          </p>
          <p className="offer-para">
            You are required to maintain professional conduct and confidentiality during and after your tenure. To accept this offer, please confirm your acceptance by replying to this email by <strong>{formatDate(formData.acceptanceDeadline)}</strong>.
          </p>
          <p className="offer-para">
            We wish you a productive learning experience with us.
          </p>
        </>
      )}

      {/* Signature + Stamp Row */}
      <div className="offer-sig-stamp-row">
        <div className="offer-sig-left">
          <p className="offer-text">Sincerely,</p>
          {formData.signature ? (
            <img src={formData.signature} alt="Signature" className="offer-sig-img" />
          ) : (
            <div style={{ height: '40px' }} />
          )}
          <p className="offer-bold">{formData.authorizedPersonName || ''}</p>
          <p className="offer-small">{formData.authorizedPersonDesignation || ''}</p>
          <p className="offer-bold" style={{ fontSize: '10pt' }}>{formData.companyName || ''}</p>
        </div>
        <div className="offer-stamp-right">
          {formData.showStamp && (
            <>
              {formData.stampType === 'uploaded' && formData.stampUrl ? (
                <img src={formData.stampUrl} alt="Company Stamp" className="doc-stamp-img" />
              ) : formData.stampType === 'generated' && formData.companyName ? (
                <StampPreview companyName={formData.companyName} city={formData.stampCity} size={70} />
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Acceptance & Signature Section */}
      <div className="offer-acceptance-section">
        <div className="offer-acceptance-divider" />
        <h4 className="offer-acceptance-title">ACCEPTANCE &amp; SIGNATURE</h4>
        <div className="offer-acceptance-divider" />

        <p className="offer-para" style={{ marginTop: '1em' }}>
          I, _________________________, hereby accept the terms and conditions of this offer letter.
        </p>

        <div className="offer-acceptance-columns">
          <div className="offer-acceptance-col">
            <p className="offer-bold" style={{ fontSize: '9pt', marginBottom: '0.5em' }}>Authorized Signatory</p>
            <p className="offer-text" style={{ fontSize: '9pt' }}>{formData.authorizedPersonName || '___________________'}</p>
            <p className="offer-text" style={{ fontSize: '9pt' }}>{formData.companyName || '___________________'}</p>
            <p className="offer-text" style={{ fontSize: '9pt' }}>Date: {formatDate(today)}</p>
            {formData.signature ? (
              <img src={formData.signature} alt="Signature" className="offer-sig-img" style={{ maxHeight: '35px', marginTop: '0.5em' }} />
            ) : (
              <div style={{ borderBottom: '1px solid #333', width: '180px', marginTop: '1em', paddingTop: '1.5em' }} />
            )}
            <p className="offer-small" style={{ marginTop: '0.25em' }}>Signature</p>
          </div>

          <div className="offer-acceptance-col">
            <p className="offer-bold" style={{ fontSize: '9pt', marginBottom: '0.5em' }}>Candidate Signature</p>
            <p className="offer-text" style={{ fontSize: '9pt' }}>Name: &nbsp;_______________________</p>
            <p className="offer-text" style={{ fontSize: '9pt' }}>Date: &nbsp;&nbsp;_______________________</p>
            <p className="offer-text" style={{ fontSize: '9pt' }}>Place: _______________________</p>
            <div style={{ borderBottom: '1px solid #333', width: '180px', marginTop: '1em', paddingTop: '1.5em' }} />
            <p className="offer-small" style={{ marginTop: '0.25em' }}>Signature</p>
          </div>
        </div>

        <p className="offer-small" style={{ textAlign: 'center', color: '#888', marginTop: '1.5em', fontSize: '7pt' }}>
          For digital acceptance, please use the secure link provided. For physical copy, sign above and return to HR.
        </p>
      </div>
    </div>
  );
}
