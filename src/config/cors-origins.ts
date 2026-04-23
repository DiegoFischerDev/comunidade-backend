/**
 * Origens CORS. Preferir `CORS_ORIGINS` (lista separada por vírgulas) em produção com
 * vários frontends. Senão, usa `FRONTEND_URL` e inclui origens de dev (Next em local).
 */
const DEFAULT_DEV_ORIGINS: readonly string[] = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

function mergeWithDevOrigins(base: string[]): string[] {
  const out = [...base];
  for (const o of DEFAULT_DEV_ORIGINS) {
    if (!out.includes(o)) out.push(o);
  }
  return [...new Set(out)];
}

export function getCorsOrigins(): string[] {
  const fromList = process.env.CORS_ORIGINS;
  if (fromList?.trim()) {
    const out = fromList
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return mergeWithDevOrigins(out);
  }
  const fe = (process.env.FRONTEND_URL || 'http://localhost:3000')
    .trim()
    .replace(/\/$/, '');
  return mergeWithDevOrigins([fe]);
}
