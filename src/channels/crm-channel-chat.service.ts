import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  ChannelMessageAuthor,
  ChannelMessageDirection,
  ChannelMessageKind,
  ChatbotChannel,
  Prisma,
} from '@prisma/client';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { toAbsoluteMediaUrl } from '../common/public-media-url';
import { PrismaService } from '../prisma/prisma.service';
import {
  prepareChannelMediaFromLocalFile,
  uploadsDir,
} from '../uploads/channel-media.util';
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
const CHAT_AUDIO_MAX_BYTES = 5 * 1024 * 1024;
const CHAT_AUDIO_BODY = 'Nota de voz';

export type ChannelChatIdentity = {
  whatsappDigits: string | null;
  instagramUserId: string | null;
  name: string | null;
  bookingId?: string | null;
};

@Injectable()
export class CrmChannelChatService {
  private readonly logger = new Logger(CrmChannelChatService.name);

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

  async sendAudioForBooking(
    bookingId: string,
    channelRaw: string,
    file: Express.Multer.File | undefined,
  ) {
    const identity = await this.identityFromBooking(bookingId);
    return this.sendAudio({
      identity,
      channel: this.parseChannel(channelRaw),
      file,
    });
  }

  async sendAudioForLead(
    slug: string,
    leadId: string,
    channelRaw: string,
    file: Express.Multer.File | undefined,
  ) {
    const identity = await this.identityFromLead(slug, leadId);
    return this.sendAudio({
      identity,
      channel: this.parseChannel(channelRaw),
      file,
    });
  }

  /**
   * Apaga `channel_messages` das conversas do lead e os ficheiros de `mediaUrl`.
   * Não apaga a row `joana_conversations` (só o histórico de chat).
   */
  async purgeMessagesForIdentity(identity: {
    whatsappDigits?: string | null;
    instagramUserId?: string | null;
  }): Promise<void> {
    const conversationIds = await this.findConversationIds(identity);
    if (conversationIds.length === 0) return;

    const withMedia = await this.prisma.channelMessage.findMany({
      where: {
        conversationId: { in: conversationIds },
        mediaUrl: { not: null },
      },
      select: { mediaUrl: true },
    });
    for (const row of withMedia) {
      await this.deleteUploadUrlAndVariants(row.mediaUrl);
    }

    await this.prisma.channelMessage.deleteMany({
      where: { conversationId: { in: conversationIds } },
    });
  }

