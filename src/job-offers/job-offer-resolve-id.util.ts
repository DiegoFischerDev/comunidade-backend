/** Parâmetro de rota: número público (12) ou id interno legado (cuid). */
export function parseJobOfferRouteId(param: string): {
  kind: 'publicNumber' | 'internalId';
  value: string;
} {
  const trimmed = param.trim();
  if (/^\d{1,9}$/.test(trimmed)) {
    return { kind: 'publicNumber', value: trimmed };
  }
  return { kind: 'internalId', value: trimmed };
}
