import { Injectable } from '@nestjs/common';
import { decodeWhatsappAudio, whatsappAudioFileName } from './joana-audio';
import { JOANA_DEFAULT_CONTEXT } from './joana-context';
import {
  JOANA_TYPOLOGIES,
  type JoanaProposal,
  type JoanaTypology,
  canonicalImmigration,
  parseDesiredRent,
  parseJoanaTypology,
} from './joana-turn';

@Injectable()
export class JoanaOpenAiService {
  private get apiKey(): string {
    return (process.env.OPENAI_API_KEY || '').trim();
  }

  private get model(): string {
    return (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  }

  private get transcribeModel(): string {
    return (process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe').trim();
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /** Transcreve uma nota de voz do WhatsApp. Devolve texto vazio se não houver fala. */
  async transcribeAudio(input: {
    base64: string;
    mimeType?: string;
    fileName?: string;
  }): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('OPENAI_API_KEY não está configurada.');
    }
    const decoded = decodeWhatsappAudio(input.base64);
    if (!decoded.ok) {
      throw new Error(
        decoded.reason === 'too_large' ? 'Áudio maior que 25 MB.' : 'Áudio vazio.',
      );
    }

    const file = whatsappAudioFileName(input.mimeType || '', input.fileName);
    const form = new FormData();
    form.append('model', this.transcribeModel);
    form.append('language', 'pt');
    form.append('response_format', 'json');
    form.append(
      'file',
      new Blob([new Uint8Array(decoded.bytes)], { type: file.mime }),
      file.name,
    );

    const controller = new AbortController();
    const configured = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS || 45000);
    const timeoutMs = Math.min(
      Math.max(Number.isFinite(configured) ? configured : 45_000, 60_000),
      120_000,
    );
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: controller.signal,
      });
      const raw = await res.text().catch(() => '');
      if (!res.ok) {
        throw new Error(`OpenAI respondeu ${res.status}: ${raw.slice(0, 500)}`);
      }
      try {
        const parsed = JSON.parse(raw) as { text?: unknown };
        return typeof parsed.text === 'string' ? parsed.text.trim().slice(0, 8000) : '';
      } catch {
        return raw.trim().slice(0, 8000);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async interpret(input: {
    context: string;
    transcript: string;
    profileSummary: string;
    pendingQuestion: string | null;
    combinedText: string;
  }): Promise<{ reply: string; proposal: JoanaProposal }> {
    if (!this.isConfigured()) {
      throw new Error('OPENAI_API_KEY não está configurada.');
    }

    const today = joanaDateInstruction();
    const system = [
      input.context.trim() || JOANA_DEFAULT_CONTEXT,
      '',
      'Você responde no WhatsApp. A Rafa é mulher. Trata sempre no feminino: a Rafa, ela, dela. Nunca escrevas "o Rafa", "ele" ou "dele" para falar da Rafa.',
      'Se ainda não há ficha no CRM e a pessoa ainda não disse que quer o serviço, apresenta-te como Joana e explica em duas ou três frases o que é o relocation: assessoria para alugar ou comprar imóvel em Portugal, com busca, visitas por videochamada, análise dos documentos e negociação com os proprietários. Termina perguntando se a pessoa tem interesse. Não peças data, visto, cidade, tipologia, aluguel, pet nem nome. Não preenchas esses campos.',
      'interested só é true quando a pessoa diz com clareza que quer o serviço (sim, tenho interesse, quero, pode seguir). Dizer oi, perguntar o preço ou mencionar cidade, data ou visto não é interesse. false se recusar o serviço. null se ainda não deu para saber. Quando interested for true nesta mensagem, preenche os campos que ela disse agora.',
      'Fale como uma pessoa no WhatsApp: frases curtas e próximas. Quando a pessoa contar algo, reaja ao que ela disse e faça uma única pergunta sobre o próximo dado que falta, nesta ordem: data de imigração, visto, cidades, tipologia, valor do aluguel pretendido, pet, nome. Não perguntes de novo se tem interesse. Não perguntes o que ela acabou de dizer. Não digas que a Rafa pode ajudar.',
      'Se a pessoa disser que não tem visto, hasVisa é false. Não peças o próximo dado, não ofereças a videochamada e não escrevas link. A reply fica só numa reação curta, sem pergunta. O sistema avisa que, antes de continuar o relocation, ela precisa se encaixar num visto válido e indica a Clara para assessoria de vistos e passagens aéreas.',
      'Se a ficha já diz que a pessoa não tem visto e ela não falou de visto agora, responde ao que ela perguntou e não continues a qualificação nem ofereças a videochamada.',
      'Não escrevas o link da videochamada. Quando a pessoa tem visto e a data está perto, o sistema acrescenta o link para agendar.',
      'Não comente que a informação foi guardada, registrada ou atualizada. Não invente preço nem horário.',
      'Devolva só JSON com as chaves: reply, interested, confirmation, name, immigration, hasVisa, cities, typology, desiredRent, hasPet.',
      'confirmation: "yes" se a pessoa aceitou a confirmação pendente, "no" se recusou, null se não havia confirmação ou a resposta não foi sim nem não.',
      'name, immigration, hasVisa, cities, typology, desiredRent, hasPet: omita a chave se a pessoa não falou desse dado. immigration é YYYY-MM-DD, "IMEDIATO", ou "" para apagar. hasVisa é true se a pessoa já tem visto e false se disser que ainda não tem, mesmo que a ficha já esteja assim. typology é uma de: QUARTO, T0, T1, T2, T3, T4, T5. desiredRent é o aluguel mensal do imóvel em euros inteiros, ou "" para apagar. Não uses o preço do serviço da Rafa. hasPet é true ou false.',
      'cities pode juntar várias cidades numa frase.',
      today,
    ].join('\n');

    const user = [
      today,
      `Ficha atual: ${input.profileSummary}`,
      input.pendingQuestion
        ? `Confirmação pendente: ${input.pendingQuestion}`
        : 'Sem confirmação pendente.',
      input.transcript ? `Histórico:\n${input.transcript}` : 'Sem histórico.',
      `Mensagem agora:\n${input.combinedText}`,
    ].join('\n\n');

    const controller = new AbortController();
    const timeoutMs = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS || 45000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.4,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`OpenAI respondeu ${res.status}: ${body.slice(0, 500)}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content ?? '';
      const parsed = parseJoanaModelJson(content);
      const immigration = immigrationFromLead(
        input.combinedText,
        parsed.proposal.immigration,
      );
      if (immigration !== undefined) parsed.proposal.immigration = immigration;
      return parsed;
    } finally {
      clearTimeout(timeout);
    }
  }
}

const LISBON_TZ = 'Europe/Lisbon';

/** Dia civil de Lisboa, no formato da conversa: 17/11/2026. */
export function lisbonCivilDate(now = new Date()): {
  day: number;
  month: number;
  year: number;
  label: string;
} {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LISBON_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const day = pick('day');
  const month = pick('month');
  const year = pick('year');
  const label = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
  return { day, month, year, label };
}

function lastDayOfFebruary(year: number): string {
  const day = new Date(Date.UTC(year, 2, 0)).getUTCDate();
  return `${year}-02-${String(day).padStart(2, '0')}`;
}

/** Contexto de data enviado em todos os pedidos da Joana. */
export function joanaDateInstruction(now = new Date()): string {
  const today = lisbonCivilDate(now);
  const februaryYear = today.month > 2 ? today.year + 1 : today.year;
  const februaryEnd = lastDayOfFebruary(februaryYear);
  return [
    `Data de hoje em Lisboa: ${today.label}.`,
    'Quando a pessoa falar de um mês ou de um período sem dizer o ano, escolhe a próxima ocorrência que ainda não passou em relação a esta data.',
    `Se esse mês já passou em ${today.year}, o ano é ${today.year + 1}.`,
    `Exemplo: em ${today.label}, "final de fevereiro" é ${februaryEnd}, o último dia desse fevereiro.`,
    '"Final de" é o último dia do mês. "Início de" ou "começo de" é o dia 1. Só o nome do mês, sem dia, é o dia 15.',
    'Se a pessoa disser o ano, usa esse ano. Nunca escolhas um ano anterior ao de hoje.',
  ].join(' ');
}

const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'marco',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

const MONTH_PATTERN = 'janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';

function monthNumber(name: string): number {
  const key = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  return MONTH_NAMES.indexOf(key as (typeof MONTH_NAMES)[number]) + 1;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoDate(year: number, month: number, day: number): string | null {
  const clamped = Math.min(Math.max(day, 1), lastDayOfMonth(year, month));
  const date = new Date(Date.UTC(year, month - 1, clamped));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
}

function isBeforeToday(
  year: number,
  month: number,
  day: number,
  today: { year: number; month: number; day: number },
): boolean {
  if (year !== today.year) return year < today.year;
  if (month !== today.month) return month < today.month;
  return day < today.day;
}

function dateInFutureOrYear(
  month: number,
  day: number,
  explicitYear: number | null,
  today: { year: number; month: number; day: number },
): string | null {
  if (!month) return null;
  let year = explicitYear ?? today.year;
  let resolved = isoDate(year, month, day);
  if (!resolved) return null;
  if (explicitYear === null && isBeforeToday(year, month, Number(resolved.slice(8)), today)) {
    year += 1;
    resolved = isoDate(year, month, day);
  }
  return resolved;
}

/**
 * A data dita pela pessoa ganha à da OpenAI.
 * Mês sem ano vai para a próxima ocorrência que ainda não passou.
 */
export function inferImmigrationFromMessage(text: string, now = new Date()): string | null {
  const raw = text.trim();
  if (!raw) return null;
  if (/\bimediat[oa]\b/i.test(raw)) return 'IMEDIATO';

  const numeric = raw.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/);
  if (numeric) return isoDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));

  const iso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const today = lisbonCivilDate(now);
  const dayAndMonth = raw.match(
    new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${MONTH_PATTERN})(?:\\s+de\\s+(\\d{4}))?\\b`, 'iu'),
  );
  if (dayAndMonth) {
    return dateInFutureOrYear(
      monthNumber(dayAndMonth[2]!),
      Number(dayAndMonth[1]),
      dayAndMonth[3] ? Number(dayAndMonth[3]) : null,
      today,
    );
  }

  const qualified = raw.match(
    new RegExp(
      `\\b(final|fim|finais|in[ií]cio|come[cç]o|meados)\\s+de\\s+(${MONTH_PATTERN})(?:\\s+de\\s+(\\d{4}))?\\b`,
      'iu',
    ),
  );
  if (qualified) {
    const kind = qualified[1]!.toLowerCase();
    const day = /final|fim/.test(kind) ? 31 : kind.startsWith('mead') ? 15 : 1;
    return dateInFutureOrYear(
      monthNumber(qualified[2]!),
      day,
      qualified[3] ? Number(qualified[3]) : null,
      today,
    );
  }

  const bare = raw.match(
    new RegExp(
      `\\b(?:em|no|para|pra)\\s+(?:o\\s+)?(?:m[eê]s\\s+de\\s+)?(${MONTH_PATTERN})(?:\\s+de\\s+(\\d{4}))?\\b`,
      'iu',
    ),
  );
  if (bare) {
    return dateInFutureOrYear(
      monthNumber(bare[1]!),
      15,
      bare[2] ? Number(bare[2]) : null,
      today,
    );
  }

  return null;
}

