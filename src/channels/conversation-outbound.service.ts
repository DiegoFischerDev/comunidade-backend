import { Injectable, Logger } from '@nestjs/common';
import { ChatbotChannel, Prisma } from '@prisma/client';
import { InstagramService } from '../instagram/instagram.service';
import { PrismaService } from '../prisma/prisma.service';
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
      const { tripped, count } = this.outboundGuard.recordSuccessfulSend(peer);
      if (tripped) {
        this.logger.error(
          `Circuit-breaker anti-loop IG ${peer.igsid}: ${count} envios na janela — pausando conversa.`,
        );
        await this.pausePeerConversation(peer);
      }
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
