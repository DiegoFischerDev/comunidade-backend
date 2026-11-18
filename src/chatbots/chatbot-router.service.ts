import { Injectable, Logger } from '@nestjs/common';
import { ChatbotChannel, ChatbotEngineKind, Prisma } from '@prisma/client';
import { ConversationOutboundService } from '../channels/conversation-outbound.service';
import { PrismaService } from '../prisma/prisma.service';
import { JOANA_AUDIO_UNHEARD } from '../joana/joana-audio';
import { JoanaOpenAiService } from '../joana/joana-openai.service';
import { JoanaService } from '../joana/joana.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { ChatbotCrmService } from './chatbot-crm.service';
import { ChatbotService } from './chatbot.service';
import {
  OUTROS_HANDOFF_MESSAGE,
  chatbotDebounceMs,
  chatbotWhatsappInstance,
} from './chatbot.constants';
import { GenericContextEngine } from './generic-context.engine';

type BufferItem = { id: string; text: string; at: string };

type InboundChannel = 'whatsapp' | 'instagram';

const STALE_LOCK_MS = 2 * 60 * 1000;

@Injectable()
export class ChatbotRouterService {
  private readonly logger = new Logger(ChatbotRouterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wa: WhatsAppService,
    private readonly outbound: ConversationOutboundService,
    private readonly chatbots: ChatbotService,
    private readonly crm: ChatbotCrmService,
    private readonly joana: JoanaService,
    private readonly openai: JoanaOpenAiService,
    private readonly generic: GenericContextEngine,
  ) {}

