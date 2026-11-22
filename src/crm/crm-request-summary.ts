import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

export const CRM_REQUEST_SUMMARY_MAX_CHARS = 2000;

const NO_CONVERSATION_MESSAGE = 'Este lead ainda não tem conversa para resumir.';

type HistoryTurn = { role: 'user' | 'assistant'; text: string };

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

/** Pede à OpenAI um resumo de até 5 linhas. Lança Error se a chave falhar ou a resposta vier vazia. */
export async function summarizeLeadRequestText(transcript: string): Promise<string> {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY não está configurada.');
  }
  const model = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  const system = [
    'És um assistente do CRM. Resume a conversa em português de Portugal.',
    'No máximo 5 linhas.',
    'Inclui só as dúvidas e as solicitações concretas do lead.',
    'Não incluas saudações, nem repitas o que a assistente já respondeu, excepto se o lead ainda estiver à espera de resposta.',
    'Se não houver pedidos concretos, responde com uma única linha a dizer que o lead ainda não fez um pedido concreto.',
    'Não uses títulos nem marcadores. Uma ideia por linha.',
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
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: transcript },
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
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*•]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 5);
    const summary = normalizeCrmRequestSummary(lines.join('\n'));
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
  return summarizeLeadRequestText(transcript);
}
