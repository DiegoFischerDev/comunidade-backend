import { JobOfferRegion } from '@prisma/client';

export { JobOfferRegion };

export const JOB_OFFER_REGION_LABELS: Record<JobOfferRegion, string> = {
  NORTE: 'Norte',
  CENTRO: 'Centro',
  SUL: 'Sul',
};

/**
 * Palavras-chave normalizadas (sem acentos, minúsculas).
 * Correspondência pelo termo mais longo que encaixe na cidade.
 */
const REGION_KEYWORDS: Record<JobOfferRegion, readonly string[]> = {
  NORTE: [
    'viana do castelo',
    'ponte de lima',
    'ponte da barca',
    'valenca',
    'valença',
    'caminha',
    'moncao',
    'monção',
    'vila nova de cerveira',
    'braga',
    'guimaraes',
    'guimarães',
    'famalicao',
    'famalicão',
    'barcelos',
    'espinho',
    'esposende',
    'fafe',
    'vila verde',
    'amares',
    'terras de bouro',
    'porto',
    'matosinhos',
    'maia',
    'vila nova de gaia',
    'gondomar',
    'valongo',
    'paredes',
    'penafiel',
    'lousada',
    'felgueiras',
    'marco de canaveses',
    'marco de canavezes',
    'amarante',
    'trofa',
    'santo tirso',
    'povoa de varzim',
    'póvoa de varzim',
    'vila do conde',
    'vila real',
    'chaves',
    'montalegre',
    'ribeira de pena',
    'sabrosa',
    'alijo',
    'alijó',
    'murça',
    'braganca',
    'bragança',
    'mirandela',
    'mogadouro',
  ],
  CENTRO: [
    'viseu',
    'guarda',
    'castelo branco',
    'coimbra',
    'leiria',
    'figueira da foz',
    'cantanhede',
    'serta',
    'fundao',
    'fundão',
    'covilha',
    'covilhã',
    'penela',
    'penacova',
    'mira',
    'arganil',
    'oliveira do hospital',
    'tondela',
    'mangualde',
    'satao',
    'sátão',
    'aveiro',
    'oliveira de azemeis',
    'oliveira de azeméis',
    'sao joao da madeira',
    'são joão da madeira',
    'ilhavo',
    'ílhavo',
    'agueda',
    'águeda',
    'estarreja',
    'anadia',
    'mealhada',
    'castelo de paiva',
  ],
  SUL: [
    'lisboa',
    'sintra',
    'cascais',
    'oeiras',
    'amadora',
    'loures',
    'odivelas',
    'mafra',
    'torres vedras',
    'alenquer',
    'azambuja',
    'cartaxo',
    'santarem',
    'santarém',
    'setubal',
    'setúbal',
    'almada',
    'seixal',
    'barreiro',
    'moita',
    'montijo',
    'alcochete',
    'palmela',
    'sesimbra',
    'vila franca de xira',
    'evora',
    'évora',
    'beja',
    'portalegre',
    'sines',
    'elvas',
    'estremoz',
    'montemor-o-novo',
    'santiago do cacem',
    'santiago do cacém',
    'alcacer do sal',
    'alcácer do sal',
    'faro',
    'albufeira',
    'lagos',
    'portimao',
    'portimão',
    'tavira',
    'loulé',
    'loule',
    'silves',
    'algarve',
    'vila real de santo antonio',
    'vila real de santo antónio',
    'olhao',
    'olhão',
    'acores',
    'açores',
    'ponta delgada',
    'angra do heroismo',
    'angra do heroísmo',
    'horta',
    'ribeira grande',
    'madeira',
    'funchal',
    'machico',
    'camara de lobos',
    'câmara de lobos',
  ],
};

export function normalizeCityForRegion(city: string): string {
  return city
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ');
}

function cityMatchesKeyword(cityNorm: string, keyword: string): boolean {
  if (!cityNorm || !keyword) return false;
  if (cityNorm === keyword) return true;
  if (cityNorm.startsWith(`${keyword} `)) return true;
  if (cityNorm.endsWith(` ${keyword}`)) return true;
  if (cityNorm.includes(` ${keyword} `)) return true;
  return false;
}

/** Infere NORTE, CENTRO ou SUL a partir da cidade (predefinição: SUL se vazio ou desconhecido). */
export function resolveJobOfferRegionFromCity(city: string): JobOfferRegion {
  const cityNorm = normalizeCityForRegion(city);
  if (!cityNorm) return 'SUL';

  let best: { region: JobOfferRegion; len: number } | null = null;

  for (const region of Object.values(JobOfferRegion)) {
    for (const keyword of REGION_KEYWORDS[region]) {
      if (!cityMatchesKeyword(cityNorm, keyword)) continue;
      if (!best || keyword.length > best.len) {
        best = { region, len: keyword.length };
      }
    }
  }

  return best?.region ?? 'SUL';
}

