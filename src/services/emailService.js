const EMAILJS_API = 'https://api.emailjs.com/api/v1.0/email/send';

export const emailService = {

  /**
   * Test if the EmailJS config is valid by sending a tiny test email to yourself.
   */
  testConnection: async ({ serviceId, templateId, publicKey }) => {
    if (!serviceId || !templateId || !publicKey) {
      return { success: false, message: 'Please fill in all three EmailJS fields (Service ID, Template ID, Public Key).' };
    }

    try {
      const response = await fetch(EMAILJS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: serviceId,
          template_id: templateId,
          user_id: publicKey,
          template_params: {
            to_email: 'test@test.com',
            to_name: 'Test',
            subject: 'EdgeOS Connection Test',
            message: 'This is a test from EdgeOS.',
          },
        }),
      });

      if (response.ok || response.status === 200) {
        return { success: true, message: 'EmailJS is configured correctly!' };
      }

      const text = await response.text();
      return { success: false, message: text || 'EmailJS responded with an error. Check your Service ID, Template ID, and Public Key.' };
    } catch (err) {
      console.error('Test connection error:', err);
      return {
        success: false,
        message: 'Could not reach EmailJS. Check your credentials and try again.',
      };
    }
  },

  sendOfferNotification: async ({ recordData, emailConfig, companyName }) => {
    const { serviceId, templateId, publicKey } = emailConfig || {};

    if (!serviceId || !templateId || !publicKey) {
      return { success: false, message: 'Email not configured. Go to Company Profile → Email Integration and add your EmailJS credentials.' };
    }

    const recipientEmail = recordData.email;
    if (!recipientEmail) {
      return { success: false, message: 'No email address found for this employee.' };
    }

    try {
      const isFT = recordData.offerType === 'fulltime';
      const subject = isFT
        ? `Offer of Full-Time Employment – ${companyName}`
        : `Internship Offer Letter – ${companyName}`;

      const body = buildEmailBody(recordData, companyName);

      const response = await fetch(EMAILJS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: serviceId,
          template_id: templateId,
          user_id: publicKey,
          template_params: {
            to_email: recipientEmail,
            to_name: recordData.studentName || 'Candidate',
            from_name: companyName,
            subject,
            message: body,
          },
        }),
      });

      if (response.ok || response.status === 200) {
        return { success: true, message: `Email sent to ${recipientEmail}` };
      }

      const text = await response.text();
      return { success: false, message: text || 'EmailJS returned an error. Check your template and credentials.' };
    } catch (err) {
      console.error('Email send error:', err);
      return {
        success: false,
        message: 'Failed to send email. Check your EmailJS configuration in Company Profile.',
      };
    }
  },

  sendPortalLink: async ({ recipientEmail, recipientName, role, companyName, portalUrl, deadline, emailConfig }) => {
    const { serviceId, templateId, publicKey } = emailConfig || {};
    if (!serviceId || !templateId || !publicKey) {
      return { success: false, message: 'Email not configured. Go to Company Profile → Email Integration and add your EmailJS credentials.' };
    }
    if (!recipientEmail) {
      return { success: false, message: 'No email address saved for this candidate.' };
    }

    const deadlineStr = deadline
      ? new Date(deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
      : '';

    try {
      const response = await fetch(EMAILJS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: serviceId,
          template_id: templateId,
          user_id: publicKey,
          template_params: {
            to_email: recipientEmail,
            to_name: recipientName || 'Candidate',
            from_name: companyName,
            subject: `Your Offer Letter from ${companyName} – Action Required`,
            message: buildPortalLinkEmail({ recipientName, role, companyName, portalUrl, deadline: deadlineStr }),
          },
        }),
      });

      if (response.ok || response.status === 200) {
        return { success: true, message: `Email sent to ${recipientEmail}` };
      }
      const text = await response.text();
      return { success: false, message: text || 'EmailJS returned an error.' };
    } catch (err) {
      console.error('Portal link email error:', err);
      return { success: false, message: 'Failed to send email. Check your EmailJS configuration.' };
    }
  },
};

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

