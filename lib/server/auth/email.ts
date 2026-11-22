type EmailMessage = { to: string; subject: string; text: string };

/** Sends account mail through Resend, with local-only link logging for development. */
export async function sendAccountEmail(message: EmailMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  if (!apiKey || !from) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Account email delivery is not configured. Set RESEND_API_KEY and AUTH_EMAIL_FROM.');
    }
    console.info(`[auth email] ${message.subject}\nTo: ${message.to}\n${message.text}`);
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
  });
  if (!response.ok) {
    console.error('[auth email] provider rejected a message:', response.status);
    throw new Error('Could not send account email. Please try again later.');
  }
}
