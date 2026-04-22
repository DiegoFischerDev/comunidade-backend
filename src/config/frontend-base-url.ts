/**
 * URL base do frontend (Next) — definir `FRONTEND_URL` no `.env` (ex. https://comunidade.…)
 * Obrigatório quando `NODE_ENV=production`.
 */
export function getFrontendBaseUrl(): string {
  const raw = process.env.FRONTEND_URL?.replace(/\/$/, '');
  if (raw) {
    return raw;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'FRONTEND_URL is required in production (ex. https://comunidade.exemplo.com)',
    );
  }
  return 'http://localhost:3000';
}
