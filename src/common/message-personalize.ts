/** Tag dinâmica → primeiro nome do contacto no outbound. */
export const MESSAGE_NAME_TAG = '{{nome}}';

const NAME_TAG_RE = /\{\{\s*nome\s*\}\}/gi;
const NAME_TAG_TEST_RE = /\{\{\s*nome\s*\}\}/i;

export function messageHasNameTag(text: string): boolean {
  return NAME_TAG_TEST_RE.test(text);
}

/** Primeiro nome para personalização (ex.: «Maria Silva» → «Maria»). */
export function leadFirstName(
  displayName: string | null | undefined,
): string {
  const raw = (displayName || '').trim();
  if (!raw) return '';
  return raw.split(/\s+/)[0] || '';
}

/**
 * Substitui `{{nome}}` pelo primeiro nome e limpa espaços sobrantes.
 */
export function personalizeMessageText(
  text: string,
  displayName: string | null | undefined,
): string {
  if (!messageHasNameTag(text)) return text;
  const name = leadFirstName(displayName);
  let out = text.replace(NAME_TAG_RE, name);
  out = out.replace(/\s{2,}/g, ' ');
  out = out.replace(/\s+([,.;!?])/g, '$1');
  return out.trim();
}

/** Garante que variações OpenAI mantêm a tag se a original a tinha. */
export function ensureNameTagPreserved(
  original: string,
  variation: string,
): string {
  if (!messageHasNameTag(original)) return variation;
  if (messageHasNameTag(variation)) {
    return variation.replace(NAME_TAG_RE, MESSAGE_NAME_TAG);
  }
  return `${MESSAGE_NAME_TAG}, ${variation}`.trim();
}