/** Usa a data da mensagem. Se a OpenAI escolher um ano já passado, avança esse dia. */
export function immigrationFromLead(
  text: string,
  modelValue: string | undefined,
  now = new Date(),
): string | undefined {
  const inferred = inferImmigrationFromMessage(text, now);
  if (inferred) return inferred;
  if (!modelValue || modelValue === 'IMEDIATO' || modelValue === '') return modelValue;
  const match = modelValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return modelValue;
  const year = Number(match[1]);
  if (text.includes(match[1]!)) return modelValue;
  const today = lisbonCivilDate(now);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isBeforeToday(year, month, day, today)) return modelValue;
  return dateInFutureOrYear(month, day, null, today) ?? modelValue;
}

export function parseJoanaModelJson(content: string): {
  reply: string;
  proposal: JoanaProposal;
} {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {
      reply: '',
      proposal: { interested: null, confirmation: null },
    };
  }

  const reply = typeof parsed.reply === 'string' ? parsed.reply.trim().slice(0, 1500) : '';
  const interested =
    parsed.interested === true ? true : parsed.interested === false ? false : null;
  const confirmation =
    parsed.confirmation === 'yes' || parsed.confirmation === 'no'
      ? parsed.confirmation
      : null;

  const proposal: JoanaProposal = { interested, confirmation };

  if (typeof parsed.name === 'string') proposal.name = parsed.name;
  if (typeof parsed.immigration === 'string') {
    const canonical = canonicalImmigration(parsed.immigration);
    if (canonical !== null) proposal.immigration = canonical;
  }
  if (typeof parsed.cities === 'string') proposal.cities = parsed.cities;
  if (typeof parsed.typology === 'string') {
    const typology = parseJoanaTypology(parsed.typology);
    if (typology && (JOANA_TYPOLOGIES as readonly string[]).includes(typology)) {
      proposal.typology = typology as JoanaTypology;
    } else if (!parsed.typology.trim()) {
      proposal.typology = '';
    }
  }
  const desiredRent = parseDesiredRent(parsed.desiredRent);
  if (desiredRent !== undefined) proposal.desiredRent = desiredRent;
  if (parsed.hasVisa === true || parsed.hasVisa === false) proposal.hasVisa = parsed.hasVisa;
  if (parsed.hasPet === true || parsed.hasPet === false) proposal.hasPet = parsed.hasPet;

  return { reply, proposal };
}
