import { Resend } from 'resend';
import { readFile } from 'fs/promises';

export function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey || !apiKey.trim()) {
    return null;
  }

  return new Resend(apiKey.trim());
}

export async function sendEmailBase(params: {
  to: string | string[];
  /** Recebem cópia (CC). Útil quando queremos que o lead também receba o anexo enviado ao parceiro. */
  cc?: string | string[];
  /** Endereço de resposta — quem clicar «Responder» fala diretamente com este email. */
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}) {
  const resend = getResendClient();

  if (!resend) {
    throw new Error('Envio de email não está configurado (Resend).');
  }

  const fromFormatted =
    'Comunidade Rafa Portugal <noreply@ia.rafaapelomundo.com>';

  return await resend.emails.send({
    from: fromFormatted,
    to: Array.isArray(params.to) ? params.to : [params.to],
    cc: params.cc
      ? Array.isArray(params.cc)
        ? params.cc
        : [params.cc]
      : undefined,
    replyTo: params.replyTo,
    subject: params.subject,
    text: params.text,
    html: params.html,
    attachments: params.attachments,
  } as any);
}

export async function sendEmailWithPdfAttachment(params: {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  filename: string;
  absoluteFilePath: string;
}) {
  const buf = await readFile(params.absoluteFilePath);
  return sendEmailBase({
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
    attachments: [
      {
        filename: params.filename,
        content: buf,
        contentType: 'application/pdf',
      },
    ],
  });
}
