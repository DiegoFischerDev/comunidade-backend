export type GabiProfile = {
  companyName: string | null;
  /** null = ainda não sabemos; "" = sem Instagram; valor = handle com @ */
  instagramHandle: string | null;
};

export type GabiProposal = {
  companyName?: string;
  /** handle com ou sem @; "" se disse que não tem / não aplicável */
  instagramHandle?: string;
};

export type GabiField = 'companyName' | 'instagramHandle';

export function emptyGabiProfile(): GabiProfile {
  return { companyName: null, instagramHandle: null };
}

export function normalizeCompanyName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 2) return undefined;
  return name.slice(0, 160);
}

/** Normaliza @instagram. "" = sem Instagram. */
export function normalizeInstagramHandle(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const lower = trimmed.toLowerCase();
  if (
    /^(nao|não|n\/a|na|sem|nenhum|nao tenho|não tenho|nao aplicavel|não aplicável|nao se aplica|não se aplica)/i.test(
      lower,
    )
  ) {
    return '';
  }

  let handle = trimmed.replace(/^@+/, '').replace(/\s+/g, '');
  handle = handle.replace(/[^a-zA-Z0-9._]/g, '');
  if (handle.length < 2) return undefined;
  return `@${handle.slice(0, 119)}`;
}

export function applyGabiProposal(
  profile: GabiProfile,
  proposal: GabiProposal,
): GabiProfile {
  const next = { ...profile };
  if (proposal.companyName !== undefined) {
    const name = normalizeCompanyName(proposal.companyName);
    if (name !== undefined) next.companyName = name;
  }
  if (proposal.instagramHandle !== undefined) {
    const handle = normalizeInstagramHandle(proposal.instagramHandle);
    if (handle !== undefined) next.instagramHandle = handle;
  }
  return next;
}

export function nextGabiMissingField(profile: GabiProfile): GabiField | null {
  if (!profile.companyName?.trim()) return 'companyName';
  if (profile.instagramHandle === null) return 'instagramHandle';
  return null;
}

export function gabiMissingFieldQuestion(field: GabiField): string {
  if (field === 'companyName') {
    return 'Qual é o nome da empresa?';
  }
  return 'A empresa tem Instagram? Se sim, manda o @. Se não tiver, diz que não.';
}

export function gabiProfileSummary(profile: GabiProfile): string {
  const company = profile.companyName?.trim() || 'ainda não temos';
  let ig = 'ainda não sabemos';
  if (profile.instagramHandle === '') ig = 'sem Instagram / não aplicável';
  else if (profile.instagramHandle) ig = profile.instagramHandle;
  return `Empresa: ${company}. Instagram: ${ig}. Próximo a perguntar: ${
    nextGabiMissingField(profile) ?? 'nenhum'
  }.`;
}

/**
 * Resposta final: reação da Gabi + (se faltar) uma pergunta de qualificação.
 * Não comenta que gravou dados.
 */
export function composeGabiReply(
  modelReply: string,
  profileAfter: GabiProfile,
): string {
  const base = modelReply.trim();
  const missing = nextGabiMissingField(profileAfter);
  if (!missing) return base || 'Perfeito, obrigada! A Rafa ou a equipa segue daqui.';

  const question = gabiMissingFieldQuestion(missing);
  if (!base) return question;
  if (base.includes(question) || /nome da empresa|instagram|\@/i.test(base)) {
    return base;
  }
  return `${base}\n\n${question}`;
}

export function parseGabiModelJson(content: string): {
  reply: string;
  proposal: GabiProposal;
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
  const proposal: GabiProposal = {};
  if ('companyName' in parsed) {
    const name = normalizeCompanyName(parsed.companyName);
    if (name !== undefined) proposal.companyName = name;
  }
  if ('instagramHandle' in parsed) {
    const handle = normalizeInstagramHandle(parsed.instagramHandle);
    if (handle !== undefined) proposal.instagramHandle = handle;
  }
  return { reply, proposal };
}
