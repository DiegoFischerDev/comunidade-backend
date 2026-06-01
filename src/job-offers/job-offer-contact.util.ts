/** E-mail do anunciante na mensagem original do scan. */
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/** Telemóvel PT (9[1236] + 7 dígitos), com prefixo 351 opcional e separadores. */
const PT_MOBILE_RE =
  /(?:\+?\s*351[\s.\-()]*)?(?:\(?\s*)?9[1236](?:[\s.\-()]?\d){7}(?!\d)/i;

/** Links WhatsApp com número. */
const WA_ME_RE = /wa\.me\/\+?\d{9,15}/i;

/**
 * A mensagem do scan inclui meio de contacto do anunciante (telemóvel ou e-mail)?
 * Ofertas sem contacto não são criadas.
 */
export function messageHasAdvertiserContact(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;

  if (EMAIL_RE.test(raw)) return true;
  if (WA_ME_RE.test(raw)) return true;
  if (PT_MOBILE_RE.test(raw)) return true;

  const digitChunks = raw.match(/(?:\+?\d[\d\s.\-/]{6,}\d|\d{9,})/g) ?? [];
  for (const chunk of digitChunks) {
    const digits = chunk.replace(/\D/g, '');
    if (digits.length === 9 && /^9[1236]\d{7}$/.test(digits)) return true;
    if (digits.length === 12 && /^3519[1236]\d{7}$/.test(digits)) return true;
  }

  return false;
}
