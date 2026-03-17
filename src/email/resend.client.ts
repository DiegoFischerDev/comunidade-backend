import { Resend } from 'resend';

export function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey || !apiKey.trim()) {
    return null;
  }

  return new Resend(apiKey.trim());
}

export async function sendEmailBase(params: {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
}) {
  const resend = getResendClient();

  if (!resend) {
    throw new Error('Envio de email não está configurado (Resend).');
  }

  const fromFormatted = 'Comunidade RPM <noreply@ia.rafaapelomundo.com>';

  return await resend.emails.send(
    {
      from: fromFormatted,
      to: Array.isArray(params.to) ? params.to : [params.to],
      subject: params.subject,
      text: params.text,
      html: params.html,
    } as any,
  );
}

