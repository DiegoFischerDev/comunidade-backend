import { getFrontendBaseUrl } from '../config/frontend-base-url';

/** URL curta sem protocolo (ex.: comunidade.rafaportugal.com/ofertas-trabalho/12). */
export function formatJobOfferDetailsUrl(publicNumber: number): string {
  const host = getFrontendBaseUrl()
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '');
  return `${host}/ofertas-trabalho/${publicNumber}`;
}
