import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter;

function getTransporter() {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
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
      from: env.MAIL_FROM,
      to,
      subject,
      text,
    });
  } else if (env.NODE_ENV !== 'test') {
    console.info('[mail:stub]', { to, subject, inviteLink });
  }
}
