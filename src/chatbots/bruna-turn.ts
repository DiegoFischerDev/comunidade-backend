import { RafaCallCrmPropertyTypology } from '@prisma/client';
import {
  formatJoanaTypologiesKey,
  normalizeCities,
  parseJoanaTypologies,
  parseJoanaTypology,
  type JoanaTypology,
} from '../joana/joana-turn';

export type BrunaTypology = JoanaTypology;

export type BrunaProfile = {
  /** Euros inteiros do imóvel pretendido. */
  desiredHouseValue: number | null;
  preferredCities: string | null;
  /** Uma ou várias tipologias. Vazio = ainda não sabemos. */
  propertyTypology: BrunaTypology[];
};

export type BrunaProposal = {
  desiredHouseValue?: number | '';
  preferredCities?: string;
  propertyTypology?: string;
};

export type BrunaField =
  | 'desiredHouseValue'
  | 'preferredCities'
  | 'propertyTypology';

const BRUNA_TYPOLOGIES = [
  'QUARTO',
  'T0',
  'T1',
  'T2',
  'T3',
  'T4',
  'T5',
] as const satisfies readonly RafaCallCrmPropertyTypology[];

/** Valor da casa em euros (0 a 5M). `''` apaga. */
export function parseDesiredHouseValue(raw: unknown): number | '' | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return undefined;
    const rounded = Math.round(raw);
    if (rounded < 0 || rounded > 5_000_000) return undefined;
    return rounded;
  }
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const withoutCurrency = trimmed
    .toLowerCase()
    .replace(/euros?|eur|€/g, '')
    .replace(/\s+/g, '');
  const withoutThousands = withoutCurrency
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(/,(?=\d{3}(?:\D|$))/g, '');
  const whole = withoutThousands.replace(/[.,].*$/, '').replace(/[^\d]/g, '');
  if (!whole) return undefined;
  const value = Number(whole);
  if (!Number.isInteger(value) || value < 0 || value > 5_000_000) {
    return undefined;
  }
  return value;
}

export function parseBrunaTypology(
  raw: string | null | undefined,
): BrunaTypology | null {
  return parseJoanaTypology(raw);
}

export function parseBrunaTypologies(
  raw: string | null | undefined,
): BrunaTypology[] {
  return parseJoanaTypologies(raw);
}

export function normalizePreferredCities(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cities = normalizeCities(raw);
  if (cities.length < 2) return undefined;
  return cities;
}

export function emptyBrunaProfile(): BrunaProfile {
  return {
    desiredHouseValue: null,
    preferredCities: null,
    propertyTypology: [],
  };
}

export function applyBrunaProposal(
  profile: BrunaProfile,
  proposal: BrunaProposal,
): BrunaProfile {
  const next = { ...profile };
  if (proposal.desiredHouseValue !== undefined) {
    if (proposal.desiredHouseValue === '') {
      next.desiredHouseValue = null;
    } else {
      const value = parseDesiredHouseValue(proposal.desiredHouseValue);
      if (typeof value === 'number') next.desiredHouseValue = value;
    }
  }
  if (proposal.preferredCities !== undefined) {
    const cities = normalizePreferredCities(proposal.preferredCities);
    if (cities !== undefined) next.preferredCities = cities;
  }
  if (proposal.propertyTypology !== undefined) {
    if (!proposal.propertyTypology.trim()) {
      next.propertyTypology = [];
    } else {
      const typologies = parseBrunaTypologies(proposal.propertyTypology);
      if (typologies.length > 0) next.propertyTypology = typologies;
    }
  }
  return next;
}

export function nextBrunaMissingField(profile: BrunaProfile): BrunaField | null {
  if (profile.desiredHouseValue == null) return 'desiredHouseValue';
  if (!profile.preferredCities?.trim()) return 'preferredCities';
  if (profile.propertyTypology.length === 0) return 'propertyTypology';
  return null;
}

export function brunaMissingFieldQuestion(field: BrunaField): string {
  if (field === 'desiredHouseValue') {
    return 'Qual o valor da casa que você pretende comprar? Pode ser um valor aproximado, em euros.';
  }
  if (field === 'preferredCities') {
    return 'Em que cidade ou cidades de Portugal você gostaria de comprar?';
  }
  return 'Que tipologia procura? Pode ser mais de uma, por exemplo T2 ou T3. T0 é estúdio, T1 tem um quarto, T2 dois, T3 três, e assim por diante.';
}

export function formatHouseValueLabel(value: number): string {
  return `€${value.toLocaleString('pt-PT')}`;
}

export function brunaProfileSummary(profile: BrunaProfile): string {
  const house =
    profile.desiredHouseValue == null
      ? 'ainda não sabemos'
      : formatHouseValueLabel(profile.desiredHouseValue);
  const cities = profile.preferredCities?.trim() || 'ainda não sabemos';
  const typology =
    profile.propertyTypology.length > 0
      ? formatJoanaTypologiesKey(profile.propertyTypology)
      : 'ainda não sabemos';
  return `Valor da casa: ${house}. Cidades: ${cities}. Tipologia: ${typology}. Próximo a perguntar: ${
    nextBrunaMissingField(profile) ?? 'nenhum'
  }.`;
}

/**
 * Resposta final: reação da Bruna + (se faltar) uma pergunta de qualificação.
 */
export function composeBrunaReply(
  modelReply: string,
  profileAfter: BrunaProfile,
): string {
  const base = modelReply.trim();
  const missing = nextBrunaMissingField(profileAfter);
  if (!missing) {
    return (
      base ||
      'Perfeito, obrigada! A Rafa ou a equipa segue daqui com o crédito.'
    );
  }

  const question = brunaMissingFieldQuestion(missing);
  if (!base) return question;
  if (
    base.includes(question) ||
    /valor da casa|cidade|cidades|tipologia|T[0-5]|estúdio|estudio/i.test(base)
  ) {
    return base;
  }
  return `${base}\n\n${question}`;
}

export function parseBrunaModelJson(content: string): {
  reply: string;
  proposal: BrunaProposal;
} {
  const trimmed = content.trim();
  let parsed: Record<string, unknown> = {};
  try {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    const jsonText =
      start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return { reply: trimmed.slice(0, 4000), proposal: {} };
  }

  const reply =
    typeof parsed.reply === 'string' ? parsed.reply.trim().slice(0, 4000) : '';
  const proposal: BrunaProposal = {};

  if ('desiredHouseValue' in parsed) {
    const value = parseDesiredHouseValue(parsed.desiredHouseValue);
    if (value !== undefined) proposal.desiredHouseValue = value;
  }
  if ('preferredCities' in parsed) {
    const cities = normalizePreferredCities(parsed.preferredCities);
    if (cities !== undefined) proposal.preferredCities = cities;
  }
  if ('propertyTypology' in parsed) {
    if (
      typeof parsed.propertyTypology === 'string' &&
      !parsed.propertyTypology.trim()
    ) {
      proposal.propertyTypology = '';
    } else if (typeof parsed.propertyTypology === 'string') {
      const typologies = parseBrunaTypologies(parsed.propertyTypology);
      if (typologies.length > 0) {
        proposal.propertyTypology = formatJoanaTypologiesKey(typologies);
      }
    }
  }

  return { reply, proposal };
}

export function isBrunaTypology(
  value: string,
): value is RafaCallCrmPropertyTypology {
  return (BRUNA_TYPOLOGIES as readonly string[]).includes(value);
}
