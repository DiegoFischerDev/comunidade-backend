/**
 * Email enviado ao parceiro com os documentos do lead em anexo. O lead recebe cópia (CC) com
 * o mesmo conteúdo + ficheiros. O `replyTo` é o email do lead, para o parceiro responder
 * diretamente.
 */

import { sendEmailBase } from '../email/resend.client';
import type { LeadDocumentSubmissionMode } from './lead-documents.constants';

const TEXT_DARK = '#111827';
const TEXT_MUTED = '#525252';
const BORDER = '#e5e7eb';
const PRIMARY = '#d58901';
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

function digitsOnly(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D+/g, '');
}

function subjectForMode(input: {
  mode: LeadDocumentSubmissionMode;
  leadName: string;
}): string {
  const name = input.leadName.trim() || 'Lead';
  if (input.mode === 'spouse') return `[${name} (cônjuge)] Documentos`;
  if (input.mode === 'extra') return `[${name}] Documentos adicionais`;
  return `[${name}] Documentos`;
}

/** Bloco com os dados que o lead declarou (estado civil, vínculo, etc.). */
function buildDeclaredFieldsHtml(input: {
  estadoCivil: string;
  numDependentes: string;
  anosEmprego: string;
  vinculoLaboral: string;
  disponibilidadeFiador: string;
  financiamento100: boolean;
  semDocsLabels: string[];
  mensagem: string;
  modeLabel: string | null;
}): string {
  const rows: string[] = [];
  const addRow = (label: string, value: string) => {
    if (!value.trim()) return;
    rows.push(`
      <tr>
        <td style="padding:6px 12px 6px 0;color:${TEXT_MUTED};font-size:13px;width:200px;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:6px 0;color:${TEXT_DARK};font-size:14px;">${nl2br(value)}</td>
      </tr>`);
  };

  if (input.modeLabel) addRow('Tipo de envio', input.modeLabel);
  addRow('Estado civil', input.estadoCivil);
  addRow('N.º de dependentes', input.numDependentes);
  addRow('Anos no emprego atual', input.anosEmprego);
  addRow('Vínculo laboral', input.vinculoLaboral);
  addRow('Disponibilidade para fiador', input.disponibilidadeFiador);
  if (input.financiamento100) {
    addRow(
      'Pedido especial',
      'Solicita financiamento a 100% para jovens com menos de 35 anos.',
    );
  }
  if (input.semDocsLabels.length) {
    addRow(
      'Documentos em falta',
      'O lead não consegue obter, neste momento, os seguintes documentos:\n- ' +
        input.semDocsLabels.join('\n- '),
    );
  }
  if (input.mensagem.trim()) {
    addRow('Mensagem do lead', input.mensagem);
  }

  if (!rows.length) return '';
  return `
    <h3 style="margin:0 0 8px;font-size:15px;color:${TEXT_DARK};">Dados declarados</h3>
    <table style="border-collapse:collapse;width:100%;border:1px solid ${BORDER};border-radius:10px;overflow:hidden;">${rows.join('')}</table>
  `;
}

