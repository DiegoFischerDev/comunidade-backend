import type { ChatbotSlug } from './chatbot.constants';

export type MenuBot = {
  slug: ChatbotSlug;
  menuOrder: number;
  menuLabel: string;
  name: string;
};

/** Texto do menu inicial (1/2/3) a partir dos bots activos. */
export function buildChatbotMenuText(bots: MenuBot[]): string {
  const lines = [
    'Olá! Sou a equipa virtual da Rafa. Escolhe o número do assunto:',
    '',
  ];
  for (const bot of [...bots].sort((a, b) => a.menuOrder - b.menuOrder)) {
    lines.push(`${bot.menuOrder} — ${bot.menuLabel}`);
  }
  lines.push('', 'Responde só com o número (1, 2 ou 3).');
  return lines.join('\n');
}

/**
 * Interpreta a escolha do menu. Aceita "1", "2", "3" e sinónimos simples
 * (relocation, crédito, publicidade, nomes dos bots).
 */
export function parseChatbotMenuChoice(
  text: string,
  bots: MenuBot[],
): ChatbotSlug | null {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return null;

  const byOrder = new Map(bots.map((bot) => [bot.menuOrder, bot.slug]));
  const digit = trimmed.match(/^([123])(?:\b|[.)\-\s]|$)/);
  if (digit) {
    const order = Number(digit[1]);
    return byOrder.get(order) ?? null;
  }

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
    /\b(credito|crédito|financ|compra de casa|imobiliario|imobiliário)/.test(
      normalized,
    ) &&
    byOrder.has(2)
  ) {
    return byOrder.get(2) ?? null;
  }
  if (
    /\b(publicidade|propaganda|anuncio|anúncio|parceria|marketing)/.test(
      normalized,
    ) &&
    byOrder.has(3)
  ) {
    return byOrder.get(3) ?? null;
  }

  return null;
}
