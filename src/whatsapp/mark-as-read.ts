/**
 * Helpers para `POST /chat/markMessageAsRead/{instance}` (Evolution).
 * IDs `local-*` são gerados no backend (sem key na Evolution) e são ignorados.
 */
export type EvolutionReadMessage = {
  id: string;
  fromMe: false;
  remoteJid: string;
};

/** Filtra e deduplica IDs reais da Evolution (descarta `local-…`). */
export function uniqueEvolutionMessageIds(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = (raw || '').trim();
    if (!id || id.startsWith('local-') || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function buildEvolutionReadMessages(
  digits: string,
  messageIds: string[],
): EvolutionReadMessage[] {
  const n = digits.replace(/\D/g, '');
  if (!n) return [];
  const remoteJid = `${n}@s.whatsapp.net`;
  return uniqueEvolutionMessageIds(messageIds).map((id) => ({
    id,
    fromMe: false as const,
    remoteJid,
  }));
}
