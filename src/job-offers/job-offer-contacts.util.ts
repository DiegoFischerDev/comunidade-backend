export type JobOfferContactType = 'email' | 'phone' | 'url';

export interface JobOfferAdvertiserContact {
  type: JobOfferContactType;
  value: string;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PT_MOBILE_RE =
  /(?:\+?\s*351[\s.\-()]*)?(?:\(?\s*)?9[1236](?:[\s.\-()]?\d){7}(?!\d)/gi;
const WA_ME_RE = /wa\.me\/\+?(\d{9,15})/gi;
const URL_RE =
  /https?:\/\/[^\s<>"']+|(?:www\.)[a-z0-9][-a-z0-9.]+\.[a-z]{2,}(?:\/[^\s<>"']*)?/gi;

function contactKey(c: JobOfferAdvertiserContact): string {
  return `${c.type}:${c.value.toLowerCase()}`;
}

function pushUnique(
  list: JobOfferAdvertiserContact[],
  seen: Set<string>,
  contact: JobOfferAdvertiserContact,
) {
  const value = contact.value.trim();
  if (!value) return;
  const key = contactKey({ ...contact, value });
  if (seen.has(key)) return;
  seen.add(key);
  list.push({ type: contact.type, value });
}

export function normalizeAdvertiserContacts(
  raw: unknown,
): JobOfferAdvertiserContact[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: JobOfferAdvertiserContact[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const typeRaw = String(o.type ?? '').toLowerCase();
    const value = String(o.value ?? '').trim();
    if (!value) continue;
    if (typeRaw === 'email' && /@/.test(value)) {
      pushUnique(out, seen, { type: 'email', value: value.toLowerCase() });
      continue;
    }
    if (typeRaw === 'phone') {
      const digits = value.replace(/\D/g, '');
      if (digits.length >= 9) {
        pushUnique(out, seen, { type: 'phone', value: digits });
      }
      continue;
    }
    if (typeRaw === 'url') {
      const url = value.startsWith('http') ? value : `https://${value}`;
      pushUnique(out, seen, { type: 'url', value: url });
    }
  }
  return out;
}

/** Extrai contactos do texto (fallback quando a IA não preenche o array). */
export function extractAdvertiserContactsFromText(
  text: string,
): JobOfferAdvertiserContact[] {
  const raw = text.trim();
  if (!raw) return [];
  const seen = new Set<string>();
  const out: JobOfferAdvertiserContact[] = [];

  for (const m of raw.matchAll(EMAIL_RE)) {
    pushUnique(out, seen, { type: 'email', value: m[0].toLowerCase() });
  }

  for (const m of raw.matchAll(WA_ME_RE)) {
    pushUnique(out, seen, { type: 'phone', value: m[1].replace(/\D/g, '') });
  }

  const mobileMatches = raw.matchAll(PT_MOBILE_RE);
  for (const m of mobileMatches) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length === 9) {
      pushUnique(out, seen, { type: 'phone', value: digits });
    } else if (digits.length === 12 && digits.startsWith('351')) {
      pushUnique(out, seen, { type: 'phone', value: digits });
    }
  }

  for (const m of raw.matchAll(URL_RE)) {
    const v = m[0].trim();
    if (/wa\.me/i.test(v)) continue;
    if (/mailto:/i.test(v)) continue;
    pushUnique(out, seen, {
      type: 'url',
      value: v.startsWith('http') ? v : `https://${v}`,
    });
  }

  return out;
}

export function mergeAdvertiserContacts(
  ...groups: JobOfferAdvertiserContact[][]
): JobOfferAdvertiserContact[] {
  const seen = new Set<string>();
  const out: JobOfferAdvertiserContact[] = [];
  for (const group of groups) {
    for (const c of group) {
      pushUnique(out, seen, c);
    }
  }
  return out;
}

export function hasAdvertiserContact(
  text: string,
  contacts?: JobOfferAdvertiserContact[],
): boolean {
  if (contacts?.length) return true;
  return extractAdvertiserContactsFromText(text).length > 0;
}

/** @deprecated use hasAdvertiserContact */
export function messageHasAdvertiserContact(text: string): boolean {
  return hasAdvertiserContact(text);
}

export function formatContactForWhatsapp(c: JobOfferAdvertiserContact): string {
  if (c.type === 'email') return c.value;
  if (c.type === 'phone') {
    const d = c.value.replace(/\D/g, '');
    return d.startsWith('351') ? d : d.length === 9 ? `351${d}` : d;
  }
  return c.value.replace(/^https?:\/\//i, '');
}

export function formatAdvertiserContactsLine(
  contacts: JobOfferAdvertiserContact[],
): string {
  if (!contacts.length) return '';
  const parts = contacts.map(formatContactForWhatsapp);
  const hasEmail = contacts.some((c) => c.type === 'email');
  const hasPhone = contacts.some((c) => c.type === 'phone');
  const emoji =
    hasEmail && hasPhone ? '📧' : hasPhone ? '📲' : hasEmail ? '📧' : '🔗';
  return `${emoji} *Candidaturas:* ${parts.join(' ou ')}`;
}
