import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import {
  ChannelMessageAuthor,
  ChannelMessageDirection,
  ChannelMessageKind,
  ChatbotChannel,
  Prisma,
} from '@prisma/client';
import { InstagramService } from '../instagram/instagram.service';
import {
  guessWelcomeImageMime,
  pickWelcomeMediaForChannel,
  resolveWelcomeMediaUrl,
  type JoanaWelcomeStep,
  type WelcomeChannel,
} from '../joana/joana-welcome';
import { PrismaService } from '../prisma/prisma.service';
import { enrichWelcomeStepsChannelMedia } from '../uploads/channel-media.util';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { ChannelMessageLogService } from './channel-message-log.service';
import {
  instagramPeer,
  sharedOutboundGuard,
  whatsappPeer,
  type OutboundPeer,
} from './outbound-guard';

export type ConversationOutboundRow = {
  whatsappDigits: string | null;
  instagramUserId: string | null;
  activeChannel: ChatbotChannel;
  instance?: string | null;
};

const ASK_WHATSAPP_MESSAGE =
  'Para te atender melhor e guardar a tua ficha, envia o teu WhatsApp com o indicativo do país (só números). Ex.: 5511999999999';

export const ATTENDANCE_CLOSED_MESSAGE = 'Seu atendimento foi encerrado 🤗';

export type AttendanceCloseCandidate = ConversationOutboundRow & {
  lastInboundAt?: Date | null;
  updatedAt?: Date | null;
};

/**
 * Canal do aviso de encerramento: a conversa com inbound mais recente.
 * Sem histórico, WhatsApp se houver número; senão Instagram.
 */
export function pickAttendanceCloseTarget(
  rows: AttendanceCloseCandidate[],
  identity: { whatsappDigits: string | null; instagramUserId: string | null },
): ConversationOutboundRow | null {
  const ranked = [...rows].sort((left, right) => {
    const leftInbound = left.lastInboundAt?.getTime() ?? 0;
    const rightInbound = right.lastInboundAt?.getTime() ?? 0;
    if (leftInbound !== rightInbound) return rightInbound - leftInbound;
    return (right.updatedAt?.getTime() ?? 0) - (left.updatedAt?.getTime() ?? 0);
  });

  const row = ranked[0];
  if (row) {
    return {
      whatsappDigits: row.whatsappDigits,
      instagramUserId: row.instagramUserId,
      activeChannel: row.activeChannel,
      instance: row.instance ?? null,
    };
  }

  if (identity.whatsappDigits) {
    return {
      whatsappDigits: identity.whatsappDigits,
      instagramUserId: identity.instagramUserId,
      activeChannel: ChatbotChannel.WHATSAPP,
      instance: null,
    };
  }

  if (identity.instagramUserId) {
    return {
      whatsappDigits: null,
      instagramUserId: identity.instagramUserId,
      activeChannel: ChatbotChannel.INSTAGRAM,
      instance: null,
    };
  }

  return null;
}

@Injectable()
export class ConversationOutboundService {
  private readonly logger = new Logger(ConversationOutboundService.name);
  private readonly outboundGuard = sharedOutboundGuard;

  constructor(
    private readonly wa: WhatsAppService,
    @Inject(forwardRef(() => InstagramService))
    private readonly instagram: InstagramService,
    private readonly prisma: PrismaService,
    private readonly messageLog: ChannelMessageLogService,
  ) {}

  askWhatsappMessage(): string {
    return ASK_WHATSAPP_MESSAGE;
  }

