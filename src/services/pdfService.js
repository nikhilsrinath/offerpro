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
};
