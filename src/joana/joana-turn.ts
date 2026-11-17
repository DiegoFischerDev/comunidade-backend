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

export type JoanaField = 'name' | 'immigration' | 'cities' | 'typology' | 'pet';

export type JoanaProfile = {
  name: string | null;
  /** `YYYY-MM-DD`, `IMEDIATO` ou null. */
  immigration: string | null;
  cities: string | null;
  typology: JoanaTypology | null;
  hasPet: boolean | null;
};

export type JoanaProposal = {
  interested: boolean | null;
  confirmation: 'yes' | 'no' | null;
  name?: string;
  immigration?: string;
  cities?: string;
  typology?: string;
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
  'cities',
  'typology',
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
    cities: null,
    typology: null,
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
    case 'cities':
      return profile.cities;
    case 'typology':
      return profile.typology;
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
    case 'cities':
      return proposal.cities === undefined ? undefined : normalizeCities(proposal.cities);
    case 'typology': {
      if (proposal.typology === undefined) return undefined;
      if (!proposal.typology.trim()) return '';
      return parseJoanaTypology(proposal.typology) ?? undefined;
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
    case 'pet':
      return `Quer atualizar a informação de pet para ${value === 'true' ? 'sim' : 'não'}?`;
    case 'name':
      return value
        ? `Quer atualizar seu nome para ${value}?`
        : 'Quer deixar o nome em branco?';
  }
}

function ackLine(field: JoanaField, value: string): string {
  switch (field) {
    case 'immigration':
      return value
        ? `Anotei a data para ${formatImmigrationLabel(value)}.`
        : 'Tirei a data prevista de imigração.';
    case 'cities':
      return value ? `Anotei as cidades: ${value}.` : 'Tirei as cidades pretendidas.';
    case 'typology': {
      const speech = JOANA_TYPOLOGY_SPEECH[value as JoanaTypology];
      return speech
        ? `Anotei a tipologia ${value}, ${speech}.`
        : 'Tirei a tipologia.';
    }
    case 'pet':
      return value === 'true' ? 'Anotei que você tem pet.' : 'Anotei que você não tem pet.';
    case 'name':
      return value ? `Anotei seu nome, ${value}.` : 'Tirei o nome.';
  }
}

export function missingFieldQuestion(profile: JoanaProfile): string | null {
  if (!profile.immigration) {
    return 'Para quando você pretende vir para Portugal? Pode ser uma data, por exemplo 18/12/2026, ou dizer que é imediato.';
  }
  if (!profile.cities) {
    return 'Quais cidades você está considerando? Pode ser mais de uma, por exemplo Viseu, Aveiro e São Pedro do Sul.';
  }
  if (!profile.typology) {
    return 'Que imóvel você procura? Quarto é só um quarto. T0 é estúdio. T1 é uma casa com um quarto, T2 com dois, T3 com três, T4 com quatro e T5 com cinco.';
  }
  if (profile.hasPet === null) {
    return 'Você tem animal de estimação?';
  }
  if (!profile.name || /^lead\s+\d+$/i.test(profile.name.trim())) {
    return 'Como posso te chamar?';
  }
  return null;
}

/** Aviso do que foi anotado e, a seguir, uma pergunta para o que ainda falta. */
export function composeJoanaReply(reply: string, append: string[], fallback: string): string {
  const extra = append.map((line) => line.trim()).filter(Boolean);
  const noted = extra.some((line) => isAckLine(line));
  if (noted) {
    const acks = extra.filter((line) => isAckLine(line));
    const rest = extra.filter((line) => !isAckLine(line));
    const question = firstQuestion(withoutHelpPitch(withoutSaveClaims(reply)));
    const restLines = question ? rest.filter((line) => !line.includes('?')) : keepFirstQuestionLine(rest);
    return [...acks, ...restLines, question].filter(Boolean).join('\n\n').slice(0, 4000);
  }

  const systemAsks = extra.some((line) => line.includes('?'));
  const cleaned = withoutSaveClaims(reply);
  const narrative = systemAsks ? dropQuestions(cleaned) : keepFirstQuestion(cleaned);
  const lines = systemAsks ? keepFirstQuestionLine(extra) : extra;
  const intro = narrative || (lines.length ? '' : fallback.trim());
  return [intro, ...lines].filter(Boolean).join('\n\n').slice(0, 4000);
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

function firstQuestion(text: string): string {
  return splitSentences(text).find((sentence) => sentence.endsWith('?')) ?? '';
}

function withoutSaveClaims(text: string): string {
  return splitSentences(text)
    .filter((sentence) => !/^(anotei|tirei)\b/i.test(sentence))
    .join(' ')
    .trim();
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

function keepFirstQuestionLine(lines: string[]): string[] {
  let keptQuestion = false;
  return lines.flatMap((line) => {
    const sentences = splitSentences(line).filter((sentence) => {
      if (!sentence.endsWith('?')) return true;
      if (keptQuestion) return false;
      keptQuestion = true;
      return true;
    });
    const next = sentences.join(' ').trim();
    return next ? [next] : [];
  });
}

function isConcrete(proposal: JoanaProposal): boolean {
  return FIELD_ORDER.some((field) => {
    const value = proposedRaw(proposal, field);
    return value !== undefined && value !== '';
  });
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
    case 'cities':
      profile.cities = value || null;
      patch.cities = value || null;
      return;
    case 'typology':
      profile.typology = (value || null) as JoanaTypology | null;
      patch.typology = profile.typology;
      return;
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
    append.push(ackLine(field, value));
  };

  if (!input.excluded && pending && input.proposal.confirmation === 'yes') {
    const current = currentRaw(profile, pending.field);
    if (!sameText(current, pending.value)) {
      remember(pending.field, pending.value);
    }
    pending = null;
  } else if (pending && input.proposal.confirmation === 'no') {
    append.push('Deixei como estava.');
    pending = null;
  }

  if (!input.excluded) {
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
    !input.hasLead &&
    !input.excluded &&
    (input.proposal.interested === true || isConcrete(input.proposal));

  if (input.hasLead || createLead) {
    const question = missingFieldQuestion(profile);
    if (question) append.push(question);
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
