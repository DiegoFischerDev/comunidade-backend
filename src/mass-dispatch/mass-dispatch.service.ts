import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  MassCampaignRecipientStatus,
  MassCampaignStatus,
  Prisma,
} from '@prisma/client';
import { enrichWelcomeStepsChannelMedia } from '../uploads/channel-media.util';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationOutboundService } from '../channels/conversation-outbound.service';
import {
  CreateMassCampaignDto,
  MASS_DISPATCH_BOT_SLUGS,
  MASS_DISPATCH_TYPOLOGIES,
  type MassDispatchBotSlug,
  type MassDispatchFiltersDto,
} from './dto/mass-dispatch.dto';
import { MassDispatchAudienceService } from './mass-dispatch-audience.service';
import {
  applyTextVariations,
  normalizeMassDispatchSteps,
} from './mass-dispatch-steps';
import { MassDispatchVariationsService } from './mass-dispatch-variations.service';

const PREVIEW_LIMIT = 50;

@Injectable()
export class MassDispatchService {
  private readonly logger = new Logger(MassDispatchService.name);
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audience: MassDispatchAudienceService,
    private readonly variations: MassDispatchVariationsService,
    private readonly outbound: ConversationOutboundService,
  ) {}

  normalizeFilters(raw: MassDispatchFiltersDto | undefined): MassDispatchFiltersDto {
    const filters: MassDispatchFiltersDto = {};
    if (!raw || typeof raw !== 'object') return filters;

    if (Array.isArray(raw.bots)) {
      filters.bots = raw.bots.filter((b): b is MassDispatchBotSlug =>
        (MASS_DISPATCH_BOT_SLUGS as readonly string[]).includes(b),
      );
    }
    if (typeof raw.hasVisa === 'boolean') filters.hasVisa = raw.hasVisa;
    if (Array.isArray(raw.typologies)) {
      filters.typologies = raw.typologies.filter(
        (t): t is (typeof MASS_DISPATCH_TYPOLOGIES)[number] =>
          (MASS_DISPATCH_TYPOLOGIES as readonly string[]).includes(t),
      );
    }
    if (typeof raw.preferredCityContains === 'string') {
      filters.preferredCityContains = raw.preferredCityContains.trim().slice(0, 160);
    }
    if (typeof raw.immigrationFrom === 'string') {
      filters.immigrationFrom = raw.immigrationFrom.trim().slice(0, 10);
    }
    if (typeof raw.immigrationTo === 'string') {
      filters.immigrationTo = raw.immigrationTo.trim().slice(0, 10);
    }
    if (raw.immigrationImmediate === true) {
      filters.immigrationImmediate = true;
    }
    return filters;
  }

  async preview(filters: MassDispatchFiltersDto) {
    const items = await this.audience.resolveAudience(
      this.normalizeFilters(filters),
    );
    return {
      total: items.length,
      items: items.slice(0, PREVIEW_LIMIT).map((item) => ({
        botSlug: item.botSlug,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        conversationId: item.conversationId,
        channel: item.channel,
        whatsappDigits: item.whatsappDigits,
        instagramUserId: item.instagramUserId,
        displayName: item.displayName,
        hasVisa: item.hasVisa,
        propertyTypology: item.propertyTypology,
        preferredCity: item.preferredCity,
        expectedImmigrationAt: item.expectedImmigrationAt,
        immigrationImmediate: item.immigrationImmediate,
      })),
    };
  }

  async create(userId: string, dto: CreateMassCampaignDto) {
    const active = await this.prisma.massCampaign.findFirst({
      where: { status: MassCampaignStatus.SENDING },
      select: { id: true },
    });
    if (active) {
      throw new ConflictException(
        'Já existe uma campanha a enviar. Cancela-a ou espera que termine.',
      );
    }

    const steps = normalizeMassDispatchSteps(dto.steps);
    const preparedSteps = await enrichWelcomeStepsChannelMedia(steps);
    const filters = this.normalizeFilters(dto.filters);
    const minDelay = dto.minDelayMinutes ?? 1;
    const maxDelay = dto.maxDelayMinutes ?? 10;
    if (minDelay > maxDelay) {
      throw new BadRequestException(
        'O intervalo mínimo não pode ser maior que o máximo.',
      );
    }

    const audience = await this.audience.resolveAudience(filters);
    if (audience.length === 0) {
      throw new BadRequestException(
        'Nenhum lead corresponde às condições (com canal activo).',
      );
    }

    const textVariations = await this.variations.generateForSteps(preparedSteps);
    const now = new Date();
    /** Placeholder até o worker agendar o próximo após cada envio. */
    const parkedDueAt = new Date('2099-01-01T00:00:00.000Z');

    const campaign = await this.prisma.massCampaign.create({
      data: {
        name: dto.name?.trim() || null,
        status: MassCampaignStatus.SENDING,
        steps: preparedSteps as unknown as Prisma.InputJsonValue,
        filters: filters as unknown as Prisma.InputJsonValue,
        textVariations: textVariations as unknown as Prisma.InputJsonValue,
        minDelayMinutes: minDelay,
        maxDelayMinutes: maxDelay,
        totalRecipients: audience.length,
        sentCount: 0,
        failedCount: 0,
        createdByUserId: userId,
        recipients: {
          create: audience.map((item, index) => ({
            status: MassCampaignRecipientStatus.PENDING,
            botSlug: item.botSlug,
            sourceType: item.sourceType,
            sourceId: item.sourceId,
            conversationId: item.conversationId,
            channel: item.channel,
            whatsappDigits: item.whatsappDigits,
            instagramUserId: item.instagramUserId,
            displayName: item.displayName,
            dueAt: index === 0 ? now : parkedDueAt,
            variationIndex: index,
          })),
        },
      },
    });

    return this.getById(campaign.id);
  }

  async list() {
    const items = await this.prisma.massCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return { items: items.map((c) => this.serializeCampaign(c)) };
  }

  async getById(id: string) {
    const campaign = await this.prisma.massCampaign.findUnique({
      where: { id },
      include: {
        recipients: {
          orderBy: { createdAt: 'asc' },
          take: 200,
        },
      },
    });
    if (!campaign) throw new NotFoundException('Campanha não encontrada.');
    return {
      ...this.serializeCampaign(campaign),
      recipients: campaign.recipients.map((r) => ({
        id: r.id,
        status: r.status,
        botSlug: r.botSlug,
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        conversationId: r.conversationId,
        channel: r.channel,
        whatsappDigits: r.whatsappDigits,
        instagramUserId: r.instagramUserId,
        displayName: r.displayName,
        dueAt: r.dueAt.toISOString(),
        variationIndex: r.variationIndex,
        errorMessage: r.errorMessage,
        sentAt: r.sentAt?.toISOString() ?? null,
      })),
    };
  }

  async cancel(id: string) {
    const campaign = await this.prisma.massCampaign.findUnique({
      where: { id },
    });
    if (!campaign) throw new NotFoundException('Campanha não encontrada.');
    if (campaign.status !== MassCampaignStatus.SENDING) {
      throw new BadRequestException('Só é possível cancelar campanhas a enviar.');
    }

    await this.prisma.$transaction([
      this.prisma.massCampaignRecipient.updateMany({
        where: {
          campaignId: id,
          status: {
            in: [
              MassCampaignRecipientStatus.PENDING,
              MassCampaignRecipientStatus.SENDING,
            ],
          },
        },
        data: { status: MassCampaignRecipientStatus.SKIPPED },
      }),
      this.prisma.massCampaign.update({
        where: { id },
        data: { status: MassCampaignStatus.CANCELLED },
      }),
    ]);

    return this.getById(id);
  }

  /**
   * Processa no máximo 1 recipient due. Chamado pelo worker `@Interval`.
   */
  async processDue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      const campaign = await this.prisma.massCampaign.findFirst({
        where: { status: MassCampaignStatus.SENDING },
        orderBy: { createdAt: 'asc' },
      });
      if (!campaign) return;

      const recipient = await this.prisma.massCampaignRecipient.findFirst({
        where: {
          campaignId: campaign.id,
          status: MassCampaignRecipientStatus.PENDING,
          dueAt: { lte: new Date() },
        },
        orderBy: { dueAt: 'asc' },
      });

      if (!recipient) {
        await this.maybeCompleteCampaign(campaign.id);
        return;
      }

      const claimed = await this.prisma.massCampaignRecipient.updateMany({
        where: {
          id: recipient.id,
          status: MassCampaignRecipientStatus.PENDING,
        },
        data: { status: MassCampaignRecipientStatus.SENDING },
      });
      if (claimed.count === 0) return;

      const conversation = await this.prisma.joanaConversation.findUnique({
        where: { id: recipient.conversationId },
        select: {
          id: true,
          whatsappDigits: true,
          instagramUserId: true,
          activeChannel: true,
          instance: true,
        },
      });

      const stepsRaw = campaign.steps;
      const textVariations = (campaign.textVariations ?? {}) as Record<
        string,
        string[]
      >;
      const baseSteps = normalizeMassDispatchSteps(stepsRaw);
      const variationIndex = recipient.variationIndex ?? 0;
      const steps = applyTextVariations(baseSteps, textVariations, variationIndex);

      let sendOk = false;
      let errorMessage: string | null = null;

      if (!conversation) {
        errorMessage = 'Conversa não encontrada.';
      } else {
        try {
          await this.outbound.sendWelcomeSteps(
            {
              whatsappDigits: conversation.whatsappDigits,
              instagramUserId: conversation.instagramUserId,
              activeChannel: conversation.activeChannel,
              instance: conversation.instance,
            },
            steps,
            { requireDelivery: true },
          );
          sendOk = true;
        } catch (err) {
          errorMessage =
            err instanceof Error ? err.message.slice(0, 500) : String(err);
          this.logger.warn(
            `Disparo ${campaign.id} → ${recipient.id} falhou: ${errorMessage}`,
          );
        }
      }

      const now = new Date();
      if (sendOk) {
        await this.prisma.$transaction([
          this.prisma.massCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
              status: MassCampaignRecipientStatus.SENT,
              sentAt: now,
              errorMessage: null,
            },
          }),
          this.prisma.massCampaign.update({
            where: { id: campaign.id },
            data: { sentCount: { increment: 1 } },
          }),
        ]);
      } else {
        await this.prisma.$transaction([
          this.prisma.massCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
              status: MassCampaignRecipientStatus.FAILED,
              errorMessage,
              sentAt: now,
            },
          }),
          this.prisma.massCampaign.update({
            where: { id: campaign.id },
            data: { failedCount: { increment: 1 } },
          }),
        ]);
      }

      await this.scheduleNextRecipient(campaign.id, {
        minDelayMinutes: campaign.minDelayMinutes,
        maxDelayMinutes: campaign.maxDelayMinutes,
      });
      await this.maybeCompleteCampaign(campaign.id);
    } finally {
      this.processing = false;
    }
  }

  private async scheduleNextRecipient(
    campaignId: string,
    delays: { minDelayMinutes: number; maxDelayMinutes: number },
  ): Promise<void> {
    const next = await this.prisma.massCampaignRecipient.findFirst({
      where: {
        campaignId,
        status: MassCampaignRecipientStatus.PENDING,
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!next) return;

    const delayMs = this.randomDelayMs(
      delays.minDelayMinutes,
      delays.maxDelayMinutes,
    );
    await this.prisma.massCampaignRecipient.update({
      where: { id: next.id },
      data: { dueAt: new Date(Date.now() + delayMs) },
    });
  }

  private randomDelayMs(minMinutes: number, maxMinutes: number): number {
    const min = Math.max(1, Math.min(10, minMinutes));
    const max = Math.max(min, Math.min(10, maxMinutes));
    const minutes = min + Math.random() * (max - min);
    return Math.floor(minutes * 60_000);
  }

  private async maybeCompleteCampaign(campaignId: string): Promise<void> {
    const pending = await this.prisma.massCampaignRecipient.count({
      where: {
        campaignId,
        status: {
          in: [
            MassCampaignRecipientStatus.PENDING,
            MassCampaignRecipientStatus.SENDING,
          ],
        },
      },
    });
    if (pending > 0) return;

    const current = await this.prisma.massCampaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    if (!current || current.status !== MassCampaignStatus.SENDING) return;

    await this.prisma.massCampaign.update({
      where: { id: campaignId },
      data: { status: MassCampaignStatus.COMPLETED },
    });
  }

  private serializeCampaign(campaign: {
    id: string;
    name: string | null;
    status: MassCampaignStatus;
    steps: Prisma.JsonValue;
    filters: Prisma.JsonValue;
    textVariations: Prisma.JsonValue;
    minDelayMinutes: number;
    maxDelayMinutes: number;
    totalRecipients: number;
    sentCount: number;
    failedCount: number;
    createdByUserId: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      steps: campaign.steps,
      filters: campaign.filters,
      minDelayMinutes: campaign.minDelayMinutes,
      maxDelayMinutes: campaign.maxDelayMinutes,
      totalRecipients: campaign.totalRecipients,
      sentCount: campaign.sentCount,
      failedCount: campaign.failedCount,
      createdByUserId: campaign.createdByUserId,
      createdAt: campaign.createdAt.toISOString(),
      updatedAt: campaign.updatedAt.toISOString(),
    };
  }
}
