/**
 * Email enviado ao lead com os dados da gestora atribuída (foto, contactos, boas-vindas,
 * link de upload de documentos). Inline HTML porque é mais portátil para os clientes de email
 * (Gmail, Outlook, Apple Mail) — sem CSS externo nem JS.
 */

import { sendEmailBase } from '../email/resend.client';
import { IaAppService, type GestoraShape } from './ia-app.service';
import type { QuizAnswerBreakdownItem } from './financing-quiz.constants';

const PRIMARY = '#d58901';
const PRIMARY_DARK = '#a96900';
const TEXT_DARK = '#111827';
const TEXT_MUTED = '#525252';
const BORDER = '#e5e7eb';
const SOFT_BG = '#fef7e7';

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
  return trimmed.split(/\s+/)[0]!;
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
 * Constrói o HTML do email do "kit da gestora": apresentação da gestora atribuída + CTA para o
 * upload de documentos + resumo do resultado + respostas detalhadas do quiz.
 */
export function buildGestoraEmailHtml(input: {
  leadName: string;
  gestora: GestoraShape | undefined;
  uploadUrl: string;
  outcomeBody: string;
  example: { intro?: string; body: string } | null;
  breakdown: QuizAnswerBreakdownItem[];
}): string {
  const greeting = firstName(input.leadName) || 'olá';
  const gestoraName = IaAppService.extractGestoraName(input.gestora) || 'A tua gestora';
  const gestoraWhatsapp = IaAppService.extractGestoraWhatsapp(input.gestora);
  const gestoraEmail = IaAppService.extractGestoraEmail(input.gestora);
  const boasVindas = IaAppService.extractGestoraBoasVindas(input.gestora);
  const photoSrc = IaAppService.fotoSrcFromGestora(input.gestora);

  const whatsappLink = gestoraWhatsapp
    ? `https://wa.me/${gestoraWhatsapp.replace(/\D/g, '')}`
    : '';
  const safeUploadUrl = String(input.uploadUrl ?? '').trim();

  const photoBlock = photoSrc
    ? `
      <div style="text-align:center;margin:0 0 20px;">
        <img
          src="${escapeHtml(photoSrc)}"
          alt="${escapeHtml(gestoraName)}"
          width="160"
          height="160"
          style="width:160px;height:160px;object-fit:cover;border-radius:12px;border:3px solid ${PRIMARY};display:inline-block;"
        />
      </div>
    `
    : '';

  const welcomeBlock = boasVindas
    ? `
      <div style="background:${SOFT_BG};border-left:4px solid ${PRIMARY};border-radius:6px;padding:14px 16px;margin:0 0 18px;">
        <p style="margin:0;color:${TEXT_DARK};font-size:14px;line-height:1.55;">${nl2br(boasVindas)}</p>
      </div>
    `
    : '';

  const contactRows: string[] = [];
  if (gestoraWhatsapp) {
    contactRows.push(
      `<tr>
        <td style="padding:6px 0;color:${TEXT_MUTED};font-size:13px;width:90px;">WhatsApp</td>
        <td style="padding:6px 0;color:${TEXT_DARK};font-size:14px;">
          <a href="${escapeHtml(whatsappLink)}" style="color:${PRIMARY_DARK};text-decoration:none;font-weight:600;">+${escapeHtml(gestoraWhatsapp)}</a>
        </td>
      </tr>`,
    );
  }
  if (gestoraEmail) {
    contactRows.push(
      `<tr>
        <td style="padding:6px 0;color:${TEXT_MUTED};font-size:13px;width:90px;">Email</td>
        <td style="padding:6px 0;color:${TEXT_DARK};font-size:14px;">
          <a href="mailto:${escapeHtml(gestoraEmail)}" style="color:${PRIMARY_DARK};text-decoration:none;font-weight:600;">${escapeHtml(gestoraEmail)}</a>
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

  const ctaBlock = safeUploadUrl
    ? `
      <p style="margin:0 0 12px;color:${TEXT_DARK};font-size:14px;line-height:1.55;">
        Próximo passo: envia a tua documentação para a gestora avançar com a análise. Após enviares,
        ela entra em contacto em até <strong>4 dias úteis</strong>.
      </p>
      <div style="text-align:center;margin:18px 0 6px;">
        <a
          href="${escapeHtml(safeUploadUrl)}"
          style="display:inline-block;background:linear-gradient(90deg,${PRIMARY},#f0b23a);color:#fff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:12px;font-size:15px;"
        >
          Enviar documentos
        </a>
      </div>
      <p style="margin:8px 0 0;text-align:center;font-size:12px;color:${TEXT_MUTED};">
        Ou copia o link: <a href="${escapeHtml(safeUploadUrl)}" style="color:${PRIMARY_DARK};">${escapeHtml(safeUploadUrl)}</a>
      </p>
    `
    : '';

  return `
    <div style="max-width:600px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${TEXT_DARK};">
      <div style="background:linear-gradient(135deg,${PRIMARY} 0%,#f0b23a 100%);padding:24px 20px;text-align:center;border-radius:16px 16px 0 0;">
        <p style="margin:0;color:#fff;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Comunidade Rafa Portugal</p>
        <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:700;">A tua gestora de crédito</h1>
      </div>

      <div style="border:1px solid ${BORDER};border-top:0;border-radius:0 0 16px 16px;padding:24px 22px;background:#fff;">
        <p style="margin:0 0 18px;font-size:15px;color:${TEXT_DARK};">
          Olá ${escapeHtml(greeting)}, foi-te atribuída uma gestora gratuita para te ajudar a financiar a tua casa em Portugal.
        </p>

        ${photoBlock}

        <h2 style="margin:0 0 4px;font-size:20px;text-align:center;color:${TEXT_DARK};">${escapeHtml(gestoraName)}</h2>
        <p style="margin:0 0 18px;text-align:center;font-size:13px;color:${TEXT_MUTED};">Gestora de crédito habitação</p>

        ${welcomeBlock}
        ${contactBlock}
        ${ctaBlock}

        ${buildResultBlockHtml({ outcomeBody: input.outcomeBody, example: input.example })}
        ${buildBreakdownBlockHtml(input.breakdown)}

        <hr style="border:0;border-top:1px solid ${BORDER};margin:22px 0 16px;" />
        <p style="margin:0;font-size:12px;color:${TEXT_MUTED};line-height:1.5;">
          Este email foi-te enviado porque concluíste o questionário de financiamento na Comunidade Rafa Portugal e pediste para falar com uma gestora. O serviço é totalmente gratuito — quem paga a comissão da gestora são os bancos.
        </p>
      </div>
    </div>
  `;
}

/** Versão texto simples (fallback para clientes que não renderizam HTML). */
export function buildGestoraEmailText(input: {
  leadName: string;
  gestora: GestoraShape | undefined;
  uploadUrl: string;
  outcomeBody: string;
  example: { intro?: string; body: string } | null;
  breakdown: QuizAnswerBreakdownItem[];
}): string {
  const greeting = firstName(input.leadName) || 'olá';
  const gestoraName = IaAppService.extractGestoraName(input.gestora) || 'A tua gestora';
  const gestoraWhatsapp = IaAppService.extractGestoraWhatsapp(input.gestora);
  const gestoraEmail = IaAppService.extractGestoraEmail(input.gestora);
  const boasVindas = IaAppService.extractGestoraBoasVindas(input.gestora);
  const safeUploadUrl = String(input.uploadUrl ?? '').trim();

  const lines: string[] = [
    `Olá ${greeting},`,
    '',
    `Foi-te atribuída uma gestora gratuita para te ajudar a financiar a tua casa em Portugal.`,
    '',
    `Gestora: ${gestoraName}`,
  ];
  if (gestoraWhatsapp) lines.push(`WhatsApp: +${gestoraWhatsapp}`);
  if (gestoraEmail) lines.push(`Email: ${gestoraEmail}`);
  if (boasVindas) {
    lines.push('');
    lines.push(boasVindas);
  }
  if (safeUploadUrl) {
    lines.push('');
    lines.push('Para a gestora avançar com a tua análise, envia os documentos aqui:');
    lines.push(safeUploadUrl);
    lines.push('Após o envio, ela entra em contacto em até 4 dias úteis.');
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

/** Envia o email do kit da gestora ao lead. Lança em caso de falha do Resend. */
export async function sendGestoraKitEmail(input: {
  to: string;
  leadName: string;
  gestora: GestoraShape | undefined;
  uploadUrl: string;
  outcomeBody: string;
  example: { intro?: string; body: string } | null;
  breakdown: QuizAnswerBreakdownItem[];
}): Promise<void> {
  const subject = `A tua gestora gratuita já está pronta — Comunidade Rafa Portugal`;
  await sendEmailBase({
    to: input.to,
    subject,
    text: buildGestoraEmailText(input),
    html: buildGestoraEmailHtml(input),
  });
}
