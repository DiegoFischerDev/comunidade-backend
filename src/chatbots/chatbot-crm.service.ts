import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { Prisma, RafaCallCrmPropertyTypology } from '@prisma/client';
import { InstagramService } from '../instagram/instagram.service';
import { PrismaService } from '../prisma/prisma.service';
import { RafacallCrmService } from '../rafacall/rafacall-crm.service';
import { ChatbotService } from './chatbot.service';
import { isChatbotSlug, type ChatbotSlug } from './chatbot.constants';
import {
  normalizePreferredCities,
  parseDesiredHouseValue,
  type BrunaProfile,
} from './bruna-turn';
import {
  normalizeCampaignObjective,
  normalizeCompanyName,
  normalizeInstagramHandle,
  type GabiProfile,
} from './gabi-turn';

const CRM_AVATAR_BOARD_BACKFILL_LIMIT = 8;

function waDigits(value: string): string {
  return value.replace(/\D/g, '');
}

@Injectable()
export class ChatbotCrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatbots: ChatbotService,
    private readonly rafacallCrm: RafacallCrmService,
    @Inject(forwardRef(() => InstagramService))
    private readonly instagram: InstagramService,
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

    this.scheduleMissingProfileImageBackfill(leads);
    const whatsappList = leads
      .map((lead) => lead.whatsappDigits)
      .filter((digits): digits is string => Boolean(digits));
    const documentsByWhatsapp =
      await this.rafacallCrm.listDocumentsByWhatsapp(whatsappList);

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
          .map((lead) =>
            this.serializeLead(
              lead,
              column.slug,
              lead.whatsappDigits
                ? documentsByWhatsapp.get(lead.whatsappDigits) ?? []
                : [],
            ),
          ),
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

    // Lead excluído fica arquivado: contacto de novo → sempre novo ID.
    const created = await this.prisma.crmLead.create({
      data: {
        chatbotId: bot.id,
        columnId: column.id,
        whatsappDigits: whatsapp,
        guestName: name,
        botEnabled: true,
      },
    });
    void this.scheduleEnsureProfileImage(whatsapp, null);
    return this.serializeLeadWithDocuments(created, column.slug);
  }

  /** Cria lead na 1ª coluna se ainda não existir (escolha do menu). */
  async ensureLeadOnMenuAssign(params: {
    chatbotId: string;
    whatsappDigits?: string | null;
    instagramUserId?: string | null;
    displayName?: string | null;
    botEnabled?: boolean;
    subjectSummary?: string | null;
  }) {
    const botEnabled = params.botEnabled !== false;
    const whatsapp = params.whatsappDigits
      ? waDigits(params.whatsappDigits)
      : null;
    const ig = (params.instagramUserId || '').trim() || null;
    if (!whatsapp && !ig) return null;

    const identityWhere = {
      chatbotId: params.chatbotId,
      crmExcludedAt: null as null,
      OR: [
        ...(whatsapp ? [{ whatsappDigits: whatsapp }] : []),
        ...(ig ? [{ instagramUserId: ig }] : []),
      ],
    };

    const existing = await this.prisma.crmLead.findFirst({
      where: identityWhere,
    });
    if (existing) {
      const updated = await this.prisma.crmLead.update({
        where: { id: existing.id },
        data: {
          botEnabled,
          ...(whatsapp && !existing.whatsappDigits
            ? { whatsappDigits: whatsapp }
            : {}),
          ...(ig && !existing.instagramUserId
            ? { instagramUserId: ig }
            : {}),
          ...(params.subjectSummary
            ? { subjectSummary: params.subjectSummary }
            : {}),
        },
      });
      if (whatsapp || updated.whatsappDigits) {
        void this.scheduleEnsureProfileImage(
          whatsapp || updated.whatsappDigits!,
          updated.crmProfileImageUrl,
        );
      }
      if (ig || updated.instagramUserId) {
        void this.scheduleEnsureInstagramProfileImage(
          ig || updated.instagramUserId!,
          updated.crmProfileImageUrl,
        );
      }
      await this.ensureJoanaRafaCallCard({
        chatbotId: params.chatbotId,
        crmLeadId: updated.id,
        whatsapp: updated.whatsappDigits,
        instagramUserId: updated.instagramUserId || ig,
        guestName:
          updated.guestName ||
          cleanName(params.displayName) ||
          (updated.whatsappDigits
            ? `Lead ${updated.whatsappDigits.slice(-3)}`
            : `Lead IG ${(ig || '').slice(-4)}`),
      });
      return updated;
    }

    const firstColumn = await this.prisma.crmColumn.findFirst({
      where: { chatbotId: params.chatbotId },
      orderBy: { sortOrder: 'asc' },
    });
    if (!firstColumn) return null;

    // Excluídos que ainda ocupam o IGSID (unique) bloqueiam lead novo → libertar.
    if (ig) {
      await this.releaseExcludedInstagramIdentity(params.chatbotId, ig);
    }

    // Excluídos não se restauram: menu → sempre novo CrmLead (novo ID).
    const fallbackName =
      cleanName(params.displayName) ||
      (whatsapp
        ? `Lead ${whatsapp.slice(-3)}`
        : `Lead IG ${(ig || '').slice(-4)}`);
    const handleFromDisplay =
      fallbackName?.startsWith('@') && fallbackName.length >= 3
        ? fallbackName.slice(0, 120)
        : null;

    const createPayload = {
      chatbotId: params.chatbotId,
      columnId: firstColumn.id,
      whatsappDigits: whatsapp,
      instagramUserId: ig,
      guestName: fallbackName,
      instagramHandle: handleFromDisplay,
      botEnabled,
      subjectSummary: params.subjectSummary ?? null,
    };

    try {
      const created = await this.prisma.crmLead.create({ data: createPayload });
      if (whatsapp) void this.scheduleEnsureProfileImage(whatsapp, null);
      if (ig) void this.scheduleEnsureInstagramProfileImage(ig, null);
      await this.ensureJoanaRafaCallCard({
        chatbotId: params.chatbotId,
        crmLeadId: created.id,
        whatsapp,
        instagramUserId: ig,
        guestName: created.guestName || fallbackName,
      });
      return created;
    } catch (err: unknown) {
      if (
        !(err instanceof Prisma.PrismaClientKnownRequestError) ||
        err.code !== 'P2002'
      ) {
        throw err;
      }

      // Corrida / IGSID ainda preso: libertar de novo e tentar uma vez.
      if (ig) {
        await this.releaseExcludedInstagramIdentity(params.chatbotId, ig);
        try {
          const created = await this.prisma.crmLead.create({
            data: createPayload,
          });
          if (whatsapp) void this.scheduleEnsureProfileImage(whatsapp, null);
          if (ig) void this.scheduleEnsureInstagramProfileImage(ig, null);
          await this.ensureJoanaRafaCallCard({
            chatbotId: params.chatbotId,
            crmLeadId: created.id,
            whatsapp,
            instagramUserId: ig,
            guestName: created.guestName || fallbackName,
          });
          return created;
        } catch (retryErr: unknown) {
          if (
            !(retryErr instanceof Prisma.PrismaClientKnownRequestError) ||
            retryErr.code !== 'P2002'
          ) {
            throw retryErr;
          }
        }
      }

      const again = await this.prisma.crmLead.findFirst({
        where: identityWhere,
      });
      if (again) {
        await this.ensureJoanaRafaCallCard({
          chatbotId: params.chatbotId,
          crmLeadId: again.id,
          whatsapp: again.whatsappDigits,
          instagramUserId: again.instagramUserId || ig,
          guestName: again.guestName || fallbackName,
        });
        if (again.instagramUserId || ig) {
          void this.scheduleEnsureInstagramProfileImage(
            again.instagramUserId || ig!,
            again.crmProfileImageUrl,
          );
        }
      }
      return again;
    }
  }

  /** Liberta @@unique([chatbotId, instagramUserId]) em leads já excluídos. */
  private async releaseExcludedInstagramIdentity(
    chatbotId: string,
    instagramUserId: string,
  ): Promise<void> {
    await this.prisma.crmLead.updateMany({
      where: {
        chatbotId,
        instagramUserId,
        crmExcludedAt: { not: null },
      },
      data: { instagramUserId: null },
    });
  }

  /**
   * Joana CRM (kanban RafaCall) só mostra RafaCallBooking.
   * Ao escolher Joana no menu, cria já a ficha em «Sem data para imigar»
   * (com ou sem WhatsApp — no IG o número vem depois no /agendar).
   */
  private async ensureJoanaRafaCallCard(params: {
    chatbotId: string;
    crmLeadId: string;
    whatsapp: string | null;
    instagramUserId?: string | null;
    guestName: string;
  }): Promise<void> {
    const bot = await this.prisma.chatbot.findUnique({
      where: { id: params.chatbotId },
      select: { slug: true },
    });
    if (bot?.slug !== 'joana') return;

    const lead = await this.prisma.crmLead.findUnique({
      where: { id: params.crmLeadId },
      select: {
        id: true,
        rafaCallBookingId: true,
        guestName: true,
        instagramUserId: true,
        crmProfileImageUrl: true,
      },
    });
    if (!lead) return;

    const ig = (params.instagramUserId || lead.instagramUserId || '').trim() || null;

    if (lead.rafaCallBookingId) {
      const existing = await this.prisma.rafaCallBooking.findFirst({
        where: { id: lead.rafaCallBookingId, crmExcludedAt: null },
        select: { id: true },
      });
      if (existing) {
        if (ig) {
          void this.scheduleEnsureInstagramProfileImage(
            ig,
            lead.crmProfileImageUrl,
          );
        }
        return;
      }
    }

    if (params.whatsapp) {
      const visible = await this.rafacallCrm.lookupLeadForJoana(params.whatsapp);
      if (visible.kind === 'visible') {
        await this.prisma.crmLead.update({
          where: { id: lead.id },
          data: { rafaCallBookingId: visible.bookingId },
        });
        if (ig) {
          void this.scheduleEnsureInstagramProfileImage(
            ig,
            lead.crmProfileImageUrl,
          );
        }
        return;
      }
    }

    try {
      const created = await this.rafacallCrm.createCrmClient({
        name: (params.guestName || lead.guestName || 'Lead').slice(0, 80),
        whatsapp: params.whatsapp,
      });
      await this.prisma.crmLead.update({
        where: { id: lead.id },
        data: { rafaCallBookingId: created.id },
      });
      if (ig) {
        void this.scheduleEnsureInstagramProfileImage(
          ig,
          lead.crmProfileImageUrl,
        );
      }
    } catch (err: unknown) {
      if (
        err instanceof BadRequestException &&
        err.message === 'Este cliente já está no CRM.' &&
        params.whatsapp
      ) {
        const again = await this.rafacallCrm.lookupLeadForJoana(params.whatsapp);
        if (again.kind === 'visible') {
          await this.prisma.crmLead.update({
            where: { id: lead.id },
            data: { rafaCallBookingId: again.bookingId },
          });
          if (ig) {
            void this.scheduleEnsureInstagramProfileImage(
              ig,
              lead.crmProfileImageUrl,
            );
          }
        }
        return;
      }
      throw err;
    }
  }

  async findActiveOutrosLead(whatsappDigits: string) {
    const bot = await this.prisma.chatbot.findUnique({
      where: { slug: 'outros' },
      select: { id: true },
    });
    if (!bot) return null;
    return this.prisma.crmLead.findFirst({
      where: {
        chatbotId: bot.id,
        whatsappDigits: waDigits(whatsappDigits),
        crmExcludedAt: null,
      },
    });
  }

  async updateSubjectSummary(leadId: string, subjectSummary: string) {
    const summary = subjectSummary.trim().slice(0, 200);
    if (summary.length < 2) return null;
    return this.prisma.crmLead.update({
      where: { id: leadId },
      data: { subjectSummary: summary },
    });
  }

  async patchGabiQualification(leadId: string, profile: GabiProfile) {
    await this.prisma.crmLead.update({
      where: { id: leadId },
      data: {
        companyName: profile.companyName,
        instagramHandle: profile.instagramHandle,
        campaignObjective: profile.campaignObjective,
        ...(profile.companyName?.trim()
          ? { guestName: profile.companyName.trim() }
          : {}),
      },
    });
  }

  async patchBrunaQualification(leadId: string, profile: BrunaProfile) {
    await this.prisma.crmLead.update({
      where: { id: leadId },
      data: {
        desiredHouseValue: profile.desiredHouseValue,
        crmPreferredCity: profile.preferredCities,
        crmPropertyTypology: profile.propertyTypology,
      },
    });
  }

  async updateLead(
    slug: string,
    leadId: string,
    input: {
      guestName?: string;
      columnId?: string;
      botEnabled?: boolean;
      crmComments?: string | null;
      companyName?: string | null;
      instagramHandle?: string | null;
      campaignObjective?: string | null;
      subjectSummary?: string | null;
      desiredHouseValue?: number | null;
      preferredCities?: string | null;
      propertyTypology?: RafaCallCrmPropertyTypology[] | null;
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
    if (input.companyName !== undefined) {
      if (input.companyName === null || input.companyName.trim() === '') {
        data.companyName = null;
      } else {
        const name = normalizeCompanyName(input.companyName);
        if (!name) {
          throw new BadRequestException('Nome da empresa inválido.');
        }
        data.companyName = name;
        data.guestName = name;
      }
    }
    if (input.instagramHandle !== undefined) {
      if (input.instagramHandle === null) {
        data.instagramHandle = null;
      } else {
        const handle = normalizeInstagramHandle(input.instagramHandle);
        if (handle === undefined) {
          throw new BadRequestException('Instagram inválido.');
        }
        data.instagramHandle = handle;
      }
    }
    if (input.campaignObjective !== undefined) {
      if (
        input.campaignObjective === null ||
        input.campaignObjective.trim() === ''
      ) {
        data.campaignObjective = null;
      } else {
        const objective = normalizeCampaignObjective(input.campaignObjective);
        if (!objective) {
          throw new BadRequestException('Objectivo da campanha inválido.');
        }
        data.campaignObjective = objective;
      }
    }
    if (input.subjectSummary !== undefined) {
      const summary = input.subjectSummary?.trim() || null;
      data.subjectSummary = summary ? summary.slice(0, 200) : null;
    }
    if (input.desiredHouseValue !== undefined) {
      if (input.desiredHouseValue === null) {
        data.desiredHouseValue = null;
      } else {
        const value = parseDesiredHouseValue(input.desiredHouseValue);
        if (typeof value !== 'number') {
          throw new BadRequestException('Valor da casa pretendida inválido.');
        }
        data.desiredHouseValue = value;
      }
    }
    if (input.preferredCities !== undefined) {
      if (input.preferredCities === null || input.preferredCities.trim() === '') {
        data.crmPreferredCity = null;
      } else {
        const cities = normalizePreferredCities(input.preferredCities);
        if (!cities) {
          throw new BadRequestException('Cidades pretendidas inválidas.');
        }
        data.crmPreferredCity = cities;
      }
    }
    if (input.propertyTypology !== undefined) {
      data.crmPropertyTypology = input.propertyTypology ?? [];
    }
    if (input.botEnabled !== undefined) {
      data.botEnabled = input.botEnabled;
      await this.pauseLeadConversations(lead, bot.id, !input.botEnabled);
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
        await this.pauseLeadConversations(lead, bot.id, true);
      }
    }

    const saved = await this.prisma.crmLead.update({
      where: { id: lead.id },
      data,
    });
    return this.serializeLeadWithDocuments(saved, columnSlug);
  }

  async uploadLeadDocument(
    slug: string,
    leadId: string,
    file: Express.Multer.File | undefined,
  ) {
    const lead = await this.requireActiveLead(slug, leadId);
    if (!lead.whatsappDigits) {
      throw new BadRequestException(
        'Este lead ainda não tem WhatsApp — documentos ficam associados ao número.',
      );
    }
    return this.rafacallCrm.uploadCrmDocumentByWhatsapp({
      whatsappDigits: lead.whatsappDigits,
      file,
    });
  }

  async deleteLeadDocument(slug: string, leadId: string, documentId: string) {
    const lead = await this.requireActiveLead(slug, leadId);
    if (!lead.whatsappDigits) {
      throw new BadRequestException(
        'Este lead ainda não tem WhatsApp — documentos ficam associados ao número.',
      );
    }
    return this.rafacallCrm.deleteCrmDocumentByWhatsapp({
      whatsappDigits: lead.whatsappDigits,
      documentId,
    });
  }

  async deleteLead(slug: string, leadId: string) {
    const bot = await this.chatbots.requireBySlug(slug);
    const lead = await this.prisma.crmLead.findFirst({
      where: { id: leadId, chatbotId: bot.id, crmExcludedAt: null },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado.');

    const excludedAt = new Date();
    const bookingId = lead.rafaCallBookingId;
    const identity = {
      whatsappDigits: lead.whatsappDigits,
      instagramUserId: lead.instagramUserId,
    };

    // Joana: a ficha visível é o RafaCallBooking — remove do kanban e limpa interesse.
    if (bookingId) {
      try {
        await this.rafacallCrm.removeFromCrm({ bookingId });
      } catch {
        /* booking já invisível / apagado — continua soft-exclude local */
      }
    }

    const stillActive = await this.prisma.crmLead.findFirst({
      where: { id: lead.id, crmExcludedAt: null },
      select: { id: true },
    });
    if (stillActive) {
      await this.prisma.crmLead.update({
        where: { id: lead.id },
        data: {
          crmExcludedAt: excludedAt,
          botEnabled: false,
          rafaCallBookingId: null,
          // Liberta @@unique([chatbotId, instagramUserId]) para um lead novo.
          instagramUserId: null,
        },
      });
    } else if (identity.instagramUserId) {
      await this.prisma.crmLead.updateMany({
        where: { id: lead.id, instagramUserId: identity.instagramUserId },
        data: { instagramUserId: null },
      });
    }

    // Limpa atribuição do menu (chatbotId) — próximo contacto vê o menu outra vez.
    await this.resetLeadConversationsToMenu(identity);
    return { ok: true as const };
  }

  async findActiveLead(
    chatbotId: string,
    identity: { whatsappDigits?: string | null; instagramUserId?: string | null },
  ) {
    const whatsapp = identity.whatsappDigits
      ? waDigits(identity.whatsappDigits)
      : null;
    const ig = (identity.instagramUserId || '').trim() || null;
    if (!whatsapp && !ig) return null;
    return this.prisma.crmLead.findFirst({
      where: {
        chatbotId,
        crmExcludedAt: null,
        OR: [
          ...(whatsapp ? [{ whatsappDigits: whatsapp }] : []),
          ...(ig ? [{ instagramUserId: ig }] : []),
        ],
      },
    });
  }

  /**
   * Está em algum CRM activo? (CrmLead Bruna/Gabi/Joana lock, ou kanban Joana RafaCall).
   * Sem ficha → o router manda para o menu inicial, mesmo com histórico de chat.
   */
  async isWhatsappInAnyCrm(whatsappRaw: string): Promise<boolean> {
    const whatsapp = waDigits(whatsappRaw);
    if (whatsapp.length < 8) return false;

    const lead = await this.prisma.crmLead.findFirst({
      where: { whatsappDigits: whatsapp, crmExcludedAt: null },
      select: { id: true },
    });
    if (lead) return true;

    const booking = await this.prisma.rafaCallBooking.findFirst({
      where: {
        status: { in: ['SCHEDULED', 'COMPLETED'] },
        crmExcludedAt: null,
        OR: [{ guestWhatsapp: whatsapp }, { user: { whatsapp } }],
      },
      select: { id: true },
    });
    return Boolean(booking);
  }

  async isInstagramInAnyCrm(instagramUserIdRaw: string): Promise<boolean> {
    const ig = instagramUserIdRaw.trim();
    if (!ig) return false;
    const lead = await this.prisma.crmLead.findFirst({
      where: { instagramUserId: ig, crmExcludedAt: null },
      select: { id: true },
    });
    return Boolean(lead);
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

  private async requireActiveLead(slug: string, leadId: string) {
    const bot = await this.chatbots.requireBySlug(slug);
    const lead = await this.prisma.crmLead.findFirst({
      where: { id: leadId, chatbotId: bot.id, crmExcludedAt: null },
      include: { column: true },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    return lead;
  }

  private scheduleEnsureProfileImage(
    whatsappRaw: string,
    existingUrl?: string | null,
  ) {
    void this.rafacallCrm.ensureCrmProfileImage(whatsappRaw, {
      existingUrl: existingUrl ?? null,
    });
  }

  /**
   * Descarrega a foto IG (Graph) e grava em storage + CrmLead/booking.
   * Se já houver `remoteUrl` (webhook), evita nova chamada à Graph.
   */
  scheduleEnsureInstagramProfileImage(
    instagramUserId: string,
    existingUrl?: string | null,
    remoteUrl?: string | null,
  ) {
    const ig = instagramUserId.trim();
    if (!ig) return;
    void (async () => {
      try {
        let picUrl = remoteUrl?.trim() || null;
        if (!picUrl && !existingUrl?.trim()) {
          const profile = await this.instagram.fetchUserProfile(ig);
          picUrl = profile?.profilePicUrl ?? null;
        }
        await this.rafacallCrm.ensureCrmProfileImageFromInstagram(ig, {
          remoteUrl: picUrl,
          existingUrl: existingUrl ?? null,
        });
      } catch {
        /* best-effort */
      }
    })();
  }

  private scheduleMissingProfileImageBackfill(
    leads: Array<{
      whatsappDigits: string | null;
      instagramUserId?: string | null;
      crmProfileImageUrl: string | null;
    }>,
  ) {
    const missingWa = leads
      .filter(
        (lead) =>
          Boolean(lead.whatsappDigits) && !lead.crmProfileImageUrl?.trim(),
      )
      .slice(0, CRM_AVATAR_BOARD_BACKFILL_LIMIT);
    for (const lead of missingWa) {
      this.scheduleEnsureProfileImage(lead.whatsappDigits!, null);
    }

    const missingIg = leads
      .filter(
        (lead) =>
          Boolean(lead.instagramUserId?.trim()) &&
          !lead.crmProfileImageUrl?.trim() &&
          !lead.whatsappDigits,
      )
      .slice(0, CRM_AVATAR_BOARD_BACKFILL_LIMIT);
    for (const lead of missingIg) {
      this.scheduleEnsureInstagramProfileImage(lead.instagramUserId!, null);
    }
  }

  private async pauseLeadConversations(
    lead: { whatsappDigits: string | null; instagramUserId: string | null },
    chatbotId: string,
    paused: boolean,
  ) {
    if (lead.whatsappDigits) {
      await this.prisma.joanaConversation.updateMany({
        where: { whatsappDigits: lead.whatsappDigits, chatbotId },
        data: { paused },
      });
    }
    if (lead.instagramUserId) {
      await this.prisma.joanaConversation.updateMany({
        where: { instagramUserId: lead.instagramUserId, chatbotId },
        data: { paused },
      });
    }
  }

  /**
   * Após excluir lead: tira o interesse (chatbotId) e repõe o menu.
   * O mesmo WA/IG a voltar a escrever é tratado como contacto novo.
   */
  private async resetLeadConversationsToMenu(lead: {
    whatsappDigits: string | null;
    instagramUserId: string | null;
  }) {
    const menuReset = {
      chatbotId: null,
      menuSent: false,
      welcomeSent: false,
      paused: false,
      buffer: [] as Prisma.InputJsonValue,
      pendingConfirmation: Prisma.JsonNull,
      pendingOutbound: null,
      farGuidanceSent: false,
      schedulingLinkSent: false,
      processing: false,
    };

    if (lead.whatsappDigits) {
      await this.prisma.joanaConversation.updateMany({
        where: { whatsappDigits: lead.whatsappDigits },
        data: menuReset,
      });
    }
    if (lead.instagramUserId) {
      await this.prisma.joanaConversation.updateMany({
        where: { instagramUserId: lead.instagramUserId },
        data: menuReset,
      });
    }
  }

  private async serializeLeadWithDocuments(
    lead: {
      id: string;
      chatbotId: string;
      columnId: string;
      whatsappDigits: string | null;
      instagramUserId?: string | null;
      guestName: string | null;
      companyName?: string | null;
      instagramHandle?: string | null;
      campaignObjective?: string | null;
      subjectSummary?: string | null;
      desiredHouseValue?: number | null;
      crmPreferredCity?: string | null;
      crmPropertyTypology?: RafaCallCrmPropertyTypology[];
      botEnabled: boolean;
      crmComments: string | null;
      crmProfileImageUrl: string | null;
      updatedAt: Date;
      createdAt: Date;
    },
    columnSlug: string,
  ) {
    if (!lead.whatsappDigits) {
      return this.serializeLead(lead, columnSlug, []);
    }
    const docs = await this.rafacallCrm.listDocumentsByWhatsapp([
      lead.whatsappDigits,
    ]);
    return this.serializeLead(
      lead,
      columnSlug,
      docs.get(lead.whatsappDigits) ?? [],
    );
  }

  private serializeLead(
    lead: {
      id: string;
      chatbotId: string;
      columnId: string;
      whatsappDigits: string | null;
      instagramUserId?: string | null;
      guestName: string | null;
      companyName?: string | null;
      instagramHandle?: string | null;
      campaignObjective?: string | null;
      subjectSummary?: string | null;
      desiredHouseValue?: number | null;
      crmPreferredCity?: string | null;
      crmPropertyTypology?: RafaCallCrmPropertyTypology[];
      botEnabled: boolean;
      crmComments: string | null;
      crmProfileImageUrl: string | null;
      updatedAt: Date;
      createdAt: Date;
    },
    columnSlug: string,
    documents: Array<{
      id: string;
      fileName: string;
      fileUrl: string;
      sizeBytes: number;
      createdAt: string;
    }> = [],
  ) {
    return {
      id: lead.id,
      columnId: lead.columnId,
      columnSlug,
      whatsapp: lead.whatsappDigits,
      instagramUserId: lead.instagramUserId ?? null,
      guestName: lead.guestName,
      companyName: lead.companyName ?? null,
      instagramHandle: lead.instagramHandle ?? null,
      campaignObjective: lead.campaignObjective ?? null,
      subjectSummary: lead.subjectSummary ?? null,
      desiredHouseValue: lead.desiredHouseValue ?? null,
      preferredCities: lead.crmPreferredCity ?? null,
      propertyTypology: lead.crmPropertyTypology ?? [],
      botEnabled: lead.botEnabled,
      crmComments: lead.crmComments,
      crmProfileImageUrl: lead.crmProfileImageUrl,
      documents,
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
