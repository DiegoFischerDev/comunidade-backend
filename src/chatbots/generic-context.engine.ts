import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConversationOutboundService } from '../channels/conversation-outbound.service';
import { buildSchedulingLink } from '../channels/scheduling-link';
import { PrismaService } from '../prisma/prisma.service';
import { welcomeStepsHistorySummary } from '../joana/joana-welcome';
import { buildSystemWithRag } from '../rag/rag-prompt';
import { RagQaService } from '../rag/rag-qa.service';
import { ChatbotService } from './chatbot.service';
import {
  CHATBOT_WHATSAPP_REPLY_STYLE,
  isChatbotSlug,
} from './chatbot.constants';
import { ChatbotCrmService } from './chatbot-crm.service';
import {
  applyBrunaProposal,
  brunaProfileSummary,
  composeBrunaReply,
  emptyBrunaProfile,
  parseBrunaModelJson,
  type BrunaProfile,
} from './bruna-turn';
import {
  applyGabiProposal,
  composeGabiReply,
  emptyGabiProfile,
  gabiProfileSummary,
  parseGabiModelJson,
  type GabiProfile,
} from './gabi-turn';

type HistoryItem = { role: 'user' | 'assistant'; text: string };
type BufferItem = { id: string; text: string; at: string };

const HISTORY_LIMIT = 16;

@Injectable()
export class GenericContextEngine {
  private readonly logger = new Logger(GenericContextEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbound: ConversationOutboundService,
    private readonly chatbots: ChatbotService,
    private readonly crm: ChatbotCrmService,
    private readonly ragQa: RagQaService,
  ) {}

