import { jsPDF } from 'jspdf';

export const pdfService = {
  generateOfferLetter: (data) => {
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

    const fileName = `Offer_${data.studentName.replace(/\s+/g, '_')}.pdf`;
    doc.save(fileName);
  },

  generateCertificate: (data) => {
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = 297;
    const pageHeight = 210;

    // Background Decoration
    doc.setFillColor(15, 23, 42); // Primary color
    doc.rect(0, 0, pageWidth, 5, 'F');
    doc.rect(0, pageHeight - 5, pageWidth, 5, 'F');

    // Border
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(1);
    doc.rect(10, 10, pageWidth - 20, pageHeight - 20);

    // Header logic
    let y = 30;
    
    // Logo
    if (data.logo) {
      try {
        const props = doc.getImageProperties(data.logo);
        const displayWidth = 35;
        const displayHeight = (props.height * displayWidth) / props.width;
        doc.addImage(data.logo, 'PNG', (pageWidth / 2) - (displayWidth / 2), y, displayWidth, displayHeight);
        y += displayHeight + 15;
      } catch (e) {
        console.error('Logo error:', e);
        y += 20;
      }
    } else {
      y += 25;
    }

    // Title
    doc.setFont('times', 'bold');
    doc.setFontSize(36);
    doc.text('CERTIFICATE', pageWidth / 2, y, { align: 'center' });
    y += 12;
    doc.setFontSize(16);
    doc.setFont('helvetica', 'normal');
    doc.text('OF ACHIEVEMENT', pageWidth / 2, y, { align: 'center' });
    y += 25;

    // Body
    doc.setFontSize(14);
    doc.text('This is to certify that', pageWidth / 2, y, { align: 'center' });
    y += 15;

    doc.setFontSize(28);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(37, 99, 235); // Accent color
    doc.text(data.recipientName.toUpperCase(), pageWidth / 2, y, { align: 'center' });
    doc.setTextColor(15, 23, 42); // Reset to primary
    y += 15;

    doc.setFontSize(14);
    doc.setFont('helvetica', 'normal');
    doc.text('has successfully demonstrated excellence in', pageWidth / 2, y, { align: 'center' });
    y += 10;

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(data.achievementTitle, pageWidth / 2, y, { align: 'center' });
    y += 20;

    doc.setFontSize(12);
    doc.setFont('helvetica', 'italic');
    const splitDesc = doc.splitTextToSize(data.description, 200);
    doc.text(splitDesc, pageWidth / 2, y, { align: 'center' });
    y += (splitDesc.length * 6) + 20;

    // Footer - Signatures and Dates
    const footerY = 175;
    
    // Left: Organization
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(data.issuingOrganization, 50, footerY);
    doc.setFont('helvetica', 'normal');
    doc.text('Organization', 50, footerY + 5);

    // Center: Date
    doc.setFont('helvetica', 'bold');
    doc.text(new Date(data.issueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), pageWidth / 2, footerY, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.text('Date of Issue', pageWidth / 2, footerY + 5, { align: 'center' });

    // Right: Signature
    if (data.signature) {
      const sigW = 40;
      doc.addImage(data.signature, 'PNG', pageWidth - 50 - sigW, footerY - 15, sigW, 15);
    }
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.5);
    doc.line(pageWidth - 90, footerY - 2, pageWidth - 50, footerY - 2);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(data.authorizedSignatory, pageWidth - 70, footerY, { align: 'center' });
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(data.signatoryDesignation, pageWidth - 70, footerY + 5, { align: 'center' });

    const fileName = `Certificate_${data.recipientName.replace(/\s+/g, '_')}.pdf`;
    doc.save(fileName);
  },

  generateMoU: (data, isPreview = false) => {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const margin = 28;
    const pageWidth = 210;
    const contentWidth = pageWidth - (margin * 2);
    let y = 25;

    // Reuse helper logic locally or assume it's part of the closure
    const addText = (text, options = {}) => {
      const { font = 'times', size = 11, style = 'normal', alignment = 'left', gap = 2 } = options;
      doc.setFont(font, style);
      doc.setFontSize(size);
      const splitText = doc.splitTextToSize(text || '', contentWidth);
      const lineHeight = size * 0.3527 * 1.3;
      let x = margin;
      if (alignment === 'center') x = pageWidth / 2;
      doc.text(splitText, x, y, { align: alignment });
      y += (splitText.length * lineHeight) + gap;
    };

    const renderParagraph = (text, isBold = false) => {
      doc.setFont('times', isBold ? 'bold' : 'normal');
      doc.setFontSize(11);
      const splitText = doc.splitTextToSize(text, contentWidth);
      doc.text(splitText, margin, y, { align: 'justify' });
      y += (splitText.length * 11 * 0.3527 * 1.4) + 4;
    };

    // Header
    addText('MEMORANDUM OF UNDERSTANDING', { style: 'bold', size: 16, alignment: 'center', gap: 10 });
    
    addText('This Memorandum of Understanding (MoU) is entered into on this ' + 
      new Date(data.effectiveDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + 
      ' BY AND BETWEEN:', { gap: 6 });

    addText(data.partyAName.toUpperCase(), { style: 'bold', gap: 1 });
    addText('(Hereinafter referred to as the "FIRST PARTY")', { size: 9, style: 'italic', gap: 6 });

    addText('AND', { style: 'bold', alignment: 'center', gap: 6 });

    addText(data.partyBName.toUpperCase(), { style: 'bold', gap: 1 });
    addText('(Hereinafter referred to as the "SECOND PARTY")', { size: 9, style: 'italic', gap: 10 });

    addText('1. PURPOSE AND SCOPE', { style: 'bold', gap: 4 });
    renderParagraph('The purpose of this MoU is to outline the understanding between the Parties regarding ' + data.purpose + '. This agreement establishes a framework for cooperation and sets forth the intentions of both Parties.');

    addText('2. DURATION', { style: 'bold', gap: 4 });
    renderParagraph('This MoU shall become effective as of ' + new Date(data.effectiveDate).toLocaleDateString('en-GB') + 
      ' and shall remain in force until ' + new Date(data.terminationDate).toLocaleDateString('en-GB') + 
      ', unless terminated earlier by either party with mutual consent.');

    if (data.confidentiality) {
      addText('3. CONFIDENTIALITY', { style: 'bold', gap: 4 });
      renderParagraph('Both parties agree to maintain the strictest confidentiality regarding all proprietary information, trade secrets, and internal data shared during the course of this association.');
    }

    addText('4. GOVERNING LAW AND JURISDICTION', { style: 'bold', gap: 4 });
    renderParagraph('This MoU shall be governed by and construed in accordance with the laws of India. Any disputes arising shall be subject to the exclusive jurisdiction of the ' + data.jurisdiction + '.');

    if (y > 230) {
      doc.addPage();
      y = 30;
    }

    // Execution Space
    y += 15;
    addText('IN WITNESS WHEREOF, the parties hereto have executed this MoU as of the date first above written.', { size: 10, italic: true, gap: 15 });

    const sigY = y;
    addText('__________________________', { alignment: 'left', gap: 4 });
    addText('For (First Party)', { size: 10, alignment: 'left', gap: 1 });
    addText(data.partyAName, { size: 10, style: 'bold', alignment: 'left' });

    y = sigY;
    addText('__________________________', { alignment: 'right', gap: 4 });
    addText('For (Second Party)', { size: 10, alignment: 'right', gap: 1 });
    addText(data.partyBName, { size: 10, style: 'bold', alignment: 'right' });

    if (isPreview) {
      window.open(doc.output('bloburl'), '_blank');
    } else {
      const fileName = `MoU_${data.partyAName.replace(/\s+/g, '_')}_${data.partyBName.replace(/\s+/g, '_')}.pdf`;
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
    let y = 25;

    const addText = (text, options = {}) => {
      const { font = 'helvetica', size = 10, style = 'normal', alignment = 'left', gap = 2, color = [0, 0, 0] } = options;
      doc.setFont(font, style);
      doc.setFontSize(size);
      doc.setTextColor(color[0], color[1], color[2]);
      const splitText = doc.splitTextToSize(text || '', contentWidth);
      const lineHeight = size * 0.3527 * 1.3;
      let x = margin;
      if (alignment === 'center') x = pageWidth / 2;
      if (alignment === 'right') x = pageWidth - margin;
      doc.text(splitText, x, y, { align: alignment });
      y += (splitText.length * lineHeight) + gap;
    };

    // Header Branding
    doc.setFillColor(10, 10, 10);
    doc.rect(margin, y, contentWidth, 35, 'F');
    y += 12;
    addText('INVOICE', { font: 'helvetica', style: 'bold', size: 24, color: [255, 255, 255], alignment: 'center', gap: 5 });
    addText(data.invoiceNumber || '', { size: 10, color: [200, 200, 200], alignment: 'center' });
    y = 65;

    // Organization & Client Info
    const startY = y;
    addText('FROM:', { size: 8, style: 'bold', color: [100, 100, 100], gap: 2 });
    addText(data.orgName || 'Your Organization', { size: 11, style: 'bold', gap: 6 });

    y = startY;
    addText('BILL TO:', { alignment: 'right', size: 8, style: 'bold', color: [100, 100, 100], gap: 2 });
    addText(data.clientName || 'Client Name', { alignment: 'right', size: 11, style: 'bold', gap: 2 });
    addText(data.clientEmail || '', { alignment: 'right', size: 9, color: [100, 100, 100], gap: 10 });

    // Dates
    y += 5;
    const dateY = y;
    addText('Invoice Date: ' + (data.invoiceDate || ''), { size: 9 });
    y = dateY;
    addText('Due Date: ' + (data.dueDate || ''), { alignment: 'right', size: 9, gap: 15 });

    // Table Header
    doc.setFillColor(245, 245, 245);
    doc.rect(margin, y, contentWidth, 10, 'F');
    addText('Description', { size: 9, style: 'bold', gap: 0 });
    y -= 4;
    addText('Qty', { alignment: 'right', size: 9, style: 'bold', gap: 0 });
    y -= 4;
    addText('Price', { alignment: 'right', size: 9, style: 'bold', gap: 0 });
    y -= 4;
    doc.text('Total', pageWidth - margin - 35, y, { align: 'right' }); 
    y += 14;

    // Line Items
    if (data.items && data.items.length > 0) {
      data.items.forEach((item) => {
        const itemY = y;
        addText(item.description || '-', { size: 9, gap: 0 });
        y = itemY;
        addText(item.quantity?.toString() || '0', { alignment: 'right', size: 9, gap: 0 });
        y = itemY;
        addText('₹' + (item.price || 0).toLocaleString(), { alignment: 'right', size: 9, gap: 0 });
        y = itemY;
        doc.text('₹' + ((item.quantity || 0) * (item.price || 0)).toLocaleString(), pageWidth - margin - 15, y, { align: 'right' });
        y += 8;
        
        // Horizontal line
        doc.setDrawColor(240, 240, 240);
        doc.line(margin, y - 2, pageWidth - margin, y - 2);
      });
    }

    y += 10;
    // Totals Section
    const totalsX = pageWidth - margin;
    const labelX = pageWidth - margin - 50;

    const addTotalLine = (label, value, isBold = false) => {
      doc.setFont('helvetica', isBold ? 'bold' : 'normal');
      doc.setFontSize(isBold ? 11 : 9);
      doc.text(label, labelX, y);
      doc.text('₹' + value.toLocaleString(), totalsX, y, { align: 'right' });
      y += 7;
    };

    addTotalLine('Subtotal:', data.totals?.subtotal || 0);
    if (data.discountRate > 0) addTotalLine(`Discount (${data.discountRate}%):`, -(data.totals?.discountAmount || 0));
    if (data.taxRate > 0) addTotalLine(`Tax (${data.taxRate}%):`, data.totals?.taxAmount || 0);
    
    y += 2;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.line(labelX, y - 4, totalsX, y - 4);
    addTotalLine('TOTAL AMOUNT:', data.totals?.grandTotal || 0, true);

    // Footer / Notes
    if (data.notes) {
      y += 20;
      if (y > 250) { doc.addPage(); y = 30; }
      addText('NOTES / TERMS:', { size: 8, style: 'bold', color: [100, 100, 100], gap: 4 });
      addText(data.notes, { size: 9, color: [50, 50, 50] });
    }

    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('Generated via OfferPro Suite • Automated Documentation', pageWidth / 2, 285, { align: 'center' });

    if (isPreview) {
      window.open(doc.output('bloburl'), '_blank');
    } else {
      const fileName = `Invoice_${(data.clientName || 'Client').replace(/\s+/g, '_')}_${data.invoiceNumber}.pdf`;
      doc.save(fileName);
    }
  }
};
