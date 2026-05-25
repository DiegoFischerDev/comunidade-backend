/**
 * Email enviado ao lead com os dados do parceiro de financiamento atribuído (logo, contactos,
 * boas-vindas) + resumo completo do quiz (resultado, exemplo, respostas).
 *
 * Inline HTML porque é mais portátil para clientes de email (Gmail, Outlook, Apple Mail) —
 * sem CSS externo nem JS.
 */

import { sendEmailBase } from '../email/resend.client';
import type { QuizAnswerBreakdownItem } from './financing-quiz.constants';
import { toAbsoluteMediaUrl } from '../common/public-media-url';

const PRIMARY = '#d58901';
const PRIMARY_DARK = '#a96900';
const TEXT_DARK = '#111827';
const TEXT_MUTED = '#525252';
const BORDER = '#e5e7eb';
const SOFT_BG = '#fef7e7';

/** Forma mínima de um parceiro necessária para renderizar o email. */
export type PartnerForLeadEmail = {
  name: string;
  whatsapp: string;
  logoUrl: string | null;
  shortDescription: string | null;
  email: string | null;
};

function escapeHtml(input: string): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nl2br(input: string): string {
  return escapeHtml(input).replace(/\n/g, '<br/>');
}

function firstName(name: string): string {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0];
}

/** Apenas dígitos, para construir links `wa.me`. */
function digitsOnly(value: string): string {
  return String(value ?? '').replace(/\D+/g, '');
}

/** Bloco "O teu resultado" + exemplo prático (texto que o utilizador viu na página). */
function buildResultBlockHtml(input: {
  outcomeBody: string;
  example: { intro?: string; body: string } | null;
}): string {
  const outcomeHtml = nl2br(input.outcomeBody);
  const exampleHtml = input.example
    ? `
      ${
        input.example.intro
          ? `<p style="margin:14px 0 6px;color:${TEXT_DARK};font-size:13px;">${nl2br(input.example.intro)}</p>`
          : ''
      }
      <pre style="white-space:pre-wrap;word-wrap:break-word;font-family:inherit;background:#fafafa;border:1px solid ${BORDER};border-radius:10px;padding:14px 16px;margin:0;font-size:13px;line-height:1.55;color:${TEXT_DARK};">${escapeHtml(input.example.body)}</pre>
    `
    : '';

  return `
    <h3 style="margin:24px 0 8px;font-size:15px;color:${TEXT_DARK};">O teu resultado</h3>
    <div style="white-space:pre-line;background:${SOFT_BG};border:1px solid #f3d68a;border-radius:10px;padding:14px 16px;font-size:14px;line-height:1.55;color:${TEXT_DARK};">${outcomeHtml}</div>
    ${exampleHtml}
  `;
}

/** Bloco "As tuas respostas" (lista pergunta→resposta). */
function buildBreakdownBlockHtml(breakdown: QuizAnswerBreakdownItem[]): string {
  if (!breakdown.length) return '';
  const rows = breakdown
    .map(
      (b, i) => `
      <li style="margin:0 0 10px;padding:0;">
        <p style="margin:0 0 2px;font-size:12px;color:${TEXT_MUTED};font-weight:600;">Pergunta ${i + 1}</p>
        <p style="margin:0 0 2px;font-size:13px;color:${TEXT_DARK};line-height:1.45;">${escapeHtml(b.question)}</p>
        <p style="margin:0;font-size:13px;color:${PRIMARY_DARK};font-weight:600;">→ ${escapeHtml(b.answer)}</p>
      </li>
    `,
    )
    .join('');
  return `
    <h3 style="margin:24px 0 8px;font-size:15px;color:${TEXT_DARK};">As tuas respostas</h3>
    <ul style="list-style:none;padding:0;margin:0;border:1px solid ${BORDER};border-radius:10px;padding:14px 16px;">${rows}</ul>
  `;
}

/**
 * Constrói o HTML do email do "kit do parceiro": apresentação do parceiro atribuído +
 * contactos + resumo do resultado + respostas detalhadas do quiz + link para o lead enviar
 * os seus documentos diretamente para o email do parceiro.
 */
