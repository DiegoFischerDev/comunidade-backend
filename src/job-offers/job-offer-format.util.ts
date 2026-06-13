import {
  filterAdvertiserContactsForWhatsappShare,
  formatAdvertiserContactsLine,
  stripUrlsForWhatsappJobShare,
  type JobOfferAdvertiserContact,
} from './job-offer-contacts.util';
import { formatJobOfferDetailsUrl } from './job-offer-public-url.util';

/** Mensagem padronizada republicada no grupo WhatsApp de destino. */
export function formatJobOfferWhatsappText(offer: {
  publicNumber: number;
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

  const contacts = filterAdvertiserContactsForWhatsappShare(
    Array.isArray(offer.advertiserContacts)
      ? (offer.advertiserContacts as JobOfferAdvertiserContact[])
      : [],
  );
  const candidaturas = formatAdvertiserContactsLine(contacts);
  if (candidaturas) {
    lines.push(candidaturas);
  }

  const detailsLine = `Mais detalhes: ${formatJobOfferDetailsUrl(offer.publicNumber)}`;
  const footer = `\n\n${detailsLine}`;
  const header = lines.join('\n');
  let summary = stripUrlsForWhatsappJobShare(offer.summary ?? '');
  const headerBlock = header.length ? `${header}\n\n` : '';
  const maxSummaryLen = 4000 - headerBlock.length - footer.length;
  if (summary && summary.length > maxSummaryLen && maxSummaryLen > 80) {
    summary = `${summary.slice(0, maxSummaryLen - 1).trimEnd()}…`;
  }

  const parts: string[] = [];
  if (header) parts.push(header);
  if (summary) parts.push(summary);
  parts.push(detailsLine);
  return parts.join('\n\n').slice(0, 4000);
}