  /**
   * Contagens de mensagens consecutivas do lead a aguardar resposta,
   * por chave de identidade (bookingId / leadId) e canal.
   */
  async unansweredCountsForIdentities(
    identities: Array<{
      key: string;
      whatsappDigits?: string | null;
      instagramUserId?: string | null;
    }>,
  ): Promise<Map<string, { whatsapp: number; instagram: number }>> {
    const result = new Map<string, { whatsapp: number; instagram: number }>();
    for (const identity of identities) {
      result.set(identity.key, { whatsapp: 0, instagram: 0 });
    }
    if (identities.length === 0) return result;

    const whatsapps = [
      ...new Set(
        identities
          .map((row) => (row.whatsappDigits || '').replace(/\D/g, ''))
          .filter((digits) => digits.length >= 8),
      ),
    ];
    const instagramIds = [
      ...new Set(
        identities
          .map((row) => (row.instagramUserId || '').trim())
          .filter(Boolean),
      ),
    ];
    if (whatsapps.length === 0 && instagramIds.length === 0) return result;

    const or: Prisma.JoanaConversationWhereInput[] = [];
    if (whatsapps.length > 0) or.push({ whatsappDigits: { in: whatsapps } });
    if (instagramIds.length > 0) or.push({ instagramUserId: { in: instagramIds } });

    const conversations = await this.prisma.joanaConversation.findMany({
      where: { OR: or },
      select: {
        id: true,
        whatsappDigits: true,
        instagramUserId: true,
        activeChannel: true,
        updatedAt: true,
      },
    });
    if (conversations.length === 0) return result;

    const byWhatsapp = new Map<string, typeof conversations>();
    const byInstagram = new Map<string, (typeof conversations)[number]>();
    for (const row of conversations) {
      const digits = (row.whatsappDigits || '').replace(/\D/g, '');
      if (digits.length >= 8) {
        const list = byWhatsapp.get(digits) ?? [];
        list.push(row);
        byWhatsapp.set(digits, list);
      }
      const ig = row.instagramUserId?.trim();
      if (ig && !byInstagram.has(ig)) byInstagram.set(ig, row);
    }

    const conversationIds = new Set<string>();
    const binding = new Map<
      string,
      { whatsappConversationId: string | null; instagramConversationId: string | null }
    >();
    for (const identity of identities) {
      const digits = (identity.whatsappDigits || '').replace(/\D/g, '');
      const ig = (identity.instagramUserId || '').trim();
      const waConv =
        digits.length >= 8 ? pickWhatsappConversation(byWhatsapp.get(digits) ?? []) : null;
      const igConv = ig ? byInstagram.get(ig) ?? null : null;
      if (waConv) conversationIds.add(waConv.id);
      if (igConv) conversationIds.add(igConv.id);
      binding.set(identity.key, {
        whatsappConversationId: waConv?.id ?? null,
        instagramConversationId: igConv?.id ?? null,
      });
    }

    const counts = await this.messages.unansweredLeadCounts([...conversationIds]);
    for (const identity of identities) {
      const bound = binding.get(identity.key);
      if (!bound) continue;
      result.set(identity.key, {
        whatsapp: bound.whatsappConversationId
          ? counts.get(`${bound.whatsappConversationId}:${ChatbotChannel.WHATSAPP}`) ?? 0
          : 0,
        instagram: bound.instagramConversationId
          ? counts.get(`${bound.instagramConversationId}:${ChatbotChannel.INSTAGRAM}`) ?? 0
          : 0,
      });
    }
    return result;
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

  async sendAudio(input: {
    identity: ChannelChatIdentity;
    channel: ChatbotChannel;
    file: Express.Multer.File | undefined;
  }): Promise<{ message: ChannelMessageView; botPaused: true }> {
    const channel = this.assertOpenChannel(input.channel);
    this.assertIdentity(channel, input.identity);

    const file = input.file;
    if (!file?.buffer?.length) {
      throw new BadRequestException('Grava um áudio antes de enviar.');
    }
    if (file.size > CHAT_AUDIO_MAX_BYTES) {
      throw new PayloadTooLargeException('O áudio é demasiado grande (máx. 5 MB).');
    }
    const mime = (file.mimetype || '').toLowerCase();
    if (mime && !mime.startsWith('audio/') && mime !== 'video/webm') {
      throw new BadRequestException('O ficheiro tem de ser áudio.');
    }

    const conversation = await this.ensureConversation(channel, input.identity);
    await this.pauseLead(input.identity, conversation.id);

    const ext = guessAudioExt(file.originalname, mime);
    const stem = `crm-chat-${Date.now()}-${randomBytes(4).toString('hex')}`;
    const fileName = `${stem}${ext}`;
    await mkdir(uploadsDir(), { recursive: true });
    const absolutePath = join(uploadsDir(), fileName);
    await writeFile(absolutePath, file.buffer);

    let prepared;
    try {
      prepared = await prepareChannelMediaFromLocalFile({
        absolutePath,
        originalName: file.originalname || fileName,
        mimeType: mime || 'audio/webm',
      });
    } catch (err: unknown) {
      await safeUnlink(absolutePath);
      this.logger.warn(
        `Falha a preparar áudio CRM: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadRequestException('Não foi possível processar o áudio.');
    }

    const relativeUrl =
      channel === ChatbotChannel.INSTAGRAM
        ? prepared.mediaUrlInstagram
        : prepared.mediaUrlWhatsapp;
    const absoluteUrl = toAbsoluteMediaUrl(relativeUrl);
    const playbackUrl =
      prepared.mediaUrlInstagram || prepared.mediaUrlWhatsapp || relativeUrl;

    const outboundRow = {
      whatsappDigits: conversation.whatsappDigits,
      instagramUserId: conversation.instagramUserId,
      activeChannel: channel,
      instance: conversation.instance,
    };

    try {
      await this.outbound.sendAttachment(outboundRow, {
        kind: 'audio',
        mediaUrl: absoluteUrl,
        mimeType:
          channel === ChatbotChannel.INSTAGRAM
            ? prepared.mediaMimeTypeInstagram
            : prepared.mediaMimeTypeWhatsapp,
        fileName: prepared.mediaFileName,
        requireDelivery: true,
      });
    } catch (err: unknown) {
      throw new BadRequestException(humanizeSendError(err));
    }

    const message = await this.messages.record({
      conversationId: conversation.id,
      channel,
      direction: ChannelMessageDirection.OUTBOUND,
      author: ChannelMessageAuthor.ADMIN,
      kind: ChannelMessageKind.AUDIO,
      body: CHAT_AUDIO_BODY,
      mediaUrl: playbackUrl,
      mirrorHistory: 'assistant',
    });
    if (!message) {
      throw new BadRequestException('O áudio saiu, mas não foi possível guardá-lo no histórico.');
    }
    return { message, botPaused: true };
  }

  private async findConversationIds(identity: {
    whatsappDigits?: string | null;
    instagramUserId?: string | null;
  }): Promise<string[]> {
    const or: Prisma.JoanaConversationWhereInput[] = [];
    const whatsapp = (identity.whatsappDigits || '').replace(/\D/g, '');
    const ig = (identity.instagramUserId || '').trim();
    if (whatsapp.length >= 8) or.push({ whatsappDigits: whatsapp });
    if (ig) or.push({ instagramUserId: ig });
    if (or.length === 0) return [];
    const rows = await this.prisma.joanaConversation.findMany({
      where: { OR: or },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  private async deleteUploadUrlAndVariants(mediaUrl: string | null | undefined): Promise<void> {
    const raw = (mediaUrl || '').trim();
    if (!raw) return;
    const pathOnly = raw.startsWith('http')
      ? (() => {
          try {
            return new URL(raw).pathname;
          } catch {
            return raw;
          }
        })()
      : raw;
    if (!pathOnly.startsWith('/uploads/')) return;
    const rel = pathOnly.replace(/^\/uploads\//, '');
    if (!rel || rel.includes('..')) return;

    const candidates = new Set<string>([rel]);
    const stem = rel.replace(/\.(wa\.ogg|ig\.m4a|webm|ogg|opus|m4a|mp3|mp4)$/i, '');
    if (stem && stem !== rel) {
      for (const suffix of ['.wa.ogg', '.ig.m4a', '.webm', '.ogg', '.opus', '.m4a', '.mp3']) {
        candidates.add(`${stem}${suffix}`);
      }
    }
    for (const name of candidates) {
      await safeUnlink(join(uploadsDir(), name));
    }
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

function pickWhatsappConversation(
  rows: Array<{
    id: string;
    activeChannel: ChatbotChannel;
    instagramUserId: string | null;
    updatedAt: Date;
  }>,
): { id: string } | null {
  if (rows.length === 0) return null;
  const byWhatsappChannel = rows.find(
    (row) => row.activeChannel === ChatbotChannel.WHATSAPP,
  );
  if (byWhatsappChannel) return byWhatsappChannel;
  const withoutIg = rows.find((row) => !row.instagramUserId);
  if (withoutIg) return withoutIg;
  return [...rows].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0] ?? null;
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

function guessAudioExt(originalName: string | undefined, mime: string): string {
  const lower = (originalName || '').toLowerCase();
  if (lower.endsWith('.ogg') || lower.endsWith('.opus')) return '.ogg';
  if (lower.endsWith('.m4a')) return '.m4a';
  if (lower.endsWith('.mp3')) return '.mp3';
  if (lower.endsWith('.mp4')) return '.mp4';
  if (lower.endsWith('.webm') || mime.includes('webm')) return '.webm';
  if (mime.includes('ogg') || mime.includes('opus')) return '.ogg';
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return '.m4a';
  return '.webm';
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: string }).code)
        : '';
    if (code !== 'ENOENT') {
      /* ignore leftover files */
    }
  }
}
