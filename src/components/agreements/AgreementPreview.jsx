import DocumentHeader from '../DocumentHeader';
import StampPreview from '../StampPreview';
import { buildAgreement } from '../../services/agreementModel';

const BLOCK_CLASS = { para: 'nda-para', bold: 'nda-bold-para', italic: 'nda-italic-para', center: 'nda-center-bold', bullet: 'nda-bullet' };

function Block({ block }) {
  const Tag = block.kind === 'bullet' || block.kind === 'center' ? 'div' : 'p';
  return <Tag className={BLOCK_CLASS[block.kind]}>{block.text}</Tag>;
}

export default function AgreementPreview({ formData }) {
  const doc = buildAgreement(formData);

  const headerData = {
    companyLogo: formData.companyLogo,
    companyName: formData.firstPartyName,
    companyTagline: formData.companyTagline,
    cin: formData.cin,
    companyAddress: formData.firstPartyAddress,
    companyPhone: formData.companyPhone,
    companyEmail: formData.companyEmail,
    companyWebsite: formData.companyWebsite,
  };

  return (
    <div className="a4-sheet">
      <DocumentHeader formData={headerData} />

      <div className="nda-title">{doc.title}</div>

      {doc.preamble.map((b, i) => <Block key={`p${i}`} block={b} />)}

      {doc.clauses.map((c, i) => (
        <div key={i}>
          {c.heading && <h4 className="nda-heading">{c.heading}</h4>}
          {c.blocks.map((b, j) => <Block key={j} block={b} />)}
        </div>
      ))}

      {doc.closing && (
        <p className="nda-para" style={{ marginTop: '2em' }}>
          <strong>IN WITNESS WHEREOF</strong>{doc.closing.slice('IN WITNESS WHEREOF'.length)}
        </p>
      )}

      {doc.signatories.length > 0 && (
        <div className="nda-sig-block">
          {doc.signatories.map((s, i) => (
            <div key={i} className="nda-sig-col">
              <div className="nda-sig-name">{s.party.toUpperCase()}</div>
              {s.signature ? (
                <img src={s.signature} alt="Signature" className="nda-sig-img" />
              ) : (
                <div className="nda-sig-line"><span>Signature: ___________________________</span></div>
              )}
              <div>Name: {s.name || '___________________'}</div>
              <div>Designation: {s.designation || '___________________'}</div>
              <div>Date: {s.date}</div>
              {s.stamp && (
                <div className="nda-stamp-area">
                  {formData.showStamp && (
                    formData.stampType === 'uploaded' && formData.stampUrl ? (
                      <img src={formData.stampUrl} alt="Company Stamp" className="doc-stamp-img" />
                    ) : formData.stampType === 'generated' && formData.firstPartyName ? (
                      <StampPreview companyName={formData.firstPartyName} city={formData.stampCity} size={65} />
                    ) : null
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {doc.witnesses && (
        <div className="nda-witness-section">
          <p className="nda-bold-para" style={{ marginTop: '1.5em', fontSize: '10pt' }}>WITNESSES:</p>
          <div className="nda-sig-block" style={{ marginTop: '0.5em' }}>
            {[1, 2].map((n) => (
              <div key={n} className="nda-sig-col">
                <div style={{ fontSize: '9pt' }}>{n}. Name: ___________________________</div>
                <div style={{ fontSize: '9pt', marginTop: '0.5em' }}>Address: ___________________________</div>
                <div style={{ borderBottom: '1px solid #333', width: '180px', marginTop: '1.5em' }} />
                <div style={{ fontSize: '8pt', marginTop: '0.25em' }}>Signature</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