  /**
   * Entrada de texto (WhatsApp DM ou Instagram DM).
   * Sem ficha em nenhum CRM → menu (mesmo com histórico).
   * Com bot atribuído e ficha → engine respectivo.
   * No IG não pedimos WhatsApp: CRM ancora no IGSID; videochamada via /agendar.
   */
  async bufferInbound(input: {
    channel?: InboundChannel;
    whatsapp?: string;
    instagramUserId?: string;
    text: string;
    instance?: string;
    pushName?: string;
    externalMessageId?: string;
  }): Promise<{ handled: boolean; status: string }> {
    const channel: InboundChannel =
      input.channel ||
      (input.instagramUserId && !input.whatsapp ? 'instagram' : 'whatsapp');
    const whatsapp = (input.whatsapp || '').trim();
    const instagramUserId = (input.instagramUserId || '').trim();
    const instance = (input.instance || '').trim();

    if (channel === 'whatsapp') {
      if (!whatsapp) return { handled: true, status: 'ignored_empty' };
      if (instance && instance !== chatbotWhatsappInstance()) {
        return { handled: false, status: 'ignored_instance' };
      }
    } else if (!instagramUserId) {
      return { handled: true, status: 'ignored_empty' };
    }

    const text = input.text.trim();
    if (!text) return { handled: true, status: 'ignored_empty' };

    if (whatsapp) {
      await this.detachBotIfOutsideCrm(whatsapp);
    } else if (instagramUserId) {
      await this.detachBotIfOutsideCrmByInstagram(instagramUserId);
    }

    let existing = await this.findConversation({
      whatsapp: whatsapp || undefined,
      instagramUserId: instagramUserId || undefined,
    });

    if (existing?.paused) {
      if (existing.whatsappDigits) {
        const captured = await this.tryCaptureOutrosSubject({
          whatsapp: existing.whatsappDigits,
          text,
          pushName: input.pushName,
        });
        if (captured) return { handled: true, status: 'outros_subject_captured' };
      }

      if (!existing.chatbotId) {
        await this.prisma.joanaConversation.update({
          where: { id: existing.id },
          data: { paused: false },
        });
        existing = { ...existing, paused: false };
      } else {
        return { handled: true, status: 'paused' };
      }
    }

    if (existing?.chatbotId) {
      const lead = await this.crm.findActiveLead(existing.chatbotId, {
        whatsappDigits: existing.whatsappDigits,
        instagramUserId: existing.instagramUserId,
      });
      if (lead && !lead.botEnabled) {
        if (existing.whatsappDigits) {
          const captured = await this.tryCaptureOutrosSubject({
            whatsapp: existing.whatsappDigits,
            text,
            pushName: input.pushName,
          });
          if (captured) return { handled: true, status: 'outros_subject_captured' };
        }
        return { handled: true, status: 'paused' };
      }
      if (existing.chatbot?.engineKind === ChatbotEngineKind.HANDOFF_OTHER) {
        return { handled: true, status: 'paused' };
      }
      if (
        existing.chatbot?.engineKind === ChatbotEngineKind.JOANA_QUALIFICATION
      ) {
        if (existing.whatsappDigits) {
          return this.joana.bufferInbound({
            whatsapp: existing.whatsappDigits,
            text,
            instance: instance || existing.instance || undefined,
            pushName: input.pushName,
            externalMessageId: input.externalMessageId,
          });
        }
        // Joana no IG sem WhatsApp: buffer na conversa; CRM RafaCall só com número.
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
      channel,
      whatsapp: whatsapp || null,
      instagramUserId: instagramUserId || null,
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

    await this.detachBotIfOutsideCrm(input.whatsapp);

    let existing = await this.prisma.joanaConversation.findFirst({
      where: {
        whatsappDigits: input.whatsapp,
        activeChannel: ChatbotChannel.WHATSAPP,
      },
      include: { chatbot: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (existing?.paused) {
      if (!existing.chatbotId) {
        await this.prisma.joanaConversation.update({
          where: { id: existing.id },
          data: { paused: false },
        });
        existing = { ...existing, paused: false };
      } else {
        return { handled: true, status: 'paused' };
      }
    }

    // Sem bot / menu: nota de voz não escolhe menu — pede texto
    if (!existing?.chatbotId) {
      try {
        await this.wa.sendText(
          input.whatsapp,
          'Para começar, responde com o número do menu (1 a 5) por escrito. Se ainda não viste o menu, escreve oi.',
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

      if (row.whatsappDigits) {
        await this.detachBotIfOutsideCrm(row.whatsappDigits);
      } else if (row.instagramUserId) {
        await this.detachBotIfOutsideCrmByInstagram(row.instagramUserId);
      }
      const fresh = await this.prisma.joanaConversation.findUnique({
        where: { id: row.id },
        include: { chatbot: true },
      });
      if (!fresh) continue;

      const claimed = await this.prisma.joanaConversation.updateMany({
        where: { id: fresh.id, processing: false },
        data: { processing: true, processingStartedAt: new Date() },
      });
      if (claimed.count !== 1) continue;

      try {
        if (!fresh.chatbotId) {
          await this.processMenuTurn(fresh.id);
        } else if (
          fresh.chatbot?.engineKind === ChatbotEngineKind.HANDOFF_OTHER
        ) {
          await this.prisma.joanaConversation.update({
            where: { id: fresh.id },
            data: {
              processing: false,
              paused: true,
              buffer: [] as unknown as Prisma.InputJsonValue,
              pendingOutbound: null,
            },
          });
        } else if (
          fresh.chatbot?.engineKind === ChatbotEngineKind.JOANA_QUALIFICATION
        ) {
          // Joana processConversation faz o próprio claim — libertar e delegar
          await this.prisma.joanaConversation.update({
            where: { id: fresh.id },
            data: { processing: false },
          });
          await this.joana.processConversationPublic(fresh.id);
        } else {
          await this.generic.processConversation(fresh.id);
        }
      } catch (err: unknown) {
        this.logger.warn(
          `Chatbot flush ${fresh.whatsappDigits || fresh.instagramUserId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        await this.prisma.joanaConversation.updateMany({
          where: { id: fresh.id },
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
    const menuText = await this.chatbots.getMenuText();
    const buffer = readBuffer(row.buffer);

    if (!row.menuSent) {
      try {
        await this.outbound.sendText(row, menuText, {
          requireDelivery: true,
        });
      } catch (err: unknown) {
        this.logger.warn(
          `Menu envio ${row.whatsappDigits || row.instagramUserId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        await this.release(id);
        return;
      }

      // Se já havia texto no buffer (ex. «oi»), guardar no histórico e limpar;
      // a próxima mensagem é a escolha (número ou texto livre).
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
    const choice = await this.chatbots.resolveMenuChoice(combined, bots);

    if (!choice) {
      const clarify =
        `Não percebi o assunto. Podes dizer por exemplo «relocation», «crédito», «visto», «publicidade» ou «outros», ou o número 1 a 5.\n\n${menuText}`;
      try {
        await this.outbound.sendText(row, clarify, { requireDelivery: true });
      } catch (err: unknown) {
        this.logger.warn(
          `Menu reenvio ${row.whatsappDigits || row.instagramUserId}: ${
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
            { role: 'assistant', text: clarify },
          ]) as unknown as Prisma.InputJsonValue,
          processing: false,
        },
      });
      return;
    }

    const bot = await this.chatbots.requireBySlug(choice);

    if (bot.engineKind === ChatbotEngineKind.HANDOFF_OTHER) {
      await this.assignOutrosHandoff({
        conversationId: id,
        botId: bot.id,
        whatsapp: row.whatsappDigits,
        instagramUserId: row.instagramUserId,
        displayName: row.displayName,
        instance: row.instance,
        userText: combined,
        history: readHistory(row.history),
      });
      return;
    }

    // Lead no CRM trava o bot: sem ficha, o próximo contacto volta ao menu.
    // Joana: CrmLead é o «lock» até nascer a ficha RafaCall por interesse.
    // No IG a ficha pode nascer só com IGSID (WhatsApp só no /agendar).
    await this.crm.ensureLeadOnMenuAssign({
      chatbotId: bot.id,
      whatsappDigits: row.whatsappDigits,
      instagramUserId: row.instagramUserId,
      displayName: row.displayName,
    });

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
      await this.outbound.sendText(
        row,
        `Perfeito — vou passar-te para a ${bot.name}.`,
        { requireDelivery: true },
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
      channel: row.activeChannel === ChatbotChannel.INSTAGRAM ? 'instagram' : 'whatsapp',
      whatsapp: row.whatsappDigits,
      instagramUserId: row.instagramUserId,
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

  private async assignOutrosHandoff(input: {
    conversationId: string;
    botId: string;
    whatsapp: string | null;
    instagramUserId: string | null;
    displayName: string | null;
    instance: string | null;
    userText: string;
    history: HistoryItem[];
  }): Promise<void> {
    const subjectSummary = await this.chatbots.summarizeSubject(input.userText);

    await this.crm.ensureLeadOnMenuAssign({
      chatbotId: input.botId,
      whatsappDigits: input.whatsapp,
      instagramUserId: input.instagramUserId,
      displayName: input.displayName,
      botEnabled: false,
      subjectSummary,
    });

    const row = await this.prisma.joanaConversation.findUnique({
      where: { id: input.conversationId },
    });
    try {
      if (row) {
        await this.outbound.sendText(row, OUTROS_HANDOFF_MESSAGE, {
          requireDelivery: true,
        });
      } else if (input.whatsapp) {
        await this.wa.sendText(input.whatsapp, OUTROS_HANDOFF_MESSAGE, {
          preferredInstance: input.instance || undefined,
          requireDelivery: true,
        });
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Outros handoff ${input.whatsapp || input.instagramUserId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    await this.prisma.joanaConversation.update({
      where: { id: input.conversationId },
      data: {
        chatbotId: input.botId,
        menuSent: true,
        welcomeSent: true,
        paused: true,
        buffer: [] as unknown as Prisma.InputJsonValue,
        pendingOutbound: null,
        history: appendHistory(input.history, [
          { role: 'user', text: input.userText },
          { role: 'assistant', text: OUTROS_HANDOFF_MESSAGE },
        ]) as unknown as Prisma.InputJsonValue,
        processing: false,
      },
    });
  }

  /**
   * Com chatbot Off no CRM Outros: guarda o texto como assunto (resumo)
   * sem voltar a responder automaticamente.
   */
  private async tryCaptureOutrosSubject(input: {
    whatsapp: string;
    text: string;
    pushName?: string;
  }): Promise<boolean> {
    const lead = await this.crm.findActiveOutrosLead(input.whatsapp);
    if (!lead) return false;

    const summary = await this.chatbots.summarizeSubject(input.text);
    if (summary) {
      await this.crm.updateSubjectSummary(lead.id, summary);
    }

    const row = await this.prisma.joanaConversation.findFirst({
      where: {
        whatsappDigits: input.whatsapp,
        activeChannel: ChatbotChannel.WHATSAPP,
      },
      select: { id: true, history: true, displayName: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (row) {
      await this.prisma.joanaConversation.update({
        where: { id: row.id },
        data: {
          history: appendHistory(readHistory(row.history), [
            { role: 'user', text: input.text.trim() },
          ]) as unknown as Prisma.InputJsonValue,
          displayName: row.displayName || cleanName(input.pushName),
          paused: true,
          buffer: [] as unknown as Prisma.InputJsonValue,
        },
      });
    }
    return true;
  }

  /**
   * Sem ficha em nenhum CRM, tira a atribuição do bot para forçar o menu —
   * mesmo que já exista histórico de mensagens.
   */
  private async detachBotIfOutsideCrm(whatsapp: string): Promise<void> {
    const inCrm = await this.crm.isWhatsappInAnyCrm(whatsapp);
    if (inCrm) return;

    const existing = await this.prisma.joanaConversation.findFirst({
      where: {
        whatsappDigits: whatsapp,
        activeChannel: ChatbotChannel.WHATSAPP,
      },
      select: { id: true, chatbotId: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!existing?.chatbotId) return;

    await this.resetConversationToMenu(existing.id, whatsapp);
  }

  private async detachBotIfOutsideCrmByInstagram(
    instagramUserId: string,
  ): Promise<void> {
    const inCrm = await this.crm.isInstagramInAnyCrm(instagramUserId);
    if (inCrm) return;

    const existing = await this.prisma.joanaConversation.findUnique({
      where: { instagramUserId },
      select: { id: true, chatbotId: true },
    });
    if (!existing?.chatbotId) return;

    await this.resetConversationToMenu(existing.id, `ig:${instagramUserId}`);
  }

  private async resetConversationToMenu(
    conversationId: string,
    label: string,
  ): Promise<void> {
    await this.prisma.joanaConversation.update({
      where: { id: conversationId },
      data: {
        chatbotId: null,
        menuSent: false,
        welcomeSent: false,
        paused: false,
        buffer: [] as unknown as Prisma.InputJsonValue,
        pendingConfirmation: Prisma.JsonNull,
        pendingOutbound: null,
        farGuidanceSent: false,
        schedulingLinkSent: false,
      },
    });
    this.logger.log(
      `Menu: ${label} sem CRM — conversa reposta para o menu inicial`,
    );
  }

  private async findConversation(input: {
    whatsapp?: string;
    instagramUserId?: string;
  }) {
    if (input.instagramUserId) {
      const byIg = await this.prisma.joanaConversation.findUnique({
        where: { instagramUserId: input.instagramUserId },
        include: { chatbot: true },
      });
      if (byIg) return byIg;
    }
    if (input.whatsapp) {
      // Preferir conversa WA activa (não IG) se houver várias com o mesmo número.
      const byWaActive = await this.prisma.joanaConversation.findFirst({
        where: {
          whatsappDigits: input.whatsapp,
          activeChannel: ChatbotChannel.WHATSAPP,
        },
        include: { chatbot: true },
        orderBy: { updatedAt: 'desc' },
      });
      if (byWaActive) return byWaActive;
      return this.prisma.joanaConversation.findFirst({
        where: { whatsappDigits: input.whatsapp },
        include: { chatbot: true },
        orderBy: { updatedAt: 'desc' },
      });
    }
    return null;
  }

  private async appendBuffer(input: {
    channel: InboundChannel;
    whatsapp: string | null;
    instagramUserId: string | null;
    instance: string | null;
    displayName: string | null;
    item: BufferItem;
  }) {
    const existing = await this.findConversation({
      whatsapp: input.whatsapp || undefined,
      instagramUserId: input.instagramUserId || undefined,
    });

    if (!existing) {
      try {
        await this.prisma.joanaConversation.create({
          data: {
            whatsappDigits: input.whatsapp,
            instagramUserId: input.instagramUserId,
            activeChannel:
              input.channel === 'instagram'
                ? ChatbotChannel.INSTAGRAM
                : ChatbotChannel.WHATSAPP,
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
      (await this.findConversation({
        whatsapp: input.whatsapp || undefined,
        instagramUserId: input.instagramUserId || undefined,
      }));
    if (!row) return;

    for (let attempt = 0; attempt < 3; attempt++) {
      const current =
        attempt === 0
          ? row
          : await this.prisma.joanaConversation.findUnique({
              where: { id: row.id },
            });
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
          activeChannel:
            input.channel === 'instagram'
              ? ChatbotChannel.INSTAGRAM
              : current.activeChannel,
          instagramUserId: current.instagramUserId || input.instagramUserId,
          whatsappDigits: current.whatsappDigits || input.whatsapp,
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