function buildEmailBody(data, companyName) {
  const isFT = data.offerType === 'fulltime';
  const name = data.studentName || 'Candidate';
  const role = data.role || 'the offered position';
  const department = data.department || '';
  const supervisor = data.supervisorName || '';
  const startDate = fmtDate(data.startDate);
  const endDate = !isFT ? fmtDate(data.endDate) : '';
  const deadline = fmtDate(data.acceptanceDeadline);
  const responsibilities = data.responsibilities || '';
  const hasPay = data.isPaid && data.stipend;
  const currencySymbol = data.currency === 'INR' ? '\u20B9' : data.currency === 'USD' ? '$' : data.currency === 'EUR' ? '\u20AC' : data.currency === 'GBP' ? '\u00A3' : (data.currency || '');
  const payFreq = (data.paymentFrequency || 'Monthly').toLowerCase();
  const contactEmail = data.contactEmail || '';
  const contactPhone = data.contactPhone || '';
  const companyAddress = data.companyAddress || '';
  const tagline = data.companyTagline || '';
  const sigName = data.authorizedPersonName || 'HR Department';
  const sigTitle = data.authorizedPersonDesignation || '';

  const detailRows = [];
  detailRows.push(['Position', `<strong>${role}</strong>`]);
  detailRows.push(['Type', isFT ? 'Full-Time Employment' : 'Internship']);
  if (department) detailRows.push(['Department', department]);
  if (supervisor) detailRows.push(['Reporting To', supervisor]);
  if (startDate) detailRows.push([isFT ? 'Start Date' : 'Start Date', startDate]);
  if (endDate) detailRows.push(['End Date', endDate]);
  if (hasPay) detailRows.push([isFT ? 'Compensation' : 'Stipend', `${currencySymbol} ${Number(data.stipend).toLocaleString('en-IN')} / ${payFreq}`]);
  if (deadline) detailRows.push(['Accept By', `<strong style="color:#b45309;">${deadline}</strong>`]);

  const detailsTable = detailRows.map(([label, value]) => `
    <tr>
      <td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;white-space:nowrap;width:130px;">${label}</td>
      <td style="padding:10px 14px;font-size:13px;color:#18181b;border-bottom:1px solid #f3f4f6;font-weight:500;">${value}</td>
    </tr>`).join('');

  const responsibilitiesBlock = responsibilities ? `
  <div style="margin-top:24px;">
    <h3 style="margin:0 0 12px;font-size:13px;font-weight:700;color:#18181b;text-transform:uppercase;letter-spacing:0.05em;">Key Responsibilities</h3>
    <div style="background:#fafafa;border:1px solid #f3f4f6;border-radius:8px;padding:16px 18px;">
      <p style="margin:0;font-size:13px;line-height:1.8;color:#374151;white-space:pre-line;">${responsibilities}</p>
    </div>
  </div>` : '';

  const contactBlock = (contactEmail || contactPhone) ? `
  <div style="margin-top:24px;padding:16px 18px;background:#f0f4ff;border:1px solid #dbeafe;border-radius:8px;">
    <p style="margin:0;font-size:12px;font-weight:600;color:#1e40af;margin-bottom:6px;">Questions? Contact us</p>
    ${contactEmail ? `<p style="margin:0;font-size:13px;color:#374151;">${contactEmail}</p>` : ''}
    ${contactPhone ? `<p style="margin:0;font-size:13px;color:#374151;">${contactPhone}</p>` : ''}
  </div>` : '';

  return `
<div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:36px 32px 28px;text-align:center;border-radius:0 0 0 0;">
    <h1 style="margin:0 0 4px;font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">${companyName}</h1>
    ${tagline ? `<p style="margin:0;font-size:12px;color:#94a3b8;letter-spacing:0.04em;">${tagline}</p>` : ''}
  </div>

  <!-- Badge -->
  <div style="text-align:center;margin-top:-18px;margin-bottom:20px;">
    <span style="display:inline-block;background:${isFT ? '#059669' : '#2563eb'};color:#ffffff;font-size:11px;font-weight:700;padding:6px 20px;border-radius:20px;letter-spacing:0.04em;text-transform:uppercase;">
      ${isFT ? 'Full-Time Offer' : 'Internship Offer'}
    </span>
  </div>

  <!-- Body -->
  <div style="padding:8px 32px 32px;">

    <!-- Greeting -->
    <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#374151;">
      Dear <strong style="color:#18181b;">${name}</strong>,
    </p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
      We are delighted to extend this ${isFT ? 'offer of full-time employment' : 'internship offer'} to you for the role of <strong style="color:#18181b;">${role}</strong> at <strong style="color:#18181b;">${companyName}</strong>. After careful consideration, we believe your skills and experience make you an excellent fit for our team.
    </p>

    <!-- Details Table -->
    <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:4px;">
      <div style="background:#f8fafc;padding:12px 14px;border-bottom:1px solid #e5e7eb;">
        <h3 style="margin:0;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Offer Details</h3>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        ${detailsTable}
      </table>
    </div>

    ${responsibilitiesBlock}

    <!-- Next Steps -->
    ${deadline ? `
    <div style="margin-top:24px;padding:18px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">
      <p style="margin:0;font-size:13px;font-weight:600;color:#92400e;margin-bottom:4px;">Next Steps</p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#78350f;">
        Please confirm your acceptance by responding to this email on or before <strong>${deadline}</strong>. If you have any questions about the offer, feel free to reach out before the deadline.
      </p>
    </div>` : `
    <div style="margin-top:24px;padding:18px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;">
      <p style="margin:0;font-size:13px;font-weight:600;color:#166534;margin-bottom:4px;">Next Steps</p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#15803d;">
        Please confirm your acceptance by responding to this email at your earliest convenience. We look forward to welcoming you to the team.
      </p>
    </div>`}

    ${contactBlock}

    <!-- Signature -->
    <div style="margin-top:32px;padding-top:20px;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">Warm regards,</p>
      <p style="margin:8px 0 2px;font-size:15px;font-weight:700;color:#18181b;">${sigName}</p>
      ${sigTitle ? `<p style="margin:0 0 2px;font-size:13px;color:#6b7280;">${sigTitle}</p>` : ''}
      <p style="margin:0;font-size:13px;color:#6b7280;">${companyName}</p>
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:20px 32px;text-align:center;">
    ${companyAddress ? `<p style="margin:0 0 6px;font-size:11px;color:#94a3b8;">${companyAddress}</p>` : ''}
    <p style="margin:0;font-size:10px;color:#cbd5e1;">
      This is an official communication from ${companyName}. Please do not forward this email without authorization.
    </p>
  </div>

</div>`.trim();
}

