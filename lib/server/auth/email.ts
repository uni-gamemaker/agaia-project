import nodemailer from 'nodemailer';

type EmailMessage = { to: string; subject: string; text: string };

/** Sends account mail through Gmail SMTP, with local-only link logging in development. */
export async function sendAccountEmail(message: EmailMessage): Promise<void> {
  const user = process.env.GMAIL_USER?.trim();
  const appPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, '');
  if (!user || !appPassword) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Account email delivery is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD.');
    }
    console.info(`[auth email] ${message.subject}\nTo: ${message.to}\n${message.text}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass: appPassword },
  });

  try {
    await transporter.sendMail({
      from: `Ajaia <${user}>`,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : 'unknown';
    const responseCode = typeof error === 'object' && error !== null && 'responseCode' in error
      ? Number(error.responseCode)
      : undefined;
    console.error('[auth email] Gmail SMTP send failed:', { code, responseCode });
    throw new Error('Could not send account email. Please try again later.');
  }
}