/** Constrói o corpo HTML do email com documentos para o parceiro. */
export function buildLeadDocumentsEmailHtml(input: {
  mode: LeadDocumentSubmissionMode;
  leadName: string;
  leadEmail: string;
  leadWhatsapp: string;
  partnerName: string;
  partnerEmail: string;
  partnerWhatsapp: string;
  estadoCivil: string;
  numDependentes: string;
  anosEmprego: string;
  vinculoLaboral: string;
  disponibilidadeFiador: string;
  financiamento100: boolean;
  semDocsLabels: string[];
  mensagem: string;
  attachmentNames: string[];
}): string {
  const modeLabel =
    input.mode === 'spouse'
      ? 'Documentos do cônjuge'
      : input.mode === 'extra'
        ? 'Envio complementar (após o primeiro envio)'
        : 'Primeiro envio';

  const wa = digitsOnly(input.leadWhatsapp);
  const partnerWa = digitsOnly(input.partnerWhatsapp);

  const declaredBlock = buildDeclaredFieldsHtml({
    estadoCivil: input.estadoCivil,
    numDependentes: input.numDependentes,
    anosEmprego: input.anosEmprego,
    vinculoLaboral: input.vinculoLaboral,
    disponibilidadeFiador: input.disponibilidadeFiador,
    financiamento100: input.financiamento100,
    semDocsLabels: input.semDocsLabels,
    mensagem: input.mensagem,
    modeLabel,
  });

  const fileListHtml = input.attachmentNames.length
    ? `
      <h3 style="margin:24px 0 8px;font-size:15px;color:${TEXT_DARK};">Documentos anexados (${input.attachmentNames.length})</h3>
      <ul style="margin:0;padding:0 0 0 18px;color:${TEXT_DARK};font-size:13px;line-height:1.6;">
        ${input.attachmentNames.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}
      </ul>
    `
    : '';

  return `
    <div style="max-width:600px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${TEXT_DARK};">
      <div style="background:linear-gradient(135deg,${PRIMARY} 0%,#f0b23a 100%);padding:24px 20px;text-align:center;border-radius:16px 16px 0 0;">
        <p style="margin:0;color:#fff;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Comunidade Rafa Portugal</p>
        <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:700;">Documentos recebidos do lead</h1>
      </div>
      <div style="border:1px solid ${BORDER};border-top:0;border-radius:0 0 16px 16px;padding:24px 22px;background:#fff;">
        <table role="presentation" style="border-collapse:separate;border-spacing:0;width:100%;margin:0 0 18px;">
          <tr>
            <td style="vertical-align:top;width:50%;padding-right:6px;">
              <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${TEXT_MUTED};font-weight:600;">Enviado por (lead)</p>
              <div style="background:${SOFT_BG};border-left:4px solid ${PRIMARY};border-radius:6px;padding:14px 16px;">
                <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:${TEXT_DARK};">${escapeHtml(input.leadName || 'Lead sem nome')}</p>
                ${input.leadEmail ? `<p style="margin:0;font-size:13px;color:${TEXT_DARK};"><a href="mailto:${escapeHtml(input.leadEmail)}" style="color:${TEXT_DARK};text-decoration:underline;">${escapeHtml(input.leadEmail)}</a></p>` : ''}
                ${wa ? `<p style="margin:2px 0 0;font-size:13px;color:${TEXT_DARK};"><a href="https://wa.me/${wa}" style="color:${TEXT_DARK};text-decoration:underline;">+${escapeHtml(wa)}</a></p>` : ''}
              </div>
            </td>
            <td style="vertical-align:top;width:50%;padding-left:6px;">
              <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${TEXT_MUTED};font-weight:600;">Recebido por (gestora)</p>
              <div style="background:#ecfdf5;border-left:4px solid #10b981;border-radius:6px;padding:14px 16px;">
                <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:${TEXT_DARK};">${escapeHtml(input.partnerName || 'Gestora atribuída')}</p>
                ${input.partnerEmail ? `<p style="margin:0;font-size:13px;color:${TEXT_DARK};"><a href="mailto:${escapeHtml(input.partnerEmail)}" style="color:${TEXT_DARK};text-decoration:underline;">${escapeHtml(input.partnerEmail)}</a></p>` : ''}
                ${partnerWa ? `<p style="margin:2px 0 0;font-size:13px;color:${TEXT_DARK};"><a href="https://wa.me/${partnerWa}" style="color:${TEXT_DARK};text-decoration:underline;">+${escapeHtml(partnerWa)}</a></p>` : ''}
              </div>
            </td>
          </tr>
        </table>

        ${declaredBlock}
        ${fileListHtml}

        <hr style="border:0;border-top:1px solid ${BORDER};margin:22px 0 16px;" />
        <p style="margin:0;font-size:12px;color:${TEXT_MUTED};line-height:1.5;">
          Este email foi gerado automaticamente quando concluiu o envio de documentos na Comunidade Rafa Portugal. Apenas a gestora de crédito tem acesso aos documentos.       </p>
      </div>
    </div>
  `;
}

