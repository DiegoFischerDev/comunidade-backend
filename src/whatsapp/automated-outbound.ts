const DEFAULT_TTL_MS = 3 * 60 * 1000;

type TimedText = { text: string; expires: number };
type TimedCount = { remaining: number; expires: number };

/**
 * Mensagens que o backend acabou de enviar pela Evolution.
 * O webhook `fromMe` dessas mensagens não é o admin a assumir a conversa.
 * O id fica até expirar (a Evolution pode reentregar o mesmo webhook).
 * O texto e a mídia gastam-se na primeira correspondência, para não engolir
 * uma mensagem igual escrita depois pelo admin.
 */
export class AutomatedOutboundRegistry {
  private readonly ids = new Map<string, number>();
  private readonly texts = new Map<string, TimedText[]>();
  private readonly media = new Map<string, TimedCount>();

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}

  rememberText(digits: string, text: string, now = Date.now()): void {
    const key = digits.trim();
    const normalized = normalizeOutboundText(text);
    if (!key || key.includes('@') || !normalized) return;
    this.prune(now);
    const list = this.liveTexts(key, now);
    list.push({ text: normalized, expires: now + this.ttlMs });
    this.texts.set(key, list);
  }

  rememberMedia(digits: string, now = Date.now()): void {
    const key = digits.trim();
    if (!key || key.includes('@')) return;
    this.prune(now);
    const current = this.media.get(key);
    const remaining = current && current.expires > now ? current.remaining : 0;
    this.media.set(key, { remaining: remaining + 1, expires: now + this.ttlMs });
  }

  rememberMessageId(id: string, now = Date.now()): void {
    const key = id.trim();
    if (!key) return;
    this.prune(now);
    this.ids.set(key, now + this.ttlMs);
  }

  forgetText(digits: string, text: string, now = Date.now()): void {
    this.consumeText(digits.trim(), normalizeOutboundText(text), now);
  }

  forgetMedia(digits: string, now = Date.now()): void {
    this.consumeMedia(digits.trim(), now);
  }

  isAutomatedEcho(input: {
    digits: string;
    messageId?: string | null;
    text?: string | null;
    hasMedia?: boolean;
    now?: number;
  }): boolean {
    const now = input.now ?? Date.now();
    this.prune(now);
    const digits = input.digits.trim();
    const messageId = input.messageId?.trim() || '';
    const text = normalizeOutboundText(input.text || '');
    const byId = Boolean(messageId && this.ids.has(messageId));
    const byText = Boolean(text && this.consumeText(digits, text, now));
    const byMedia = Boolean(
      input.hasMedia && (byId || byText || !text) && this.consumeMedia(digits, now),
    );
    return byId || byText || byMedia;
  }

  private liveTexts(digits: string, now: number): TimedText[] {
    return (this.texts.get(digits) ?? []).filter((item) => item.expires > now);
  }

  private consumeText(digits: string, text: string, now: number): boolean {
    if (!digits || !text) return false;
    const list = this.liveTexts(digits, now);
    const index = list.findIndex((item) => item.text === text);
    if (index < 0) {
      this.texts.set(digits, list);
      return false;
    }
    list.splice(index, 1);
    if (list.length === 0) this.texts.delete(digits);
    else this.texts.set(digits, list);
    return true;
  }

  private consumeMedia(digits: string, now: number): boolean {
    if (!digits) return false;
    const current = this.media.get(digits);
    if (!current || current.expires <= now || current.remaining < 1) {
      if (current) this.media.delete(digits);
      return false;
    }
    if (current.remaining === 1) this.media.delete(digits);
    else this.media.set(digits, { remaining: current.remaining - 1, expires: current.expires });
    return true;
  }

  private prune(now: number): void {
    for (const [id, expires] of this.ids) {
      if (expires <= now) this.ids.delete(id);
    }
    for (const [digits, list] of this.texts) {
      const live = list.filter((item) => item.expires > now);
      if (live.length === 0) this.texts.delete(digits);
      else if (live.length !== list.length) this.texts.set(digits, live);
    }
    for (const [digits, entry] of this.media) {
      if (entry.expires <= now || entry.remaining < 1) this.media.delete(digits);
    }
  }
}

export function normalizeOutboundText(text: string): string {
  return text.trim().slice(0, 8000);
}

export function readEvolutionMessageId(body: string): string | null {
  try {
    const data = JSON.parse(body) as unknown;
    const id = findMessageId(data);
    return id;
  } catch {
    return null;
  }
}

function findMessageId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const key = record.key;
  if (key && typeof key === 'object') {
    const id = (key as Record<string, unknown>).id;
    if (typeof id === 'string' && id.trim()) return id.trim();
  }
  for (const nested of [record.message, record.data]) {
    const found = findMessageId(nested);
    if (found) return found;
  }
  return null;
}
