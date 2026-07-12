import nodemailer from 'nodemailer';

let transporter;

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    const port = parseInt(process.env.SMTP_PORT, 10);
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

export async function sendInvitationEmail({ to, orgName, inviteLink, inviterName }) {
  const tx = getTransporter();
  const subject = `You're invited to ${orgName} on AssessHub`;
  const text = `${inviterName} invited you to join ${orgName}.\n\nAccept: ${inviteLink}\n`;

  if (tx) {
    await tx.sendMail({
      from: process.env.MAIL_FROM,
      to,
      subject,
      text,
    });
  } else if (process.env.NODE_ENV !== 'test') {
    console.info('[mail:stub]', { to, subject, inviteLink });
  }
}
