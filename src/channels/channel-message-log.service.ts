import { Injectable, Logger } from '@nestjs/common';
import {
  ChannelMessageAuthor,
  ChannelMessageDirection,
  ChannelMessageKind,
  ChatbotChannel,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const HISTORY_LIMIT = 16;
const AUDIO_PENDING_TEXT = 'A transcrever áudio…';
export const AUDIO_TRANSCRIPT_FAILED = 'Não foi possível transcrever o áudio.';

export type ChannelMessageView = {
  id: string;
  channel: ChatbotChannel;
  direction: ChannelMessageDirection;
  author: ChannelMessageAuthor;
  kind: ChannelMessageKind;
  body: string;
  mediaUrl: string | null;
  createdAt: string;
};

type HistoryRole = 'user' | 'assistant';

export type RecordChannelMessageInput = {
  conversationId: string;
  channel: ChatbotChannel;
  direction: ChannelMessageDirection;
  author: ChannelMessageAuthor;
  kind?: ChannelMessageKind;
  body: string;
  mediaUrl?: string | null;
  externalMessageId?: string | null;
  /** Copia o texto para o JSON `history` (contexto do modelo). */
  mirrorHistory?: HistoryRole;
};

@Injectable()
export class ChannelMessageLogService {
  private readonly logger = new Logger(ChannelMessageLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  pendingAudioText(): string {
    return AUDIO_PENDING_TEXT;
  }

  async record(input: RecordChannelMessageInput): Promise<ChannelMessageView | null> {
    const body = input.body.trim().slice(0, 8000);
    if (!body || !input.conversationId) return null;

    const kind = input.kind ?? ChannelMessageKind.TEXT;
    const mediaUrl = input.mediaUrl?.trim().slice(0, 512) || null;
    const externalMessageId = input.externalMessageId?.trim() || null;

    try {
      if (externalMessageId) {
        const existing = await this.prisma.channelMessage.findUnique({
          where: { externalMessageId },
        });
        if (existing) {
          const changed =
            existing.body !== body ||
            existing.kind !== kind ||
            (existing.mediaUrl || null) !== mediaUrl;
          const row = changed
            ? await this.prisma.channelMessage.update({
                where: { id: existing.id },
                data: { body, kind, mediaUrl },
              })
            : existing;
          if (input.mirrorHistory && body !== AUDIO_PENDING_TEXT) {
            await this.appendHistory(input.conversationId, input.mirrorHistory, body);
          }
          if (input.direction === ChannelMessageDirection.INBOUND) {
            await this.touchInbound(input.conversationId);
          }
          return serializeMessage(row);
        }
      }

      const row = await this.prisma.channelMessage.create({
        data: {
          conversationId: input.conversationId,
          channel: input.channel,
          direction: input.direction,
          author: input.author,
          kind,
          body,
          mediaUrl,
          externalMessageId,
        },
      });

      if (input.direction === ChannelMessageDirection.INBOUND) {
        await this.touchInbound(input.conversationId);
      }
      if (input.mirrorHistory && body !== AUDIO_PENDING_TEXT) {
        await this.appendHistory(input.conversationId, input.mirrorHistory, body);
      }
      return serializeMessage(row);
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        externalMessageId
      ) {
        const existing = await this.prisma.channelMessage.findUnique({
          where: { externalMessageId },
        });
        return existing ? serializeMessage(existing) : null;
      }
      this.logger.warn(
        `Falha ao gravar mensagem ${input.conversationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * Mensagens consecutivas do lead no fim do fio, por conversa+canal —
   * o que ainda aguarda resposta de BOT/ADMIN (como o badge do WhatsApp).
   */
  async unansweredLeadCounts(
    conversationIds: string[],
  ): Promise<Map<string, number>> {
    const ids = [...new Set(conversationIds.filter(Boolean))];
    const counts = new Map<string, number>();
    if (ids.length === 0) return counts;

    const rows = await this.prisma.channelMessage.findMany({
      where: {
        conversationId: { in: ids },
        channel: { in: [ChatbotChannel.WHATSAPP, ChatbotChannel.INSTAGRAM] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        conversationId: true,
        channel: true,
        author: true,
      },
    });

    const sealed = new Set<string>();
    for (const row of rows) {
      const key = `${row.conversationId}:${row.channel}`;
      if (sealed.has(key)) continue;
      if (row.author === ChannelMessageAuthor.LEAD) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
        continue;
      }
      sealed.add(key);
    }
    return counts;
  }

  private async touchInbound(conversationId: string): Promise<void> {
    await this.prisma.joanaConversation.updateMany({
      where: { id: conversationId },
      data: { lastInboundAt: new Date() },
    });
  }

  private async appendHistory(
    conversationId: string,
    role: HistoryRole,
    text: string,
  ): Promise<void> {
    const current = await this.prisma.joanaConversation.findUnique({
      where: { id: conversationId },
      select: { history: true },
    });
    if (!current) return;
    const history = readHistory(current.history);
    const turn = { role, text };
    const tail = history[history.length - 1];
    const next =
      tail && tail.role === turn.role && tail.text === turn.text
        ? history
        : [...history, turn].slice(-HISTORY_LIMIT);
    await this.prisma.joanaConversation.update({
      where: { id: conversationId },
      data: { history: next as unknown as Prisma.InputJsonValue },
    });
  }
}

function readHistory(value: unknown): Array<{ role: HistoryRole; text: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as { role?: unknown; text?: unknown };
    if (row.role !== 'user' && row.role !== 'assistant') return [];
    if (typeof row.text !== 'string' || !row.text.trim()) return [];
    return [{ role: row.role, text: row.text.trim() }];
  });
}

export function serializeMessage(row: {
  id: string;
  channel: ChatbotChannel;
  direction: ChannelMessageDirection;
  author: ChannelMessageAuthor;
  kind: ChannelMessageKind;
  body: string;
  mediaUrl?: string | null;
  createdAt: Date;
}): ChannelMessageView {
  return {
    id: row.id,
    channel: row.channel,
    direction: row.direction,
    author: row.author,
    kind: row.kind,
    body: row.body,
    mediaUrl: row.mediaUrl?.trim() || null,
    createdAt: row.createdAt.toISOString(),
  };
}
