import type { ChatbotSlug } from './chatbot.constants';

export type MenuBot = {
  slug: ChatbotSlug;
  menuOrder: number;
  menuLabel: string;
  name: string;
};

export const DEFAULT_CHATBOT_MENU_TEXT = `Olá! Sou a equipa virtual da Rafa. Diz-me o que precisas, ou escolhe o número do assunto:

1 — Relocation / aluguel
2 — Crédito imobiliário / compra de casa
3 — Publicidade com a Rafa

Podes responder com o número ou em texto livre (ex.: «publicidade», «quero alugar»).`;

/** Fallback se ainda não houver texto guardado na BD. */
export function buildChatbotMenuText(bots: MenuBot[]): string {
  const lines = [
    'Olá! Sou a equipa virtual da Rafa. Diz-me o que precisas, ou escolhe o número do assunto:',
    '',
  ];
  for (const bot of [...bots].sort((a, b) => a.menuOrder - b.menuOrder)) {
    lines.push(`${bot.menuOrder} — ${bot.menuLabel}`);
  }
  lines.push(
    '',
    'Podes responder com o número ou em texto livre (ex.: «publicidade», «quero alugar»).',
  );
  return lines.join('\n');
}

/**
 * Atalho determinístico: "1", "2", "3" (e variantes "1)", "2 - …").
 * Texto livre fica para a OpenAI.
 */
export function parseChatbotMenuDigitChoice(
  text: string,
  bots: MenuBot[],
): ChatbotSlug | null {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return null;

  const byOrder = new Map(bots.map((bot) => [bot.menuOrder, bot.slug]));
  const digit = trimmed.match(/^([123])(?:\b|[.)\-\s]|$)/);
  if (!digit) return null;
  const order = Number(digit[1]);
  return byOrder.get(order) ?? null;
}

/** @deprecated Preferir digito + OpenAI. Mantido para testes / fallback. */
export function parseChatbotMenuChoice(
  text: string,
  bots: MenuBot[],
): ChatbotSlug | null {
  const digit = parseChatbotMenuDigitChoice(text, bots);
  if (digit) return digit;

  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return null;

  const byOrder = new Map(bots.map((bot) => [bot.menuOrder, bot.slug]));
  const normalized = trimmed
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const bot of bots) {
    if (normalized === bot.slug || normalized === bot.name.toLowerCase()) {
      return bot.slug;
    }
  }

  if (
    /\b(relocation|aluguel|arrendamento|imigr)/.test(normalized) &&
    byOrder.has(1)
  ) {
    return byOrder.get(1) ?? null;
  }
  if (
    /\b(credito|financ|compra de casa|imobiliario)/.test(normalized) &&
    byOrder.has(2)
  ) {
    return byOrder.get(2) ?? null;
  }
  if (
    /\b(publicidade|propaganda|anuncio|parceria|marketing)/.test(normalized) &&
    byOrder.has(3)
  ) {
    return byOrder.get(3) ?? null;
  }

  return null;
}

export function buildMenuClassifySystemPrompt(bots: MenuBot[]): string {
  const options = [...bots]
    .sort((a, b) => a.menuOrder - b.menuOrder)
    .map(
      (bot) =>
        `- slug="${bot.slug}" numero=${bot.menuOrder} nome="${bot.name}" assunto="${bot.menuLabel}"`,
    )
    .join('\n');

  return [
    'És um classificador de intenções para o WhatsApp da Rafa.',
    'Dado o texto do contacto, escolhe UMA opção (slug) da lista.',
    'Aceita número (1/2/3), nome do bot, ou qualquer frase em português que indique o assunto.',
    'Exemplos: "publicidade" → gabi; "quero alugar em Viseu" → joana; "crédito para comprar casa" → bruna.',
    'Se não der para perceber o assunto, devolve null.',
    'Responde APENAS JSON válido: {"slug":"joana"|"bruna"|"gabi"|null}',
    '',
    'Opções:',
    options,
  ].join('\n');
}

export function parseMenuClassifyResponse(
  raw: string,
  bots: MenuBot[],
): ChatbotSlug | null {
  const allowed = new Set(bots.map((bot) => bot.slug));
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    const jsonText =
      start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
    const parsed = JSON.parse(jsonText) as { slug?: unknown };
    if (parsed.slug == null) return null;
    if (typeof parsed.slug !== 'string') return null;
    const slug = parsed.slug.trim().toLowerCase();
    return allowed.has(slug as ChatbotSlug) ? (slug as ChatbotSlug) : null;
  } catch {
    const lower = trimmed.toLowerCase();
    for (const bot of bots) {
      if (lower.includes(`"${bot.slug}"`) || lower === bot.slug) {
        return bot.slug;
      }
    }
    return null;
  }
}