  /**
   * Avisa o lead de que o atendimento fechou, no canal activo (WhatsApp ou Instagram).
   * Falha de envio não propaga — a exclusão do CRM já ficou registada.
   */
  async notifyAttendanceClosed(identity: {
    whatsappDigits?: string | null;
    instagramUserId?: string | null;
  }): Promise<void> {
    const whatsapp = (identity.whatsappDigits || '').replace(/\D/g, '');
    const whatsappDigits = whatsapp.length >= 8 ? whatsapp : null;
    const instagramUserId = (identity.instagramUserId || '').trim() || null;
    if (!whatsappDigits && !instagramUserId) return;

    try {
      const rows = await this.prisma.joanaConversation.findMany({
        where: {
          OR: [
            ...(whatsappDigits ? [{ whatsappDigits }] : []),
            ...(instagramUserId ? [{ instagramUserId }] : []),
          ],
        },
        select: {
          whatsappDigits: true,
          instagramUserId: true,
          activeChannel: true,
          instance: true,
          lastInboundAt: true,
          updatedAt: true,
        },
      });
      const target = pickAttendanceCloseTarget(rows, {
        whatsappDigits,
        instagramUserId,
      });
      if (!target) return;
      await this.sendText(target, ATTENDANCE_CLOSED_MESSAGE);
    } catch (err: unknown) {
      this.logger.warn(
        `Falha ao avisar encerramento do atendimento: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Envia texto pelo canal activo da conversa (IG ou WhatsApp).
   * Aplica circuit-breaker e regista fingerprint anti-eco.
   */
  async sendText(
    row: ConversationOutboundRow,
    text: string,
    opts?: { requireDelivery?: boolean; skipMessageLog?: boolean },
  ): Promise<void> {
    const body = text.trim();
    if (!body) return;

    const peer = this.resolvePeer(row);
    if (!peer) {
      this.logger.warn(
        'Outbound sem WhatsApp nem Instagram — mensagem descartada',
      );
      throw new Error('conversation_outbound_no_channel');
    }

    if (!this.outboundGuard.allowSend(peer)) {
      this.logger.warn(
        `Circuit-breaker anti-loop aberto (${peer.channel}); envio bloqueado.`,
      );
      if (opts?.requireDelivery) {
        throw new Error('outbound_circuit_open');
      }
      return;
    }

    if (peer.channel === 'instagram') {
      this.outboundGuard.rememberText(peer, body);
      try {
        await this.instagram.sendText(peer.igsid, body);
      } catch (err) {
        this.outboundGuard.forgetText(peer, body);
        throw err;
      }
      await this.afterSuccessfulSend(peer);
      await this.logBotText(row, body, opts?.skipMessageLog);
      return;
    }

    // WhatsApp: WhatsAppService já regista eco + circuit; aqui só pausamos se tripou.
    const beforeOpen = this.outboundGuard.isCircuitOpen(peer);
    await this.wa.sendText(peer.digits, body, {
      preferredInstance: row.instance || undefined,
      requireDelivery: opts?.requireDelivery,
    });
    await this.logBotText(row, body, opts?.skipMessageLog);
    if (!beforeOpen && this.outboundGuard.isCircuitOpen(peer)) {
      this.logger.error(
        `Circuit-breaker anti-loop WA ${peer.digits}: pausando conversa.`,
      );
      await this.pausePeerConversation(peer);
    }
  }

  /**
   * Sequência de boas-vindas (TEXT / AUDIO / IMAGE / DOCUMENT) no canal activo.
   * Áudio/imagem usam variantes por canal (WA Ogg / IG M4A) quando existem.
   */
  async sendWelcomeSteps(
    row: ConversationOutboundRow,
    steps: JoanaWelcomeStep[],
    opts?: { requireDelivery?: boolean },
  ): Promise<void> {
    const peer = this.resolvePeer(row);
    if (!peer) {
      throw new Error('conversation_outbound_no_channel');
    }

    const channel: WelcomeChannel =
      peer.channel === 'instagram' ? 'instagram' : 'whatsapp';
    const prepared = await enrichWelcomeStepsChannelMedia(steps);

    let sentAny = false;
    let lastError: unknown = null;

    for (let i = 0; i < prepared.length; i++) {
      const step = prepared[i]!;
      try {
        if (step.type === 'TEXT') {
          const body = (step.textContent || '').trim();
          if (body) {
            await this.sendText(row, body, opts);
            sentAny = true;
          }
        } else if (
          step.type === 'AUDIO' ||
          step.type === 'IMAGE' ||
          step.type === 'DOCUMENT'
        ) {
          const picked = pickWelcomeMediaForChannel(step, channel);
          if (!picked) {
            throw new Error(`Passo ${step.type} sem mediaUrl válida.`);
          }
          const abs = resolveWelcomeMediaUrl(picked.mediaUrl);
          if (!abs) {
            throw new Error(`Passo ${step.type} sem mediaUrl válida.`);
          }
          if (step.type === 'AUDIO') {
            await this.sendAttachment(row, {
              kind: 'audio',
              mediaUrl: abs,
              mimeType: picked.mediaMimeType || undefined,
              requireDelivery: opts?.requireDelivery,
            });
          } else if (step.type === 'IMAGE') {
            const mime =
              picked.mediaMimeType?.trim() ||
              guessWelcomeImageMime(picked.mediaFileName || abs);
            const fileName =
              picked.mediaFileName?.trim() ||
              abs.split('/').pop()?.split('?')[0] ||
              'image.jpg';
            await this.sendAttachment(row, {
              kind: 'image',
              mediaUrl: abs,
              mimeType: mime,
              fileName,
              caption: (step.textContent || '').trim(),
              requireDelivery: opts?.requireDelivery,
            });
          } else {
            const fileName =
              picked.mediaFileName?.trim() ||
              abs.split('/').pop()?.split('?')[0] ||
              'documento.pdf';
            await this.sendAttachment(row, {
              kind: 'document',
              mediaUrl: abs,
              mimeType: picked.mediaMimeType?.trim() || 'application/pdf',
              fileName,
              caption: (step.textContent || '').trim(),
              requireDelivery: opts?.requireDelivery,
            });
          }
          sentAny = true;
        }
      } catch (err: unknown) {
        lastError = err;
        this.logger.warn(
          `Boas-vindas passo ${i + 1}/${prepared.length} (${step.type}) falhou: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      const delay = Math.max(0, step.delayMsAfter ?? 650);
      if (i < prepared.length - 1 && delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    if (!sentAny && lastError) {
      throw lastError instanceof Error
        ? lastError
        : new Error(String(lastError));
    }
  }

  /**
   * Media no canal activo. No IG a Meta só aceita URL pública;
   * legendas de imagem/PDF saem como texto a seguir (a API IG não tem caption).
   */
  async sendAttachment(
    row: ConversationOutboundRow,
    input: {
      kind: 'audio' | 'image' | 'document';
      mediaUrl: string;
      mimeType?: string;
      fileName?: string;
      caption?: string;
      requireDelivery?: boolean;
    },
  ): Promise<void> {
    const peer = this.resolvePeer(row);
    if (!peer) {
      throw new Error('conversation_outbound_no_channel');
    }

    if (!this.outboundGuard.allowSend(peer)) {
      this.logger.warn(
        `Circuit-breaker anti-loop aberto (${peer.channel}); media bloqueada.`,
      );
      if (input.requireDelivery) {
        throw new Error('outbound_circuit_open');
      }
      return;
    }

    if (peer.channel === 'instagram') {
      const igType =
        input.kind === 'audio'
          ? 'audio'
          : input.kind === 'image'
            ? 'image'
            : 'file';
      this.outboundGuard.rememberMedia(peer);
      try {
        await this.instagram.sendAttachment({
          recipientIgUserId: peer.igsid,
          type: igType,
          mediaUrl: input.mediaUrl,
        });
      } catch (err) {
        this.outboundGuard.forgetMedia(peer);
        throw err;
      }
      await this.afterSuccessfulSend(peer);

      const caption = (input.caption || '').trim();
      if (caption) {
        await this.sendText(row, caption, {
          requireDelivery: input.requireDelivery,
        });
      }
      return;
    }

    const beforeOpen = this.outboundGuard.isCircuitOpen(peer);
    if (input.kind === 'audio') {
      await this.wa.sendWhatsAppAudio({
        to: peer.digits,
        mediaUrl: input.mediaUrl,
        preferredInstance: row.instance || undefined,
        requireDelivery: input.requireDelivery,
      });
    } else {
      await this.wa.sendMedia({
        to: peer.digits,
        caption: (input.caption || '').trim(),
        mediaUrl: input.mediaUrl,
        mimeType:
          input.mimeType ||
          (input.kind === 'image' ? 'image/jpeg' : 'application/pdf'),
        fileName:
          input.fileName ||
          (input.kind === 'image' ? 'image.jpg' : 'documento.pdf'),
        mediaType: input.kind === 'image' ? 'image' : 'document',
        preferredInstance: row.instance || undefined,
        requireDelivery: input.requireDelivery,
      });
    }
    if (!beforeOpen && this.outboundGuard.isCircuitOpen(peer)) {
      this.logger.error(
        `Circuit-breaker anti-loop WA ${peer.digits}: pausando conversa.`,
      );
      await this.pausePeerConversation(peer);
    }
  }

  private async afterSuccessfulSend(peer: OutboundPeer): Promise<void> {
    const { tripped, count } = this.outboundGuard.recordSuccessfulSend(peer);
    if (!tripped) return;
    this.logger.error(
      `Circuit-breaker anti-loop ${peer.channel}: ${count} envios na janela — pausando conversa.`,
    );
    await this.pausePeerConversation(peer);
  }

  private async logBotText(
    row: ConversationOutboundRow,
    body: string,
    skip?: boolean,
  ): Promise<void> {
    if (skip) return;
    try {
      const channel =
        row.activeChannel === ChatbotChannel.INSTAGRAM && row.instagramUserId?.trim()
          ? ChatbotChannel.INSTAGRAM
          : ChatbotChannel.WHATSAPP;
      const conversationId = await this.findLogConversationId(row, channel);
      if (!conversationId) return;
      await this.messageLog.record({
        conversationId,
        channel,
        direction: ChannelMessageDirection.OUTBOUND,
        author: ChannelMessageAuthor.BOT,
        kind: ChannelMessageKind.TEXT,
        body,
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Falha ao gravar outbound no histórico: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async findLogConversationId(
    row: ConversationOutboundRow,
    channel: ChatbotChannel,
  ): Promise<string | null> {
    if (channel === ChatbotChannel.INSTAGRAM && row.instagramUserId?.trim()) {
      const found = await this.prisma.joanaConversation.findUnique({
        where: { instagramUserId: row.instagramUserId.trim() },
        select: { id: true },
      });
      return found?.id ?? null;
    }
    const whatsapp = (row.whatsappDigits || '').trim();
    if (!whatsapp) return null;
    const found =
      (await this.prisma.joanaConversation.findFirst({
        where: { whatsappDigits: whatsapp, activeChannel: ChatbotChannel.WHATSAPP },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      })) ??
      (await this.prisma.joanaConversation.findFirst({
        where: { whatsappDigits: whatsapp },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      }));
    return found?.id ?? null;
  }

  private resolvePeer(row: ConversationOutboundRow): OutboundPeer | null {
    if (
      row.activeChannel === ChatbotChannel.INSTAGRAM &&
      row.instagramUserId?.trim()
    ) {
      return instagramPeer(row.instagramUserId);
    }
    const whatsapp = (row.whatsappDigits || '').trim();
    if (whatsapp) return whatsappPeer(whatsapp);
    if (row.instagramUserId?.trim()) {
      return instagramPeer(row.instagramUserId);
    }
    return null;
  }

  /** Pausa a conversa do peer (anti-loop). Admin reactiva no CRM. */
  private async pausePeerConversation(peer: OutboundPeer): Promise<void> {
    try {
      const pauseData = {
        paused: true,
        buffer: [] as unknown as Prisma.InputJsonValue,
        pendingOutbound: null,
        processing: false,
      };
      if (peer.channel === 'whatsapp') {
        await this.prisma.joanaConversation.updateMany({
          where: { whatsappDigits: peer.digits },
          data: pauseData,
        });
        return;
      }
      await this.prisma.joanaConversation.updateMany({
        where: { instagramUserId: peer.igsid },
        data: pauseData,
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Falha ao pausar conversa anti-loop: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

/** Extrai dígitos de um possível número WhatsApp (10–15 dígitos). */
export function parseWhatsappDigitsCandidate(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}
