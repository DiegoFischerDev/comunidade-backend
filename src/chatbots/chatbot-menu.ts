import type { ChatbotSlug } from './chatbot.constants';

export type MenuBot = {
  slug: ChatbotSlug;
  menuOrder: number;
  menuLabel: string;
  name: string;
};

export const DEFAULT_CHATBOT_MENU_TEXT = `Oiê! 🥰 Seja muito bem-vindo(a)!

Sou a assistente virtual da Rafa e estou aqui pra te ajudar! 💛

Me conta, sobre qual assunto você gostaria de conversar?

🏡 1. Aluguel de imóveis em Portugal (Relocation)

🔑 2. Financiamento ou compra de casa em Portugal

💌 3. Publicidade e parcerias com a Rafa

💬 4. Falar diretamente com a Rafa sobre outros assuntos`;

const MENU_OPTION_EMOJI: Record<number, string> = {
  1: '🏡 ',
  2: '🔑 ',
  3: '💌 ',
  4: '💬 ',
};

/** Fallback se ainda não houver texto guardado na BD. */
export function buildChatbotMenuText(bots: MenuBot[]): string {
  const lines = [
    'Oiê! 🥰 Seja muito bem-vindo(a)!',
    '',
    'Sou a assistente virtual da Rafa e estou aqui pra te ajudar! 💛',
    '',
    'Me conta, sobre qual assunto você gostaria de conversar?',
    '',
  ];
  for (const bot of [...bots].sort((a, b) => a.menuOrder - b.menuOrder)) {
    const emoji = MENU_OPTION_EMOJI[bot.menuOrder] ?? '';
    lines.push(`${emoji}${bot.menuOrder}. ${bot.menuLabel}`);
    lines.push('');
  }
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/**
 * Atalho determinístico: número do menu (1, 2, 3, 4, …).
 * Texto livre fica para a OpenAI.
 */
export function parseChatbotMenuDigitChoice(
  text: string,
  bots: MenuBot[],
): ChatbotSlug | null {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return null;

  const byOrder = new Map(bots.map((bot) => [bot.menuOrder, bot.slug]));
  const digit = trimmed.match(/^(\d{1,2})(?:\b|[.)\-\s]|$)/);
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
  if (
    /\b(outros|outra coisa|falar (com|diretamente)|falar com a rafa|assunto diferente)/.test(
      normalized,
    ) &&
    byOrder.has(4)
  ) {
    return byOrder.get(4) ?? null;
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

  const slugList = bots.map((bot) => `"${bot.slug}"`).join('|');

  return [
    'És um classificador de intenções para o WhatsApp da Rafa.',
    'Dado o texto do contacto, escolhe UMA opção (slug) da lista.',
    'Aceita número (1/2/3/4), nome do bot, ou qualquer frase em português que indique o assunto.',
    'Exemplos: "publicidade" → gabi; "quero alugar em Viseu" → joana; "crédito para comprar casa" → bruna; "quero falar com a Rafa" / "outro assunto" / "4" → outros.',
    'Se não der para perceber o assunto, devolve null.',
    `Responde APENAS JSON válido: {"slug":${slugList}|null}`,
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

/** Resume o assunto num frase curta para o CRM Outros. */
export function parseSubjectSummaryResponse(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    const jsonText =
      start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
    const parsed = JSON.parse(jsonText) as { summary?: unknown };
    if (typeof parsed.summary !== 'string') return null;
    const summary = parsed.summary.trim().replace(/\s+/g, ' ');
    if (summary.length < 2) return null;
    return summary.slice(0, 200);
  } catch {
    const fallback = trimmed.replace(/\s+/g, ' ').slice(0, 200);
    return fallback.length >= 2 ? fallback : null;
  }
}
