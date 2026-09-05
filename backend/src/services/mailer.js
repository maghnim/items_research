const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function sendAlertEmail({ to, subject, html }) {
  if (!resend) {
    console.warn('[mailer] RESEND_API_KEY not set — skipping email send. Would have sent:', subject);
    return;
  }
  await resend.emails.send({
    from: process.env.ALERT_FROM_EMAIL || 'support@pricera.online',
    to,
    subject,
    html,
  });
}

module.exports = { sendAlertEmail };
