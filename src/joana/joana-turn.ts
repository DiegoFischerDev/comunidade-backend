export const JOANA_TYPOLOGIES = [
  'QUARTO',
  'T0',
  'T1',
  'T2',
  'T3',
  'T4',
  'T5',
] as const;

export type JoanaTypology = (typeof JOANA_TYPOLOGIES)[number];

export type JoanaField = 'name' | 'immigration' | 'visa' | 'cities' | 'typology' | 'rent' | 'pet';

export type JoanaProfile = {
  name: string | null;
  /** `YYYY-MM-DD`, `IMEDIATO` ou null. */
  immigration: string | null;
  hasVisa: boolean | null;
  cities: string | null;
  typology: JoanaTypology | null;
  /** Euros inteiros por mês, ou null se ainda não sabemos. */
  desiredRent: number | null;
  hasPet: boolean | null;
};

export type JoanaProposal = {
  interested: boolean | null;
  confirmation: 'yes' | 'no' | null;
  name?: string;
  immigration?: string;
  cities?: string;
  typology?: string;
  hasVisa?: boolean;
  /** Euros inteiros, ou `''` para apagar. */
  desiredRent?: number | '';
  hasPet?: boolean;
};

export type PendingConfirmation = {
  field: JoanaField;
  value: string;
  question: string;
};

export type JoanaCrmPatch = {
  immigration?: string | null;
  cities?: string | null;
  typology?: JoanaTypology | null;
  hasVisa?: boolean | null;
  desiredRent?: number | null;
  hasPet?: boolean | null;
};

export type JoanaTurnResult = {
  createLead: boolean;
  nameToSave: string | null;
  crmPatch: JoanaCrmPatch | null;
  pending: PendingConfirmation | null;
  append: string[];
};

const FIELD_ORDER: JoanaField[] = [
  'immigration',
  'visa',
  'cities',
  'typology',
  'rent',
  'pet',
  'name',
];

export const JOANA_TYPOLOGY_SPEECH: Record<JoanaTypology, string> = {
  QUARTO: 'um quarto, não a casa toda',
  T0: 'um estúdio, sem quarto separado',
  T1: 'uma casa com um quarto',
  T2: 'uma casa com dois quartos',
  T3: 'uma casa com três quartos',
  T4: 'uma casa com quatro quartos',
  T5: 'uma casa com cinco quartos',
};

export function emptyJoanaProfile(): JoanaProfile {
  return {
    name: null,
    immigration: null,
    hasVisa: null,
    cities: null,
    typology: null,
    desiredRent: null,
    hasPet: null,
  };
}

export function canonicalImmigration(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  if (/^imediato$/i.test(trimmed)) return 'IMEDIATO';
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const br = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!br) return null;
  const day = br[1]!.padStart(2, '0');
  const month = br[2]!.padStart(2, '0');
  return `${br[3]}-${month}-${day}`;
}

