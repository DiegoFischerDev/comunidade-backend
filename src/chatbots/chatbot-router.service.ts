import { Injectable, Logger } from '@nestjs/common';
import { ChatbotEngineKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JOANA_AUDIO_UNHEARD } from '../joana/joana-audio';
import { JoanaOpenAiService } from '../joana/joana-openai.service';
import { JoanaService } from '../joana/joana.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { ChatbotCrmService } from './chatbot-crm.service';
import { ChatbotService } from './chatbot.service';
import {
  buildChatbotMenuText,
  parseChatbotMenuChoice,
} from './chatbot-menu';
import { chatbotDebounceMs, chatbotWhatsappInstance } from './chatbot.constants';
import { GenericContextEngine } from './generic-context.engine';

type BufferItem = { id: string; text: string; at: string };

const STALE_LOCK_MS = 2 * 60 * 1000;

@Injectable()
export class ChatbotRouterService {
  private readonly logger = new Logger(ChatbotRouterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wa: WhatsAppService,
    private readonly chatbots: ChatbotService,
    private readonly crm: ChatbotCrmService,
    private readonly joana: JoanaService,
    private readonly openai: JoanaOpenAiService,
    private readonly generic: GenericContextEngine,
  ) {}

  /**
   * Entrada de texto DM na instância partilhada.
   * Sem bot atribuído → menu; com bot → buffer para o engine respectivo.
   */
  async bufferInbound(input: {
    whatsapp: string;
    text: string;
    instance?: string;
    pushName?: string;
    externalMessageId?: string;
  }): Promise<{ handled: boolean; status: string }> {
    const instance = (input.instance || '').trim();
    if (instance && instance !== chatbotWhatsappInstance()) {
      return { handled: false, status: 'ignored_instance' };
    }

    const text = input.text.trim();
    if (!text) return { handled: true, status: 'ignored_empty' };

    const existing = await this.prisma.joanaConversation.findUnique({
      where: { whatsappDigits: input.whatsapp },
      include: { chatbot: true },
    });

    if (existing?.paused) {
      return { handled: true, status: 'paused' };
    }

    if (existing?.chatbotId) {
      const lead = await this.crm.findActiveLead(
        existing.chatbotId,
        input.whatsapp,
      );
      if (lead && !lead.botEnabled) {
        return { handled: true, status: 'paused' };
      }
      // Joana: também respeita crmJoanaEnabled / pausa legado
      if (existing.chatbot?.engineKind === ChatbotEngineKind.JOANA_QUALIFICATION) {
        return this.joana.bufferInbound(input);
      }
    }

    const item: BufferItem = {
      id:
        (input.externalMessageId || '').trim() ||
        `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      at: new Date().toISOString(),
    };

    await this.appendBuffer({
      whatsapp: input.whatsapp,
      instance: instance || null,
      displayName: cleanName(input.pushName),
      item,
    });

    return { handled: true, status: 'buffered' };
  }

  async acceptVoiceNote(input: {
    whatsapp: string;
    instance: string;
    pushName?: string;
    externalMessageId?: string;
    mediaMessage?: Record<string, unknown>;
  }): Promise<{ handled: true; status: string }> {
    const instance = (input.instance || '').trim();
    if (instance !== chatbotWhatsappInstance()) {
      return { handled: true, status: 'ignored_audio' };
    }

    const existing = await this.prisma.joanaConversation.findUnique({
      where: { whatsappDigits: input.whatsapp },
      include: { chatbot: true },
    });

    if (existing?.paused) {
      return { handled: true, status: 'paused' };
    }

    // Sem bot / menu: nota de voz não escolhe menu — pede texto
    if (!existing?.chatbotId) {
      try {
        await this.wa.sendText(
          input.whatsapp,
          'Para começar, responde com o número do menu (1, 2 ou 3) por escrito. Se ainda não viste o menu, escreve oi.',
          { preferredInstance: instance },
        );
      } catch {
        /* ignore */
      }
      return { handled: true, status: 'menu_voice_ignored' };
    }

    if (existing.chatbot?.engineKind === ChatbotEngineKind.JOANA_QUALIFICATION) {
      return this.joana.acceptVoiceNote(input);
    }

    const messageId = (input.externalMessageId || '').trim();
    if (!messageId) {
      await this.replyUnheard(input.whatsapp, instance, 'mensagem sem id');
      return { handled: true, status: 'audio_unheard' };
    }

    try {
      const media = await this.wa.getMediaBase64(instance, messageId, {
        convertToMp4: false,
        message: input.mediaMessage,
      });
      if (!media?.base64) {
        await this.replyUnheard(input.whatsapp, instance, 'Evolution sem bytes');
        return { handled: true, status: 'audio_unheard' };
      }
      const transcript = await this.openai.transcribeAudio({
        base64: media.base64,
        mimeType: media.mimetype,
        fileName: media.fileName,
      });
      if (!transcript) {
        await this.replyUnheard(input.whatsapp, instance, 'transcrição vazia');
        return { handled: true, status: 'audio_unheard' };
      }
      const buffered = await this.bufferInbound({
        whatsapp: input.whatsapp,
        text: transcript,
        instance,
        pushName: input.pushName,
        externalMessageId: messageId,
      });
      return { handled: true, status: buffered.status };
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.replyUnheard(input.whatsapp, instance, reason);
      return { handled: true, status: 'audio_unheard' };
    }
  }

  private async replyUnheard(whatsapp: string, instance: string, reason: string) {
    this.logger.warn(`Chatbot áudio ${whatsapp}: ${reason}`);
    try {
      await this.wa.sendText(whatsapp, JOANA_AUDIO_UNHEARD, {
        preferredInstance: instance,
      });
    } catch {
      /* ignore */
    }
  }

  async noteScriptedExchange(input: {
    whatsapp: string;
    instance: string;
    pushName?: string;
    userText: string;
    assistantText: string;
  }): Promise<void> {
    const joana = await this.prisma.chatbot.findUnique({
      where: { slug: 'joana' },
      select: { id: true },
    });
    await this.joana.noteScriptedExchange(input);
    if (joana) {
      await this.prisma.joanaConversation.updateMany({
        where: { whatsappDigits: input.whatsapp, chatbotId: null },
        data: { chatbotId: joana.id, menuSent: true },
      });
    }
  }

  async flushDue(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
    await this.prisma.joanaConversation.updateMany({
      where: {
        processing: true,
        processingStartedAt: { lt: staleBefore },
      },
      data: { processing: false },
    });

    const dueBefore = new Date(Date.now() - chatbotDebounceMs());
    const due = await this.prisma.joanaConversation.findMany({
      where: {
        processing: false,
        OR: [
          { pendingOutbound: { not: null } },
          { lastInboundAt: { lte: dueBefore } },
        ],
      },
      take: 20,
      orderBy: { lastInboundAt: 'asc' },
      include: { chatbot: true },
    });

    for (const row of due) {
      const buffer = readBuffer(row.buffer);
      if (!row.pendingOutbound && buffer.length === 0) continue;
      if (!row.pendingOutbound && row.lastInboundAt && row.lastInboundAt > dueBefore) {
        continue;
      }

      const claimed = await this.prisma.joanaConversation.updateMany({
        where: { id: row.id, processing: false },
        data: { processing: true, processingStartedAt: new Date() },
      });
      if (claimed.count !== 1) continue;

      try {
        if (!row.chatbotId) {
          await this.processMenuTurn(row.id);
        } else if (
          row.chatbot?.engineKind === ChatbotEngineKind.JOANA_QUALIFICATION
        ) {
          // Joana processConversation faz o próprio claim — libertar e delegar
          await this.prisma.joanaConversation.update({
            where: { id: row.id },
            data: { processing: false },
          });
          await this.joana.processConversationPublic(row.id);
        } else {
          await this.generic.processConversation(row.id);
        }
      } catch (err: unknown) {
        this.logger.warn(
          `Chatbot flush ${row.whatsappDigits}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        await this.prisma.joanaConversation.updateMany({
          where: { id: row.id },
          data: { processing: false },
        });
      }
    }
  }

  private async processMenuTurn(id: string): Promise<void> {
    const row = await this.prisma.joanaConversation.findUnique({ where: { id } });
    if (!row || row.chatbotId) {
      await this.release(id);
      return;
    }
    if (row.paused) {
      await this.dropPaused(id);
      return;
    }

    const bots = await this.chatbots.listEnabledMenuBots();
    const menuText = buildChatbotMenuText(bots);
    const buffer = readBuffer(row.buffer);

    if (!row.menuSent) {
      try {
        await this.wa.sendText(row.whatsappDigits, menuText, {
          preferredInstance: row.instance || undefined,
          requireDelivery: true,
        });
      } catch (err: unknown) {
        this.logger.warn(
          `Menu envio ${row.whatsappDigits}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        await this.release(id);
        return;
      }

      // Se já havia texto no buffer (ex. «oi»), guardar no histórico e limpar;
      // a próxima mensagem deve ser a escolha 1/2/3.
      const historyExtra =
        buffer.length > 0
          ? [
              { role: 'user' as const, text: buffer.map((b) => b.text).join('\n') },
              { role: 'assistant' as const, text: menuText },
            ]
          : [{ role: 'assistant' as const, text: menuText }];

      await this.prisma.joanaConversation.update({
        where: { id },
        data: {
          menuSent: true,
          buffer: [] as unknown as Prisma.InputJsonValue,
          history: appendHistory(readHistory(row.history), historyExtra) as unknown as Prisma.InputJsonValue,
          processing: false,
        },
      });
      return;
    }

    if (buffer.length === 0) {
      await this.release(id);
      return;
    }

    const combined = buffer.map((item) => item.text).join('\n');
    const choice = parseChatbotMenuChoice(combined, bots);

    if (!choice) {
      try {
        await this.wa.sendText(
          row.whatsappDigits,
          `Não percebi a escolha.\n\n${menuText}`,
          {
            preferredInstance: row.instance || undefined,
            requireDelivery: true,
          },
        );
      } catch (err: unknown) {
        this.logger.warn(
          `Menu reenvio ${row.whatsappDigits}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      await this.prisma.joanaConversation.update({
        where: { id },
        data: {
          buffer: [] as unknown as Prisma.InputJsonValue,
          history: appendHistory(readHistory(row.history), [
            { role: 'user', text: combined },
            { role: 'assistant', text: `Não percebi a escolha.\n\n${menuText}` },
          ]) as unknown as Prisma.InputJsonValue,
          processing: false,
        },
      });
      return;
    }

    const bot = await this.chatbots.requireBySlug(choice);
    // Joana mantém criação de ficha só após interesse; Bruna/Gabi abrem lead no menu.
    if (bot.engineKind !== ChatbotEngineKind.JOANA_QUALIFICATION) {
      await this.crm.ensureLeadOnMenuAssign({
        chatbotId: bot.id,
        whatsappDigits: row.whatsappDigits,
        displayName: row.displayName,
      });
    }

    await this.prisma.joanaConversation.update({
      where: { id },
      data: {
        chatbotId: bot.id,
        welcomeSent: false,
        buffer: [] as unknown as Prisma.InputJsonValue,
        history: appendHistory(readHistory(row.history), [
          { role: 'user', text: combined },
          {
            role: 'assistant',
            text: `Perfeito — vou passar-te para a ${bot.name}.`,
          },
        ]) as unknown as Prisma.InputJsonValue,
        processing: false,
      },
    });

    try {
      await this.wa.sendText(
        row.whatsappDigits,
        `Perfeito — vou passar-te para a ${bot.name}.`,
        {
          preferredInstance: row.instance || undefined,
          requireDelivery: true,
        },
      );
    } catch (err: unknown) {
      this.logger.warn(
        `Menu assign ${row.whatsappDigits}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Dispara o 1º turno do bot (boas-vindas + resposta) com buffer vazio:
    // injecta um «olá» sintético para o engine arrancar a welcome.
    await this.appendBuffer({
      whatsapp: row.whatsappDigits,
      instance: row.instance,
      displayName: row.displayName,
      item: {
        id: `menu-start-${Date.now()}`,
        text: 'Olá',
        at: new Date().toISOString(),
      },
    });

    // Processar de imediato (sem esperar debounce)
    const claimed = await this.prisma.joanaConversation.updateMany({
      where: { id, processing: false },
      data: { processing: true, processingStartedAt: new Date() },
    });
    if (claimed.count !== 1) return;

    if (bot.engineKind === ChatbotEngineKind.JOANA_QUALIFICATION) {
      await this.prisma.joanaConversation.update({
        where: { id },
        data: { processing: false },
      });
      await this.joana.processConversationPublic(id);
    } else {
      await this.generic.processConversation(id);
    }
  }

  private async appendBuffer(input: {
    whatsapp: string;
    instance: string | null;
    displayName: string | null;
    item: BufferItem;
  }) {
    const existing = await this.prisma.joanaConversation.findUnique({
      where: { whatsappDigits: input.whatsapp },
    });
    if (!existing) {
      try {
        await this.prisma.joanaConversation.create({
          data: {
            whatsappDigits: input.whatsapp,
            instance: input.instance,
            displayName: input.displayName,
            buffer: [input.item] as unknown as Prisma.InputJsonValue,
            history: [] as unknown as Prisma.InputJsonValue,
            lastInboundAt: new Date(),
            menuSent: false,
          },
        });
        return;
      } catch (err: unknown) {
        if (
          !(err instanceof Prisma.PrismaClientKnownRequestError) ||
          err.code !== 'P2002'
        ) {
          throw err;
        }
      }
    }

    const row =
      existing ??
      (await this.prisma.joanaConversation.findUnique({
        where: { whatsappDigits: input.whatsapp },
      }));
    if (!row) return;

    for (let attempt = 0; attempt < 3; attempt++) {
      const current =
        attempt === 0
          ? row
          : await this.prisma.joanaConversation.findUnique({ where: { id: row.id } });
      if (!current) return;
      const buffer = readBuffer(current.buffer);
      if (buffer.some((item) => item.id === input.item.id)) return;
      buffer.push(input.item);
      const saved = await this.prisma.joanaConversation.updateMany({
        where: { id: current.id, updatedAt: current.updatedAt },
        data: {
          buffer: buffer as unknown as Prisma.InputJsonValue,
          lastInboundAt: new Date(),
          instance: input.instance || current.instance,
          displayName: current.displayName || input.displayName,
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

function cleanName(value?: string | null): string | null {
  const name = value?.trim();
  if (!name || name.length < 2) return null;
  return name.slice(0, 80);
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

type HistoryItem = { role: 'user' | 'assistant'; text: string };

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
    .slice(-16);
}

function appendHistory(base: HistoryItem[], turn: HistoryItem[]): HistoryItem[] {
  return [...base, ...turn].slice(-16);
}
