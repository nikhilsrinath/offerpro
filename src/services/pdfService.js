import { jsPDF } from 'jspdf';
import { renderCertificatePdf } from './certificateTemplates';

export const pdfService = {
  generateOfferLetter: (data, isPreview = false) => {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const margin = 25;
    const pageWidth = 210;
    const contentWidth = pageWidth - (margin * 2);
    const bodySize = 11; // Uniform font size as requested
    let y = 15;

    // Helper: Simple text with standard alignment
    const addText = (text, options = {}) => {
      const { 
        font = 'helvetica', 
        size = bodySize, 
        style = 'normal', 
        alignment = 'left',
        gap = 2
      } = options;
      
      doc.setFont(font, style);
      doc.setFontSize(size);
      
      const splitText = doc.splitTextToSize(text || '', contentWidth);
      const lineHeight = size * 0.3527 * 1.3;
      
      let x = margin;
      if (alignment === 'center') x = pageWidth / 2;
      
      doc.text(splitText, x, y, { align: alignment });
      y += (splitText.length * lineHeight) + gap;
    };

    // Helper: Justified Paragraph with Inline Bolding
    const renderJustifiedParagraph = (segments, options = {}) => {
      const { size = bodySize, spacing = 1.35, gap = 5 } = options;
      doc.setFontSize(size);
      const lineHeight = size * 0.3527 * spacing;

      // 1. Flatten segments into a list of words with their styling
      let words = [];
      segments.forEach(seg => {
        const text = seg.text || '';
        const style = seg.bold ? 'bold' : 'normal';
        const segWords = text.split(/(\s+)/); // Preserve spaces
        segWords.forEach(w => {
          if (w.trim().length > 0) {
            words.push({ text: w, bold: seg.bold });
          } else if (w.length > 0) {
            words.push({ text: w, isSpace: true });
          }
        });
      });

      // 2. Wrap words into lines
      let lines = [];
      let currentLine = [];
      let currentLineWidth = 0;

      words.forEach(word => {
        doc.setFont('helvetica', word.bold ? 'bold' : 'normal');
        const wordWidth = doc.getTextWidth(word.text);

        if (currentLineWidth + wordWidth > contentWidth && currentLine.length > 0) {
          lines.push(currentLine);
          currentLine = [];
          currentLineWidth = 0;
          // If the word triggered wrap and is a space, ignore it at start of next line
          if (word.isSpace) return; 
        }

        currentLine.push(word);
        currentLineWidth += wordWidth;
      });
      if (currentLine.length > 0) lines.push(currentLine);

      // 3. Render lines (Justified)
      lines.forEach((line, index) => {
        const isLastLine = index === lines.length - 1;
        let curX = margin;

        // Calculate total text width and spaces for justification
        let totalTextWidth = 0;
        let spaceCount = 0;
        line.forEach(w => {
          doc.setFont('helvetica', w.bold ? 'bold' : 'normal');
          totalTextWidth += doc.getTextWidth(w.text);
          if (w.isSpace) spaceCount++;
        });

        const extraSpace = contentWidth - totalTextWidth;
        const spaceIncrement = (isLastLine || spaceCount === 0) ? 0 : extraSpace / spaceCount;

        line.forEach(word => {
          doc.setFont('helvetica', word.bold ? 'bold' : 'normal');
          if (word.isSpace) {
            curX += doc.getTextWidth(word.text) + spaceIncrement;
          } else {
            doc.text(word.text, curX, y);
            curX += doc.getTextWidth(word.text);
          }
        });

        y += lineHeight;
      });

      y += gap;
    };

    // Helper: Formal Date Formatter (3rd January 2026)
    const formatDateToWording = (dateStr) => {
      if (!dateStr) return '';
      // Ensure we handle numeric strings correctly
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

    // 1. Branding (Logo & Header)
    if (data.companyLogo) {
      try {
        const props = doc.getImageProperties(data.companyLogo);
        const displayWidth = 28;
        const displayHeight = (props.height * displayWidth) / props.width;
        doc.addImage(data.companyLogo, 'PNG', margin, y, displayWidth, displayHeight);
        y += displayHeight + 12; // Increased gap as requested
      } catch (e) {
        console.error('Logo error:', e);
      }
    }

    addText(data.companyName.toUpperCase(), { style: 'bold', size: 13, gap: 0 });
    addText(data.companyAddress, { size: 9, gap: 4 });

    // 2. Recipient & Date
    const today = new Date().toISOString().split('T')[0];
    addText(`Date: ${formatDateToWording(today)}`, { gap: 4 });
    addText('To,', { style: 'bold', gap: 1 });
    addText(data.studentName, { style: 'bold', gap: 1 });
    addText(data.studentAddress, { size: 10, gap: 5 });

    // 5. Template Logic (Strict Separation)
    const isFT = data.offerType === 'fulltime';
    
    if (isFT) {
        // --- FULL-TIME TEMPLATE ---
        addText('Subject: Offer of Full-Time Employment', { style: 'bold', alignment: 'center', gap: 6 });
        addText(`Dear ${data.studentName},`, { style: 'bold', gap: 4 });

        renderJustifiedParagraph([
          { text: 'We are pleased to offer you the position of ' },
          { text: data.role, bold: true },
          { text: ' at ' },
          { text: data.companyName, bold: true },
          { text: `, effective ` },
          { text: formatDateToWording(data.startDate), bold: true },
          { text: '. You will be associated with the ' },
          { text: data.department, bold: true },
          { text: ' and will report to ' },
          { text: data.supervisorName, bold: true },
          { text: '.' }
        ]);

        renderJustifiedParagraph([
          { text: 'In this role, you will be responsible for ' },
          { text: data.responsibilities, bold: false },
          { text: ', contributing to the company’s strategic, operational, and financial objectives.' }
        ]);

        const payTerm = data.paymentFrequency === 'Annual' ? 'an annual compensation' : 'a compensation';
        renderJustifiedParagraph([
          { text: 'This is a full-time employment position. You will receive ' },
          { text: `${payTerm} of `, bold: false },
          { text: `${data.stipend} ${data.currency}`, bold: true },
          { text: `, payable as per company policy, along with applicable benefits.` }
        ]);

        renderJustifiedParagraph([
          { text: 'You are required to maintain the highest standards of professional conduct and confidentiality during and after your employment with the company. Your employment will be governed by company policies and applicable laws.' }
        ]);

        renderJustifiedParagraph([
          { text: 'To confirm your acceptance of this offer, please reply to this email with your confirmation by ' },
          { text: formatDateToWording(data.acceptanceDeadline), bold: true },
          { text: '.' }
        ]);

        renderJustifiedParagraph([
          { text: `We look forward to your association and contributions to ${data.companyName}.` }
        ]);

    } else {
        // --- INTERNSHIP TEMPLATE ---
        addText('Subject: Internship Offer Letter', { style: 'bold', alignment: 'center', gap: 6 });
        addText(`Dear ${data.studentName},`, { style: 'bold', gap: 4 });

        renderJustifiedParagraph([
          { text: 'We are pleased to offer you the position of ' },
          { text: data.role, bold: true },
          { text: ' at ' },
          { text: data.companyName, bold: true },
          { text: '. This internship will commence on ' },
          { text: formatDateToWording(data.startDate), bold: true },
          { text: ' and conclude on ' },
          { text: formatDateToWording(data.endDate), bold: true },
          { text: '. You will be associated with the ' },
          { text: data.department, bold: true },
          { text: ' and report to ' },
          { text: data.supervisorName, bold: true },
          { text: '.' }
        ]);

        const payText = data.isPaid 
            ? `This is a paid internship. You will receive a stipend of ${data.stipend} ${data.currency}, disbursed on a ${data.paymentFrequency} basis.`
            : `This is an unpaid internship. No financial remuneration or benefits will be provided by the organization.`;

        renderJustifiedParagraph([
          { text: 'Your responsibilities will include ' },
          { text: data.responsibilities, bold: false },
          { text: `. ${payText} This offer does not guarantee permanent employment.` }
        ]);

        renderJustifiedParagraph([
          { text: 'You are required to maintain professional conduct and confidentiality during and after your tenure. To accept this offer, please confirm your acceptance by replying to this email by ' },
          { text: formatDateToWording(data.acceptanceDeadline), bold: true },
          { text: '.' }
        ]);

        renderJustifiedParagraph([
          { text: 'We wish you a productive learning experience with us.' }
        ]);
    }

    y += 2;
    addText('Sincerely,', { gap: 2 });

    // 9. Signature
    if (data.signature) {
      try {
        const props = doc.getImageProperties(data.signature);
        const sigW = 40;
        const sigH = (props.height * sigW) / props.width;
        doc.addImage(data.signature, 'PNG', margin, y, sigW, sigH);
        y += sigH + 2;
      } catch (e) {
        console.error('Sign error:', e);
      }
    } else {
      y += 12;
    }

    addText(data.authorizedPersonName, { style: 'bold' });
    addText(data.authorizedPersonDesignation, { size: 10, gap: 0.5 });
    addText(data.companyName, { style: 'bold', size: 10 });

    if (isPreview) {
      window.open(doc.output('bloburl'), '_blank');
    } else {
      const fileName = `Offer_${data.studentName.replace(/\s+/g, '_')}.pdf`;
      doc.save(fileName);
    }
  },

  generateCertificate: (data, isPreview = false) => {
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    renderCertificatePdf(doc, data);

    if (isPreview) {
      window.open(doc.output('bloburl'), '_blank');
    } else {
      const fileName = `Certificate_${(data.recipientName || 'Certificate').replace(/\s+/g, '_')}.pdf`;
      doc.save(fileName);
    }
  },

  generateNda: (data, isPreview = false) => {
    const doc = new jsPDF('portrait', 'mm', 'a4');
    const mg = 22;
    const pw = 210;
    const cw = pw - mg * 2;
    let y = 28;
    const pageBottom = 278;
    const lh = 5;

    const checkPage = (needed = 8) => { if (y + needed > pageBottom) { doc.addPage(); y = 28; } };
    const setN = (sz = 11) => { doc.setFont('times', 'normal'); doc.setFontSize(sz); };
    const setB = (sz = 11) => { doc.setFont('times', 'bold'); doc.setFontSize(sz); };
    const setI = (sz = 11) => { doc.setFont('times', 'italic'); doc.setFontSize(sz); };

    const writeLines = (lines, x = mg) => {
      for (const line of lines) { checkPage(lh); doc.text(line, x, y); y += lh; }
    };

    const para = (text, indent = 0, gap = 3) => {
      setN(); const w = cw - indent;
      writeLines(doc.splitTextToSize(text || '', w), mg + indent); y += gap;
    };

    const boldPara = (text, indent = 0, gap = 3) => {
      setB(); const w = cw - indent;
      writeLines(doc.splitTextToSize(text || '', w), mg + indent); y += gap;
    };

    const italicPara = (text, indent = 0, gap = 2, sz = 10) => {
      setI(sz); const w = cw - indent;
      writeLines(doc.splitTextToSize(text || '', w), mg + indent); y += gap;
    };

    const centerBold = (text, sz = 11) => {
      setB(sz); checkPage(lh + 2);
      doc.text(text, pw / 2, y, { align: 'center' }); y += sz * 0.42 + 3;
    };

    const bullet = (text, indent = 12) => {
      setN(); const w = cw - indent - 4;
      const lines = doc.splitTextToSize(text, w);
      checkPage(lh); doc.text('\u2022', mg + indent, y);
      for (let i = 0; i < lines.length; i++) { checkPage(lh); doc.text(lines[i], mg + indent + 4, y); y += lh; }
      y += 1;
    };

    const heading = (text, gap = 3) => { checkPage(15); y += 4; boldPara(text, 0, gap); };

    const fmtDate = (d) => {
      if (!d) return '___________';
      const dt = new Date(d);
      const day = dt.getDate();
      const suffix = [,'st','nd','rd'][day % 10 > 3 ? 0 : (day % 100 - day % 10 === 10 ? 0 : day % 10)] || 'th';
      return `${day}${suffix} ${dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
    };

    const fmtDatePreamble = (d) => {
      if (!d) return '___________';
      return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    };

    const numWord = (n) => {
      const w = ['zero','one','two','three','four','five','six','seven','eight','nine','ten'];
      return w[parseInt(n)] || String(n);
    };

    const dp = data.disclosingPartyName || '___________';
    const rp = data.receivingPartyName || '___________';

    // ===== TITLE =====
    centerBold('NON-DISCLOSURE AGREEMENT', 16);
    y += 3;

    // ===== PREAMBLE =====
    para(`This Non-disclosure and confidentiality agreement (the "Agreement") is made this ${fmtDatePreamble(data.effectiveDate)} ("Effective Date"), entered into at ${data.executionCity || '___________'}, ${data.executionState || '___________'}:`);

    boldPara('BY AND BETWEEN:');

    para(`${dp.toUpperCase()}, a company incorporated under the laws of ${data.disclosingPartyIncorporation || 'India'}, having its registered office at ${data.disclosingPartyAddress || '___________'}. (hereinafter referred to as the "Disclosing Party" which expression shall unless excluded by or repugnant to the subject or context be deemed to include its successors-in-interest and permitted assigns) of the ONE PART`);

    centerBold('AND');

    para(`${rp.toUpperCase()}, a company incorporated under the laws of ${data.receivingPartyIncorporation || 'India'}, having its registered office at ${data.receivingPartyAddress || '___________'} (hereinafter referred to as the "Receiving Party" which expression shall unless excluded by or repugnant to the subject or context be deemed to include its successors-in-interest and permitted assigns) of the OTHER PART`);

    italicPara('(The Disclosing Party and the Receiving Party shall hereinafter individually referred to as "Party" and collectively as "Parties")', 0, 4);

    // ===== WHEREAS =====
    boldPara('WHEREAS:');

    para('A. The Parties are proposing to enter into the following transaction:');
    para(`${dp.toUpperCase()} ${data.proposedTransaction || '___________'} ("Proposed Transaction")`, 0, 4);

    para('B. The Disclosing Party is disclosing the Confidential Information (as defined hereunder) to the Receiving Party for the following purpose:');
    para(data.purposeOfDisclosure || '___________', 0, 4);

    para('C. The Receiving Party is required to execute a non-disclosure agreement to protect the information of the Disclosing Party. Accordingly, the Parties wish to enter into this Non-Disclosure Agreement whereby Receiving Party agrees to treat as confidential, all the Confidential Information (as defined hereunder) provided by the Disclosing Party/acquired from the Disclosing Party, on the terms and conditions mentioned hereunder.');

    y += 3;
    boldPara('NOW THEREFORE THE PARTIES HEREBY AGREE AS FOLLOWS:');

    // ===== 1. DEFINITIONS =====
    heading('1. DEFINITIONS');

    para('1.1. "Confidential Information" for the purpose of this Non-Disclosure Agreement shall mean all the information and documents disclosed or submitted, orally, in writing, or by any other media (whether designated as confidential or not), by the Disclosing Party, either directly or indirectly (including through its group companies or agents), to the Receiving Party or any of its affiliated corporations or any of its authorized employees, officers or directors, and such information and documents includes without limitation:', 0, 2);

    para('1.1.1. the terms of any agreement between the Disclosing Party and the Receiving Party;', 6, 2);
    para('1.1.2. the fact that discussions are taking place between the Parties;', 6, 2);
    para('1.1.3. all technical and business information, whether written, oral or graphic, including without limitation:', 6, 2);

    para('1.1.3.1. financial plans and records, ideas, business plans and strategies, relationships with third parties, information relating to suppliers, founders, employees, and affiliates, business channels data, material, products;', 12, 2);
    para('1.1.3.2. technical data, know-how, research, formulae, processes, methods, technology, IT systems, computer software programs and descriptions of functions and features of the software, source code, computer hardware designs, techniques;', 12, 2);
    para('1.1.3.3. present and proposed products, trade secrets, designs, drawings, trademarks, patents, prototypes, samples, products, product plans, specifications, manuals, equipment, engineering, unpublished patent applications, research-in-progress, work-in-progress, prototypes;', 12, 2);
    para('1.1.3.4. advertising programs, planning and merchandising strategies, marketing, pricing, sales, marketing information, facilities, services, customers, customer lists and information or other unpublished information related to customers, marketing plans, market development, inventions, financial information, negotiations, discussion, ideas, manufacturing techniques, and the like;', 12, 2);

    para('1.1.3.5. the following will also be considered confidential information:', 12, 2);
    boldPara('Specific Confidential Information includes, without limitation:', 12, 2);

    const items = (data.specificConfidentialItems || '').split('\n').filter(l => l.trim());
    items.forEach(item => bullet(item.trim(), 12));

    y += 2;
    para('All insights, observations, analyses, notes, measurements, teardowns, or derivative understandings derived from examination, testing, or evaluation of the sample unit shall also be deemed Confidential Information.', 12, 3);

    para('1.1.3.6. information which is generated by the Receiving Party in connection with the purpose for which the confidential information is received under this Agreement or otherwise.', 12, 3);

    para('1.2. Without limiting the above, Confidential Information shall also include information that the Receiving Party knows or reasonably should know under the circumstances surrounding its disclosure, is confidential to the Disclosing Party.', 0, 4);

    // ===== 2. DUTY AS TO CONFIDENTIALITY =====
    heading('2. DUTY AS TO CONFIDENTIALITY');

    para('2.1. The Receiving Party acknowledges and agrees that the Confidential Information has been developed or obtained by the Disclosing Party by the investment of a significant amount of time, effort and/or expense and the Confidential Information is a valuable, special, and unique asset of the Disclosing Party and needs to be protected from improper disclosure.');

    para('2.2. The Receiving Party will use the Confidential Information of the Disclosing Party solely for the purpose as specified below:', 0, 2);
    para(data.purposeOfDisclosure || '___________');
    para('and shall keep it secure and confidential, and will not, except as outlined in Clause named Exceptions, disclose any of the Disclosing Party\'s Confidential Information in any manner whatsoever.');

    para('2.3. In consideration of the opportunity granted to the Receiving Party to enter into the Proposed Transaction with the Disclosing Party, the Receiving Party hereby agrees as follows:');
    para('2.3.1. To hold the Confidential Information in confidence and to take reasonable precautions to protect such Confidential Information (including, without limitation, all precautions the Receiving Party employs with respect to its confidential materials);', 6, 2);
    para('2.3.2. Not to divulge any such Confidential Information or any information derived therefrom to any third person unless prior written consent is obtained from the Disclosing Party;', 6, 2);
    para('2.3.3. Not to use the Confidential Information, at any time, directly or indirectly, to procure a commercial advantage over, or do anything in any manner whatsoever, which is detrimental to the business or activities of the Disclosing Party, any of its affiliated companies or any of its directors and employees;', 6, 2);
    para('2.3.4. Not to copy or reverse engineer any such Confidential Information;', 6, 2);
    para('2.3.5. Not to use whether directly or indirectly or turn to its advantage in any way or profit from the use of the Confidential Information or any part thereof at any time; and', 6, 2);
    para('2.3.6. To use the Confidential Information only for the purpose as specified above and in accordance with the terms of this Agreement.', 6, 3);

    // ===== 3. EFFECTIVE DATE =====
    heading('3. EFFECTIVE DATE');
    para('3.1. The obligations of the Receiving Party in respect of confidentiality as provided above shall commence from the Effective Date and the Receiving Party shall solely be responsible for compliance by such representatives with the foregoing obligations of confidentiality.');
    para('3.2. Receiving Party hereby agrees to bind all employees, agents, associates, directors, personnel, representatives, consultants, contractors and sub-contractors, professionals or any other person who receives the Confidential Information for the purposes contemplated hereunder ("Representatives") through a legally enforceable agreement to maintain the confidentiality of such Confidential Information and to be bound by all the terms of this Non-Disclosure Agreement, wherever applicable, whether expressly or generally.');

    // ===== 4. EXCEPTIONS =====
    heading('4. EXCEPTIONS');
    para('4.1. Confidential Information shall not include information that is (i) publicly available, (ii) already in the Receiving Party or its Representatives\' possession at the time of disclosure by the Disclosing Party, (iii) available to the Receiving Party or its Representatives, to the Receiving Party\'s knowledge, on a non-confidential basis, or (iv) independently developed by the Receiving Party or any of its Representatives.');
    para('4.2. The Receiving Party may make disclosures required by law or court order provided the Receiving Party: (a) uses diligent reasonable efforts to limit disclosure and to obtain confidential treatment or protective order; and (b) gives immediate written notice to the Disclosing Party regarding such requirement and allows the Disclosing Party to participate in the proceedings.');

    // ===== 5. RETURN OF INFORMATION =====
    heading('5. RETURN OF INFORMATION');
    para('5.1. Upon: (a) receiving a written request by the Disclosing Party; or (b) termination of the discussions or arrangements between the Disclosing Party and Receiving Party (for any reason whatsoever), the Receiving Party shall forthwith deliver to the Disclosing Party (without retaining copies thereof) all Confidential Information comprised in whatever form or media such as but not limited to; documents, proposals, photographs, film, video, maps, tapes, discs, computer hardware and software, which is in the Receiving Party\'s possession or under the Receiving Party\'s control in any way and the results thereof or the business of the Disclosing Party or its related or affiliated entities or joint venture partners or projects.');
    para('5.2. The Receiving Party understands that nothing herein:', 0, 2);
    para('5.2.1. Requires the disclosure of any Confidential Information of the Disclosing Party; or', 6, 2);
    para('5.2.2. Requires the Disclosing Party to proceed with any transaction or relationship.', 6, 3);

    // ===== 6. DURATION =====
    heading('6. DURATION');
    para(`The obligations under this Agreement shall subsist for a period of ${data.obligationYears || 5} (${numWord(data.obligationYears || 5)}) years from the effective date of the Agreement.`);

    // ===== 7. NON-SOLICITATION =====
    heading('7. NON-SOLICITATION');
    const nsYears = data.nonSolicitationYears || 1;
    para(`During the term of this Agreement and for a period of ${nsYears} (${numWord(nsYears)}) year${parseInt(nsYears) !== 1 ? 's' : ''} thereafter, neither Party shall, directly or indirectly, solicit, recruit, or hire any of the other Party's employees, contractors, or consultants who have been directly involved in the discussions or execution of the Proposed Transaction, without the prior written consent of the other Party. General solicitations (e.g., job postings) not targeted at specific individuals shall not be a violation of this clause.`);

    // ===== 8. REMEDIES =====
    heading('8. REMEDIES');
    para('The Receiving Party acknowledges and agrees that unauthorized disclosure or use of the Confidential Information would cause irreparable harm and significant injury to the Disclosing Party that may be difficult to ascertain, and for which monetary damages alone would not be an adequate remedy. Accordingly, the Receiving Party agrees that the Disclosing Party shall have the right to seek immediate injunctive relief to enforce obligations under this Agreement, in addition to any other rights and remedies it may have at law or in equity.');

    // ===== 9. NO WARRANTIES =====
    heading('9. NO WARRANTIES');
    para('The Receiving Party acknowledges that the Confidential Information is made available on an "AS IS" basis. The Disclosing Party does not make any representations or warranties regarding the information provided including without limitation any financial information and the same is subject to an independent assessment of the Receiving Party. THE DISCLOSING PARTY MAKES NO WARRANTIES, EXPRESS OR IMPLIED, WITH RESPECT TO THE CONFIDENTIAL INFORMATION AND HEREBY DISCLAIMS ANY AND ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. Any actions taken by the Receiving Party shall be solely at the risk of the Receiving Party.');

    // ===== 10. INDEMNITY =====
    heading('10. INDEMNITY');
    para('Each Party ("Indemnifying Party") hereby agrees to indemnify and hold the other Party harmless from all damages, costs, attorney\'s fees, or other losses arising out of or relating to the breach of this Non-Disclosure Agreement by the Indemnifying Party.');

    // ===== 11. SEVERABILITY =====
    heading('11. SEVERABILITY');
    para('If any provision of this Non-Disclosure Agreement shall for any reason be held to be invalid, illegal, or unenforceable in any respect, such invalidity, illegality, or unenforceability shall not affect any other provision thereof, and this Non-Disclosure Agreement shall be construed as if such invalid, illegal or unenforceable provision had never been contained herein. Any invalid or unenforceable provision of this Non-Disclosure Agreement shall be replaced with a provision that is valid, enforceable, and most nearly gives effect to the original intent of the invalid/unenforceable provision.');

    // ===== 12. ENTIRE AGREEMENT =====
    heading('12. ENTIRE AGREEMENT');
    para('This Non-Disclosure Agreement constitutes the entire agreement and understanding of the Parties with respect to the subject matter hereof and supersedes any and all prior negotiations, correspondence, agreements, understandings duties or obligations between the Parties with respect to the subject matter hereof.');

    // ===== 13. NO OTHER RIGHTS GRANTED =====
    heading('13. NO OTHER RIGHTS GRANTED');
    para('Nothing in this Agreement is intended to grant any rights under any patent, copyright, or other intellectual property rights of any Party in favour of the other, nor shall this Agreement be construed to grant any Party any rights in or to the other Party\'s Confidential Information, except the limited right to use such Confidential Information in connection with the proposed relationship between the parties. The Receiving Party shall not receive any intellectual property rights in the Confidential Information other than a limited right to use the Confidential Information for the purposes specified in this Agreement. All intellectual property rights shall continue to vest with the Disclosing Party. The Disclosing Party shall retain all title, interest and rights and all intellectual property and proprietary rights in the Confidential Information. No license under any trademark, patent or copyright, or application for same which are now or hereafter may be obtained by Disclosing Party is either granted or implied by the conveying of Confidential Information. The Receiving Party shall not conceal, alter, obliterate, mutilate, deface, or otherwise interfere with any trademark, trademark notice, copyright notice, confidentiality notice or any notice of any other proprietary right of the Disclosing Party on any copy of the Confidential Information, and shall reproduce any such mark or notice on all copies of such Confidential Information. Likewise, the Receiving Party shall not add or emboss its own or any other mark, symbol, or logo on such Confidential Information.');

    // ===== 14. AMENDMENTS =====
    heading('14. AMENDMENTS');
    para('Any change, alteration, amendment, or modification to this Non-Disclosure Agreement must be in writing and signed by authorized representatives of both the Parties.');

    // ===== 15. DISPUTE RESOLUTION =====
    heading('15. DISPUTE RESOLUTION');
    const arbCity = data.arbitrationCity || '___________';
    const arbState = data.arbitrationState || '___________';
    para('15.1. Except as otherwise specifically provided in this Lease Deed, the following provisions apply if any dispute and difference arise between the Parties, arising out of or in relation to/connection with this Lease Deed (The \'Dispute\').');
    para('15.2. Dispute will be deemed to arise when one Party serves on the other Party a notice stating the nature of the Dispute (a \'Notice of Dispute\').');
    para('15.3. The Parties hereto agree that upon serving a Notice of Dispute, they will use all reasonable efforts to resolve the Dispute between themselves through negotiations.');
    para('15.4. A dispute that cannot be solved by negotiations shall be referred to arbitration by a sole arbitrator to be appointed jointly by the Parties.');
    para(`15.5. The arbitration proceedings shall be held in ${arbCity}, ${arbState} in accordance with the provisions of the Arbitration and Conciliation Act, 1996 or any statutory re-enactment or modification thereof for the time being in force.`);
    para('15.6. The Parties agree that the arbitration award shall be final and may be enforced as a decree.');
    para(`15.7. The Parties further agree that subject to the above only the competent courts at ${arbCity}, ${arbState} shall have jurisdiction in all matters arising hereunder.`);

    // ===== 16. INDEPENDENT PARTIES =====
    heading('16. INDEPENDENT PARTIES');
    para('Nothing contained or implied in this letter creates a joint venture or partnership between the Parties or makes one party the agent or legal representative of the other party for any purpose.');

    // ===== 17. EXCLUSIVITY =====
    heading('17. EXCLUSIVITY');
    para('Nothing in this Agreement restricts the Disclosing Party or its group companies from discussing similar arrangements and/or any related transaction with any other party, any regulatory body in India and their respective successors.');

    // ===== 18. ASSIGNMENT =====
    heading('18. ASSIGNMENT');
    para('This Agreement shall be not be assignable by any Party without the prior written consent of the other Party.');

    // ===== 19. ANNOUNCEMENTS =====
    heading('19. ANNOUNCEMENTS');
    para('A Party shall not make any news releases, public announcements, give interviews, issue, or publish advertisements or publicize in any other manner whatsoever in connection with this Agreement, the contents/provisions thereof, other information relating to this Agreement, the Confidential Information or other matter of this Agreement, without the prior written approval of the other Party.');

    // ===== 20. NOTICES =====
    heading('20. NOTICES');
    para('Except as otherwise specified in this Non-Disclosure Agreement, all notices, requests, consents, approvals, agreements, authorizations, acknowledgements, waivers, and other communications required or permitted under this Non-Disclosure Agreement shall be in writing and shall be deemed given when sent to the address specified below:', 0, 4);

    boldPara('For Disclosing Party', 0, 1);
    para(`Address: ${data.disclosingPartyAddress || '___________'}`, 0, 4);
    boldPara('For Receiving Party', 0, 1);
    para(`Address: ${data.receivingPartyAddress || '___________'}`, 0, 4);

    para('Either Party may change its address for notification purposes by giving the other Party 10 (ten) days\' notice of the new address and the date upon which it will become effective.');

    // ===== 21. TERMINATION =====
    heading('21. TERMINATION');
    para('This Agreement shall be terminated only by mutual agreement of the Parties. Termination of this Agreement will not prejudice any rights of the parties or terminate any obligations of confidentiality with respect to the Confidential Information existing prior to termination.');

    // ===== 22. GOVERNING LAW =====
    heading('22. GOVERNING LAW');
    para('This Agreement and all issues arising out of the same shall be construed in accordance with the laws of India.');

    // ===== SIGNATURE BLOCK =====
    checkPage(65);
    y += 8;
    boldPara('IN WITNESS WHEREOF, the Parties hereto have executed this Agreement:');
    y += 6;

    const halfW = (cw - 10) / 2;
    const rightX = mg + halfW + 10;
    const sigStartY = y;

    // Left: Disclosing Party
    setB(10);
    const dpLines = doc.splitTextToSize(dp.toUpperCase(), halfW);
    for (const line of dpLines) { doc.text(line, mg, y); y += 5; }
    y += 4;

    if (data.disclosingSignature) {
      try { doc.addImage(data.disclosingSignature, 'PNG', mg, y, 38, 14); y += 17; }
      catch { setN(10); doc.text('By: _____________________________', mg, y); y += 7; }
    } else {
      setN(10); doc.text('By: _____________________________', mg, y); y += 7;
    }

    setN(10);
    doc.text(`Name: ${data.disclosingSignatoryName || ''}`, mg, y); y += 5;
    doc.text(`Designation: ${data.disclosingSignatoryDesignation || ''}`, mg, y); y += 5;
    doc.text(`Date: ${fmtDate(data.disclosingSignatoryDate || data.effectiveDate)}`, mg, y);

    // Right: Receiving Party
    y = sigStartY;
    setB(10);
    const rpLines = doc.splitTextToSize(rp.toUpperCase(), halfW);
    for (const line of rpLines) { doc.text(line, rightX, y); y += 5; }
    y += 4;

    if (data.receivingSignature) {
      try { doc.addImage(data.receivingSignature, 'PNG', rightX, y, 38, 14); y += 17; }
      catch { setN(10); doc.text('By: ______________________________', rightX, y); y += 7; }
    } else {
      setN(10); doc.text('By: ______________________________', rightX, y); y += 7;
    }

    setN(10);
    doc.text(`Name: ${data.receivingSignatoryName || ''}`, rightX, y); y += 5;
    doc.text(`Designation: ${data.receivingSignatoryDesignation || ''}`, rightX, y); y += 5;
    doc.text(`Date: ${fmtDate(data.receivingSignatoryDate || data.effectiveDate)}`, rightX, y);

    // Save or Preview
    if (isPreview) {
      window.open(doc.output('bloburl'), '_blank');
    } else {
      const fileName = `NDA_${(dp).replace(/\s+/g, '_')}_${(rp).replace(/\s+/g, '_')}.pdf`;
      doc.save(fileName);
    }
  },

  generateMoU: (data, isPreview = false) => {
    const doc = new jsPDF('portrait', 'mm', 'a4');
    const mg = 22;
    const pw = 210;
    const cw = pw - mg * 2;
    let y = 28;
    const pageBottom = 278;
    const lh = 5;

    const checkPage = (needed = 8) => { if (y + needed > pageBottom) { doc.addPage(); y = 28; } };
    const setN = (sz = 11) => { doc.setFont('times', 'normal'); doc.setFontSize(sz); };
    const setB = (sz = 11) => { doc.setFont('times', 'bold'); doc.setFontSize(sz); };
    const setI = (sz = 11) => { doc.setFont('times', 'italic'); doc.setFontSize(sz); };

    const writeLines = (lines, x = mg) => {
      for (const line of lines) { checkPage(lh); doc.text(line, x, y); y += lh; }
    };

    const para = (text, indent = 0, gap = 3) => {
      setN(); const w = cw - indent;
      writeLines(doc.splitTextToSize(text || '', w), mg + indent); y += gap;
    };

    const boldPara = (text, indent = 0, gap = 3) => {
      setB(); const w = cw - indent;
      writeLines(doc.splitTextToSize(text || '', w), mg + indent); y += gap;
    };

    const italicPara = (text, indent = 0, gap = 2, sz = 10) => {
      setI(sz); const w = cw - indent;
      writeLines(doc.splitTextToSize(text || '', w), mg + indent); y += gap;
    };

    const centerBold = (text, sz = 11) => {
      setB(sz); checkPage(lh + 2);
      doc.text(text, pw / 2, y, { align: 'center' }); y += sz * 0.42 + 3;
    };

    const bullet = (text, indent = 6) => {
      setN(); const w = cw - indent - 4;
      const lines = doc.splitTextToSize(text, w);
      checkPage(lh); doc.text('\u2022', mg + indent, y);
      for (let i = 0; i < lines.length; i++) { checkPage(lh); doc.text(lines[i], mg + indent + 4, y); y += lh; }
      y += 1;
    };

    const heading = (text, gap = 3) => { checkPage(15); y += 4; boldPara(text, 0, gap); };

    const fmtDate = (d) => {
      if (!d) return '___________';
      const dt = new Date(d);
      const day = dt.getDate();
      const suffix = [,'st','nd','rd'][day % 10 > 3 ? 0 : (day % 100 - day % 10 === 10 ? 0 : day % 10)] || 'th';
      return `${day}${suffix} ${dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
    };

    const fmtDatePreamble = (d) => {
      if (!d) return '___________';
      return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    };

    const numWord = (n) => {
      const w = ['zero','one','two','three','four','five','six','seven','eight','nine','ten'];
      return w[parseInt(n)] || String(n);
    };

    const fp = data.firstPartyName || '___________';
    const sp = data.secondPartyName || '___________';
    const spType = data.secondPartyType === 'individual' ? 'an individual' : 'a company/individual';
    const termYears = data.mouTermYears || 2;
    const arbCity = data.arbitrationCity || '___________';

    // ===== TITLE =====
    centerBold('MEMORANDUM OF UNDERSTANDING (MoU)', 16);
    y += 3;

    // ===== PREAMBLE =====
    para(`This Memorandum of Understanding ("MoU") is made on this ${fmtDatePreamble(data.effectiveDate)} ("Effective Date"), at ${data.executionCity || '___________'}, ${data.executionState || '___________'}.`);

    boldPara('BY AND BETWEEN');

    para(`${fp.toUpperCase()}, a company incorporated under the laws of ${data.firstPartyIncorporation || 'India'}, having its registered office at ${data.firstPartyAddress || '___________'} (hereinafter referred to as the "First Party", which expression shall unless repugnant to the context or meaning thereof include its successors and permitted assigns);`);

    centerBold('AND');

    para(`${sp.toUpperCase()}, ${spType} incorporated under the laws of ${data.secondPartyIncorporation || 'India'}, having its registered office at ${data.secondPartyAddress || '___________'} (hereinafter referred to as the "Second Party", which expression shall unless repugnant to the context or meaning thereof include its successors and permitted assigns).`);

    italicPara('The First Party and Second Party shall hereinafter individually be referred to as a "Party" and collectively as the "Parties."', 0, 4);

    // ===== 1. PURPOSE =====
    heading('1. PURPOSE');
    para('The purpose of this Memorandum of Understanding is to establish a framework of cooperation between the Parties for the purpose of:');
    para(data.purpose || '________________________________________');
    para('This MoU outlines the intentions of the Parties to collaborate in good faith and defines the roles, responsibilities, and expectations relating to the proposed collaboration.');

    // ===== 2. SCOPE OF COLLABORATION =====
    heading('2. SCOPE OF COLLABORATION');
    para('The Parties agree to cooperate in the following areas:');

    const scopeItems = (data.scopeAreas || '').split('\n').filter(l => l.trim());
    if (scopeItems.length > 0) {
      scopeItems.forEach(item => bullet(item.trim()));
    } else {
      bullet('Development, research, or deployment of ________________________');
      bullet('Sharing of relevant expertise, knowledge, and technical capabilities');
      bullet('Joint exploration of business opportunities related to ________________________');
    }
    bullet('Any other mutually agreed activity that supports the objectives of this collaboration.');
    y += 2;
    para('Any specific projects, commercial agreements, or transactions arising from this collaboration may be governed by separate definitive agreements.');

    // ===== 3. ROLES AND RESPONSIBILITIES =====
    heading('3. ROLES AND RESPONSIBILITIES');

    boldPara('3.1 Responsibilities of the First Party');
    para('The First Party agrees to:');
    const fpResponsibilities = (data.firstPartyResponsibilities || '').split('\n').filter(l => l.trim());
    if (fpResponsibilities.length > 0) {
      fpResponsibilities.forEach(item => bullet(item.trim()));
    } else {
      bullet('Provide expertise, technology, or resources related to ________________________');
      bullet('Participate in planning and coordination of collaborative activities');
      bullet('Share relevant knowledge and information necessary for the collaboration');
      bullet('Fulfill commitments required for successful implementation of the collaboration.');
    }

    y += 2;
    boldPara('3.2 Responsibilities of the Second Party');
    para('The Second Party agrees to:');
    const spResponsibilities = (data.secondPartyResponsibilities || '').split('\n').filter(l => l.trim());
    if (spResponsibilities.length > 0) {
      spResponsibilities.forEach(item => bullet(item.trim()));
    } else {
      bullet('Provide expertise, services, or resources related to ________________________');
      bullet('Support implementation of the agreed collaborative activities');
      bullet('Coordinate with the First Party for execution of the objectives');
      bullet('Ensure timely performance of assigned responsibilities.');
    }

    // ===== 4. CONFIDENTIALITY =====
    heading('4. CONFIDENTIALITY');
    para('Both Parties agree that any confidential information shared during the course of collaboration shall be treated as confidential and shall not be disclosed to third parties without prior written consent of the other Party.');
    para('If required, the Parties may enter into a separate Non-Disclosure Agreement (NDA) governing confidentiality obligations.');

    // ===== 5. FINANCIAL ARRANGEMENTS =====
    heading('5. FINANCIAL ARRANGEMENTS');
    para('Unless otherwise agreed in writing:');
    bullet('Each Party shall bear its own costs and expenses incurred in relation to activities under this MoU.');
    bullet('Any financial arrangements, investments, revenue sharing, or commercial terms shall be defined in a separate written agreement between the Parties.');

    // ===== 6. INTELLECTUAL PROPERTY =====
    heading('6. INTELLECTUAL PROPERTY');
    para('6.1 Any intellectual property owned by a Party prior to entering into this MoU shall remain the property of that Party.');
    para('6.2 Any intellectual property developed jointly during the course of collaboration shall be governed by a separate agreement mutually agreed by the Parties.');
    para('6.3 Nothing contained in this MoU shall be deemed to grant either Party any license or rights to the intellectual property of the other Party unless expressly agreed in writing.');

    // ===== 7. TERM AND TERMINATION =====
    heading('7. TERM AND TERMINATION');
    para(`7.1 This MoU shall remain in effect for a period of ${termYears} (${numWord(termYears)}) year${parseInt(termYears) !== 1 ? 's' : ''} from the Effective Date unless terminated earlier by mutual agreement of the Parties.`);
    para('7.2 Either Party may terminate this MoU by giving 30 (thirty) days\' written notice to the other Party.');
    para('7.3 Termination of this MoU shall not affect any obligations already incurred prior to termination.');

    // ===== 8. NON-BINDING NATURE =====
    heading('8. NON-BINDING NATURE');
    para('This Memorandum of Understanding represents the mutual intentions of the Parties and does not constitute a legally binding agreement, except for clauses relating to confidentiality, dispute resolution, and intellectual property where applicable.');
    para('The Parties acknowledge that definitive agreements may be executed in the future to formalize specific commercial arrangements.');

    // ===== 9. DISPUTE RESOLUTION =====
    heading('9. DISPUTE RESOLUTION');
    para('9.1 The Parties shall first attempt to resolve any dispute arising out of this MoU through mutual discussions and negotiations.');
    para('9.2 If the dispute cannot be resolved amicably, it shall be referred to arbitration by a sole arbitrator mutually appointed by the Parties.');
    para('9.3 The arbitration shall be conducted in accordance with the Arbitration and Conciliation Act, 1996.');
    para(`9.4 The place of arbitration shall be ${arbCity}, India.`);
    para('9.5 The decision of the arbitrator shall be final and binding on the Parties.');

    // ===== 10. GOVERNING LAW =====
    heading('10. GOVERNING LAW');
    para('This MoU shall be governed by and construed in accordance with the laws of India.');

    // ===== 11. AMENDMENTS =====
    heading('11. AMENDMENTS');
    para('Any amendment or modification to this MoU shall be made only through a written document signed by authorized representatives of both Parties.');

    // ===== 12. INDEPENDENT PARTIES =====
    heading('12. INDEPENDENT PARTIES');
    para('Nothing contained in this MoU shall be deemed to create any partnership, joint venture, employment, or agency relationship between the Parties unless expressly agreed through a separate written agreement.');

    // ===== 13. ASSIGNMENT =====
    heading('13. ASSIGNMENT');
    para('Neither Party shall assign or transfer its rights or obligations under this MoU without the prior written consent of the other Party.');

    // ===== 14. ENTIRE UNDERSTANDING =====
    heading('14. ENTIRE UNDERSTANDING');
    para('This MoU represents the entire understanding between the Parties with respect to the subject matter hereof and supersedes all prior discussions, negotiations, or communications.');

    // ===== SIGNATURE BLOCK =====
    checkPage(65);
    y += 8;
    boldPara('IN WITNESS WHEREOF');
    para('The Parties have executed this Memorandum of Understanding on the date first written above.');
    y += 6;

    const halfW = (cw - 10) / 2;
    const rightX = mg + halfW + 10;
    const sigStartY = y;

    // Left: First Party
    setB(10);
    const fpLines = doc.splitTextToSize(fp.toUpperCase(), halfW);
    for (const line of fpLines) { doc.text(line, mg, y); y += 5; }
    y += 4;

    if (data.firstPartySignature) {
      try { doc.addImage(data.firstPartySignature, 'PNG', mg, y, 38, 14); y += 17; }
      catch { setN(10); doc.text('Signature: ___________________________', mg, y); y += 7; }
    } else {
      setN(10); doc.text('Signature: ___________________________', mg, y); y += 7;
    }

    setN(10);
    doc.text(`Name: ${data.firstPartySignatoryName || '___________________'}`, mg, y); y += 5;
    doc.text(`Designation: ${data.firstPartySignatoryDesignation || '___________________'}`, mg, y); y += 5;
    doc.text(`Date: ${fmtDate(data.firstPartySignatoryDate || data.effectiveDate)}`, mg, y);

    // Right: Second Party
    y = sigStartY;
    setB(10);
    const spLines = doc.splitTextToSize(sp.toUpperCase(), halfW);
    for (const line of spLines) { doc.text(line, rightX, y); y += 5; }
    y += 4;

    if (data.secondPartySignature) {
      try { doc.addImage(data.secondPartySignature, 'PNG', rightX, y, 38, 14); y += 17; }
      catch { setN(10); doc.text('Signature: ___________________________', rightX, y); y += 7; }
    } else {
      setN(10); doc.text('Signature: ___________________________', rightX, y); y += 7;
    }

    setN(10);
    doc.text(`Name: ${data.secondPartySignatoryName || '___________________'}`, rightX, y); y += 5;
    doc.text(`Designation: ${data.secondPartySignatoryDesignation || '___________________'}`, rightX, y); y += 5;
    doc.text(`Date: ${fmtDate(data.secondPartySignatoryDate || data.effectiveDate)}`, rightX, y);

    // Save or Preview
    if (isPreview) {
      window.open(doc.output('bloburl'), '_blank');
    } else {
      const fileName = `MoU_${(fp).replace(/\s+/g, '_')}_${(sp).replace(/\s+/g, '_')}.pdf`;
      doc.save(fileName);
    }
  },

  generateInvoice: (data, isPreview = false) => {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const margin = 20;
    const pageWidth = 210;
    const contentWidth = pageWidth - (margin * 2);
    let y = 20;

    const addText = (text, options = {}) => {
      const { font = 'helvetica', size = 10, style = 'normal', alignment = 'left', gap = 2, color = [0, 0, 0], maxWidth = contentWidth } = options;
      doc.setFont(font, style);
      doc.setFontSize(size);
      doc.setTextColor(color[0], color[1], color[2]);
      const splitText = doc.splitTextToSize(text || '', maxWidth);
      const lineHeight = size * 0.3527 * 1.3;
      let x = margin;
      if (alignment === 'center') x = pageWidth / 2;
      if (alignment === 'right') x = pageWidth - margin;
      doc.text(splitText, x, y, { align: alignment });
      y += (splitText.length * lineHeight) + gap;
    };

    // ===== HEADER =====
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageWidth, 45, 'F');
    y = 18;
    addText('TAX INVOICE', { style: 'bold', size: 22, color: [255, 255, 255], alignment: 'center', gap: 3 });
    addText(data.invoiceNumber || '', { size: 10, color: [148, 163, 184], alignment: 'center', gap: 0 });
    y = 50;

    // ===== FROM / BILL TO =====
    const infoY = y;
    addText('FROM', { size: 7, style: 'bold', color: [100, 116, 139], gap: 2 });
    addText(data.orgName || 'Your Organization', { size: 11, style: 'bold', gap: 1 });
    if (data.sellerGSTIN) {
      addText(`GSTIN: ${data.sellerGSTIN}`, { size: 8, color: [100, 116, 139], gap: 1 });
    }
    if (data.sellerState) {
      addText(`State: ${data.sellerState}`, { size: 8, color: [100, 116, 139] });
    }
    const fromEndY = y;

    y = infoY;
    addText('BILL TO', { alignment: 'right', size: 7, style: 'bold', color: [100, 116, 139], gap: 2 });
    addText(data.clientName || 'Client Name', { alignment: 'right', size: 11, style: 'bold', gap: 1 });
    if (data.clientEmail) {
      addText(data.clientEmail, { alignment: 'right', size: 8, color: [100, 116, 139], gap: 1 });
    }
    if (data.clientAddress) {
      addText(data.clientAddress, { alignment: 'right', size: 8, color: [100, 116, 139], gap: 1, maxWidth: contentWidth / 2 });
    }
    if (data.buyerGSTIN) {
      addText(`GSTIN: ${data.buyerGSTIN}`, { alignment: 'right', size: 8, color: [100, 116, 139], gap: 1 });
    }
    if (data.buyerState) {
      addText(`State: ${data.buyerState}`, { alignment: 'right', size: 8, color: [100, 116, 139] });
    }

    y = Math.max(fromEndY, y) + 5;

    // ===== DATES =====
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, y, contentWidth, 12, 2, 2, 'F');
    y += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(`Invoice Date: ${data.invoiceDate || '-'}`, margin + 5, y);
    doc.text(`Due Date: ${data.dueDate || '-'}`, pageWidth - margin - 5, y, { align: 'right' });
    if (data.isInterState !== undefined) {
      doc.text(`Supply Type: ${data.isInterState ? 'Inter-State' : 'Intra-State'}`, pageWidth / 2, y, { align: 'center' });
    }
    y += 12;

    // ===== TABLE HEADER =====
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y, contentWidth, 10, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    const colX = {
      desc: margin + 3,
      hsn: margin + 85,
      qty: margin + 110,
      price: margin + 130,
      total: pageWidth - margin - 3
    };
    doc.text('Description', colX.desc, y + 7);
    doc.text('HSN/SAC', colX.hsn, y + 7);
    doc.text('Qty', colX.qty, y + 7);
    doc.text('Rate', colX.price, y + 7);
    doc.text('Amount', colX.total, y + 7, { align: 'right' });
    y += 14;

    // ===== LINE ITEMS =====
    doc.setTextColor(30, 41, 59);
    if (data.items && data.items.length > 0) {
      data.items.forEach((item, index) => {
        if (y > 250) { doc.addPage(); y = 20; }
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text((item.description || '-').substring(0, 45), colX.desc, y);
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(item.hsnCode || '-', colX.hsn, y);
        doc.setTextColor(30, 41, 59);
        doc.setFontSize(9);
        doc.text((item.quantity || 0).toString(), colX.qty, y);
        doc.text(`₹${(item.price || 0).toLocaleString()}`, colX.price, y);
        const lineTotal = (item.quantity || 0) * (item.price || 0);
        doc.setFont('helvetica', 'bold');
        doc.text(`₹${lineTotal.toLocaleString()}`, colX.total, y, { align: 'right' });
        y += 9;

        doc.setDrawColor(241, 245, 249);
        doc.setLineWidth(0.3);
        doc.line(margin, y - 2, pageWidth - margin, y - 2);
      });
    }

    y += 8;

    // ===== TOTALS =====
    const totalsX = pageWidth - margin;
    const labelX = pageWidth - margin - 55;

    const addTotalLine = (label, value, options = {}) => {
      const { bold = false, color = [30, 41, 59], size = 9 } = options;
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(color[0], color[1], color[2]);
      doc.text(label, labelX, y);
      doc.text(`₹${value.toLocaleString()}`, totalsX, y, { align: 'right' });
      y += 7;
    };

    addTotalLine('Subtotal:', data.totals?.subtotal || 0);

    if (data.discountRate > 0) {
      addTotalLine(`Discount (${data.discountRate}%):`, -(data.totals?.discountAmount || 0), { color: [239, 68, 68] });
    }

    addTotalLine('Taxable Amount:', data.totals?.taxableAmount || 0);

    // GST Breakdown
    y += 2;
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(labelX, y - 4, totalsX, y - 4);

    if (data.isInterState) {
      addTotalLine(`IGST @ ${data.gstRate || 0}%:`, data.totals?.igst || 0, { color: [37, 99, 235] });
    } else {
      addTotalLine(`CGST @ ${(data.gstRate || 0) / 2}%:`, data.totals?.cgst || 0, { color: [37, 99, 235] });
      addTotalLine(`SGST @ ${(data.gstRate || 0) / 2}%:`, data.totals?.sgst || 0, { color: [37, 99, 235] });
    }

    y += 2;
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.8);
    doc.line(labelX, y - 4, totalsX, y - 4);
    addTotalLine('TOTAL AMOUNT:', data.totals?.grandTotal || 0, { bold: true, size: 12 });

    // ===== NOTES =====
    if (data.notes) {
      y += 15;
      if (y > 250) { doc.addPage(); y = 20; }
      addText('NOTES / TERMS:', { size: 7, style: 'bold', color: [100, 116, 139], gap: 3 });
      addText(data.notes, { size: 8, color: [71, 85, 105] });
    }

    // ===== FOOTER =====
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text('This is a computer-generated invoice. Generated via OfferPro Suite.', pageWidth / 2, 285, { align: 'center' });

    if (isPreview) {
      window.open(doc.output('bloburl'), '_blank');
    } else {
      const fileName = `Invoice_${(data.clientName || 'Client').replace(/\s+/g, '_')}_${data.invoiceNumber}.pdf`;
      doc.save(fileName);
    }
  }
};
