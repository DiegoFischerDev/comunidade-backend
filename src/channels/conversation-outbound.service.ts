import { Injectable, Logger } from '@nestjs/common';
import { ChatbotChannel } from '@prisma/client';
import { InstagramService } from '../instagram/instagram.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

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

  constructor(
    private readonly wa: WhatsAppService,
    private readonly instagram: InstagramService,
  ) {}

  askWhatsappMessage(): string {
    return ASK_WHATSAPP_MESSAGE;
  }

  /**
   * Envia texto pelo canal activo da conversa (IG ou WhatsApp).
   */
  async sendText(
    row: ConversationOutboundRow,
    text: string,
    opts?: { requireDelivery?: boolean },
  ): Promise<void> {
    const body = text.trim();
    if (!body) return;

    if (
      row.activeChannel === ChatbotChannel.INSTAGRAM &&
      row.instagramUserId
    ) {
      await this.instagram.sendText(row.instagramUserId, body);
      return;
    }

    const whatsapp = (row.whatsappDigits || '').trim();
    if (!whatsapp) {
      this.logger.warn(
        'Outbound sem WhatsApp nem Instagram — mensagem descartada',
      );
      throw new Error('conversation_outbound_no_channel');
    }

    await this.wa.sendText(whatsapp, body, {
      preferredInstance: row.instance || undefined,
      requireDelivery: opts?.requireDelivery,
    });
  }
}

/** Extrai dígitos de um possível número WhatsApp (10–15 dígitos). */
export function parseWhatsappDigitsCandidate(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}