export function buildPartnerKitEmailHtml(input: {
  leadName: string;
  partner: PartnerForLeadEmail;
  outcomeBody: string;
  example: { intro?: string; body: string } | null;
  breakdown: QuizAnswerBreakdownItem[];
  uploadUrl: string;
}): string {
  const greeting = firstName(input.leadName) || 'olá';
  const partnerName = input.partner.name.trim() || 'O teu parceiro';
  const partnerWhatsapp = digitsOnly(input.partner.whatsapp);
  const partnerEmail = (input.partner.email ?? '').trim();
  const partnerWelcome = (input.partner.shortDescription ?? '').trim();
  const logoSrc = input.partner.logoUrl
    ? toAbsoluteMediaUrl(input.partner.logoUrl)
    : '';

  const whatsappLink = partnerWhatsapp
    ? `https://wa.me/${partnerWhatsapp}`
    : '';

  const logoBlock = logoSrc
    ? `
      <div style="text-align:center;margin:0 0 20px;">
        <img
          src="${escapeHtml(logoSrc)}"
          alt="${escapeHtml(partnerName)}"
          width="120"
          height="120"
          style="width:120px;height:120px;object-fit:contain;border-radius:12px;border:3px solid ${PRIMARY};display:inline-block;background:#fff;padding:8px;"
        />
      </div>
    `
    : '';

  const welcomeBlock = partnerWelcome
    ? `
      <div style="background:${SOFT_BG};border-left:4px solid ${PRIMARY};border-radius:6px;padding:14px 16px;margin:0 0 18px;">
        <p style="margin:0;color:${TEXT_DARK};font-size:14px;line-height:1.55;">${nl2br(partnerWelcome)}</p>
      </div>
    `
    : '';

  const contactRows: string[] = [];
  if (partnerWhatsapp) {
    contactRows.push(
      `<tr>
        <td style="padding:6px 0;color:${TEXT_MUTED};font-size:13px;width:90px;">WhatsApp</td>
        <td style="padding:6px 0;color:${TEXT_DARK};font-size:14px;">
          <a href="${escapeHtml(whatsappLink)}" style="color:${PRIMARY_DARK};text-decoration:none;font-weight:600;">+${escapeHtml(partnerWhatsapp)}</a>
        </td>
      </tr>`,
    );
  }
  if (partnerEmail) {
    contactRows.push(
      `<tr>
        <td style="padding:6px 0;color:${TEXT_MUTED};font-size:13px;width:90px;">Email</td>
        <td style="padding:6px 0;color:${TEXT_DARK};font-size:14px;">
          <a href="mailto:${escapeHtml(partnerEmail)}" style="color:${PRIMARY_DARK};text-decoration:none;font-weight:600;">${escapeHtml(partnerEmail)}</a>
        </td>
      </tr>`,
    );
  }

  const contactBlock = contactRows.length
    ? `
      <div style="border:1px solid ${BORDER};border-radius:10px;padding:12px 16px;margin:0 0 18px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:${TEXT_MUTED};">Contactos directos</p>
        <table style="border-collapse:collapse;width:100%;">${contactRows.join('')}</table>
      </div>
    `
    : '';

  const ctaBlock = whatsappLink
    ? `
      <p style="margin:0 0 12px;color:${TEXT_DARK};font-size:14px;line-height:1.55;">
        Próximo passo: contacta o teu parceiro de financiamento. Ele entrará em contacto contigo em até <strong>4 dias úteis</strong>; podes também enviar uma mensagem agora para acelerar o processo.
      </p>
      <div style="text-align:center;margin:18px 0 6px;">
        <a
          href="${escapeHtml(whatsappLink)}"
          style="display:inline-block;background:linear-gradient(90deg,${PRIMARY},#f0b23a);color:#fff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:12px;font-size:15px;"
        >
          Falar com ${escapeHtml(partnerName)} no WhatsApp
        </a>
      </div>
    `
    : '';

  const uploadBlock = input.uploadUrl
    ? `
      <div style="margin:24px 0 0;padding:18px 18px 16px;border:1px solid ${BORDER};border-radius:12px;background:#fafafa;">
        <h3 style="margin:0 0 6px;font-size:15px;color:${TEXT_DARK};">Envia já os teus documentos</h3>
        <p style="margin:0 0 12px;font-size:13px;color:${TEXT_MUTED};line-height:1.55;">
          Para o teu parceiro iniciar a análise é necessário enviar alguns documentos (cartão de cidadão/passaporte, recibos, IRS, comprovativos). Faz tudo em poucos minutos pelo teu telemóvel ou computador — os ficheiros vão direto para o email do parceiro.
        </p>
        <div style="text-align:center;">
          <a
            href="${escapeHtml(input.uploadUrl)}"
            style="display:inline-block;background:#111827;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px;font-size:14px;"
          >
            Enviar documentos
          </a>
        </div>
      </div>
    `
    : '';

  return `
    <div style="max-width:600px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${TEXT_DARK};">
      <div style="background:linear-gradient(135deg,${PRIMARY} 0%,#f0b23a 100%);padding:24px 20px;text-align:center;border-radius:16px 16px 0 0;">
        <p style="margin:0;color:#fff;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Comunidade Rafa Portugal</p>
        <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:700;">O teu parceiro de financiamento</h1>
      </div>

      <div style="border:1px solid ${BORDER};border-top:0;border-radius:0 0 16px 16px;padding:24px 22px;background:#fff;">
        <p style="margin:0 0 18px;font-size:15px;color:${TEXT_DARK};">
          Olá ${escapeHtml(greeting)}, foi-te atribuído um parceiro gratuito para te ajudar a financiar a tua casa em Portugal.
        </p>

        ${logoBlock}

        <h2 style="margin:0 0 4px;font-size:20px;text-align:center;color:${TEXT_DARK};">${escapeHtml(partnerName)}</h2>
        <p style="margin:0 0 18px;text-align:center;font-size:13px;color:${TEXT_MUTED};">Parceiro de crédito habitação</p>

        ${welcomeBlock}
        ${contactBlock}
        ${ctaBlock}
        ${uploadBlock}

        ${buildResultBlockHtml({ outcomeBody: input.outcomeBody, example: input.example })}
        ${buildBreakdownBlockHtml(input.breakdown)}

        <hr style="border:0;border-top:1px solid ${BORDER};margin:22px 0 16px;" />
        <p style="margin:0;font-size:12px;color:${TEXT_MUTED};line-height:1.5;">
          Este email foi-te enviado porque concluíste o questionário de financiamento na Comunidade Rafa Portugal e pediste para falar com um parceiro. O serviço é totalmente gratuito — quem paga a comissão é o banco.
        </p>
      </div>
    </div>
  `;
}