  async processConversation(id: string): Promise<void> {
    const row = await this.prisma.joanaConversation.findUnique({
      where: { id },
      include: { chatbot: true },
    });
    if (!row?.chatbot || row.chatbot.engineKind !== 'GENERIC_CONTEXT') {
      await this.release(id);
      return;
    }
    if (!row.whatsappDigits && !row.instagramUserId) {
      await this.release(id);
      return;
    }

    const slug = isChatbotSlug(row.chatbot.slug) ? row.chatbot.slug : null;
    if (!slug) {
      await this.release(id);
      return;
    }

    const lead = await this.crm.findActiveLead(row.chatbotId!, {
      whatsappDigits: row.whatsappDigits,
      instagramUserId: row.instagramUserId,
    });
    const extractOnly = row.paused || Boolean(lead && !lead.botEnabled);

    if (extractOnly && row.pendingOutbound) {
      await this.prisma.joanaConversation.update({
        where: { id },
        data: { pendingOutbound: null, processing: false },
      });
      return;
    }

    if (row.pendingOutbound) {
      const outbound = row.pendingOutbound;
      await this.outbound.sendText(row, outbound, { requireDelivery: true });
      await this.prisma.joanaConversation.update({
        where: { id },
        data: { pendingOutbound: null, processing: false },
      });
      return;
    }

    const buffer = readBuffer(row.buffer);
    if (buffer.length === 0) {
      await this.release(id);
      return;
    }

    const combined = buffer.map((item) => item.text).join('\n');
    const history = readHistory(row.history);
    const bot = await this.chatbots.getBySlug(slug);

    // Bot Off: Bruna/Gabi continuam a extrair campos; sem reply nem boas-vindas.
    if (extractOnly) {
      await this.extractQualificationWhilePaused({
        id,
        slug,
        lead,
        buffer,
        combined,
        history,
        botName: bot.name,
        context: bot.contextText,
      });
      return;
    }

    // 1ª interação do bot = só boas-vindas; OpenAI só na mensagem seguinte.
    if (!row.welcomeSent) {
      let welcomeSummary = '';
      try {
        if (bot.welcomeSteps.length > 0) {
          await this.outbound.sendWelcomeSteps(row, bot.welcomeSteps, {
            requireDelivery: true,
          });
          welcomeSummary = welcomeStepsHistorySummary(bot.welcomeSteps);
        } else if (bot.introFallback?.trim()) {
          await this.outbound.sendText(row, bot.introFallback.trim(), {
            requireDelivery: true,
          });
          welcomeSummary = bot.introFallback.trim();
        }
      } catch (err: unknown) {
        this.logger.warn(
          `${bot.name} boas-vindas ${row.whatsappDigits || row.instagramUserId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      await this.persistTurn({
        id,
        bufferIds: buffer.map((item) => item.id),
        userText: combined,
        assistantText: welcomeSummary || '[Boas-vindas enviadas]',
        history,
        welcomeSent: true,
        outbound: null,
      });
      return;
    }

    const historyForModel = history;

    let reply = '';
    try {
      if (slug === 'gabi') {
        const profile = lead
          ? {
              companyName: lead.companyName,
              instagramHandle: lead.instagramHandle,
              campaignObjective: lead.campaignObjective,
            }
          : emptyGabiProfile();
        const interpreted = await this.interpretGabi({
          context: bot.contextText,
          history: historyForModel,
          userText: combined,
          profile,
        });
        const nextProfile = applyGabiProposal(profile, interpreted.proposal);
        if (
          lead &&
          (interpreted.proposal.companyName !== undefined ||
            interpreted.proposal.instagramHandle !== undefined ||
            interpreted.proposal.campaignObjective !== undefined)
        ) {
          await this.crm.patchGabiQualification(lead.id, nextProfile);
        }
        reply = composeGabiReply(interpreted.reply, nextProfile);
      } else if (slug === 'bruna') {
        const profile: BrunaProfile = lead
          ? {
              desiredHouseValue: lead.desiredHouseValue,
              preferredCities: lead.crmPreferredCity,
              propertyTypology: Array.isArray(lead.crmPropertyTypology)
                ? lead.crmPropertyTypology
                : lead.crmPropertyTypology
                  ? [lead.crmPropertyTypology]
                  : [],
            }
          : emptyBrunaProfile();
        const interpreted = await this.interpretBruna({
          context: bot.contextText,
          history: historyForModel,
          userText: combined,
          profile,
        });
        const nextProfile = applyBrunaProposal(profile, interpreted.proposal);
        if (
          lead &&
          (interpreted.proposal.desiredHouseValue !== undefined ||
            interpreted.proposal.preferredCities !== undefined ||
            interpreted.proposal.propertyTypology !== undefined)
        ) {
          await this.crm.patchBrunaQualification(lead.id, nextProfile);
        }
        reply = composeBrunaReply(interpreted.reply, nextProfile);
      } else {
        reply = await this.replyWithContext({
          botName: bot.name,
          context: bot.contextText,
          history: historyForModel,
          userText: combined,
          ...(slug === 'bianca'
            ? {
                schedulingLink: this.buildSchedulingLink(
                  row.whatsappDigits,
                  lead?.guestName || row.displayName,
                ),
              }
            : {}),
        });
      }
    } catch (err: unknown) {
      this.logger.warn(
        `${bot.name} OpenAI ${row.whatsappDigits}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      reply =
        'Desculpa, tive um problema a processar a tua mensagem. Podes tentar de novo daqui a pouco?';
    }

    if (!reply.trim()) {
      reply = 'Podes repetir, por favor? Não apanhei bem.';
    }

    let sent = false;
    try {
      await this.outbound.sendText(row, reply, { requireDelivery: true });
      sent = true;
    } catch (err: unknown) {
      this.logger.warn(
        `${bot.name} envio ${row.whatsappDigits}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    await this.persistTurn({
      id,
      bufferIds: buffer.map((item) => item.id),
      userText: combined,
      assistantText: reply,
      history: historyForModel,
      welcomeSent: true,
      outbound: sent ? null : reply,
    });
  }

  private async interpretBruna(input: {
    context: string;
    history: HistoryItem[];
    userText: string;
    profile: BrunaProfile;
  }): Promise<{
    reply: string;
    proposal: ReturnType<typeof parseBrunaModelJson>['proposal'];
  }> {
    const apiKey = (process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY não está configurada.');
    }
    const model = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
    const ragBlock = await this.ragQa.retrievePromptBlock(input.userText);
    const system = buildSystemWithRag(
      [
        input.context.trim(),
        '',
        CHATBOT_WHATSAPP_REPLY_STYLE,
        'Identidade interna: Bruna (crédito/compra). A Rafa é mulher — fala no feminino. Na reply não digas o teu nome.',
        'Responde em JSON: {"reply":"...","desiredHouseValue":250000,"preferredCities":"...","propertyTypology":"T2"}',
        'desiredHouseValue, preferredCities e propertyTypology: só inclui a chave se a pessoa falou desse dado agora.',
        'desiredHouseValue: euros inteiros do imóvel pretendido (ex.: 220000).',
        'preferredCities: cidade(s) em Portugal, texto curto.',
        'propertyTypology: uma ou várias de QUARTO, T0, T1, T2, T3, T4, T5 (ex.: "T2" ou "T2 ou T3").',
        'Na reply: reage ao que disseram e faz no máximo uma pergunta. Não digas que gravaste dados.',
        'Ordem: valor da casa pretendida → cidades pretendidas → tipologia do imóvel. Não perguntes de novo o que a ficha já tem.',
        'Não inventes taxas, spreads, prazos nem condições bancárias.',
        `Ficha actual: ${brunaProfileSummary(input.profile)}`,
      ],
      ragBlock,
    );

    const messages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
    }> = [{ role: 'system', content: system }];
    for (const item of input.history.slice(-HISTORY_LIMIT)) {
      messages.push({ role: item.role, content: item.text });
    }
    messages.push({ role: 'user', content: input.userText });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.55,
          response_format: { type: 'json_object' },
          messages,
        }),
        signal: controller.signal,
      });
      const raw = await res.text();
      if (!res.ok) {
        throw new Error(`OpenAI ${res.status}: ${raw.slice(0, 400)}`);
      }
      const parsed = JSON.parse(raw) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return parseBrunaModelJson(parsed.choices?.[0]?.message?.content || '');
    } finally {
      clearTimeout(timeout);
    }
  }

  private async interpretGabi(input: {
    context: string;
    history: HistoryItem[];
    userText: string;
    profile: GabiProfile;
  }): Promise<{ reply: string; proposal: ReturnType<typeof parseGabiModelJson>['proposal'] }> {
    const apiKey = (process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY não está configurada.');
    }
    const model = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
    const ragBlock = await this.ragQa.retrievePromptBlock(input.userText);
    const system = buildSystemWithRag(
      [
        input.context.trim(),
        '',
        CHATBOT_WHATSAPP_REPLY_STYLE,
        'Identidade interna: Gabi (publicidade/parcerias). A Rafa é mulher — fala no feminino. Na reply não digas o teu nome.',
        'Responde em JSON: {"reply":"...","companyName":"...","instagramHandle":"...","campaignObjective":"..."}',
        'companyName, instagramHandle e campaignObjective: só inclui a chave se a pessoa falou desse dado agora.',
        'instagramHandle: o @ (com ou sem @); se disser que não tem / não aplicável, usa "".',
        'campaignObjective: resume o objectivo da campanha/parceria em 1 frase curta.',
        'Na reply: reage ao que disseram e faz no máximo uma pergunta. Não digas que gravaste dados.',
        'Ordem: nome da empresa → Instagram (@ ou sem) → objectivo da campanha/parceria. Não perguntes de novo o que a ficha já tem.',
        'Não inventes preços nem compromissos.',
        `Ficha actual: ${gabiProfileSummary(input.profile)}`,
      ],
      ragBlock,
    );

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: system },
    ];
    for (const item of input.history.slice(-HISTORY_LIMIT)) {
      messages.push({ role: item.role, content: item.text });
    }
    messages.push({ role: 'user', content: input.userText });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.55,
          response_format: { type: 'json_object' },
          messages,
        }),
        signal: controller.signal,
      });
      const raw = await res.text();
      if (!res.ok) {
        throw new Error(`OpenAI ${res.status}: ${raw.slice(0, 400)}`);
      }
      const parsed = JSON.parse(raw) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return parseGabiModelJson(parsed.choices?.[0]?.message?.content || '');
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildSchedulingLink(
    whatsapp: string | null | undefined,
    name: string | null | undefined,
  ): string | null {
    try {
      return buildSchedulingLink(whatsapp, name);
    } catch (err: unknown) {
      this.logger.warn(
        `Bianca sem link de agenda: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private async replyWithContext(input: {
    botName: string;
    context: string;
    history: HistoryItem[];
    userText: string;
    schedulingLink?: string | null;
  }): Promise<string> {
    const apiKey = (process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY não está configurada.');
    }
    const model = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
    const schedulingHints = input.schedulingLink
      ? [
          'Quando a pessoa mostrar interesse em falar com a especialista / agendar, inclui este link exacto na resposta:',
          input.schedulingLink,
          'Não inventes outro URL de agendamento.',
        ]
      : [];
    const ragBlock = await this.ragQa.retrievePromptBlock(input.userText);
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: buildSystemWithRag(
          [
            input.context.trim(),
            '',
            CHATBOT_WHATSAPP_REPLY_STYLE,
            `Identidade interna: ${input.botName}. Responde numa única mensagem curta de WhatsApp. Na reply não digas o teu nome.`,
            'Não inventes preços, prazos nem compromissos fora do contexto.',
            'Não digas que gravaste dados.',
            ...schedulingHints,
          ],
          ragBlock,
        ),
      },
    ];
    for (const item of input.history.slice(-HISTORY_LIMIT)) {
      messages.push({ role: item.role, content: item.text });
    }
    messages.push({ role: 'user', content: input.userText });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.55,
          messages,
        }),
        signal: controller.signal,
      });
      const raw = await res.text();
      if (!res.ok) {
        throw new Error(`OpenAI ${res.status}: ${raw.slice(0, 400)}`);
      }
      const parsed = JSON.parse(raw) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return (parsed.choices?.[0]?.message?.content || '').trim().slice(0, 4000);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async persistTurn(input: {
    id: string;
    bufferIds: string[];
    userText: string;
    assistantText: string;
    history: HistoryItem[];
    welcomeSent: boolean;
    outbound: string | null;
  }) {
    const turn: HistoryItem[] = [
      { role: 'user', text: input.userText },
      { role: 'assistant', text: input.assistantText },
    ];
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.prisma.joanaConversation.findUnique({
        where: { id: input.id },
      });
      if (!current) return;
      const remaining = readBuffer(current.buffer).filter(
        (item) => !input.bufferIds.includes(item.id),
      );
      const history = appendHistory(
        historyBase(readHistory(current.history), input.history),
        turn,
      );
      const saved = await this.prisma.joanaConversation.updateMany({
        where: { id: input.id, updatedAt: current.updatedAt },
        data: {
          pendingOutbound: input.outbound,
          welcomeSent: input.welcomeSent,
          processing: false,
          history: history as unknown as Prisma.InputJsonValue,
          buffer: remaining as unknown as Prisma.InputJsonValue,
        },
      });
      if (saved.count === 1) return;
    }
  }

  /**
   * Atendimento manual (bot Off): OpenAI extrai campos Bruna/Gabi sem responder.
   */
  private async extractQualificationWhilePaused(input: {
    id: string;
    slug: string;
    lead: Awaited<ReturnType<ChatbotCrmService['findActiveLead']>>;
    buffer: BufferItem[];
    combined: string;
    history: HistoryItem[];
    botName: string;
    context: string;
  }): Promise<void> {
    const bufferIds = input.buffer.map((item) => item.id);
    try {
      if (input.slug === 'gabi' && input.lead) {
        const profile = {
          companyName: input.lead.companyName,
          instagramHandle: input.lead.instagramHandle,
          campaignObjective: input.lead.campaignObjective,
        };
        const interpreted = await this.interpretGabi({
          context: input.context,
          history: input.history,
          userText: input.combined,
          profile,
        });
        const nextProfile = applyGabiProposal(profile, interpreted.proposal);
        if (
          interpreted.proposal.companyName !== undefined ||
          interpreted.proposal.instagramHandle !== undefined ||
          interpreted.proposal.campaignObjective !== undefined
        ) {
          await this.crm.patchGabiQualification(input.lead.id, nextProfile);
        }
      } else if (input.slug === 'bruna' && input.lead) {
        const profile: BrunaProfile = {
          desiredHouseValue: input.lead.desiredHouseValue,
          preferredCities: input.lead.crmPreferredCity,
          propertyTypology: Array.isArray(input.lead.crmPropertyTypology)
            ? input.lead.crmPropertyTypology
            : input.lead.crmPropertyTypology
              ? [input.lead.crmPropertyTypology]
              : [],
        };
        const interpreted = await this.interpretBruna({
          context: input.context,
          history: input.history,
          userText: input.combined,
          profile,
        });
        const nextProfile = applyBrunaProposal(profile, interpreted.proposal);
        if (
          interpreted.proposal.desiredHouseValue !== undefined ||
          interpreted.proposal.preferredCities !== undefined ||
          interpreted.proposal.propertyTypology !== undefined
        ) {
          await this.crm.patchBrunaQualification(input.lead.id, nextProfile);
        }
      }
    } catch (err: unknown) {
      this.logger.warn(
        `${input.botName} extracção (pausado) ${input.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Limpa o buffer sem inventar reply de assistant (o user já foi espelhado no log).
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.prisma.joanaConversation.findUnique({
        where: { id: input.id },
      });
      if (!current) return;
      const remaining = readBuffer(current.buffer).filter(
        (item) => !bufferIds.includes(item.id),
      );
      const saved = await this.prisma.joanaConversation.updateMany({
        where: { id: input.id, updatedAt: current.updatedAt },
        data: {
          buffer: remaining as unknown as Prisma.InputJsonValue,
          pendingOutbound: null,
          processing: false,
        },
      });
      if (saved.count === 1) return;
    }
    await this.dropPaused(input.id);
  }

  private async dropPaused(id: string) {
    await this.prisma.joanaConversation.update({
      where: { id },
      data: {
        buffer: [] as unknown as Prisma.InputJsonValue,
        pendingOutbound: null,
        processing: false,
      },
    });
  }

  private async release(id: string) {
    await this.prisma.joanaConversation.update({
      where: { id },
      data: { processing: false },
    });
  }
}

function readBuffer(raw: unknown): BufferItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const id = typeof row.id === 'string' ? row.id : '';
      const text = typeof row.text === 'string' ? row.text : '';
      const at = typeof row.at === 'string' ? row.at : new Date().toISOString();
      if (!id || !text.trim()) return null;
      return { id, text: text.trim(), at };
    })
    .filter((item): item is BufferItem => Boolean(item));
}

function readHistory(raw: unknown): HistoryItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const role = row.role === 'assistant' ? 'assistant' : row.role === 'user' ? 'user' : null;
      const text = typeof row.text === 'string' ? row.text.trim() : '';
      if (!role || !text) return null;
      return { role, text };
    })
    .filter((item): item is HistoryItem => Boolean(item))
    .slice(-HISTORY_LIMIT);
}

function historyBase(current: HistoryItem[], snapshot: HistoryItem[]): HistoryItem[] {
  return snapshot.length > 0 ? snapshot : current;
}

function appendHistory(base: HistoryItem[], turn: HistoryItem[]): HistoryItem[] {
  return [...base, ...turn].slice(-HISTORY_LIMIT);
}

