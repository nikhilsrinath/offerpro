import DocumentHeader from './DocumentHeader';
import StampPreview from './StampPreview';

export default function NdaPreview({ formData }) {
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

  const dp = formData.disclosingPartyName || '___________';
  const rp = formData.receivingPartyName || '___________';
  const docTitle = 'NON-DISCLOSURE AGREEMENT';

  const oblYears = formData.obligationYears || 5;
  const nsYears = formData.nonSolicitationYears || 1;
  const arbCity = formData.arbitrationCity || '___________';
  const arbState = formData.arbitrationState || '___________';

  const items = (formData.specificConfidentialItems || '').split('\n').filter(l => l.trim());

  // Map NDA fields to DocumentHeader expected names
  const headerData = {
    companyLogo: formData.companyLogo,
    companyName: formData.disclosingPartyName,
    companyTagline: formData.companyTagline,
    cin: formData.cin,
    companyAddress: formData.disclosingPartyAddress,
    companyPhone: formData.companyPhone,
    companyEmail: formData.companyEmail,
    companyWebsite: formData.companyWebsite,
  };

  return (
    <div className="a4-sheet">
      {/* Professional Header */}
      <DocumentHeader formData={headerData} />

      {/* TITLE */}
      <div className="nda-title">{docTitle}</div>

      {/* PREAMBLE */}
      <p className="nda-para">
        This Non-disclosure and confidentiality agreement (the &ldquo;Agreement&rdquo;) is made
        this {fmtDatePreamble(formData.effectiveDate)} (&ldquo;Effective Date&rdquo;), entered into at {formData.executionCity || '___________'}, {formData.executionState || '___________'}:
      </p>

      <p className="nda-bold-para">BY AND BETWEEN:</p>

      <p className="nda-para">
        {dp.toUpperCase()}, a company incorporated under the laws of {formData.disclosingPartyIncorporation || 'India'}, having its registered office at {formData.disclosingPartyAddress || '___________'}. (hereinafter referred to as the &ldquo;Disclosing Party&rdquo; which expression shall unless excluded by or repugnant to the subject or context be deemed to include its successors-in-interest and permitted assigns) of the ONE PART
      </p>

      <div className="nda-center-bold">AND</div>

      <p className="nda-para">
        {rp.toUpperCase()}, a company incorporated under the laws of {formData.receivingPartyIncorporation || 'India'}, having its registered office at {formData.receivingPartyAddress || '___________'} (hereinafter referred to as the &ldquo;Receiving Party&rdquo; which expression shall unless excluded by or repugnant to the subject or context be deemed to include its successors-in-interest and permitted assigns) of the OTHER PART
      </p>

      <p className="nda-italic-para">
        (The Disclosing Party and the Receiving Party shall hereinafter individually referred to as &ldquo;Party&rdquo; and collectively as &ldquo;Parties&rdquo;)
      </p>

      {/* WHEREAS */}
      <p className="nda-bold-para">WHEREAS:</p>

      <p className="nda-para">A. The Parties are proposing to enter into the following transaction:</p>
      <p className="nda-para">
        {dp.toUpperCase()} {formData.proposedTransaction || '___________'} (&ldquo;Proposed Transaction&rdquo;)
      </p>

      <p className="nda-para">B. The Disclosing Party is disclosing the Confidential Information (as defined hereunder) to the Receiving Party for the following purpose:</p>
      <p className="nda-para">{formData.purposeOfDisclosure || '___________'}</p>

      <p className="nda-para">
        C. The Receiving Party is required to execute a non-disclosure agreement to protect the information of the Disclosing Party. Accordingly, the Parties wish to enter into this Non-Disclosure Agreement whereby Receiving Party agrees to treat as confidential, all the Confidential Information (as defined hereunder) provided by the Disclosing Party/acquired from the Disclosing Party, on the terms and conditions mentioned hereunder.
      </p>

      <p className="nda-bold-para">NOW THEREFORE THE PARTIES HEREBY AGREE AS FOLLOWS:</p>

      {/* 1. DEFINITIONS */}
      <h4 className="nda-heading">1. DEFINITIONS</h4>

      <p className="nda-para">
        1.1. &ldquo;Confidential Information&rdquo; for the purpose of this Non-Disclosure Agreement shall mean all the information and documents disclosed or submitted, orally, in writing, or by any other media (whether designated as confidential or not), by the Disclosing Party, either directly or indirectly (including through its group companies or agents), to the Receiving Party or any of its affiliated corporations or any of its authorized employees, officers or directors, and such information and documents includes without limitation:
      </p>

      <p className="nda-sub-clause">1.1.1. the terms of any agreement between the Disclosing Party and the Receiving Party;</p>
      <p className="nda-sub-clause">1.1.2. the fact that discussions are taking place between the Parties;</p>
      <p className="nda-sub-clause">1.1.3. all technical and business information, whether written, oral or graphic, including without limitation:</p>

      <p className="nda-deep-sub">1.1.3.1. financial plans and records, ideas, business plans and strategies, relationships with third parties, information relating to suppliers, founders, employees, and affiliates, business channels data, material, products;</p>
      <p className="nda-deep-sub">1.1.3.2. technical data, know-how, research, formulae, processes, methods, technology, IT systems, computer software programs and descriptions of functions and features of the software, source code, computer hardware designs, techniques;</p>
      <p className="nda-deep-sub">1.1.3.3. present and proposed products, trade secrets, designs, drawings, trademarks, patents, prototypes, samples, products, product plans, specifications, manuals, equipment, engineering, unpublished patent applications, research-in-progress, work-in-progress, prototypes;</p>
      <p className="nda-deep-sub">1.1.3.4. advertising programs, planning and merchandising strategies, marketing, pricing, sales, marketing information, facilities, services, customers, customer lists and information or other unpublished information related to customers, marketing plans, market development, inventions, financial information, negotiations, discussion, ideas, manufacturing techniques, and the like;</p>

      <p className="nda-deep-sub">1.1.3.5. the following will also be considered confidential information:</p>
      <p className="nda-deep-sub"><strong>Specific Confidential Information includes, without limitation:</strong></p>

      {items.map((item, i) => (
        <div key={i} className="nda-bullet">{item.trim()}</div>
      ))}

      <p className="nda-deep-sub" style={{ marginTop: items.length > 0 ? '0.4em' : 0 }}>
        All insights, observations, analyses, notes, measurements, teardowns, or derivative understandings derived from examination, testing, or evaluation of the sample unit shall also be deemed Confidential Information.
      </p>

      <p className="nda-deep-sub">1.1.3.6. information which is generated by the Receiving Party in connection with the purpose for which the confidential information is received under this Agreement or otherwise.</p>

      <p className="nda-para">
        1.2. Without limiting the above, Confidential Information shall also include information that the Receiving Party knows or reasonably should know under the circumstances surrounding its disclosure, is confidential to the Disclosing Party.
      </p>

      {/* 2. DUTY AS TO CONFIDENTIALITY */}
      <h4 className="nda-heading">2. DUTY AS TO CONFIDENTIALITY</h4>

      <p className="nda-para">
        2.1. The Receiving Party acknowledges and agrees that the Confidential Information has been developed or obtained by the Disclosing Party by the investment of a significant amount of time, effort and/or expense and the Confidential Information is a valuable, special, and unique asset of the Disclosing Party and needs to be protected from improper disclosure.
      </p>

      <p className="nda-para">2.2. The Receiving Party will use the Confidential Information of the Disclosing Party solely for the purpose as specified below:</p>
      <p className="nda-para">{formData.purposeOfDisclosure || '___________'}</p>
      <p className="nda-para">and shall keep it secure and confidential, and will not, except as outlined in Clause named Exceptions, disclose any of the Disclosing Party&rsquo;s Confidential Information in any manner whatsoever.</p>

      <p className="nda-para">2.3. In consideration of the opportunity granted to the Receiving Party to enter into the Proposed Transaction with the Disclosing Party, the Receiving Party hereby agrees as follows:</p>
      <p className="nda-sub-clause">2.3.1. To hold the Confidential Information in confidence and to take reasonable precautions to protect such Confidential Information (including, without limitation, all precautions the Receiving Party employs with respect to its confidential materials);</p>
      <p className="nda-sub-clause">2.3.2. Not to divulge any such Confidential Information or any information derived therefrom to any third person unless prior written consent is obtained from the Disclosing Party;</p>
      <p className="nda-sub-clause">2.3.3. Not to use the Confidential Information, at any time, directly or indirectly, to procure a commercial advantage over, or do anything in any manner whatsoever, which is detrimental to the business or activities of the Disclosing Party, any of its affiliated companies or any of its directors and employees;</p>
      <p className="nda-sub-clause">2.3.4. Not to copy or reverse engineer any such Confidential Information;</p>
      <p className="nda-sub-clause">2.3.5. Not to use whether directly or indirectly or turn to its advantage in any way or profit from the use of the Confidential Information or any part thereof at any time; and</p>
      <p className="nda-sub-clause">2.3.6. To use the Confidential Information only for the purpose as specified above and in accordance with the terms of this Agreement.</p>

      {/* 3. EFFECTIVE DATE */}
      <h4 className="nda-heading">3. EFFECTIVE DATE</h4>

      <p className="nda-para">
        3.1. The obligations of the Receiving Party in respect of confidentiality as provided above shall commence from the Effective Date and the Receiving Party shall solely be responsible for compliance by such representatives with the foregoing obligations of confidentiality.
      </p>
      <p className="nda-para">
        3.2. Receiving Party hereby agrees to bind all employees, agents, associates, directors, personnel, representatives, consultants, contractors and sub-contractors, professionals or any other person who receives the Confidential Information for the purposes contemplated hereunder (&ldquo;Representatives&rdquo;) through a legally enforceable agreement to maintain the confidentiality of such Confidential Information and to be bound by all the terms of this Non-Disclosure Agreement, wherever applicable, whether expressly or generally.
      </p>

      {/* 4. EXCEPTIONS */}
      <h4 className="nda-heading">4. EXCEPTIONS</h4>

      <p className="nda-para">
        4.1. Confidential Information shall not include information that is (i) publicly available, (ii) already in the Receiving Party or its Representatives&rsquo; possession at the time of disclosure by the Disclosing Party, (iii) available to the Receiving Party or its Representatives, to the Receiving Party&rsquo;s knowledge, on a non-confidential basis, or (iv) independently developed by the Receiving Party or any of its Representatives.
      </p>
      <p className="nda-para">
        4.2. The Receiving Party may make disclosures required by law or court order provided the Receiving Party: (a) uses diligent reasonable efforts to limit disclosure and to obtain confidential treatment or protective order; and (b) gives immediate written notice to the Disclosing Party regarding such requirement and allows the Disclosing Party to participate in the proceedings.
      </p>

      {/* 5. RETURN OF INFORMATION */}
      <h4 className="nda-heading">5. RETURN OF INFORMATION</h4>

      <p className="nda-para">
        5.1. Upon: (a) receiving a written request by the Disclosing Party; or (b) termination of the discussions or arrangements between the Disclosing Party and Receiving Party (for any reason whatsoever), the Receiving Party shall forthwith deliver to the Disclosing Party (without retaining copies thereof) all Confidential Information comprised in whatever form or media such as but not limited to; documents, proposals, photographs, film, video, maps, tapes, discs, computer hardware and software, which is in the Receiving Party&rsquo;s possession or under the Receiving Party&rsquo;s control in any way and the results thereof or the business of the Disclosing Party or its related or affiliated entities or joint venture partners or projects.
      </p>
      <p className="nda-para">5.2. The Receiving Party understands that nothing herein:</p>
      <p className="nda-sub-clause">5.2.1. Requires the disclosure of any Confidential Information of the Disclosing Party; or</p>
      <p className="nda-sub-clause">5.2.2. Requires the Disclosing Party to proceed with any transaction or relationship.</p>

      {/* 6. DURATION */}
      <h4 className="nda-heading">6. DURATION</h4>

      <p className="nda-para">
        The obligations under this Agreement shall subsist for a period of {oblYears} ({numWord(oblYears)}) years from the effective date of the Agreement.
      </p>

      {/* 7. NON-SOLICITATION */}
      <h4 className="nda-heading">7. NON-SOLICITATION</h4>

      <p className="nda-para">
        During the term of this Agreement and for a period of {nsYears} ({numWord(nsYears)}) year{parseInt(nsYears) !== 1 ? 's' : ''} thereafter, neither Party shall, directly or indirectly, solicit, recruit, or hire any of the other Party&rsquo;s employees, contractors, or consultants who have been directly involved in the discussions or execution of the Proposed Transaction, without the prior written consent of the other Party. General solicitations (e.g., job postings) not targeted at specific individuals shall not be a violation of this clause.
      </p>

      {/* 8. REMEDIES */}
      <h4 className="nda-heading">8. REMEDIES</h4>

      <p className="nda-para">
        The Receiving Party acknowledges and agrees that unauthorized disclosure or use of the Confidential Information would cause irreparable harm and significant injury to the Disclosing Party that may be difficult to ascertain, and for which monetary damages alone would not be an adequate remedy. Accordingly, the Receiving Party agrees that the Disclosing Party shall have the right to seek immediate injunctive relief to enforce obligations under this Agreement, in addition to any other rights and remedies it may have at law or in equity.
      </p>

      {/* 9. NO WARRANTIES */}
      <h4 className="nda-heading">9. NO WARRANTIES</h4>

      <p className="nda-para">
        The Receiving Party acknowledges that the Confidential Information is made available on an &ldquo;AS IS&rdquo; basis. The Disclosing Party does not make any representations or warranties regarding the information provided including without limitation any financial information and the same is subject to an independent assessment of the Receiving Party. THE DISCLOSING PARTY MAKES NO WARRANTIES, EXPRESS OR IMPLIED, WITH RESPECT TO THE CONFIDENTIAL INFORMATION AND HEREBY DISCLAIMS ANY AND ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. Any actions taken by the Receiving Party shall be solely at the risk of the Receiving Party.
      </p>

      {/* 10. INDEMNITY */}
      <h4 className="nda-heading">10. INDEMNITY</h4>

      <p className="nda-para">
        Each Party (&ldquo;Indemnifying Party&rdquo;) hereby agrees to indemnify and hold the other Party harmless from all damages, costs, attorney&rsquo;s fees, or other losses arising out of or relating to the breach of this Non-Disclosure Agreement by the Indemnifying Party.
      </p>

      {/* 11. SEVERABILITY */}
      <h4 className="nda-heading">11. SEVERABILITY</h4>

      <p className="nda-para">
        If any provision of this Non-Disclosure Agreement shall for any reason be held to be invalid, illegal, or unenforceable in any respect, such invalidity, illegality, or unenforceability shall not affect any other provision thereof, and this Non-Disclosure Agreement shall be construed as if such invalid, illegal or unenforceable provision had never been contained herein. Any invalid or unenforceable provision of this Non-Disclosure Agreement shall be replaced with a provision that is valid, enforceable, and most nearly gives effect to the original intent of the invalid/unenforceable provision.
      </p>

      {/* 12. ENTIRE AGREEMENT */}
      <h4 className="nda-heading">12. ENTIRE AGREEMENT</h4>

      <p className="nda-para">
        This Non-Disclosure Agreement constitutes the entire agreement and understanding of the Parties with respect to the subject matter hereof and supersedes any and all prior negotiations, correspondence, agreements, understandings duties or obligations between the Parties with respect to the subject matter hereof.
      </p>

      {/* 13. NO OTHER RIGHTS GRANTED */}
      <h4 className="nda-heading">13. NO OTHER RIGHTS GRANTED</h4>

      <p className="nda-para">
        Nothing in this Agreement is intended to grant any rights under any patent, copyright, or other intellectual property rights of any Party in favour of the other, nor shall this Agreement be construed to grant any Party any rights in or to the other Party&rsquo;s Confidential Information, except the limited right to use such Confidential Information in connection with the proposed relationship between the parties. The Receiving Party shall not receive any intellectual property rights in the Confidential Information other than a limited right to use the Confidential Information for the purposes specified in this Agreement. All intellectual property rights shall continue to vest with the Disclosing Party. The Disclosing Party shall retain all title, interest and rights and all intellectual property and proprietary rights in the Confidential Information. No license under any trademark, patent or copyright, or application for same which are now or hereafter may be obtained by Disclosing Party is either granted or implied by the conveying of Confidential Information. The Receiving Party shall not conceal, alter, obliterate, mutilate, deface, or otherwise interfere with any trademark, trademark notice, copyright notice, confidentiality notice or any notice of any other proprietary right of the Disclosing Party on any copy of the Confidential Information, and shall reproduce any such mark or notice on all copies of such Confidential Information. Likewise, the Receiving Party shall not add or emboss its own or any other mark, symbol, or logo on such Confidential Information.
      </p>

      {/* 14. AMENDMENTS */}
      <h4 className="nda-heading">14. AMENDMENTS</h4>

      <p className="nda-para">
        Any change, alteration, amendment, or modification to this Non-Disclosure Agreement must be in writing and signed by authorized representatives of both the Parties.
      </p>

      {/* 15. DISPUTE RESOLUTION */}
      <h4 className="nda-heading">15. DISPUTE RESOLUTION</h4>

      <p className="nda-para">15.1. Except as otherwise specifically provided in this Lease Deed, the following provisions apply if any dispute and difference arise between the Parties, arising out of or in relation to/connection with this Lease Deed (The &lsquo;Dispute&rsquo;).</p>
      <p className="nda-para">15.2. Dispute will be deemed to arise when one Party serves on the other Party a notice stating the nature of the Dispute (a &lsquo;Notice of Dispute&rsquo;).</p>
      <p className="nda-para">15.3. The Parties hereto agree that upon serving a Notice of Dispute, they will use all reasonable efforts to resolve the Dispute between themselves through negotiations.</p>
      <p className="nda-para">15.4. A dispute that cannot be solved by negotiations shall be referred to arbitration by a sole arbitrator to be appointed jointly by the Parties.</p>
      <p className="nda-para">15.5. The arbitration proceedings shall be held in {arbCity}, {arbState} in accordance with the provisions of the Arbitration and Conciliation Act, 1996 or any statutory re-enactment or modification thereof for the time being in force.</p>
      <p className="nda-para">15.6. The Parties agree that the arbitration award shall be final and may be enforced as a decree.</p>
      <p className="nda-para">15.7. The Parties further agree that subject to the above only the competent courts at {arbCity}, {arbState} shall have jurisdiction in all matters arising hereunder.</p>

      {/* 16. INDEPENDENT PARTIES */}
      <h4 className="nda-heading">16. INDEPENDENT PARTIES</h4>

      <p className="nda-para">
        Nothing contained or implied in this letter creates a joint venture or partnership between the Parties or makes one party the agent or legal representative of the other party for any purpose.
      </p>

      {/* 17. EXCLUSIVITY */}
      <h4 className="nda-heading">17. EXCLUSIVITY</h4>

      <p className="nda-para">
        Nothing in this Agreement restricts the Disclosing Party or its group companies from discussing similar arrangements and/or any related transaction with any other party, any regulatory body in India and their respective successors.
      </p>

      {/* 18. ASSIGNMENT */}
      <h4 className="nda-heading">18. ASSIGNMENT</h4>

      <p className="nda-para">
        This Agreement shall be not be assignable by any Party without the prior written consent of the other Party.
      </p>

      {/* 19. ANNOUNCEMENTS */}
      <h4 className="nda-heading">19. ANNOUNCEMENTS</h4>

      <p className="nda-para">
        A Party shall not make any news releases, public announcements, give interviews, issue, or publish advertisements or publicize in any other manner whatsoever in connection with this Agreement, the contents/provisions thereof, other information relating to this Agreement, the Confidential Information or other matter of this Agreement, without the prior written approval of the other Party.
      </p>

      {/* 20. NOTICES */}
      <h4 className="nda-heading">20. NOTICES</h4>

      <p className="nda-para">
        Except as otherwise specified in this Non-Disclosure Agreement, all notices, requests, consents, approvals, agreements, authorizations, acknowledgements, waivers, and other communications required or permitted under this Non-Disclosure Agreement shall be in writing and shall be deemed given when sent to the address specified below:
      </p>

      <p className="nda-bold-para">For Disclosing Party</p>
      <p className="nda-para">Address: {formData.disclosingPartyAddress || '___________'}</p>

      <p className="nda-bold-para">For Receiving Party</p>
      <p className="nda-para">Address: {formData.receivingPartyAddress || '___________'}</p>

      <p className="nda-para">
        Either Party may change its address for notification purposes by giving the other Party 10 (ten) days&rsquo; notice of the new address and the date upon which it will become effective.
      </p>

      {/* 21. TERMINATION */}
      <h4 className="nda-heading">21. TERMINATION</h4>

      <p className="nda-para">
        This Agreement shall be terminated only by mutual agreement of the Parties. Termination of this Agreement will not prejudice any rights of the parties or terminate any obligations of confidentiality with respect to the Confidential Information existing prior to termination.
      </p>

      {/* 22. GOVERNING LAW */}
      <h4 className="nda-heading">22. GOVERNING LAW</h4>

      <p className="nda-para">
        This Agreement and all issues arising out of the same shall be construed in accordance with the laws of India.
      </p>

      {/* SIGNATURE BLOCK */}
      <p className="nda-bold-para" style={{ marginTop: '2em' }}>
        IN WITNESS WHEREOF, the Parties hereto have executed this Agreement:
      </p>

      <div className="nda-sig-block">
        <div className="nda-sig-col">
          <div className="nda-sig-name">{dp.toUpperCase()}</div>
          {formData.disclosingSignature ? (
            <img src={formData.disclosingSignature} alt="Signature" className="nda-sig-img" />
          ) : (
            <div className="nda-sig-line"><span>By: _____________________________</span></div>
          )}
          <div>Name: {formData.disclosingSignatoryName || ''}</div>
          <div>Designation: {formData.disclosingSignatoryDesignation || ''}</div>
          <div>Date: {fmtDate(formData.disclosingSignatoryDate || formData.effectiveDate)}</div>
          <div className="nda-stamp-area">
            {formData.stampType === 'uploaded' && formData.stampUrl ? (
              <img src={formData.stampUrl} alt="Company Stamp" className="doc-stamp-img" />
            ) : formData.stampType === 'generated' && formData.disclosingPartyName ? (
              <StampPreview companyName={formData.disclosingPartyName} city={formData.stampCity} size={80} />
            ) : null}
          </div>
        </div>
        <div className="nda-sig-col">
          <div className="nda-sig-name">{rp.toUpperCase()}</div>
          {formData.receivingSignature ? (
            <img src={formData.receivingSignature} alt="Signature" className="nda-sig-img" />
          ) : (
            <div className="nda-sig-line"><span>By: ______________________________</span></div>
          )}
          <div>Name: {formData.receivingSignatoryName || ''}</div>
          <div>Designation: {formData.receivingSignatoryDesignation || ''}</div>
          <div>Date: {fmtDate(formData.receivingSignatoryDate || formData.effectiveDate)}</div>
        </div>
      </div>
    </div>
  );
}
