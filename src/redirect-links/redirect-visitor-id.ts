import { randomUUID } from 'crypto';

/** Nome do cookie HttpOnly no domínio da API (guarda UUID do visitante). */
export const REDIRECT_VISITOR_COOKIE = 'rd_vid';

/**
 * Lê o valor bruto do cookie `rd_vid` a partir do header Cookie.
 */
export function parseRedirectVisitorCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader || typeof cookieHeader !== 'string') return undefined;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (name === REDIRECT_VISITOR_COOKIE) {
      try {
        return decodeURIComponent(val);
      } catch {
        return val;
      }
    }
  }
  return undefined;
}

/**
 * Aceita apenas UUID (formato gerado por randomUUID) para evitar injeção / valores gigantes.
 */
export function normalizeVisitorKey(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t)
  ) {
    return null;
  }
  return t.toLowerCase();
}

/**
 * Prioridade: query `rd_vid` (enviada pelo frontend, ex. localStorage) → cookie
 * `rd_vid` → novo UUID. A query evita dois cliques com IDs distintos quando o
 * browser faz mais do que um GET ao API antes de persistir o cookie HttpOnly.
 */
export function resolveRedirectVisitorId(params: {
  cookieHeader?: string;
  /** Query `?rd_vid=<uuid>` na URL do redirect público. */
  queryRdVid?: string;
}): {
  visitorKey: string;
  /** Quando true, enviar Set-Cookie com `visitorKey` na resposta HTTP. */
  setCookie: boolean;
} {
  const fromQuery = normalizeVisitorKey(params.queryRdVid);
  const fromCookie = normalizeVisitorKey(parseRedirectVisitorCookie(params.cookieHeader));

  if (fromQuery) {
    const setCookie = !fromCookie || fromCookie !== fromQuery;
    return { visitorKey: fromQuery, setCookie };
  }
  if (fromCookie) {
    return { visitorKey: fromCookie, setCookie: false };
  }
  return { visitorKey: randomUUID(), setCookie: true };
}

/** Header Set-Cookie para persistir o visitante ~1 ano no domínio da API. */
export function buildRedirectVisitorSetCookieHeader(visitorKey: string): string {
  const maxAgeSeconds = 365 * 24 * 60 * 60;
  const secure =
    process.env.REDIRECT_COOKIE_SECURE === 'true' ||
    process.env.NODE_ENV === 'production';
  const parts = [
    `${REDIRECT_VISITOR_COOKIE}=${encodeURIComponent(visitorKey)}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
