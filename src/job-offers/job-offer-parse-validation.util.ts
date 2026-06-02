import type { JobOfferExtraction } from '../listing-ai/house-listing-openai.service';
import {
  extractAdvertiserContactsFromText,
  hasAdvertiserContact,
  mergeAdvertiserContacts,
  type JobOfferAdvertiserContact,
} from './job-offer-contacts.util';

const PLACEHOLDER_CITIES = new Set([
  '',
  '—',
  '-',
  'n/a',
  'na',
  'n/d',
  'nd',
  'desconhecido',
  'desconhecida',
  'nao especificado',
  'não especificado',
  'sem local',
  'sem cidade',
  'indefinido',
  'indefinida',
]);

/** Cidade/local válida para publicar a oferta (inclui "Remoto"). */
export function isMeaningfulJobOfferCity(city: string): boolean {
  const norm = city
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (!norm) return false;
  if (PLACEHOLDER_CITIES.has(norm)) return false;
  if (norm.length < 2) return false;
  return true;
}

export type JobOfferParseValidation =
  | {
      ok: true;
      offer: JobOfferExtraction;
      advertiserContacts: JobOfferAdvertiserContact[];
      city: string;
    }
  | { ok: false; reason: 'not_offer' | 'no_city' | 'no_contact' | 'invalid_date' };

export function validateParsedJobOffer(
  parsed: {
    isJobOffer: boolean;
    offer: JobOfferExtraction | null;
  },
  textForContacts: string,
): JobOfferParseValidation {
  if (!parsed.isJobOffer || !parsed.offer) {
    return { ok: false, reason: 'not_offer' };
  }

  const extracted = parsed.offer;
  const city = extracted.city.trim();
  if (!isMeaningfulJobOfferCity(city)) {
    return { ok: false, reason: 'no_city' };
  }

  const advertiserContacts = mergeAdvertiserContacts(
    extracted.advertiserContacts,
    extractAdvertiserContactsFromText(textForContacts),
    extractAdvertiserContactsFromText(extracted.description),
  );

  if (!hasAdvertiserContact(textForContacts, advertiserContacts)) {
    return { ok: false, reason: 'no_contact' };
  }

  const publishedAt = new Date(`${extracted.publishedAt}T12:00:00.000Z`);
  if (Number.isNaN(publishedAt.getTime())) {
    return { ok: false, reason: 'invalid_date' };
  }

  return {
    ok: true,
    offer: extracted,
    advertiserContacts,
    city,
  };
}