/** Versão texto simples (fallback para clientes que não renderizam HTML). */
export function buildPartnerKitEmailText(input: {
  leadName: string;
  partner: PartnerForLeadEmail;
  outcomeBody: string;
  example: { intro?: string; body: string } | null;
  breakdown: QuizAnswerBreakdownItem[];
  uploadUrl: string;
}): string {
  const greeting = firstName(input.leadName) || 'olá';
  const partnerName = input.partner.name.trim() || 'O teu parceiro';
  const partnerWhatsapp = digitsOnly(input.partner.whatsapp);
  const partnerEmail = (input.partner.email ?? '').trim();
  const partnerWelcome = (input.partner.shortDescription ?? '').trim();

  const lines: string[] = [
    `Olá ${greeting},`,
    '',
    `Foi-te atribuído um parceiro gratuito para te ajudar a financiar a tua casa em Portugal.`,
    '',
    `Parceiro: ${partnerName}`,
  ];
  if (partnerWhatsapp) lines.push(`WhatsApp: +${partnerWhatsapp}`);
  if (partnerEmail) lines.push(`Email: ${partnerEmail}`);
  if (partnerWelcome) {
    lines.push('');
    lines.push(partnerWelcome);
  }
  if (partnerWhatsapp) {
    lines.push('');
    lines.push(
      `Podes contactá-lo diretamente: https://wa.me/${partnerWhatsapp}`,
    );
    lines.push('Ele entrará em contacto contigo em até 4 dias úteis.');
  }

  if (input.uploadUrl) {
    lines.push('');
    lines.push('ENVIA OS TEUS DOCUMENTOS');
    lines.push(
      'Para o parceiro iniciar a análise precisa de alguns documentos (cartão de cidadão/passaporte, recibos, IRS, comprovativos).',
    );
    lines.push(`Faz o envio aqui: ${input.uploadUrl}`);
  }

  lines.push('');
  lines.push('-----');
  lines.push('O TEU RESULTADO');
  lines.push(input.outcomeBody);
  if (input.example) {
    lines.push('');
    if (input.example.intro) lines.push(input.example.intro);
    lines.push(input.example.body);
  }

  if (input.breakdown.length) {
    lines.push('');
    lines.push('AS TUAS RESPOSTAS');
    input.breakdown.forEach((b, i) => {
      lines.push(`${i + 1}. ${b.question}`);
      lines.push(`   → ${b.answer}`);
    });
  }

  lines.push('');
  lines.push('A equipa Comunidade Rafa Portugal');
  return lines.join('\n');
}

/** Envia o email do kit do parceiro ao lead. Lança em caso de falha do Resend. */
export async function sendPartnerKitEmail(input: {
  to: string;
  leadName: string;
  partner: PartnerForLeadEmail;
  outcomeBody: string;
  example: { intro?: string; body: string } | null;
  breakdown: QuizAnswerBreakdownItem[];
  uploadUrl: string;
}): Promise<void> {
  const subject = `O teu parceiro de financiamento já está pronto — Comunidade Rafa Portugal`;
  await sendEmailBase({
    to: input.to,
    subject,
    text: buildPartnerKitEmailText(input),
    html: buildPartnerKitEmailHtml(input),
  });
}
