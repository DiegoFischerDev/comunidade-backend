/** Janela (dias) para comparar ofertas já publicadas no site. */
export const JOB_OFFER_DUPLICATE_LOOKBACK_DAYS_DEFAULT = 3;

export type JobOfferDuplicateCompareInput = {
  title: string;
  jobFunction: string;
  city: string;
  company: string;
  summary: string;
  description: string;
};

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Empresa sem sufixos legais comuns para comparação mais estável. */
export function normalizeJobOfferCompany(company: string): string {
  let n = normalizeText(company);
  n = n
    .replace(
      /\b(unipessoal|limitada|sociedade|anonima|anónima|lda|ltd|inc|corp|s\s*a|s\.a\.?)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  return n;
}

function wordTokens(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .split(' ')
      .filter((w) => w.length > 1),
  );
}

/** Similaridade Jaccard entre conjuntos de palavras (0–1). */
export function wordJaccardSimilarity(a: string, b: string): number {
  const ta = wordTokens(a);
  const tb = wordTokens(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) {
    if (tb.has(w)) inter += 1;
  }
  const union = new Set([...ta, ...tb]).size;
  return inter / union;
}

export function citiesMatchForDuplicate(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) {
    return true;
  }
  return false;
}

export function companiesMatchForDuplicate(a: string, b: string): boolean {
  const na = normalizeJobOfferCompany(a);
  const nb = normalizeJobOfferCompany(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) {
    return true;
  }
  return wordJaccardSimilarity(na, nb) >= 0.85;
}

/**
 * Verdadeiro se `candidate` for essencialmente a mesma vaga que `existing`
 * (mesma empresa + local + função/descrição muito parecidas).
 */
export function isNearDuplicateJobOffer(
  candidate: JobOfferDuplicateCompareInput,
  existing: JobOfferDuplicateCompareInput,
): boolean {
  if (!citiesMatchForDuplicate(candidate.city, existing.city)) return false;

  const companyMatch = companiesMatchForDuplicate(
    candidate.company,
    existing.company,
  );
  const jobSim = wordJaccardSimilarity(
    candidate.jobFunction,
    existing.jobFunction,
  );
  const titleSim = wordJaccardSimilarity(candidate.title, existing.title);
  const summarySim = wordJaccardSimilarity(candidate.summary, existing.summary);
  const descSim = wordJaccardSimilarity(
    candidate.description.slice(0, 600),
    existing.description.slice(0, 600),
  );

  if (!companyMatch) {
    // Sem empresa alinhada: só ignorar se título, função e descrição forem quase iguais.
    return titleSim >= 0.88 && jobSim >= 0.88 && descSim >= 0.72;
  }

  if (jobSim >= 0.72) return true;
  if (titleSim >= 0.78 && descSim >= 0.55) return true;
  if (titleSim >= 0.62 && descSim >= 0.72) return true;

  const blended =
    0.35 * jobSim + 0.2 * titleSim + 0.1 * summarySim + 0.35 * descSim;
  return blended >= 0.62;
}

export function jobOfferDuplicateLookbackDays(): number {
  const raw = process.env.JOB_OFFER_DUPLICATE_LOOKBACK_DAYS?.trim();
  if (raw && /^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    if (n >= 1 && n <= 30) return n;
  }
  return JOB_OFFER_DUPLICATE_LOOKBACK_DAYS_DEFAULT;
}

export function jobOfferDuplicateCheckEnabled(): boolean {
  const raw = process.env.JOB_OFFER_DUPLICATE_CHECK?.trim();
  return raw !== '0' && raw?.toLowerCase() !== 'false';
}
