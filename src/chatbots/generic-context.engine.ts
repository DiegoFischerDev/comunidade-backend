import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toAbsoluteMediaUrl } from '../common/public-media-url';
import { getFrontendBaseUrl } from '../config/frontend-base-url';
import { PrismaService } from '../prisma/prisma.service';
import {
  type JoanaWelcomeStep,
  welcomeStepsHistorySummary,
} from '../joana/joana-welcome';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { ChatbotService } from './chatbot.service';
import { isChatbotSlug } from './chatbot.constants';
import { ChatbotCrmService } from './chatbot-crm.service';
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
    private readonly wa: WhatsAppService,
    private readonly chatbots: ChatbotService,
    private readonly crm: ChatbotCrmService,
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
    if (row.paused) {
      await this.dropPaused(id);
      return;
    }

    const slug = isChatbotSlug(row.chatbot.slug) ? row.chatbot.slug : null;
    if (!slug) {
      await this.release(id);
      return;
    }

    const lead = await this.crm.findActiveLead(row.chatbotId!, row.whatsappDigits);
    if (lead && !lead.botEnabled) {
      await this.dropPaused(id);
      return;
    }

    if (row.pendingOutbound) {
      const outbound = row.pendingOutbound;
      await this.wa.sendText(row.whatsappDigits, outbound, {
        preferredInstance: row.instance || undefined,
        requireDelivery: true,
      });
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

    let welcomeSent = row.welcomeSent;
    let welcomeSummary = '';
    if (!welcomeSent) {
      try {
        if (bot.welcomeSteps.length > 0) {
          await this.sendWelcomeSteps(
            row.whatsappDigits,
            bot.welcomeSteps,
            row.instance,
          );
          welcomeSummary = welcomeStepsHistorySummary(bot.welcomeSteps);
        } else if (bot.introFallback?.trim()) {
          await this.wa.sendText(row.whatsappDigits, bot.introFallback.trim(), {
            preferredInstance: row.instance || undefined,
            requireDelivery: true,
          });
          welcomeSummary = bot.introFallback.trim();
        }
        welcomeSent = true;
      } catch (err: unknown) {
        this.logger.warn(
          `${bot.name} boas-vindas ${row.whatsappDigits}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const historyForModel: HistoryItem[] = welcomeSummary
      ? [...history, { role: 'assistant', text: welcomeSummary }]
      : history;

    let reply = '';
    try {
      if (slug === 'gabi') {
        const profile = lead
          ? {
              companyName: lead.companyName,
              instagramHandle: lead.instagramHandle,
            }
          : emptyGabiProfile();
        const interpreted = await this.interpretGabi({
          context: bot.contextText,
          history: historyForModel,
          userText: combined,
          profile,
        });
        const nextProfile = applyGabiProposal(profile, interpreted.proposal);
        if (lead && (interpreted.proposal.companyName !== undefined || interpreted.proposal.instagramHandle !== undefined)) {
          await this.crm.patchGabiQualification(lead.id, nextProfile);
        }
        reply = composeGabiReply(interpreted.reply, nextProfile);
      } else {
        reply = await this.replyWithContext({
          botName: bot.name,
          context: bot.contextText,
          history: historyForModel,
          userText: combined,
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
      await this.wa.sendText(row.whatsappDigits, reply, {
        preferredInstance: row.instance || undefined,
        requireDelivery: true,
      });
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
      welcomeSent,
      outbound: sent ? null : reply,
    });
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
    const system = [
      input.context.trim(),
      '',
      'És a Gabi no WhatsApp. A Rafa é mulher — fala no feminino.',
      'Responde em JSON: {"reply":"...","companyName":"...","instagramHandle":"..."}',
      'companyName e instagramHandle: só inclui a chave se a pessoa falou desse dado agora.',
      'instagramHandle: o @ (com ou sem @); se disser que não tem / não aplicável, usa "".',
      'Na reply: frases curtas. Reage ao que disseram. Não digas que gravaste dados.',
      'Se a ficha ainda não tem nome da empresa, pergunta isso. Depois pergunta se tem Instagram e o @.',
      'Não inventes preços nem compromissos. Não digas que és uma IA.',
      `Ficha actual: ${gabiProfileSummary(input.profile)}`,
    ].join('\n');

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
          temperature: 0.3,
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

  private async replyWithContext(input: {
    botName: string;
    context: string;
    history: HistoryItem[];
    userText: string;
  }): Promise<string> {
    const apiKey = (process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY não está configurada.');
    }
    const model = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: [
          input.context.trim(),
          '',
          `És a ${input.botName}. Responde numa única mensagem curta de WhatsApp.`,
          'Não inventes preços, prazos nem compromissos fora do contexto.',
          'Não digas que gravaste dados nem que és uma IA.',
        ].join('\n'),
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
          temperature: 0.4,
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

  private async sendWelcomeSteps(
    whatsapp: string,
    steps: JoanaWelcomeStep[],
    instance: string | null,
  ) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      if (step.type === 'TEXT') {
        const body = (step.textContent || '').trim();
        if (body) {
          await this.wa.sendText(whatsapp, body, {
            preferredInstance: instance || undefined,
            requireDelivery: true,
          });
        }
      } else if (step.type === 'AUDIO') {
        const abs = resolveWelcomeMediaUrl(step.mediaUrl || '');
        if (!abs) throw new Error('Passo AUDIO sem mediaUrl válida.');
        await this.wa.sendWhatsAppAudio({
          to: whatsapp,
          mediaUrl: abs,
          preferredInstance: instance || undefined,
          requireDelivery: true,
        });
      } else if (step.type === 'IMAGE') {
        const abs = resolveWelcomeMediaUrl(step.mediaUrl || '');
        if (!abs) throw new Error('Passo IMAGE sem mediaUrl válida.');
        await this.wa.sendMedia({
          to: whatsapp,
          caption: (step.textContent || '').trim(),
          mediaUrl: abs,
          mimeType: step.mediaMimeType?.trim() || 'image/jpeg',
          fileName: step.mediaFileName?.trim() || 'image.jpg',
          mediaType: 'image',
          preferredInstance: instance || undefined,
          requireDelivery: true,
        });
      } else if (step.type === 'DOCUMENT') {
        const abs = resolveWelcomeMediaUrl(step.mediaUrl || '');
        if (!abs) throw new Error('Passo DOCUMENT sem mediaUrl válida.');
        await this.wa.sendMedia({
          to: whatsapp,
          caption: (step.textContent || '').trim(),
          mediaUrl: abs,
          mimeType: step.mediaMimeType?.trim() || 'application/pdf',
          fileName: step.mediaFileName?.trim() || 'documento.pdf',
          mediaType: 'document',
          preferredInstance: instance || undefined,
          requireDelivery: true,
        });
      }
      const delay = Math.max(0, step.delayMsAfter ?? 650);
      if (i < steps.length - 1 && delay > 0) {
        await sleep(delay);
      }
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

function resolveWelcomeMediaUrl(stored: string): string {
  const u = stored.trim();
  if (!u) return '';
  if (u.startsWith('https://') || u.startsWith('http://')) return u;
  if (u.startsWith('/brand/')) {
    const front = getFrontendBaseUrl().replace(/\/$/, '');
    return `${front}${u}`;
  }
  return toAbsoluteMediaUrl(u);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
