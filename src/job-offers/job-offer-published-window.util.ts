import {
  JOB_OFFER_LIST_MAX_AGE_DAYS,
  JOB_OFFER_RETENTION_DAYS,
} from './job-offer-expiry.constants';

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Início do dia civil mais antigo visível na listagem (/ofertas-trabalho). */
export function getJobOfferListPublishedFrom(): Date {
  const from = startOfLocalDay(new Date());
  from.setDate(from.getDate() - JOB_OFFER_LIST_MAX_AGE_DAYS);
  return from;
}

/** Ofertas publicadas antes desta data são apagadas (retenção 15 dias). */
export function getJobOfferRetentionCutoff(): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - JOB_OFFER_RETENTION_DAYS);
  return cutoff;
}

export function isJobOfferWithinRetention(publishedAt: Date): boolean {
  return publishedAt >= getJobOfferRetentionCutoff();
}
