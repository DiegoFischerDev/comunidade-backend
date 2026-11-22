import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChannelMessageAuthor,
  ChannelMessageDirection,
  ChannelMessageKind,
  ChatbotChannel,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ChannelMessageLogService,
  type ChannelMessageView,
  serializeMessage,
} from './channel-message-log.service';
import { ConversationOutboundService } from './conversation-outbound.service';
import {
  buildSchedulingLink,
  schedulingInviteText,
} from './scheduling-link';

const PAGE_SIZE = 200;

export type ChannelChatIdentity = {
  whatsappDigits: string | null;
  instagramUserId: string | null;
  name: string | null;
  bookingId?: string | null;
};

@Injectable()
export class CrmChannelChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbound: ConversationOutboundService,
    private readonly messages: ChannelMessageLogService,
  ) {}

  async listForBooking(bookingId: string, channelRaw: string, after?: string | null) {
    const identity = await this.identityFromBooking(bookingId);
    return this.list({
      identity,
      channel: this.parseChannel(channelRaw),
      after,
    });
  }

  async sendForBooking(
    bookingId: string,
    input: { channel: ChatbotChannel; text?: string | null; template?: 'scheduling-link' | null },
  ) {
    const identity = await this.identityFromBooking(bookingId);
    return this.send({ identity, ...input });
  }

  async listForLead(slug: string, leadId: string, channelRaw: string, after?: string | null) {
    const identity = await this.identityFromLead(slug, leadId);
    return this.list({
      identity,
      channel: this.parseChannel(channelRaw),
      after,
    });
  }

  async sendForLead(
    slug: string,
    leadId: string,
    input: { channel: ChatbotChannel; text?: string | null; template?: 'scheduling-link' | null },
  ) {
    const identity = await this.identityFromLead(slug, leadId);
    return this.send({ identity, ...input });
  }

  private parseChannel(raw: string): ChatbotChannel {
    const value = (raw || '').trim().toUpperCase();
    if (value === ChatbotChannel.WHATSAPP || value === ChatbotChannel.INSTAGRAM || value === ChatbotChannel.FACEBOOK) {
      return value;
    }
    throw new BadRequestException('Canal inválido.');
  }

  private async identityFromBooking(bookingId: string): Promise<ChannelChatIdentity> {
    const booking = await this.prisma.rafaCallBooking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        crmExcludedAt: true,
        guestName: true,
        guestWhatsapp: true,
        user: { select: { name: true, whatsapp: true } },
      },
    });
    if (!booking || booking.crmExcludedAt) {
      throw new NotFoundException('Lead não encontrado.');
    }
    const fromBooking = (booking.guestWhatsapp || booking.user?.whatsapp || '').replace(/\D/g, '');
    const lead = await this.prisma.crmLead.findFirst({
      where: { rafaCallBookingId: booking.id, crmExcludedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: { whatsappDigits: true, instagramUserId: true, guestName: true },
    });
    const whatsapp = fromBooking.length >= 8 ? fromBooking : (lead?.whatsappDigits || '').replace(/\D/g, '');
    return {
      whatsappDigits: whatsapp.length >= 8 ? whatsapp : null,
      instagramUserId: lead?.instagramUserId?.trim() || null,
      name: booking.user?.name || booking.guestName || lead?.guestName || null,
      bookingId: booking.id,
    };
  }

  private async identityFromLead(slug: string, leadId: string): Promise<ChannelChatIdentity> {
    const bot = await this.prisma.chatbot.findUnique({
      where: { slug: slug.trim() },
      select: { id: true },
    });
    if (!bot) throw new NotFoundException('Chatbot não encontrado.');
    const lead = await this.prisma.crmLead.findFirst({
      where: { id: leadId, chatbotId: bot.id, crmExcludedAt: null },
      select: {
        whatsappDigits: true,
        instagramUserId: true,
        guestName: true,
        companyName: true,
      },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    const whatsapp = (lead.whatsappDigits || '').replace(/\D/g, '');
    return {
      whatsappDigits: whatsapp.length >= 8 ? whatsapp : null,
      instagramUserId: lead.instagramUserId?.trim() || null,
      name: lead.guestName || lead.companyName || null,
      bookingId: null,
    };
  }

  async list(input: {
    identity: ChannelChatIdentity;
    channel: ChatbotChannel;
    after?: string | null;
  }): Promise<{ messages: ChannelMessageView[] }> {
    const channel = this.assertOpenChannel(input.channel);
    this.assertIdentity(channel, input.identity);
    const conversation = await this.findConversation(channel, input.identity);
    if (!conversation) return { messages: [] };

    const afterId = input.after?.trim() || '';
    const cursor = afterId
      ? await this.prisma.channelMessage.findFirst({
          where: { id: afterId, conversationId: conversation.id, channel },
          select: { createdAt: true, id: true },
        })
      : null;

    const rows = cursor
      ? await this.prisma.channelMessage.findMany({
          where: {
            conversationId: conversation.id,
            channel,
            OR: [
              { createdAt: { gt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { gt: cursor.id } },
            ],
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 100,
        })
      : (
          await this.prisma.channelMessage.findMany({
            where: { conversationId: conversation.id, channel },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: PAGE_SIZE,
          })
        ).reverse();

    return { messages: rows.map(serializeMessage) };
  }

  async send(input: {
    identity: ChannelChatIdentity;
    channel: ChatbotChannel;
    text?: string | null;
    template?: 'scheduling-link' | null;
  }): Promise<{ message: ChannelMessageView; botPaused: true }> {
    const channel = this.assertOpenChannel(input.channel);
    this.assertIdentity(channel, input.identity);

    const text = input.template
      ? schedulingInviteText(
          buildSchedulingLink(input.identity.whatsappDigits, input.identity.name),
        )
      : (input.text || '').trim();
    if (!text) {
      throw new BadRequestException('Escreve uma mensagem.');
    }
    if (text.length > 4000) {
      throw new BadRequestException('A mensagem é demasiado longa.');
    }

    const conversation = await this.ensureConversation(channel, input.identity);
    await this.pauseLead(input.identity, conversation.id);

    const outboundRow = {
      whatsappDigits: conversation.whatsappDigits,
      instagramUserId: conversation.instagramUserId,
      activeChannel: channel,
      instance: conversation.instance,
    };

    try {
      await this.outbound.sendText(outboundRow, text, {
        requireDelivery: true,
        skipMessageLog: true,
      });
    } catch (err: unknown) {
      throw new BadRequestException(humanizeSendError(err));
    }

    const message = await this.messages.record({
      conversationId: conversation.id,
      channel,
      direction: ChannelMessageDirection.OUTBOUND,
      author: ChannelMessageAuthor.ADMIN,
      kind: ChannelMessageKind.TEXT,
      body: text,
      mirrorHistory: 'assistant',
    });
    if (!message) {
      throw new BadRequestException('A mensagem saiu, mas não foi possível guardá-la no histórico.');
    }
    return { message, botPaused: true };
  }

  private assertOpenChannel(channel: ChatbotChannel): ChatbotChannel {
    if (channel === ChatbotChannel.FACEBOOK) {
      throw new BadRequestException('O chat de Facebook ainda não está disponível.');
    }
    if (channel !== ChatbotChannel.WHATSAPP && channel !== ChatbotChannel.INSTAGRAM) {
      throw new BadRequestException('Canal inválido.');
    }
    return channel;
  }

  private assertIdentity(channel: ChatbotChannel, identity: ChannelChatIdentity): void {
    if (channel === ChatbotChannel.WHATSAPP && !identity.whatsappDigits) {
      throw new BadRequestException('Este lead não tem WhatsApp.');
    }
    if (channel === ChatbotChannel.INSTAGRAM && !identity.instagramUserId) {
      throw new BadRequestException('Este lead não tem conversa de Instagram.');
    }
  }

  private async findConversation(
    channel: ChatbotChannel,
    identity: ChannelChatIdentity,
  ) {
    if (channel === ChatbotChannel.INSTAGRAM && identity.instagramUserId) {
      return this.prisma.joanaConversation.findUnique({
        where: { instagramUserId: identity.instagramUserId },
      });
    }
    const whatsapp = identity.whatsappDigits;
    if (!whatsapp) return null;
    return (
      (await this.prisma.joanaConversation.findFirst({
        where: { whatsappDigits: whatsapp, activeChannel: ChatbotChannel.WHATSAPP },
        orderBy: { updatedAt: 'desc' },
      })) ??
      this.prisma.joanaConversation.findFirst({
        where: { whatsappDigits: whatsapp, instagramUserId: null },
        orderBy: { updatedAt: 'desc' },
      })
    );
  }

  private async ensureConversation(
    channel: ChatbotChannel,
    identity: ChannelChatIdentity,
  ) {
    const existing = await this.findConversation(channel, identity);
    if (existing) return existing;

    try {
      return await this.prisma.joanaConversation.create({
        data: {
          whatsappDigits: identity.whatsappDigits,
          instagramUserId:
            channel === ChatbotChannel.INSTAGRAM ? identity.instagramUserId : null,
          activeChannel: channel,
          displayName: identity.name?.slice(0, 80) || null,
          buffer: [] as unknown as Prisma.InputJsonValue,
          history: [] as unknown as Prisma.InputJsonValue,
          paused: true,
        },
      });
    } catch (err: unknown) {
      if (
        !(err instanceof Prisma.PrismaClientKnownRequestError) ||
        err.code !== 'P2002'
      ) {
        throw err;
      }
      const again = await this.findConversation(channel, identity);
      if (again) return again;
      throw new NotFoundException('Não foi possível abrir a conversa.');
    }
  }

  private async pauseLead(identity: ChannelChatIdentity, conversationId: string) {
    const whatsapp = identity.whatsappDigits;
    const instagramUserId = identity.instagramUserId;
    const or: Prisma.JoanaConversationWhereInput[] = [{ id: conversationId }];
    if (whatsapp) or.push({ whatsappDigits: whatsapp });
    if (instagramUserId) or.push({ instagramUserId });

    await this.prisma.joanaConversation.updateMany({
      where: { OR: or },
      data: {
        paused: true,
        buffer: [] as unknown as Prisma.InputJsonValue,
        pendingOutbound: null,
        processing: false,
      },
    });

    const leadOr: Prisma.CrmLeadWhereInput[] = [];
    if (whatsapp) leadOr.push({ whatsappDigits: whatsapp });
    if (instagramUserId) leadOr.push({ instagramUserId });
    if (leadOr.length > 0) {
      await this.prisma.crmLead.updateMany({
        where: { crmExcludedAt: null, OR: leadOr },
        data: { botEnabled: false },
      });
    }

    if (whatsapp) {
      await this.prisma.rafaCallBooking.updateMany({
        where: {
          crmExcludedAt: null,
          OR: [{ guestWhatsapp: whatsapp }, { user: { whatsapp } }],
        },
        data: { crmJoanaEnabled: false },
      });
    } else if (identity.bookingId) {
      await this.prisma.rafaCallBooking.updateMany({
        where: { id: identity.bookingId, crmExcludedAt: null },
        data: { crmJoanaEnabled: false },
      });
    }
  }
}

function humanizeSendError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('outbound_circuit_open')) {
    return 'Envio bloqueado temporariamente. Tenta de novo daqui a pouco.';
  }
  if (raw.includes('conversation_outbound_no_channel')) {
    return 'Este lead não tem este canal de contacto.';
  }
  if (raw.includes('Instagram sendMessage failed') || raw.includes('Instagram')) {
    return 'Não foi possível enviar no Instagram. A resposta livre só funciona nas 24 horas após a última mensagem da pessoa.';
  }
  return 'Não foi possível enviar a mensagem.';
}
