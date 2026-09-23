import nodemailer from 'nodemailer';

let transporter;

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    const port = parseInt(process.env.SMTP_PORT, 10) || 587;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
    });
  }
  return transporter;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendInvitationEmail({ to, orgName, inviteLink, inviterName }) {
  const tx = getTransporter();
  const subject = `You're invited to ${orgName} on ClassTrio`;
  const text = `${inviterName} invited you to join ${orgName}.\n\nAccept: ${inviteLink}\n`;

  if (tx) {
    await tx.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
    });
    return { sent: true };
  }

  if (process.env.NODE_ENV !== 'test') {
    console.info('[mail:stub]', { to, subject, inviteLink });
  }
  return { sent: false, skipped: true };
}

/**
 * Welcome email after admin creates a student or teacher.
 * Includes registration ID + email; optional temporary password.
 */
export async function sendWelcomeUserEmail({
  to,
  orgName,
  studentName,
  registrationId,
  email,
  password,
  loginUrl,
}) {
  const transport = getTransporter();
  const safeName = studentName || 'there';
  const safeOrg = orgName || 'our school';
  const subject = `Welcome to ${safeOrg}`;

  const text = [
    `Hello ${safeName},`,
    '',
    `Thank you for being part of ${safeOrg}.`,
    '',
    `Your registration ID: ${registrationId}`,
    `Your email: ${email}`,
    password ? `Temporary password: ${password}` : null,
    '',
    'You can sign in with your email or registration ID.',
    loginUrl ? `Login to our website: ${loginUrl}` : null,
    '',
    '— ClassTrio',
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="font-family: system-ui, sans-serif; line-height: 1.5; color: #111;">
      <p style="margin: 0 0 12px;">Hello ${escapeHtml(safeName)},</p>
      <p style="margin: 0 0 12px;">
        Thank you for being part of <strong>${escapeHtml(safeOrg)}</strong>.
      </p>
      <p style="margin: 0 0 8px;">Your registration ID: <strong>${escapeHtml(registrationId)}</strong></p>
      <p style="margin: 0 0 8px;">Your email: <strong>${escapeHtml(email)}</strong></p>
      ${
        password
          ? `<p style="margin: 0 0 16px;">Temporary password: <strong>${escapeHtml(password)}</strong></p>`
          : '<p style="margin: 0 0 16px;"></p>'
      }
      <p style="margin: 0 0 16px; color: #555;">
        You can sign in with your email or registration ID.
      </p>
      ${
        loginUrl
          ? `<p style="margin: 0 0 16px;">
              <a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:10px 16px;background:#0f766e;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
                Login to our website
              </a>
            </p>
            <p style="margin: 0 0 16px; color: #555; font-size: 13px;">${escapeHtml(loginUrl)}</p>`
          : ''
      }
      <p style="margin: 0; color: #888; font-size: 12px;">— ClassTrio</p>
    </div>
  `;

  if (!transport) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        '[mailer] SMTP is not configured. Welcome email stubbed. Set SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM.'
      );
      console.info('[mail:stub]', { to, subject, registrationId, loginUrl });
    }
    return { sent: false, skipped: true };
  }

  await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html,
  });

  return { sent: true };
}

/**
 * Notify a student that assessment results are available on the site.
 * Does not include scores — they must log in to view results.
 */
export async function sendAssessmentResultsReleasedEmail({
  to,
  studentName,
  assessmentTitle,
  resultUrl,
}) {
  const transport = getTransporter();
  const safeName = studentName || 'there';
  const safeTitle = assessmentTitle || 'Assessment';
  const subject = `Results released: ${safeTitle}`;

  const text = [
    `Hello ${safeName},`,
    '',
    `Results for "${safeTitle}" have been released.`,
    '',
    'Please log in to ClassTrio to view your result.',
    'Scores are not shared by email.',
    '',
    resultUrl ? `Open your result: ${resultUrl}` : '',
    '',
    '— ClassTrio',
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="font-family: system-ui, sans-serif; line-height: 1.5; color: #111;">
      <p style="margin: 0 0 12px;">Hello ${escapeHtml(safeName)},</p>
      <p style="margin: 0 0 12px;">
        Results for <strong>${escapeHtml(safeTitle)}</strong> have been released.
      </p>
      <p style="margin: 0 0 16px; color: #555;">
        Please log in to ClassTrio to view your result.
        Scores are not shared by email.
      </p>
      ${
        resultUrl
          ? `<p style="margin: 0 0 16px;">
              <a href="${escapeHtml(resultUrl)}" style="display:inline-block;padding:10px 16px;background:#0f766e;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
                View result
              </a>
            </p>`
          : ''
      }
      <p style="margin: 0; color: #888; font-size: 12px;">— ClassTrio</p>
    </div>
  `;

  if (!transport) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        '[mailer] SMTP is not configured. Results released but email was not sent. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and MAIL_FROM.'
      );
      console.info('[mail:stub]', { to, subject, resultUrl });
    }
    return { sent: false, skipped: true };
  }

  await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html,
  });

  return { sent: true };
}

export function isSmtpConfigured() {
  return Boolean(process.env.SMTP_HOST);
}
