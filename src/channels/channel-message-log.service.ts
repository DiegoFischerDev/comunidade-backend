import { createHash } from 'crypto';
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
  /** Códigos curtos dos pares RAG usados neste outbound BOT. */
  ragCodes: string[] | null;
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
  /** Códigos curtos (`Rag01`…) dos pares injectados neste turno BOT. */
  ragCodes?: string[] | null;
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
    const externalMessageId = (input.externalMessageId || '').trim() || null;
    const ragCodes = normalizeRagCodes(input.ragCodes);
    const payload = {
      conversationId: input.conversationId,
      channel: input.channel,
      direction: input.direction,
      author: input.author,
      kind,
      body,
      mediaUrl,
      ragCodes,
      mirrorHistory: input.mirrorHistory,
    };

    try {
      return await this.writeRecord({ ...payload, externalMessageId });
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        externalMessageId
      ) {
        const existing = await this.prisma.channelMessage.findUnique({
          where: { externalMessageId },
        });
        if (existing) return serializeMessage(existing);
      }

      // Mids IG longos + VARCHAR(128) antigo: hash curto, depois sem id.
      if (externalMessageId && externalMessageId.length > 64) {
        const hashed = hashExternalMessageId(externalMessageId);
        this.logger.warn(
          `Falha ao gravar mid (${externalMessageId.length} chars) em ${input.conversationId}: ${
            err instanceof Error ? err.message : String(err)
          } — a tentar hash`,
        );
        try {
          return await this.writeRecord({ ...payload, externalMessageId: hashed });
        } catch (hashErr: unknown) {
          if (
            hashErr instanceof Prisma.PrismaClientKnownRequestError &&
            hashErr.code === 'P2002'
          ) {
            const existing = await this.prisma.channelMessage.findUnique({
              where: { externalMessageId: hashed },
            });
            if (existing) return serializeMessage(existing);
          }
        }
      }

      if (externalMessageId) {
        this.logger.warn(
          `Falha ao gravar com externalMessageId em ${input.conversationId} — a tentar sem id`,
        );
        try {
          return await this.writeRecord({ ...payload, externalMessageId: null });
        } catch (retryErr: unknown) {
          this.logger.warn(
            `Falha ao gravar mensagem ${input.conversationId}: ${
              retryErr instanceof Error ? retryErr.message : String(retryErr)
            }`,
          );
          return null;
        }
      }

      this.logger.warn(
        `Falha ao gravar mensagem ${input.conversationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private async writeRecord(input: {
    conversationId: string;
    channel: ChatbotChannel;
    direction: ChannelMessageDirection;
    author: ChannelMessageAuthor;
    kind: ChannelMessageKind;
    body: string;
    mediaUrl: string | null;
    externalMessageId: string | null;
    ragCodes: string[] | null;
    mirrorHistory?: HistoryRole;
  }): Promise<ChannelMessageView> {
    if (input.externalMessageId) {
      const existing = await this.prisma.channelMessage.findUnique({
        where: { externalMessageId: input.externalMessageId },
      });
      if (existing) {
        const existingCodes = parseRagCodes(existing.ragCodes);
        const codesChanged =
          JSON.stringify(existingCodes) !== JSON.stringify(input.ragCodes);
        const changed =
          existing.body !== input.body ||
          existing.kind !== input.kind ||
          (existing.mediaUrl || null) !== input.mediaUrl ||
          codesChanged;
        const row = changed
          ? await this.prisma.channelMessage.update({
              where: { id: existing.id },
              data: {
                body: input.body,
                kind: input.kind,
                mediaUrl: input.mediaUrl,
                ragCodes:
                  input.ragCodes === null
                    ? Prisma.JsonNull
                    : (input.ragCodes as unknown as Prisma.InputJsonValue),
              },
            })
          : existing;
        if (input.mirrorHistory && input.body !== AUDIO_PENDING_TEXT) {
          await this.appendHistory(input.conversationId, input.mirrorHistory, input.body);
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
        kind: input.kind,
        body: input.body,
        mediaUrl: input.mediaUrl,
        externalMessageId: input.externalMessageId,
        ragCodes:
          input.ragCodes === null
            ? undefined
            : (input.ragCodes as unknown as Prisma.InputJsonValue),
      },
    });

    if (input.direction === ChannelMessageDirection.INBOUND) {
      await this.touchInbound(input.conversationId);
    }
    if (input.mirrorHistory && input.body !== AUDIO_PENDING_TEXT) {
      await this.appendHistory(input.conversationId, input.mirrorHistory, input.body);
    }
    return serializeMessage(row);
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

/** Fallback quando o mid Meta não cabe na coluna (VARCHAR curto pré-migration). */
function hashExternalMessageId(raw: string): string {
  return `h:${createHash('sha256').update(raw).digest('hex')}`;
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
  ragCodes?: unknown;
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
    ragCodes: parseRagCodes(row.ragCodes),
    createdAt: row.createdAt.toISOString(),
  };
}

function normalizeRagCodes(value: string[] | null | undefined): string[] | null {
  if (!value || value.length === 0) return null;
  const codes = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 12);
  return codes.length > 0 ? codes : null;
}

function parseRagCodes(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const codes = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  return codes.length > 0 ? codes : null;
}
