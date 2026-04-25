import nodemailer from 'nodemailer';

/**
 * POST /api/email
 * Body: { gmailUser, appPassword, to, subject, text?, html?, fromName? }
 * Sends an email via Gmail SMTP using Nodemailer.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { gmailUser, appPassword, to, subject, text, html, fromName } = req.body || {};

  if (!gmailUser || !appPassword) {
    return res.status(400).json({
      success: false,
      error: 'Gmail credentials missing. Configure them in Profile → Email Configuration.',
    });
  }
  if (!to || !subject || (!text && !html)) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: to, subject, and text or html.',
    });
  }

  const cleanPass = String(appPassword).replace(/\s+/g, '');

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: cleanPass },
  });

  try {
    await transporter.verify();
  } catch (err) {
    console.error('[api/email] SMTP verify failed:', err?.message);
    return res.status(401).json({
      success: false,
      error:
        err?.code === 'EAUTH'
          ? 'Invalid Gmail credentials. Make sure 2-Step Verification is enabled and your App Password is correct (no spaces).'
          : `SMTP connection failed: ${err?.message || 'unknown error'}`,
    });
  }

  try {
    const info = await transporter.sendMail({
      from: fromName ? `"${fromName}" <${gmailUser}>` : gmailUser,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text: text || undefined,
      html: html || undefined,
    });

    return res.status(200).json({
      success: true,
      messageId: info.messageId,
      accepted: info.accepted || [],
      rejected: info.rejected || [],
    });
  } catch (err) {
    console.error('[api/email] sendMail failed:', err?.message);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to send email.',
    });
  }
}
