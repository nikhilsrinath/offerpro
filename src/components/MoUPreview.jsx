import DocumentHeader from './DocumentHeader';
import StampPreview from './StampPreview';

export default function MoUPreview({ formData }) {
  const fmtDatePreamble = (d) => {
    if (!d) return '___________';
    return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  const fmtDate = (d) => {
    if (!d) return '___________';
    const dt = new Date(d);
    const day = dt.getDate();
    const suffix = [, 'st', 'nd', 'rd'][day % 10 > 3 ? 0 : (day % 100 - day % 10 === 10 ? 0 : day % 10)] || 'th';
    return `${day}${suffix} ${dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
  };

  const numWord = (n) => {
    const w = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    return w[parseInt(n)] || String(n);
  };

  const fp = formData.firstPartyName || '___________';
  const sp = formData.secondPartyName || '___________';
  const spType = formData.secondPartyType === 'individual' ? 'an individual' : 'a company/individual';
  const termYears = formData.mouTermYears || 2;
  const arbCity = formData.arbitrationCity || '___________';

  const scopeItems = (formData.scopeAreas || '').split('\n').filter(l => l.trim());
  const fpResponsibilities = (formData.firstPartyResponsibilities || '').split('\n').filter(l => l.trim());
  const spResponsibilities = (formData.secondPartyResponsibilities || '').split('\n').filter(l => l.trim());

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
      {/* Professional Header */}
      <DocumentHeader formData={headerData} />

      {/* TITLE */}
      <div className="nda-title">MEMORANDUM OF UNDERSTANDING (MoU)</div>

      {/* PREAMBLE */}
      <p className="nda-para">
        This Memorandum of Understanding (&ldquo;MoU&rdquo;) is made on this {fmtDatePreamble(formData.effectiveDate)} (&ldquo;Effective Date&rdquo;), at {formData.executionCity || '___________'}, {formData.executionState || '___________'}.
      </p>

      <p className="nda-bold-para">BY AND BETWEEN</p>

      <p className="nda-para">
        {fp.toUpperCase()}, a company incorporated under the laws of {formData.firstPartyIncorporation || 'India'}, having its registered office at {formData.firstPartyAddress || '___________'} (hereinafter referred to as the &ldquo;First Party&rdquo;, which expression shall unless repugnant to the context or meaning thereof include its successors and permitted assigns);
      </p>

      <div className="nda-center-bold">AND</div>

      <p className="nda-para">
        {sp.toUpperCase()}, {spType} incorporated under the laws of {formData.secondPartyIncorporation || 'India'}, having its registered office at {formData.secondPartyAddress || '___________'} (hereinafter referred to as the &ldquo;Second Party&rdquo;, which expression shall unless repugnant to the context or meaning thereof include its successors and permitted assigns).
      </p>

      <p className="nda-italic-para">
        The First Party and Second Party shall hereinafter individually be referred to as a &ldquo;Party&rdquo; and collectively as the &ldquo;Parties.&rdquo;
      </p>

      {/* 1. PURPOSE */}
      <h4 className="nda-heading">1. PURPOSE</h4>
      <p className="nda-para">
        The purpose of this Memorandum of Understanding is to establish a framework of cooperation between the Parties for the purpose of:
      </p>
      <p className="nda-para">
        {formData.purpose || '________________________________________'}
      </p>
      <p className="nda-para">
        This MoU outlines the intentions of the Parties to collaborate in good faith and defines the roles, responsibilities, and expectations relating to the proposed collaboration.
      </p>

      {/* 2. SCOPE OF COLLABORATION */}
      <h4 className="nda-heading">2. SCOPE OF COLLABORATION</h4>
      <p className="nda-para">The Parties agree to cooperate in the following areas:</p>

      {scopeItems.length > 0 ? (
        scopeItems.map((item, i) => (
          <div key={i} className="nda-bullet">{item.trim()}</div>
        ))
      ) : (
        <>
          <div className="nda-bullet">Development, research, or deployment of ________________________</div>
          <div className="nda-bullet">Sharing of relevant expertise, knowledge, and technical capabilities</div>
          <div className="nda-bullet">Joint exploration of business opportunities related to ________________________</div>
        </>
      )}

      <div className="nda-bullet">Any other mutually agreed activity that supports the objectives of this collaboration.</div>

      <p className="nda-para" style={{ marginTop: '0.5em' }}>
        Any specific projects, commercial agreements, or transactions arising from this collaboration may be governed by separate definitive agreements.
      </p>

      {/* 3. ROLES AND RESPONSIBILITIES */}
      <h4 className="nda-heading">3. ROLES AND RESPONSIBILITIES</h4>

      <p className="nda-bold-para">3.1 Responsibilities of the First Party</p>
      <p className="nda-para">The First Party agrees to:</p>
      {fpResponsibilities.length > 0 ? (
        fpResponsibilities.map((item, i) => (
          <div key={i} className="nda-bullet">{item.trim()}</div>
        ))
      ) : (
        <>
          <div className="nda-bullet">Provide expertise, technology, or resources related to ________________________</div>
          <div className="nda-bullet">Participate in planning and coordination of collaborative activities</div>
          <div className="nda-bullet">Share relevant knowledge and information necessary for the collaboration</div>
          <div className="nda-bullet">Fulfill commitments required for successful implementation of the collaboration.</div>
        </>
      )}

      <p className="nda-bold-para" style={{ marginTop: '1em' }}>3.2 Responsibilities of the Second Party</p>
      <p className="nda-para">The Second Party agrees to:</p>
      {spResponsibilities.length > 0 ? (
        spResponsibilities.map((item, i) => (
          <div key={i} className="nda-bullet">{item.trim()}</div>
        ))
      ) : (
        <>
          <div className="nda-bullet">Provide expertise, services, or resources related to ________________________</div>
          <div className="nda-bullet">Support implementation of the agreed collaborative activities</div>
          <div className="nda-bullet">Coordinate with the First Party for execution of the objectives</div>
          <div className="nda-bullet">Ensure timely performance of assigned responsibilities.</div>
        </>
      )}

      {/* 4. CONFIDENTIALITY */}
      <h4 className="nda-heading">4. CONFIDENTIALITY</h4>
      <p className="nda-para">
        Both Parties agree that any confidential information shared during the course of collaboration shall be treated as confidential and shall not be disclosed to third parties without prior written consent of the other Party.
      </p>
      <p className="nda-para">
        If required, the Parties may enter into a separate Non-Disclosure Agreement (NDA) governing confidentiality obligations.
      </p>

      {/* 5. FINANCIAL ARRANGEMENTS */}
      <h4 className="nda-heading">5. FINANCIAL ARRANGEMENTS</h4>
      <p className="nda-para">Unless otherwise agreed in writing:</p>
      <div className="nda-bullet">Each Party shall bear its own costs and expenses incurred in relation to activities under this MoU.</div>
      <div className="nda-bullet">Any financial arrangements, investments, revenue sharing, or commercial terms shall be defined in a separate written agreement between the Parties.</div>

      {/* 6. INTELLECTUAL PROPERTY */}
      <h4 className="nda-heading">6. INTELLECTUAL PROPERTY</h4>
      <p className="nda-para">
        6.1 Any intellectual property owned by a Party prior to entering into this MoU shall remain the property of that Party.
      </p>
      <p className="nda-para">
        6.2 Any intellectual property developed jointly during the course of collaboration shall be governed by a separate agreement mutually agreed by the Parties.
      </p>
      <p className="nda-para">
        6.3 Nothing contained in this MoU shall be deemed to grant either Party any license or rights to the intellectual property of the other Party unless expressly agreed in writing.
      </p>

      {/* 7. TERM AND TERMINATION */}
      <h4 className="nda-heading">7. TERM AND TERMINATION</h4>
      <p className="nda-para">
        7.1 This MoU shall remain in effect for a period of {termYears} ({numWord(termYears)}) year{parseInt(termYears) !== 1 ? 's' : ''} from the Effective Date unless terminated earlier by mutual agreement of the Parties.
      </p>
      <p className="nda-para">
        7.2 Either Party may terminate this MoU by giving 30 (thirty) days&rsquo; written notice to the other Party.
      </p>
      <p className="nda-para">
        7.3 Termination of this MoU shall not affect any obligations already incurred prior to termination.
      </p>

      {/* 8. NON-BINDING NATURE */}
      <h4 className="nda-heading">8. NON-BINDING NATURE</h4>
      <p className="nda-para">
        This Memorandum of Understanding represents the mutual intentions of the Parties and does not constitute a legally binding agreement, except for clauses relating to confidentiality, dispute resolution, and intellectual property where applicable.
      </p>
      <p className="nda-para">
        The Parties acknowledge that definitive agreements may be executed in the future to formalize specific commercial arrangements.
      </p>

      {/* 9. DISPUTE RESOLUTION */}
      <h4 className="nda-heading">9. DISPUTE RESOLUTION</h4>
      <p className="nda-para">
        9.1 The Parties shall first attempt to resolve any dispute arising out of this MoU through mutual discussions and negotiations.
      </p>
      <p className="nda-para">
        9.2 If the dispute cannot be resolved amicably, it shall be referred to arbitration by a sole arbitrator mutually appointed by the Parties.
      </p>
      <p className="nda-para">
        9.3 The arbitration shall be conducted in accordance with the Arbitration and Conciliation Act, 1996.
      </p>
      <p className="nda-para">
        9.4 The place of arbitration shall be {arbCity}, India.
      </p>
      <p className="nda-para">
        9.5 The decision of the arbitrator shall be final and binding on the Parties.
      </p>

      {/* 10. GOVERNING LAW */}
      <h4 className="nda-heading">10. GOVERNING LAW</h4>
      <p className="nda-para">
        This MoU shall be governed by and construed in accordance with the laws of India.
      </p>

      {/* 11. AMENDMENTS */}
      <h4 className="nda-heading">11. AMENDMENTS</h4>
      <p className="nda-para">
        Any amendment or modification to this MoU shall be made only through a written document signed by authorized representatives of both Parties.
      </p>

      {/* 12. INDEPENDENT PARTIES */}
      <h4 className="nda-heading">12. INDEPENDENT PARTIES</h4>
      <p className="nda-para">
        Nothing contained in this MoU shall be deemed to create any partnership, joint venture, employment, or agency relationship between the Parties unless expressly agreed through a separate written agreement.
      </p>

      {/* 13. ASSIGNMENT */}
      <h4 className="nda-heading">13. ASSIGNMENT</h4>
      <p className="nda-para">
        Neither Party shall assign or transfer its rights or obligations under this MoU without the prior written consent of the other Party.
      </p>

      {/* 14. ENTIRE UNDERSTANDING */}
      <h4 className="nda-heading">14. ENTIRE UNDERSTANDING</h4>
      <p className="nda-para">
        This MoU represents the entire understanding between the Parties with respect to the subject matter hereof and supersedes all prior discussions, negotiations, or communications.
      </p>

      {/* SIGNATURE BLOCK */}
      <p className="nda-bold-para" style={{ marginTop: '2em' }}>
        IN WITNESS WHEREOF
      </p>
      <p className="nda-para">
        The Parties have executed this Memorandum of Understanding on the date first written above.
      </p>

      <div className="nda-sig-block">
        <div className="nda-sig-col">
          <div className="nda-sig-name">{fp.toUpperCase()}</div>
          {formData.firstPartySignature ? (
            <img src={formData.firstPartySignature} alt="Signature" className="nda-sig-img" />
          ) : (
            <div className="nda-sig-line"><span>Signature: ___________________________</span></div>
          )}
          <div>Name: {formData.firstPartySignatoryName || '___________________'}</div>
          <div>Designation: {formData.firstPartySignatoryDesignation || '___________________'}</div>
          <div>Date: {fmtDate(formData.firstPartySignatoryDate || formData.effectiveDate)}</div>
          <div className="nda-stamp-area">
            {formData.showStamp && (
              <>
                {formData.stampType === 'uploaded' && formData.stampUrl ? (
                  <img src={formData.stampUrl} alt="Company Stamp" className="doc-stamp-img" />
                ) : formData.stampType === 'generated' && formData.firstPartyName ? (
                  <StampPreview companyName={formData.firstPartyName} city={formData.stampCity} size={65} />
                ) : null}
              </>
            )}
          </div>
        </div>
        <div className="nda-sig-col">
          <div className="nda-sig-name">{sp.toUpperCase()}</div>
          {formData.secondPartySignature ? (
            <img src={formData.secondPartySignature} alt="Signature" className="nda-sig-img" />
          ) : (
            <div className="nda-sig-line"><span>Signature: ___________________________</span></div>
          )}
          <div>Name: {formData.secondPartySignatoryName || '___________________'}</div>
          <div>Designation: {formData.secondPartySignatoryDesignation || '___________________'}</div>
          <div>Date: {fmtDate(formData.secondPartySignatoryDate || formData.effectiveDate)}</div>
        </div>
      </div>
    </div>
  );
}