function buildPortalLinkEmail({ recipientName, role, companyName, portalUrl, deadline }) {
  const name = recipientName || 'Candidate';
  const deadlineBlock = deadline ? `
  <div style="margin-top:24px;padding:18px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">
    <p style="margin:0;font-size:13px;font-weight:600;color:#92400e;margin-bottom:4px;">Response Deadline</p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#78350f;">
      Please confirm your acceptance on or before <strong>${deadline}</strong>.
    </p>
  </div>` : '';

  return `
<div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
  <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:36px 32px 28px;text-align:center;">
    <h1 style="margin:0 0 4px;font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">${companyName}</h1>
    <p style="margin:0;font-size:12px;color:#94a3b8;">Secure Offer Letter Portal</p>
  </div>

  <div style="padding:32px;">
    <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#374151;">
      Dear <strong style="color:#18181b;">${name}</strong>,
    </p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
      <strong style="color:#18181b;">${companyName}</strong> has issued you an offer letter for the role of
      <strong style="color:#18181b;">${role}</strong>. Please click the button below to securely view and sign your offer letter.
    </p>

    <div style="text-align:center;margin:32px 0;">
      <a href="${portalUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;font-size:14px;font-weight:700;padding:14px 32px;border-radius:8px;text-decoration:none;letter-spacing:0.01em;">
        View &amp; Sign Offer Letter
      </a>
    </div>

    <p style="margin:0 0 8px;font-size:12px;color:#94a3b8;text-align:center;">Or copy this link:</p>
    <p style="margin:0 0 24px;font-size:11px;color:#6b7280;text-align:center;word-break:break-all;font-family:monospace;">${portalUrl}</p>

    ${deadlineBlock}

    <div style="margin-top:32px;padding-top:20px;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:13px;color:#6b7280;">Warm regards,</p>
      <p style="margin:6px 0 0;font-size:14px;font-weight:700;color:#18181b;">${companyName}</p>
    </div>
  </div>

  <div style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
    <p style="margin:0;font-size:10px;color:#cbd5e1;">
      This is a secure link from ${companyName} via EdgeOS. Do not share this link with others.
    </p>
  </div>
</div>`.trim();
}
