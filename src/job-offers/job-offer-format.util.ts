import {
  formatAdvertiserContactsLine,
  type JobOfferAdvertiserContact,
} from './job-offer-contacts.util';

/** Mensagem padronizada republicada no grupo WhatsApp de destino. */
export function formatJobOfferWhatsappText(offer: {
  jobFunction: string;
  city: string;
  company?: string | null;
  summary: string;
  advertiserContacts: JobOfferAdvertiserContact[] | unknown;
}): string {
  const lines: string[] = [];
  const fn = offer.jobFunction.trim();
  const city = offer.city.trim();

  if (fn && city) {
    lines.push(`💼 *${fn}* — ${city}`);
  } else if (fn) {
    lines.push(`💼 *${fn}*`);
  } else if (city) {
    lines.push(`📍 *${city}*`);
  } else {
    lines.push('💼 *Oferta de trabalho*');
  }

  const company = (offer.company ?? '').trim();
  if (company) {
    lines.push(`🏢 ${company}`);
  }

  const contacts = Array.isArray(offer.advertiserContacts)
    ? (offer.advertiserContacts as JobOfferAdvertiserContact[])
    : [];
  const candidaturas = formatAdvertiserContactsLine(contacts);
  if (candidaturas) {
    lines.push(candidaturas);
  }

  const summary = (offer.summary ?? '').trim();
  if (summary) {
    if (lines.length) lines.push('');
    lines.push(summary);
  }

  return lines.join('\n').slice(0, 4000);
}
