export const RELOCATION_CHATBOT_TZ = 'Europe/Lisbon';

export const RELOCATION_FIRST_CONTACT_MESSAGE = [
  'Bom dia!',
  'Você gostaria de fazer o seu relocation com o Rafa?',
  '1 - Sim',
  '2 - Não',
].join('\n');

export const RELOCATION_YES_MESSAGE =
  'Perfeito. Já registámos o seu interesse no relocation.';

/** Instância Evolution que atende o primeiro contacto do dia. */
export function relocationChatbotInstance(): string {
  return (
    process.env.RELOCATION_CHATBOT_INSTANCE ||
    process.env.RAFA_CALL_WHATSAPP_TRIGGER_INSTANCE ||
    'comunidade MEO'
  ).trim();
}

/** Dia civil em Europe/Lisbon (`YYYY-MM-DD`). */
export function relocationDayKey(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: RELOCATION_CHATBOT_TZ,
  }).format(at);
}

export type RelocationReplyChoice = 'SIM' | 'NAO';

/**
 * A resposta útil é a opção numerada.
 * «1», «1 - sim» contam como sim; «2», «2 - não» contam como não.
 */
export function parseRelocationReply(text: string): RelocationReplyChoice | null {
  const normalized = text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ');
  if (!normalized) return null;
  if (/^1\b/.test(normalized)) return 'SIM';
  if (/^2\b/.test(normalized)) return 'NAO';
  return null;
}

/** Nome visível vindo do WhatsApp; null se for curto ou só dígitos. */
export function cleanDisplayName(raw: string | null | undefined): string | null {
  const cleaned = (raw || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (cleaned.length < 2) return null;
  if (/^\d+$/.test(cleaned)) return null;
  return cleaned;
}

export function fallbackLeadName(digits: string): string {
  const tail = digits.replace(/\D/g, '').slice(-4) || 'WA';
  return `Lead ${tail}`;
}
