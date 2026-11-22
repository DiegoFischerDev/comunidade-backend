import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

export const CRM_REQUEST_SUMMARY_MAX_CHARS = 2000;
const CRM_REQUEST_SUMMARY_MAX_LINES = 4;
const CRM_REQUEST_SUMMARY_MAX_LINE_CHARS = 140;

const NO_CONVERSATION_MESSAGE = 'Este lead ainda não tem conversa para resumir.';

type HistoryTurn = { role: 'user' | 'assistant'; text: string };

/** Factos já guardados no JSON/CRM do lead — o resumo não deve repeti-los. */
export type CrmKnownLeadFacts = {
  preferredCity?: string | null;
  propertyTypology?: string[] | null;
  desiredRent?: number | null;
  hasPet?: boolean | null;
  hasVisa?: boolean | null;
  immigrationImmediate?: boolean | null;
  expectedImmigrationAt?: string | Date | null;
  companyName?: string | null;
  campaignObjective?: string | null;
  subjectSummary?: string | null;
  desiredHouseValue?: number | null;
  instagramHandle?: string | null;
};

export function normalizeCrmRequestSummary(
  value: string | null | undefined,
): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  return trimmed.slice(0, CRM_REQUEST_SUMMARY_MAX_CHARS);
}

function readHistory(value: unknown): HistoryTurn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as { role?: unknown; text?: unknown };
    if ((row.role !== 'user' && row.role !== 'assistant') || typeof row.text !== 'string') {
      return [];
    }
    const text = row.text.trim();
    if (!text) return [];
    return [{ role: row.role, text }];
  });
}

function readBufferTexts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const text = (item as { text?: unknown }).text;
    if (typeof text !== 'string' || !text.trim()) return [];
    return [text.trim()];
  });
}

/** Mensagens do buffer que ainda não entraram no histórico (janela de debounce). */
function pendingBufferTexts(history: HistoryTurn[], buffer: string[]): string[] {
  if (buffer.length === 0) return [];
  const userTexts = history.filter((turn) => turn.role === 'user').map((turn) => turn.text);
  const alreadyFlushed =
    userTexts.length >= buffer.length &&
    userTexts.slice(-buffer.length).every((text, index) => text === buffer[index]);
  return alreadyFlushed ? [] : buffer;
}

/**
 * Transcript dos últimos turnos guardados, mais o buffer ainda não gravado no histórico.
 * Notas de voz já estão em texto (a transcrição entra como mensagem do lead).
 */
export function buildLeadRequestTranscript(historyRaw: unknown, bufferRaw: unknown): string {
  const history = readHistory(historyRaw);
  const pending = pendingBufferTexts(history, readBufferTexts(bufferRaw));
  const lines = [
    ...history.map(
      (turn) => `${turn.role === 'user' ? 'Lead' : 'Assistente'}: ${turn.text}`,
    ),
    ...pending.map((text) => `Lead: ${text}`),
  ];
  return lines.join('\n').trim().slice(0, 12_000);
}

function formatKnownLeadFacts(facts?: CrmKnownLeadFacts | null): string {
  if (!facts) return '';
  const lines: string[] = [];
  const city = facts.preferredCity?.trim();
  if (city) lines.push(`Cidade preferida: ${city}`);
  const typologies = (facts.propertyTypology ?? []).map((item) => item.trim()).filter(Boolean);
  if (typologies.length > 0) lines.push(`Tipologia: ${typologies.join(', ')}`);
  if (facts.desiredRent != null) lines.push(`Aluguel pretendido: ${facts.desiredRent}€`);
  if (facts.hasPet === true) lines.push('Pet: sim');
  if (facts.hasPet === false) lines.push('Pet: não');
  if (facts.hasVisa === true) lines.push('Tem visto: sim');
  if (facts.hasVisa === false) lines.push('Tem visto: não');
  if (facts.immigrationImmediate) lines.push('Imigração: imediata');
  else if (facts.expectedImmigrationAt) {
    const raw =
      facts.expectedImmigrationAt instanceof Date
        ? facts.expectedImmigrationAt.toISOString().slice(0, 10)
        : String(facts.expectedImmigrationAt).trim();
    if (raw) lines.push(`Data de imigração: ${raw}`);
  }
  const company = facts.companyName?.trim();
  if (company) lines.push(`Empresa: ${company}`);
  const objective = facts.campaignObjective?.trim();
  if (objective) lines.push(`Objectivo da campanha: ${objective}`);
  const subject = facts.subjectSummary?.trim();
  if (subject) lines.push(`Assunto: ${subject}`);
  if (facts.desiredHouseValue != null) {
    lines.push(`Valor da casa: ${facts.desiredHouseValue}€`);
  }
  const ig = facts.instagramHandle?.trim();
  if (ig) lines.push(`Instagram: ${ig}`);
  return lines.join('\n');
}

function compactSummaryLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, CRM_REQUEST_SUMMARY_MAX_LINES)
    .map((line) =>
      line.length > CRM_REQUEST_SUMMARY_MAX_LINE_CHARS
        ? `${line.slice(0, CRM_REQUEST_SUMMARY_MAX_LINE_CHARS - 1).trimEnd()}…`
        : line,
    );
}

/** Pede à OpenAI só contexto extra além do JSON do lead. Lança Error se a chave falhar ou a resposta vier vazia. */
export async function summarizeLeadRequestText(
  transcript: string,
  knownFacts?: CrmKnownLeadFacts | null,
): Promise<string> {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY não está configurada.');
  }
  const model = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  const knownBlock = formatKnownLeadFacts(knownFacts);
  const system = [
    'És um assistente do CRM. Escreve em português de Portugal.',
    'O teu trabalho é extrair da conversa apenas informação EXTRA que ainda NÃO está nos dados estruturados do lead.',
    'NÃO repitas cidade, tipologia, aluguel, pet, visto (sim/não), data de imigração, empresa, objectivo, assunto ou valor da casa se esses dados já aparecerem na secção «Dados já guardados».',
    'Foca em contexto humano e nuances: família, estágio do visto, dúvidas, incertezas, motivações, restrições, histórico.',
    'Estilo: frases curtas e factuais. Sem prosa longa, sem saudações, sem títulos, sem marcadores.',
    `No máximo ${CRM_REQUEST_SUMMARY_MAX_LINES} frases/linhas. Cada linha com no máximo ${CRM_REQUEST_SUMMARY_MAX_LINE_CHARS} caracteres.`,
    'Exemplos do estilo correcto:',
    '"Já iniciou retirada de visto, mas não concluiu. Vem junto com marido e filho de 13 anos. Não tem certeza da cidade que quer morar ainda. Vem com visto de estudante"',
    '"Quer trazer dois cães e precisa de imóvel que aceite pets grandes. Está à espera de resposta do consulado."',
    '"Vem só; marido fica no Brasil nos primeiros meses. Prefere zona perto de metro por causa do trabalho."',
    'Se a conversa não tiver informação extra além dos dados já guardados, responde só: "Sem contexto extra".',
  ].join('\n');

  const userContent = [
    knownBlock
      ? `Dados já guardados no CRM (NÃO repetir):\n${knownBlock}`
      : 'Dados já guardados no CRM: nenhum campo estruturado preenchido.',
    '',
    'Conversa:',
    transcript,
  ].join('\n');

  const controller = new AbortController();
  const configured = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS || 45000);
  const timeoutMs = Number.isFinite(configured) ? configured : 45_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 180,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenAI respondeu ${res.status}: ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    const summary = normalizeCrmRequestSummary(compactSummaryLines(content).join('\n'));
    if (!summary) {
      throw new Error('OpenAI devolveu um resumo vazio.');
    }
    return summary;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateCrmRequestSummary(
  prisma: PrismaService,
  identity: {
    whatsappDigits?: string | null;
    instagramUserId?: string | null;
    chatbotId?: string | null;
    knownFacts?: CrmKnownLeadFacts | null;
  },
): Promise<string> {
  const whatsapp = (identity.whatsappDigits ?? '').replace(/\D/g, '');
  const instagramUserId = (identity.instagramUserId ?? '').trim();
  const or: Array<{ whatsappDigits: string } | { instagramUserId: string }> = [];
  if (whatsapp.length >= 8) or.push({ whatsappDigits: whatsapp });
  if (instagramUserId) or.push({ instagramUserId });
  if (or.length === 0) {
    throw new BadRequestException(NO_CONVERSATION_MESSAGE);
  }

  const rows = await prisma.joanaConversation.findMany({
    where: { OR: or },
    select: { history: true, buffer: true, chatbotId: true },
    orderBy: { updatedAt: 'desc' },
    take: 8,
  });
  const ordered = identity.chatbotId
    ? [
        ...rows.filter((row) => row.chatbotId === identity.chatbotId),
        ...rows.filter((row) => row.chatbotId !== identity.chatbotId),
      ]
    : rows;
  const transcript =
    ordered
      .map((row) => buildLeadRequestTranscript(row.history, row.buffer))
      .find((text) => text.length > 0) ?? '';
  if (!transcript) {
    throw new BadRequestException(NO_CONVERSATION_MESSAGE);
  }
  return summarizeLeadRequestText(transcript, identity.knownFacts);
}
