/** Apenas dígitos (remove @s.whatsapp.net, +, espaços, etc.). */
export function digitsOnly(value: string): string {
  return String(value ?? '').replace(/\D+/g, '');
}

/**
 * Forma canónica para PT: móvel 9 dígitos → prefixo 351.
 * Usada ao guardar remetente e números monitorizados.
 */
export function canonicalPhoneDigits(value: string): string {
  const d = digitsOnly(value);
  if (!d) return '';
  if (/^9\d{8}$/.test(d)) return `351${d}`;
  return d;
}

/** Variantes equivalentes (ex.: 912345678 ↔ 351912345678). */
export function phoneMatchVariants(value: string): Set<string> {
  const d = canonicalPhoneDigits(value) || digitsOnly(value);
  const set = new Set<string>();
  if (!d) return set;
  set.add(d);
  if (d.startsWith('351') && d.length > 3) {
    const local = d.slice(3);
    if (local.length >= 8) set.add(local);
  }
  if (/^9\d{8}$/.test(d)) set.add(`351${d}`);
  return set;
}

export function phonesMatchMonitored(
  sender: string,
  monitored: string[],
): boolean {
  const senderVars = phoneMatchVariants(sender);
  if (!senderVars.size) return false;
  for (const n of monitored) {
    const storedVars = phoneMatchVariants(n);
    for (const s of senderVars) {
      if (storedVars.has(s)) return true;
    }
  }
  return false;
}
