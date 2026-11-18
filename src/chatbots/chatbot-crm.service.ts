import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotService } from './chatbot.service';
import { isChatbotSlug, type ChatbotSlug } from './chatbot.constants';

function waDigits(value: string): string {
  return value.replace(/\D/g, '');
}

@Injectable()
export class ChatbotCrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatbots: ChatbotService,
  ) {}

  async listBoard(slug: string) {
    const bot = await this.chatbots.requireBySlug(slug);
    const columns = await this.prisma.crmColumn.findMany({
      where: { chatbotId: bot.id },
      orderBy: { sortOrder: 'asc' },
    });
    const leads = await this.prisma.crmLead.findMany({
      where: { chatbotId: bot.id, crmExcludedAt: null },
      orderBy: { updatedAt: 'desc' },
    });

    return {
      chatbot: {
        slug: bot.slug,
        name: bot.name,
        engineKind: bot.engineKind,
      },
      columns: columns.map((column) => ({
        id: column.id,
        slug: column.slug,
        label: column.label,
        sortOrder: column.sortOrder,
        tone: column.tone,
        pausesBot: column.pausesBot,
        items: leads
          .filter((lead) => lead.columnId === column.id)
          .map((lead) => this.serializeLead(lead, column.slug)),
      })),
    };
  }

  async listColumns(slug: string) {
    const bot = await this.chatbots.requireBySlug(slug);
    const columns = await this.prisma.crmColumn.findMany({
      where: { chatbotId: bot.id },
      orderBy: { sortOrder: 'asc' },
    });
    return columns.map((column) => ({
      id: column.id,
      slug: column.slug,
      label: column.label,
      sortOrder: column.sortOrder,
      tone: column.tone,
      pausesBot: column.pausesBot,
    }));
  }

  async createColumn(
    slug: string,
    input: { label: string; tone?: string | null; pausesBot?: boolean },
  ) {
    const bot = await this.chatbots.requireBySlug(slug);
    const label = input.label.trim();
    if (label.length < 2) {
      throw new BadRequestException('Indica o nome da coluna.');
    }
    const baseSlug = slugifyColumn(label);
    let columnSlug = baseSlug;
    let n = 2;
    while (
      await this.prisma.crmColumn.findFirst({
        where: { chatbotId: bot.id, slug: columnSlug },
        select: { id: true },
      })
    ) {
      columnSlug = `${baseSlug}_${n}`;
      n += 1;
    }
    const maxOrder = await this.prisma.crmColumn.aggregate({
      where: { chatbotId: bot.id },
      _max: { sortOrder: true },
    });
    const created = await this.prisma.crmColumn.create({
      data: {
        chatbotId: bot.id,
        slug: columnSlug,
        label,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
        tone: input.tone?.trim() || null,
        pausesBot: input.pausesBot === true,
      },
    });
    return {
      id: created.id,
      slug: created.slug,
      label: created.label,
      sortOrder: created.sortOrder,
      tone: created.tone,
      pausesBot: created.pausesBot,
    };
  }

  async updateColumn(
    slug: string,
    columnId: string,
    input: {
      label?: string;
      tone?: string | null;
      pausesBot?: boolean;
      sortOrder?: number;
    },
  ) {
    const bot = await this.chatbots.requireBySlug(slug);
    const column = await this.prisma.crmColumn.findFirst({
      where: { id: columnId, chatbotId: bot.id },
    });
    if (!column) throw new NotFoundException('Coluna não encontrada.');

    const data: Prisma.CrmColumnUpdateInput = {};
    if (input.label !== undefined) {
      const label = input.label.trim();
      if (label.length < 2) {
        throw new BadRequestException('Indica o nome da coluna.');
      }
      data.label = label;
    }
    if (input.tone !== undefined) data.tone = input.tone?.trim() || null;
    if (input.pausesBot !== undefined) data.pausesBot = input.pausesBot;
    if (input.sortOrder !== undefined) {
      if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0) {
        throw new BadRequestException('Ordem inválida.');
      }
      data.sortOrder = input.sortOrder;
    }

    const saved = await this.prisma.crmColumn.update({
      where: { id: column.id },
      data,
    });
    return {
      id: saved.id,
      slug: saved.slug,
      label: saved.label,
      sortOrder: saved.sortOrder,
      tone: saved.tone,
      pausesBot: saved.pausesBot,
    };
  }

  async reorderColumns(slug: string, columnIds: string[]) {
    const bot = await this.chatbots.requireBySlug(slug);
    const columns = await this.prisma.crmColumn.findMany({
      where: { chatbotId: bot.id },
      select: { id: true },
    });
    const existing = new Set(columns.map((c) => c.id));
    if (
      columnIds.length !== existing.size ||
      columnIds.some((id) => !existing.has(id))
    ) {
      throw new BadRequestException('Lista de colunas inválida.');
    }
    await this.prisma.$transaction(
      columnIds.map((id, index) =>
        this.prisma.crmColumn.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
    return this.listColumns(slug);
  }

  async createLead(
    slug: string,
    input: { name: string; whatsapp: string; columnId?: string },
  ) {
    const bot = await this.chatbots.requireBySlug(slug);
    const name = input.name.trim();
    if (name.length < 2) {
      throw new BadRequestException('Indica o nome do cliente.');
    }
    const whatsapp = waDigits(input.whatsapp);
    if (whatsapp.length < 8) {
      throw new BadRequestException(
        'WhatsApp inválido. Inclui o indicativo do país (ex.: 351…).',
      );
    }

    const existing = await this.prisma.crmLead.findFirst({
      where: { chatbotId: bot.id, whatsappDigits: whatsapp, crmExcludedAt: null },
    });
    if (existing) {
      throw new BadRequestException('Este cliente já está neste CRM.');
    }

    const columns = await this.prisma.crmColumn.findMany({
      where: { chatbotId: bot.id },
      orderBy: { sortOrder: 'asc' },
    });
    if (columns.length === 0) {
      throw new BadRequestException('Este CRM ainda não tem colunas.');
    }
    const column =
      (input.columnId
        ? columns.find((c) => c.id === input.columnId)
        : columns[0]) ?? null;
    if (!column) throw new BadRequestException('Coluna inválida.');

    const excluded = await this.prisma.crmLead.findFirst({
      where: {
        chatbotId: bot.id,
        whatsappDigits: whatsapp,
        crmExcludedAt: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (excluded) {
      const restored = await this.prisma.crmLead.update({
        where: { id: excluded.id },
        data: {
          crmExcludedAt: null,
          guestName: name,
          columnId: column.id,
          botEnabled: true,
          crmComments: null,
        },
      });
      return this.serializeLead(restored, column.slug);
    }

    const created = await this.prisma.crmLead.create({
      data: {
        chatbotId: bot.id,
        columnId: column.id,
        whatsappDigits: whatsapp,
        guestName: name,
        botEnabled: true,
      },
    });
    return this.serializeLead(created, column.slug);
  }

  /** Cria lead na 1ª coluna se ainda não existir (escolha do menu). */
  async ensureLeadOnMenuAssign(params: {
    chatbotId: string;
    whatsappDigits: string;
    displayName?: string | null;
  }) {
    const existing = await this.prisma.crmLead.findFirst({
      where: {
        chatbotId: params.chatbotId,
        whatsappDigits: params.whatsappDigits,
        crmExcludedAt: null,
      },
    });
    if (existing) return existing;

    const firstColumn = await this.prisma.crmColumn.findFirst({
      where: { chatbotId: params.chatbotId },
      orderBy: { sortOrder: 'asc' },
    });
    if (!firstColumn) return null;

    const excluded = await this.prisma.crmLead.findFirst({
      where: {
        chatbotId: params.chatbotId,
        whatsappDigits: params.whatsappDigits,
        crmExcludedAt: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (excluded) {
      return this.prisma.crmLead.update({
        where: { id: excluded.id },
        data: {
          crmExcludedAt: null,
          columnId: firstColumn.id,
          botEnabled: true,
          guestName: excluded.guestName || cleanName(params.displayName),
        },
      });
    }

    try {
      return await this.prisma.crmLead.create({
        data: {
          chatbotId: params.chatbotId,
          columnId: firstColumn.id,
          whatsappDigits: params.whatsappDigits,
          guestName: cleanName(params.displayName) || `Lead ${params.whatsappDigits.slice(-3)}`,
          botEnabled: true,
        },
      });
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return this.prisma.crmLead.findFirst({
          where: {
            chatbotId: params.chatbotId,
            whatsappDigits: params.whatsappDigits,
            crmExcludedAt: null,
          },
        });
      }
      throw err;
    }
  }

  async updateLead(
    slug: string,
    leadId: string,
    input: {
      guestName?: string;
      columnId?: string;
      botEnabled?: boolean;
      crmComments?: string | null;
    },
  ) {
    const bot = await this.chatbots.requireBySlug(slug);
    const lead = await this.prisma.crmLead.findFirst({
      where: { id: leadId, chatbotId: bot.id, crmExcludedAt: null },
      include: { column: true },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado.');

    const data: Prisma.CrmLeadUpdateInput = {};
    if (input.guestName !== undefined) {
      const name = input.guestName.trim();
      if (name.length < 2) {
        throw new BadRequestException('Indica o nome do cliente.');
      }
      data.guestName = name;
    }
    if (input.crmComments !== undefined) {
      data.crmComments = input.crmComments?.trim() || null;
    }
    if (input.botEnabled !== undefined) {
      data.botEnabled = input.botEnabled;
      await this.prisma.joanaConversation.updateMany({
        where: { whatsappDigits: lead.whatsappDigits, chatbotId: bot.id },
        data: { paused: !input.botEnabled },
      });
    }

    let columnSlug = lead.column.slug;
    if (input.columnId !== undefined && input.columnId !== lead.columnId) {
      const column = await this.prisma.crmColumn.findFirst({
        where: { id: input.columnId, chatbotId: bot.id },
      });
      if (!column) throw new BadRequestException('Coluna inválida.');
      data.column = { connect: { id: column.id } };
      columnSlug = column.slug;
      if (column.pausesBot && input.botEnabled === undefined) {
        data.botEnabled = false;
        await this.prisma.joanaConversation.updateMany({
          where: { whatsappDigits: lead.whatsappDigits, chatbotId: bot.id },
          data: { paused: true },
        });
      }
    }

    const saved = await this.prisma.crmLead.update({
      where: { id: lead.id },
      data,
    });
    return this.serializeLead(saved, columnSlug);
  }

  async deleteLead(slug: string, leadId: string) {
    const bot = await this.chatbots.requireBySlug(slug);
    const lead = await this.prisma.crmLead.findFirst({
      where: { id: leadId, chatbotId: bot.id, crmExcludedAt: null },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    await this.prisma.crmLead.update({
      where: { id: lead.id },
      data: { crmExcludedAt: new Date(), botEnabled: false },
    });
    await this.prisma.joanaConversation.updateMany({
      where: { whatsappDigits: lead.whatsappDigits, chatbotId: bot.id },
      data: { paused: true },
    });
    return { ok: true as const };
  }

  async findActiveLead(chatbotId: string, whatsappDigits: string) {
    return this.prisma.crmLead.findFirst({
      where: {
        chatbotId,
        whatsappDigits: waDigits(whatsappDigits),
        crmExcludedAt: null,
      },
    });
  }

  async setBotEnabledForWhatsapp(whatsappRaw: string, enabled: boolean) {
    const whatsapp = waDigits(whatsappRaw);
    await this.prisma.crmLead.updateMany({
      where: { whatsappDigits: whatsapp, crmExcludedAt: null },
      data: { botEnabled: enabled },
    });
    await this.prisma.joanaConversation.updateMany({
      where: { whatsappDigits: whatsapp },
      data: { paused: !enabled },
    });
  }

  /** Joana CRM board usa RafaCall; este helper devolve colunas seed para labels. */
  async joanaColumnLabels(): Promise<Array<{ slug: string; label: string }>> {
    const bot = await this.prisma.chatbot.findUnique({ where: { slug: 'joana' } });
    if (!bot) return [];
    const columns = await this.prisma.crmColumn.findMany({
      where: { chatbotId: bot.id },
      orderBy: { sortOrder: 'asc' },
      select: { slug: true, label: true },
    });
    return columns;
  }

  isGenericSlug(slug: string): slug is Exclude<ChatbotSlug, 'joana'> {
    return isChatbotSlug(slug) && slug !== 'joana';
  }

  private serializeLead(
    lead: {
      id: string;
      chatbotId: string;
      columnId: string;
      whatsappDigits: string;
      guestName: string | null;
      botEnabled: boolean;
      crmComments: string | null;
      crmProfileImageUrl: string | null;
      updatedAt: Date;
      createdAt: Date;
    },
    columnSlug: string,
  ) {
    return {
      id: lead.id,
      columnId: lead.columnId,
      columnSlug,
      whatsapp: lead.whatsappDigits,
      guestName: lead.guestName,
      botEnabled: lead.botEnabled,
      crmComments: lead.crmComments,
      crmProfileImageUrl: lead.crmProfileImageUrl,
      createdAt: lead.createdAt.toISOString(),
      updatedAt: lead.updatedAt.toISOString(),
    };
  }
}

function slugifyColumn(label: string): string {
  const base = label
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return base || 'COLUNA';
}

function cleanName(value?: string | null): string | null {
  const name = value?.trim();
  if (!name || name.length < 2) return null;
  return name.slice(0, 80);
}