/** Versão texto simples do email (fallback). */
export function buildLeadDocumentsEmailText(input: {
  mode: LeadDocumentSubmissionMode;
  leadName: string;
  leadEmail: string;
  leadWhatsapp: string;
  partnerName: string;
  partnerEmail: string;
  partnerWhatsapp: string;
  estadoCivil: string;
  numDependentes: string;
  anosEmprego: string;
  vinculoLaboral: string;
  disponibilidadeFiador: string;
  financiamento100: boolean;
  semDocsLabels: string[];
  mensagem: string;
  attachmentNames: string[];
}): string {
  const modeLabel =
    input.mode === 'spouse'
      ? 'Documentos do cônjuge'
      : input.mode === 'extra'
        ? 'Envio complementar (após o primeiro envio)'
        : 'Primeiro envio';

  const lines: string[] = [
    'Documentos recebidos — Comunidade Rafa Portugal',
    '',
    'Enviado por (lead):',
    `- Nome: ${input.leadName || '—'}`,
    `- Email: ${input.leadEmail || '—'}`,
    `- WhatsApp: ${input.leadWhatsapp ? `+${digitsOnly(input.leadWhatsapp)}` : '—'}`,
    '',
    'Recebido por (gestora):',
    `- Nome: ${input.partnerName || '—'}`,
    `- Email: ${input.partnerEmail || '—'}`,
    `- WhatsApp: ${input.partnerWhatsapp ? `+${digitsOnly(input.partnerWhatsapp)}` : '—'}`,
    '',
    `Tipo de envio: ${modeLabel}`,
    '',
    'Dados declarados:',
    `- Estado civil: ${input.estadoCivil || '—'}`,
    `- N.º de dependentes: ${input.numDependentes || '—'}`,
    `- Anos no emprego atual: ${input.anosEmprego || '—'}`,
    `- Vínculo laboral: ${input.vinculoLaboral || '—'}`,
  ];
  if (input.disponibilidadeFiador) {
    lines.push(`- Disponibilidade para fiador: ${input.disponibilidadeFiador}`);
  }
  if (input.financiamento100) {
    lines.push(
      '- Pedido especial: financiamento a 100% para jovens com menos de 35 anos.',
    );
  }
  if (input.semDocsLabels.length) {
    lines.push('');
    lines.push('Documentos que o lead não conseguiu obter:');
    input.semDocsLabels.forEach((label) => lines.push(`- ${label}`));
  }
  if (input.mensagem.trim()) {
    lines.push('');
    lines.push('Mensagem do lead:');
    lines.push(input.mensagem.trim());
  }
  if (input.attachmentNames.length) {
    lines.push('');
    lines.push(`Documentos anexados (${input.attachmentNames.length}):`);
    input.attachmentNames.forEach((n) => lines.push(`- ${n}`));
  }
  lines.push('');
  lines.push('— Comunidade Rafa Portugal');
  return lines.join('\n');
}

/** Envia o email ao parceiro com os ficheiros do lead em anexo. CC para o lead. */
export async function sendLeadDocumentsEmail(input: {
  mode: LeadDocumentSubmissionMode;
  partnerName: string;
  partnerEmail: string;
  partnerWhatsapp: string;
  leadName: string;
  leadEmail: string;
  leadWhatsapp: string;
  estadoCivil: string;
  numDependentes: string;
  anosEmprego: string;
  vinculoLaboral: string;
  disponibilidadeFiador: string;
  financiamento100: boolean;
  semDocsLabels: string[];
  mensagem: string;
  attachments: { filename: string; content: Buffer; contentType?: string }[];
}): Promise<void> {
  const subject = subjectForMode({
    mode: input.mode,
    leadName: input.leadName,
  });
  const attachmentNames = input.attachments.map((a) => a.filename);

  await sendEmailBase({
    to: input.partnerEmail,
    cc: input.leadEmail || undefined,
    replyTo: input.leadEmail || undefined,
    subject,
    text: buildLeadDocumentsEmailText({ ...input, attachmentNames }),
    html: buildLeadDocumentsEmailHtml({ ...input, attachmentNames }),
    attachments: input.attachments,
  });
}
