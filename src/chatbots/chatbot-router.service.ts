import { Injectable, Logger } from '@nestjs/common';
import {
  ChannelMessageAuthor,
  ChannelMessageDirection,
  ChannelMessageKind,
  ChatbotChannel,
  ChatbotEngineKind,
  Prisma,
} from '@prisma/client';
import { ChannelMessageLogService, AUDIO_TRANSCRIPT_FAILED } from '../channels/channel-message-log.service';
import { ConversationOutboundService } from '../channels/conversation-outbound.service';
import {
  instagramPeer,
  sharedOutboundGuard,
  whatsappPeer,
} from '../channels/outbound-guard';
import { PrismaService } from '../prisma/prisma.service';
import { JOANA_AUDIO_UNHEARD } from '../joana/joana-audio';
import { JoanaOpenAiService } from '../joana/joana-openai.service';
import { JoanaService } from '../joana/joana.service';
import { JOANA_INTRO } from '../joana/joana-turn';
import { welcomeStepsHistorySummary } from '../joana/joana-welcome';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { InstagramService } from '../instagram/instagram.service';
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
    private readonly messageLog: ChannelMessageLogService,
    private readonly instagram: InstagramService,
  ) {}

  /**
   * Actualiza nome / @ a partir do User Profile API (o webhook IG só traz IGSID).
   * Propaga para conversa, CrmLead e ficha RafaCall se ainda for «Lead IG …».
   */
  async enrichInstagramSender(input: {
    instagramUserId: string;
    profileName?: string | null;
    profileUsername?: string | null;
    profilePicUrl?: string | null;
  }): Promise<void> {
    const ig = input.instagramUserId.trim();
    if (!ig) return;

    const displayName =
      cleanName(input.profileName) ||
      (input.profileUsername?.trim()
        ? `@${input.profileUsername.trim().replace(/^@+/, '')}`
        : null);
    const handle = input.profileUsername?.trim()
      ? `@${input.profileUsername.trim().replace(/^@+/, '').slice(0, 119)}`
      : null;

    if (displayName) {
      await this.prisma.joanaConversation.updateMany({
        where: {
          instagramUserId: ig,
          OR: [{ displayName: null }, { displayName: { startsWith: 'Lead IG' } }],
        },
        data: { displayName },
      });
    }

    const leads = await this.prisma.crmLead.findMany({
      where: { instagramUserId: ig, crmExcludedAt: null },
      select: {
        id: true,
        guestName: true,
        instagramHandle: true,
        rafaCallBookingId: true,
        crmProfileImageUrl: true,
      },
    });

    for (const lead of leads) {
      const nextName =
        displayName &&
        (!lead.guestName?.trim() || /^Lead\s+IG\b/i.test(lead.guestName))
          ? displayName
          : undefined;

      if (nextName || handle) {
        await this.prisma.crmLead.update({
          where: { id: lead.id },
          data: {
            ...(nextName ? { guestName: nextName } : {}),
            ...(handle ? { instagramHandle: handle } : {}),
          },
        });
      }

      if (lead.rafaCallBookingId && nextName) {
        const booking = await this.prisma.rafaCallBooking.findUnique({
          where: { id: lead.rafaCallBookingId },
          select: { guestName: true },
        });
        if (
          booking &&
          (!booking.guestName?.trim() || /^Lead\s+IG\b/i.test(booking.guestName))
        ) {
          await this.prisma.rafaCallBooking.update({
            where: { id: lead.rafaCallBookingId },
            data: { guestName: nextName },
          });
        }
      }
    }

    // Avatar: descarrega profile_pic (URL Meta expira) e grava no CRM.
    if (input.profilePicUrl?.trim() || leads.some((l) => !l.crmProfileImageUrl)) {
      const existingUrl =
        leads.map((l) => l.crmProfileImageUrl?.trim() || null).find(Boolean) ||
        null;
      this.crm.scheduleEnsureInstagramProfileImage(
        ig,
        existingUrl,
        input.profilePicUrl ?? null,
      );
    }
  }

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
    kind?: ChannelMessageKind;
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

    if (!(await this.chatbots.isChannelEnabled(channel))) {
      return { handled: true, status: 'channel_disabled' };
    }

    const text = input.text.trim();
    if (!text) return { handled: true, status: 'ignored_empty' };

    const messageId = (input.externalMessageId || '').trim();
    if (!sharedOutboundGuard.claimInboundMessageId(messageId || null)) {
      return { handled: true, status: 'ignored_duplicate' };
    }

    const peer = whatsapp
      ? whatsappPeer(whatsapp)
      : instagramUserId
        ? instagramPeer(instagramUserId)
        : null;
    if (
      peer &&
      sharedOutboundGuard.isAutomatedEcho({
        peer,
        messageId: messageId || null,
        text,
      })
    ) {
      this.logger.log(
        `Anti-loop: eco outbound ignorado (${peer.channel} ${messageId || 'sem-id'})`,
      );
      return { handled: true, status: 'ignored_echo' };
    }

    if (whatsapp) {
      await this.detachBotIfOutsideCrm(whatsapp);
    } else if (instagramUserId) {
      await this.detachBotIfOutsideCrmByInstagram(instagramUserId);
    }

    let existing = await this.findConversation({
      whatsapp: whatsapp || undefined,
      instagramUserId: instagramUserId || undefined,
    });

    const kind = input.kind ?? ChannelMessageKind.TEXT;
    const logChannel =
      channel === 'instagram' ? ChatbotChannel.INSTAGRAM : ChatbotChannel.WHATSAPP;
    const logLead = async (conversationId: string, mirror: boolean) => {
      await this.messageLog.record({
        conversationId,
        channel: logChannel,
        direction: ChannelMessageDirection.INBOUND,
        author: ChannelMessageAuthor.LEAD,
        kind,
        body: text,
        externalMessageId: messageId || null,
        mirrorHistory: mirror ? 'user' : undefined,
      });
    };

    if (existing?.paused) {
      if (existing.whatsappDigits) {
        const captured = await this.tryCaptureOutrosSubject({
          whatsapp: existing.whatsappDigits,
          text,
          pushName: input.pushName,
        });
        if (captured) {
          await logLead(existing.id, true);
          return { handled: true, status: 'outros_subject_captured' };
        }
      }

      if (!existing.chatbotId) {
        await this.prisma.joanaConversation.update({
          where: { id: existing.id },
          data: { paused: false },
        });
        existing = { ...existing, paused: false };
      } else {
        // Admin Off → silêncio. Circuit expirado / pausa indevida → retomar.
        const resumed = await this.tryResumePausedConversation(existing, peer);
        if (!resumed) {
          await logLead(existing.id, true);
          return { handled: true, status: 'paused' };
        }
        existing = { ...existing, paused: false };
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
          if (captured) {
            await logLead(existing.id, true);
            return { handled: true, status: 'outros_subject_captured' };
          }
        }
        await logLead(existing.id, true);
        return { handled: true, status: 'paused' };
      }
      if (existing.chatbot?.engineKind === ChatbotEngineKind.HANDOFF_OTHER) {
        await logLead(existing.id, true);
        return { handled: true, status: 'paused' };
      }
      if (
        existing.chatbot?.engineKind === ChatbotEngineKind.JOANA_QUALIFICATION
      ) {
        // WhatsApp: buffer da Joana (exige instância Evolution).
        // Instagram: nunca usar joana.bufferInbound — sem instance Evolution a DM
        // era descartada (ignored_instance) e o bot ficava mudo.
        if (existing.whatsappDigits && channel !== 'instagram') {
          return this.joana.bufferInbound({
            whatsapp: existing.whatsappDigits,
            text,
            instance: instance || existing.instance || undefined,
            pushName: input.pushName,
            externalMessageId: input.externalMessageId,
            kind,
          });
        }
        // IG (com ou sem WA): appendBuffer abaixo → flush → processConversationPublic.
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

    const stored =
      existing ??
      (await this.findConversation({
        whatsapp: whatsapp || undefined,
        instagramUserId: instagramUserId || undefined,
      }));
    if (stored) await logLead(stored.id, false);

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
    if (!(await this.chatbots.isChannelEnabled('whatsapp'))) {
      return { handled: true, status: 'channel_disabled' };
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
        await this.storePausedWhatsappVoice(existing.id, input);
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
        kind: ChannelMessageKind.AUDIO_TRANSCRIPT,
      });
      return { handled: true, status: buffered.status };
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.replyUnheard(input.whatsapp, instance, reason);
    return { handled: true, status: 'audio_unheard' };
    }
  }

  /**
   * Áudio do Instagram: grava já a linha e transcreve em seguida, sem atrasar o 200 do webhook.
   */
  async acceptInstagramAudio(input: {
    instagramUserId: string;
    externalMessageId: string;
    audioUrl: string;
    pushName?: string;
  }): Promise<void> {
    const instagramUserId = input.instagramUserId.trim();
    const externalMessageId = input.externalMessageId.trim();
    if (!instagramUserId || !externalMessageId || !input.audioUrl.trim()) return;

    const conversationId = await this.ensureInstagramConversation(
      instagramUserId,
      input.pushName,
    );
    if (!conversationId) return;

    await this.messageLog.record({
      conversationId,
      channel: ChatbotChannel.INSTAGRAM,
      direction: ChannelMessageDirection.INBOUND,
      author: ChannelMessageAuthor.LEAD,
      kind: ChannelMessageKind.AUDIO_TRANSCRIPT,
      body: this.messageLog.pendingAudioText(),
      externalMessageId,
    });

    void this.finishInstagramAudio({
      ...input,
      instagramUserId,
      externalMessageId,
      conversationId,
    }).catch((err: unknown) => {
      this.logger.warn(
        `IG áudio ${instagramUserId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  private async finishInstagramAudio(input: {
    instagramUserId: string;
    externalMessageId: string;
    audioUrl: string;
    pushName?: string;
    conversationId: string;
  }): Promise<void> {
    let transcript = '';
    try {
      const media = await this.instagram.downloadAttachment(input.audioUrl);
      transcript = await this.openai.transcribeAudio({
        base64: media.base64,
        mimeType: media.mimeType,
        fileName: media.fileName,
      });
    } catch (err: unknown) {
      this.logger.warn(
        `IG transcrição ${input.instagramUserId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (!transcript) {
      await this.messageLog.record({
        conversationId: input.conversationId,
        channel: ChatbotChannel.INSTAGRAM,
        direction: ChannelMessageDirection.INBOUND,
        author: ChannelMessageAuthor.LEAD,
        kind: ChannelMessageKind.AUDIO_TRANSCRIPT,
        body: AUDIO_TRANSCRIPT_FAILED,
        externalMessageId: input.externalMessageId,
      });
      const row = await this.prisma.joanaConversation.findUnique({
        where: { id: input.conversationId },
      });
      if (row && !row.paused) {
        try {
          await this.outbound.sendText(row, JOANA_AUDIO_UNHEARD);
        } catch {
          /* ignore */
        }
      }
      return;
    }

    await this.bufferInbound({
      channel: 'instagram',
      instagramUserId: input.instagramUserId,
      text: transcript,
      pushName: input.pushName,
      externalMessageId: input.externalMessageId,
      kind: ChannelMessageKind.AUDIO_TRANSCRIPT,
    });
  }

  private async ensureInstagramConversation(
    instagramUserId: string,
    pushName?: string,
  ): Promise<string | null> {
    const existing = await this.prisma.joanaConversation.findUnique({
      where: { instagramUserId },
      select: { id: true },
    });
    if (existing) return existing.id;
    try {
      const created = await this.prisma.joanaConversation.create({
        data: {
          instagramUserId,
          activeChannel: ChatbotChannel.INSTAGRAM,
          displayName: cleanName(pushName),
          buffer: [] as unknown as Prisma.InputJsonValue,
          history: [] as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      return created.id;
    } catch (err: unknown) {
      if (
        !(err instanceof Prisma.PrismaClientKnownRequestError) ||
        err.code !== 'P2002'
      ) {
        throw err;
      }
      const again = await this.prisma.joanaConversation.findUnique({
        where: { instagramUserId },
        select: { id: true },
      });
      return again?.id ?? null;
    }
  }

  private async storePausedWhatsappVoice(
    conversationId: string,
    input: {
      whatsapp: string;
      instance: string;
      externalMessageId?: string;
      mediaMessage?: Record<string, unknown>;
    },
  ): Promise<void> {
    const messageId = (input.externalMessageId || '').trim();
    let body = AUDIO_TRANSCRIPT_FAILED;
    if (messageId) {
      try {
        const media = await this.wa.getMediaBase64(input.instance, messageId, {
          convertToMp4: false,
          message: input.mediaMessage,
        });
        if (media?.base64) {
          const transcript = await this.openai.transcribeAudio({
            base64: media.base64,
            mimeType: media.mimetype,
            fileName: media.fileName,
          });
          if (transcript) body = transcript;
        }
      } catch (err: unknown) {
        this.logger.warn(
          `WA áudio em pausa ${input.whatsapp}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    await this.messageLog.record({
      conversationId,
      channel: ChatbotChannel.WHATSAPP,
      direction: ChannelMessageDirection.INBOUND,
      author: ChannelMessageAuthor.LEAD,
      kind: ChannelMessageKind.AUDIO_TRANSCRIPT,
      body,
      externalMessageId: messageId || null,
      mirrorHistory: 'user',
    });
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
    // Só conversas com texto no buffer (debounce cumprido) ou resposta por enviar.
    // Sem isto, o take 20 fica nas conversas antigas já respondidas.
    const due = await this.prisma.joanaConversation.findMany({
      where: {
        processing: false,
        OR: [
          { pendingOutbound: { not: null } },
          {
            lastInboundAt: { lte: dueBefore },
            NOT: { buffer: { equals: [] as Prisma.InputJsonValue } },
          },
        ],
      },
      take: 20,
      orderBy: { lastInboundAt: { sort: 'asc', nulls: 'last' } },
      include: { chatbot: true },
    });

    for (const row of due) {
      const buffer = readBuffer(row.buffer);
      if (!row.pendingOutbound && buffer.length === 0) continue;
      if (!row.pendingOutbound && row.lastInboundAt && row.lastInboundAt > dueBefore) {
        continue;
      }

      // IG com WhatsApp na ficha: detach pelo IGSID (não pelo WA).
      if (
        row.activeChannel === ChatbotChannel.INSTAGRAM &&
        row.instagramUserId
      ) {
        await this.detachBotIfOutsideCrmByInstagram(row.instagramUserId);
      } else if (row.whatsappDigits) {
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

    const publicBot = await this.chatbots.getBySlug(choice);
    const contactLabel =
      row.whatsappDigits || row.instagramUserId || id;

    // 1ª interação do bot = só a sequência de boas-vindas (sem OpenAI).
    // A próxima mensagem real do lead é que entra na análise.
    let welcomeSummary = '';
    let welcomeSent = false;
    try {
      if (publicBot.welcomeSteps.length > 0) {
        await this.outbound.sendWelcomeSteps(row, publicBot.welcomeSteps, {
          requireDelivery: true,
        });
        welcomeSummary = welcomeStepsHistorySummary(publicBot.welcomeSteps);
        welcomeSent = true;
      } else {
        const fallback =
          publicBot.introFallback?.trim() ||
          (choice === 'joana' ? JOANA_INTRO : '');
        if (fallback) {
          await this.outbound.sendText(row, fallback, {
            requireDelivery: true,
          });
          welcomeSummary = fallback;
          welcomeSent = true;
        }
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Menu assign / boas-vindas ${contactLabel}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const historyExtra: HistoryItem[] = [
      { role: 'user', text: combined },
    ];
    if (welcomeSummary) {
      historyExtra.push({ role: 'assistant', text: welcomeSummary });
    }

    await this.prisma.joanaConversation.update({
      where: { id },
      data: {
        chatbotId: bot.id,
        welcomeSent,
        buffer: [] as unknown as Prisma.InputJsonValue,
        history: appendHistory(
          readHistory(row.history),
          historyExtra,
        ) as unknown as Prisma.InputJsonValue,
        processing: false,
      },
    });
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
   * Conversa pausada com bot On e circuit fechado → retoma (pausa indevida
   * por check WA no IG, ou circuit já expirou após restart).
   */
  private async tryResumePausedConversation(
    existing: {
      id: string;
      chatbotId: string | null;
      whatsappDigits: string | null;
      instagramUserId: string | null;
      activeChannel: ChatbotChannel;
    },
    peer: ReturnType<typeof whatsappPeer> | ReturnType<typeof instagramPeer> | null,
  ): Promise<boolean> {
    if (!existing.chatbotId) return true;

    if (peer && sharedOutboundGuard.isCircuitOpen(peer)) {
      return false;
    }

    const lead = await this.crm.findActiveLead(existing.chatbotId, {
      whatsappDigits: existing.whatsappDigits,
      instagramUserId: existing.instagramUserId,
    });
    if (lead && !lead.botEnabled) {
      return false;
    }

    await this.prisma.joanaConversation.update({
      where: { id: existing.id },
      data: { paused: false },
    });
    this.logger.log(
      `Chatbot: conversa ${existing.id} retomada após pausa (bot On / circuit fechado)`,
    );
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
