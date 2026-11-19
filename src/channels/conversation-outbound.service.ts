import { Injectable, Logger } from '@nestjs/common';
import { ChatbotChannel, Prisma } from '@prisma/client';
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

@Injectable()
export class ConversationOutboundService {
  private readonly logger = new Logger(ConversationOutboundService.name);
  private readonly outboundGuard = sharedOutboundGuard;

  constructor(
    private readonly wa: WhatsAppService,
    private readonly instagram: InstagramService,
    private readonly prisma: PrismaService,
  ) {}

  askWhatsappMessage(): string {
    return ASK_WHATSAPP_MESSAGE;
  }

  /**
   * Envia texto pelo canal activo da conversa (IG ou WhatsApp).
   * Aplica circuit-breaker e regista fingerprint anti-eco.
   */
  async sendText(
    row: ConversationOutboundRow,
    text: string,
    opts?: { requireDelivery?: boolean },
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
      return;
    }

    // WhatsApp: WhatsAppService já regista eco + circuit; aqui só pausamos se tripou.
    const beforeOpen = this.outboundGuard.isCircuitOpen(peer);
    await this.wa.sendText(peer.digits, body, {
      preferredInstance: row.instance || undefined,
      requireDelivery: opts?.requireDelivery,
    });
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