export function formatImmigrationLabel(value: string): string {
  if (value === 'IMEDIATO') return 'o mais breve possível';
  if (!value) return 'em branco';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function normalizeCities(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function normalizePersonName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * Valor mensal do aluguel, em euros inteiros (0 a 100000).
 * `''` apaga. `undefined` quer dizer que a pessoa não falou disso.
 */
export function parseDesiredRent(raw: unknown): number | '' | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return undefined;
    const rounded = Math.round(raw);
    if (rounded < 0 || rounded > 100_000) return undefined;
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
  if (!Number.isInteger(value) || value < 0 || value > 100_000) return undefined;
  return value;
}

export function parseJoanaTypology(raw: string | null | undefined): JoanaTypology | null {
  const value = (raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (value === 'QUARTO' || value === 'APENASQUARTO') return 'QUARTO';
  if ((JOANA_TYPOLOGIES as readonly string[]).includes(value)) {
    return value as JoanaTypology;
  }
  return null;
}

function sameText(left: string | null, right: string): boolean {
  return (left ?? '').trim().toLowerCase() === right.trim().toLowerCase();
}

function currentRaw(profile: JoanaProfile, field: JoanaField): string | null {
  switch (field) {
    case 'name':
      return profile.name;
    case 'immigration':
      return profile.immigration;
    case 'visa':
      if (profile.hasVisa === null) return null;
      return profile.hasVisa ? 'true' : 'false';
    case 'cities':
      return profile.cities;
    case 'typology':
      return profile.typology;
    case 'rent':
      return profile.desiredRent == null ? null : String(profile.desiredRent);
    case 'pet':
      if (profile.hasPet === null) return null;
      return profile.hasPet ? 'true' : 'false';
  }
}

function proposedRaw(proposal: JoanaProposal, field: JoanaField): string | undefined {
  switch (field) {
    case 'name':
      return proposal.name === undefined ? undefined : normalizePersonName(proposal.name);
    case 'immigration':
      if (proposal.immigration === undefined) return undefined;
      const canonical = canonicalImmigration(proposal.immigration);
      return canonical === null ? undefined : canonical;
    case 'visa':
      if (proposal.hasVisa === undefined) return undefined;
      return proposal.hasVisa ? 'true' : 'false';
    case 'cities':
      return proposal.cities === undefined ? undefined : normalizeCities(proposal.cities);
    case 'typology': {
      if (proposal.typology === undefined) return undefined;
      if (!proposal.typology.trim()) return '';
      return parseJoanaTypology(proposal.typology) ?? undefined;
    }
    case 'rent': {
      if (proposal.desiredRent === undefined) return undefined;
      if (proposal.desiredRent === '') return '';
      return String(proposal.desiredRent);
    }
    case 'pet':
      if (proposal.hasPet === undefined) return undefined;
      return proposal.hasPet ? 'true' : 'false';
  }
}

export function confirmationQuestion(field: JoanaField, value: string): string {
  switch (field) {
    case 'immigration':
      return `Quer atualizar sua data prevista de imigração para ${formatImmigrationLabel(value)}?`;
    case 'visa':
      return `Quer atualizar a informação de visto para ${value === 'true' ? 'sim' : 'não'}?`;
    case 'cities':
      return value
        ? `Quer atualizar as cidades pretendidas para ${value}?`
        : 'Quer deixar as cidades pretendidas em branco?';
    case 'typology': {
      const speech = JOANA_TYPOLOGY_SPEECH[value as JoanaTypology];
      return speech
        ? `Quer atualizar a tipologia para ${value}, ${speech}?`
        : 'Quer deixar a tipologia em branco?';
    }
    case 'rent':
      return value
        ? `Quer atualizar o valor do aluguel pretendido para €${value}?`
        : 'Quer deixar o valor do aluguel pretendido em branco?';
    case 'pet':
      return `Quer atualizar a informação de pet para ${value === 'true' ? 'sim' : 'não'}?`;
    case 'name':
      return value
        ? `Quer atualizar seu nome para ${value}?`
        : 'Quer deixar o nome em branco?';
  }
}

/** Apresentação usada quando ainda não há ficha e a Joana ainda não se apresentou. */
export const JOANA_INTRO =
  'Oi, eu sou a Joana, atendente virtual da Rafa. O relocation é uma assessoria para alugar ou comprar imóvel em Portugal. A Rafa ajuda na busca do imóvel, nas visitas por videochamada, na análise dos documentos e na negociação com os proprietários.';

export const JOANA_INTEREST_QUESTION = 'Você tem interesse nesse serviço?';

/** Garante a apresentação quando o modelo não se apresentou. */
export function ensureJoanaIntro(reply: string, needsIntro: boolean): string {
  const text = reply.trim();
  if (!needsIntro || /joana/i.test(text)) return text;
  return text ? `${JOANA_INTRO}\n\n${text}` : JOANA_INTRO;
}

export function missingFieldQuestion(profile: JoanaProfile): string | null {
  if (!profile.immigration) {
    return 'Para quando você pretende vir para Portugal? Pode ser uma data, por exemplo 18/12/2026, ou dizer que é imediato.';
  }
  if (profile.hasVisa === null) {
    return 'Você já tem visto para Portugal?';
  }
  if (!profile.cities) {
    return 'Quais cidades você está considerando? Pode ser mais de uma, por exemplo Viseu, Aveiro e São Pedro do Sul.';
  }
  if (!profile.typology) {
    return 'Que imóvel você procura? Quarto é só um quarto. T0 é estúdio. T1 é uma casa com um quarto, T2 com dois, T3 com três, T4 com quatro e T5 com cinco.';
  }
  if (profile.desiredRent == null) {
    return 'Qual o valor do aluguel pretendido por mês? Pode ser um valor aproximado, em euros.';
  }
  if (profile.hasPet === null) {
    return 'Você tem animal de estimação?';
  }
  if (!profile.name || /^lead\s+\d+$/i.test(profile.name.trim())) {
    return 'Como posso te chamar?';
  }
  return null;
}

/**
 * A fala da Joana fica como ela escreveu. Uma frase que comente a gravação sai.
 * A pergunta do sistema só entra se ela própria não tiver perguntado nada.
 */
export function composeJoanaReply(
  reply: string,
  append: string[],
  fallback: string,
  saved = false,
): string {
  const cleaned = saved
    ? withoutHelpPitch(withoutSaveClaims(reply))
    : withoutSaveClaims(reply);
  const extras = append
    .map((line) => line.trim())
    .filter((line) => line && !isAckLine(line));
  const guidance = extras.filter((line) => !line.includes('?'));
  const systemQuestion = extras.find((line) => line.includes('?')) ?? '';

  if (hasQuestion(cleaned)) {
    return [keepFirstQuestion(cleaned), ...guidance].filter(Boolean).join('\n\n').slice(0, 4000);
  }

  const narrative = dropQuestions(cleaned);
  const intro = narrative || (systemQuestion || guidance.length ? '' : fallback.trim());
  return [intro, ...guidance, systemQuestion].filter(Boolean).join('\n\n').slice(0, 4000);
}

function isAckLine(line: string): boolean {
  return /^(anotei|tirei|deixei como estava)/i.test(line);
}

function withoutHelpPitch(text: string): string {
  return splitSentences(text)
    .filter((sentence) => !/pode ajudar|vamos considerar|vou atualizar/i.test(sentence))
    .join(' ')
    .trim();
}

function withoutSaveClaims(text: string): string {
  return splitSentences(text)
    .filter((sentence) => !isSaveClaim(sentence))
    .join(' ')
    .trim();
}

function isSaveClaim(sentence: string): boolean {
  return /\b(anotei|tirei|registrei|salvei|guardei)\b/i.test(sentence)
    || /\bdeixei como estava\b/i.test(sentence);
}

function hasQuestion(text: string): boolean {
  return splitSentences(text).some((sentence) => sentence.endsWith('?'));
}

function splitSentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function dropQuestions(text: string): string {
  return splitSentences(text)
    .filter((sentence) => !sentence.endsWith('?'))
    .join(' ')
    .trim();
}

function keepFirstQuestion(text: string): string {
  let keptQuestion = false;
  return splitSentences(text)
    .filter((sentence) => {
      if (!sentence.endsWith('?')) return true;
      if (keptQuestion) return false;
      keptQuestion = true;
      return true;
    })
    .join(' ')
    .trim();
}

function applyValue(profile: JoanaProfile, patch: JoanaCrmPatch, field: JoanaField, value: string) {
  switch (field) {
    case 'name':
      profile.name = value || null;
      return;
    case 'immigration':
      profile.immigration = value || null;
      patch.immigration = value || null;
      return;
    case 'visa':
      profile.hasVisa = value === 'true';
      patch.hasVisa = profile.hasVisa;
      return;
    case 'cities':
      profile.cities = value || null;
      patch.cities = value || null;
      return;
    case 'typology':
      profile.typology = (value || null) as JoanaTypology | null;
      patch.typology = profile.typology;
      return;
    case 'rent': {
      const rent = value === '' ? null : Number(value);
      profile.desiredRent = Number.isInteger(rent) ? rent : null;
      patch.desiredRent = profile.desiredRent;
      return;
    }
    case 'pet':
      profile.hasPet = value === 'true';
      patch.hasPet = profile.hasPet;
  }
}

/**
 * Decide o que gravar, o que pedir para confirmar e o que acrescentar à resposta.
 * O modelo não grava: só propõe.
 */
export function applyJoanaProposal(input: {
  hasLead: boolean;
  excluded: boolean;
  profile: JoanaProfile;
  pending: PendingConfirmation | null;
  proposal: JoanaProposal;
}): JoanaTurnResult {
  const profile: JoanaProfile = { ...input.profile };
  const patch: JoanaCrmPatch = {};
  const append: string[] = [];
  let nameToSave: string | null = null;
  let pending = input.pending;

  const remember = (field: JoanaField, value: string) => {
    if (field === 'name') {
      profile.name = value || null;
      nameToSave = value || null;
    } else {
      applyValue(profile, patch, field, value);
    }
  };

  const canCollect =
    !input.excluded && (input.hasLead || input.proposal.interested === true);

  if (canCollect && pending && input.proposal.confirmation === 'yes') {
    const current = currentRaw(profile, pending.field);
    if (!sameText(current, pending.value)) {
      remember(pending.field, pending.value);
    }
    pending = null;
  } else if (pending && input.proposal.confirmation === 'no') {
    pending = null;
  }

  if (canCollect) {
    for (const field of FIELD_ORDER) {
      const proposed = proposedRaw(input.proposal, field);
      if (proposed === undefined) continue;
      if (field === 'name' && proposed.length > 0 && proposed.length < 2) continue;
      const current = currentRaw(profile, field);
      if (sameText(current, proposed)) continue;
      const empty = current === null || current === '';
      const clearing = proposed === '';
      if (empty && clearing) continue;
      remember(field, proposed);
    }
  }

  if (!input.proposal.confirmation) pending = null;

  const createLead =
    !input.hasLead && !input.excluded && input.proposal.interested === true;

  if (input.hasLead || createLead) {
    const question = missingFieldQuestion(profile);
    if (question) append.push(question);
  } else if (!input.hasLead && !input.excluded && input.proposal.interested !== false) {
    append.push(JOANA_INTEREST_QUESTION);
  }

  const hasPatch = Object.keys(patch).length > 0;

  return {
    createLead,
    nameToSave,
    crmPatch: hasPatch ? patch : null,
    pending,
    append,
  };
}
