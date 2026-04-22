/**
 * Origens CORS. Preferir `CORS_ORIGINS` (lista separada por vírgulas) em produção com
 * vários frontends. Senão, usa `FRONTEND_URL` e inclui `http://localhost:3000` para dev.
 */
export function getCorsOrigins(): string[] {
  const fromList = process.env.CORS_ORIGINS;
  if (fromList?.trim()) {
    const out = fromList
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!out.includes('http://localhost:3000')) {
      out.push('http://localhost:3000');
    }
    return [...new Set(out)];
  }
  const fe = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(
    /\/$/,
    '',
  );
  return [
    ...new Set([fe, 'http://localhost:3000']),
  ];
}
