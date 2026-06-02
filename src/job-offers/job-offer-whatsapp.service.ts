import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  JobOfferWhatsappMessageStatus,
  Prisma,
} from '@prisma/client';
import { HouseListingOpenAiService } from '../listing-ai/house-listing-openai.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import {
  canonicalPhoneDigits,
  digitsOnly,
  phonesMatchMonitored,
} from '../whatsapp-scan/phone-match.util';
import { IngestMessageDto } from '../whatsapp-scan/dto/ingest-message.dto';
import { CreateJobOfferWhatsappRouteDto } from './dto/create-job-offer-whatsapp-route.dto';
import { UpdateJobOfferWhatsappRouteDto } from './dto/update-job-offer-whatsapp-route.dto';
import {
  extractAdvertiserContactsFromText,
  hasAdvertiserContact,
  mergeAdvertiserContacts,
} from './job-offer-contacts.util';
import { formatJobOfferWhatsappText } from './job-offer-format.util';

type RouteRow = {
  id: string;
  sourceGroupJid: string;
  sourceTitle: string | null;
  destGroupJid: string;
  destTitle: string | null;
  monitoredNumbers: string[];
  monitorAllMembers: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function mapRouteRow(r: RouteRow) {
  return {
    id: r.id,
    sourceGroupJid: r.sourceGroupJid,
    sourceTitle: r.sourceTitle,
    destGroupJid: r.destGroupJid,
    destTitle: r.destTitle,
    monitoredNumbers: r.monitoredNumbers,
    monitorAllMembers: r.monitorAllMembers,
    active: r.active,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const routeSelect = {
  id: true,
  sourceGroupJid: true,
  sourceTitle: true,
  destGroupJid: true,
  destTitle: true,
  monitoredNumbers: true,
  monitorAllMembers: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class JobOfferWhatsappService {
  private readonly logger = new Logger(JobOfferWhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly listingOpenAi: HouseListingOpenAiService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  async listRoutes() {
    const rows = await this.prisma.jobOfferWhatsappRoute.findMany({
      orderBy: { createdAt: 'asc' },
      select: routeSelect,
    });
    return { items: rows.map(mapRouteRow) };
  }

  async createRoute(dto: CreateJobOfferWhatsappRouteDto) {
    const sourceGroupJid = dto.sourceGroupJid.trim();
    const destGroupJid = dto.destGroupJid.trim();
    if (sourceGroupJid === destGroupJid) {
      throw new BadRequestException(
        'O grupo de origem e o de destino não podem ser o mesmo.',
      );
    }

    const monitoredNumbers = (dto.monitoredNumbers ?? [])
      .map((n) => canonicalPhoneDigits(n) || digitsOnly(n))
      .filter((n) => n.length > 0);
    const monitorAllMembers =
      dto.monitorAllMembers === true ||
      (dto.monitorAllMembers !== false && monitoredNumbers.length === 0);

    let sourceTitle = dto.sourceTitle?.trim() || null;
    let destTitle = dto.destTitle?.trim() || null;
    if (!sourceTitle) {
      sourceTitle = await this.whatsapp.getGroupSubject(sourceGroupJid);
    }
    if (!destTitle) {
      destTitle = await this.whatsapp.getGroupSubject(destGroupJid);
    }

    try {
      const row = await this.prisma.jobOfferWhatsappRoute.create({
        data: {
          sourceGroupJid,
          sourceTitle,
          destGroupJid,
          destTitle,
          monitoredNumbers: monitorAllMembers ? [] : monitoredNumbers,
          monitorAllMembers,
          active: dto.active ?? true,
        },
        select: routeSelect,
      });
      return mapRouteRow(row);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Já existe uma rota com este par origem → destino.',
        );
      }
      throw e;
    }
  }

  async updateRoute(id: string, dto: UpdateJobOfferWhatsappRouteDto) {
    const existing = await this.prisma.jobOfferWhatsappRoute.findUnique({
      where: { id },
      select: routeSelect,
    });
    if (!existing) throw new NotFoundException('Rota não encontrada.');

    const data: Prisma.JobOfferWhatsappRouteUpdateInput = {};
    if (typeof dto.sourceTitle === 'string') {
      data.sourceTitle = dto.sourceTitle.trim() || null;
    }
    if (typeof dto.destTitle === 'string') {
      data.destTitle = dto.destTitle.trim() || null;
    }
    if (typeof dto.sourceGroupJid === 'string') {
      data.sourceGroupJid = dto.sourceGroupJid.trim();
    }
    if (typeof dto.destGroupJid === 'string') {
      data.destGroupJid = dto.destGroupJid.trim();
    }
    if (Array.isArray(dto.monitoredNumbers)) {
      const nums = dto.monitoredNumbers
        .map((n) => canonicalPhoneDigits(n) || digitsOnly(n))
        .filter((n) => n.length > 0);
      data.monitoredNumbers = nums;
      if (typeof dto.monitorAllMembers !== 'boolean') {
        data.monitorAllMembers = nums.length === 0;
        if (nums.length === 0) data.monitoredNumbers = [];
      }
    }
    if (typeof dto.monitorAllMembers === 'boolean') {
      data.monitorAllMembers = dto.monitorAllMembers;
      if (dto.monitorAllMembers) data.monitoredNumbers = [];
    }
    if (typeof dto.active === 'boolean') {
      data.active = dto.active;
    }

    const nextSource =
      typeof dto.sourceGroupJid === 'string'
        ? dto.sourceGroupJid.trim()
        : existing.sourceGroupJid;
    const nextDest =
      typeof dto.destGroupJid === 'string'
        ? dto.destGroupJid.trim()
        : existing.destGroupJid;
    if (nextSource === nextDest) {
      throw new BadRequestException(
        'O grupo de origem e o de destino não podem ser o mesmo.',
      );
    }

    try {
      const row = await this.prisma.jobOfferWhatsappRoute.update({
        where: { id },
        data,
        select: routeSelect,
      });
      return mapRouteRow(row);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Já existe uma rota com este par origem → destino.',
        );
      }
      throw e;
    }
  }

  async deleteRoute(id: string) {
    const existing = await this.prisma.jobOfferWhatsappRoute.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Rota não encontrada.');
    await this.prisma.jobOfferWhatsappRoute.delete({ where: { id } });
    return { ok: true as const };
  }

  async listEvolutionGroups() {
    const instance = this.whatsapp.getPrimaryInstanceName();
    const items = await this.whatsapp.fetchInstanceGroupTargets(instance);
    return { instance, items };
  }

  async listMessages(limit = 80, routeId?: string) {
    const rows = await this.prisma.jobOfferWhatsappMessage.findMany({
      where: routeId ? { routeId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
      select: {
        id: true,
        routeId: true,
        senderNumber: true,
        rawText: true,
        status: true,
        createdJobOfferId: true,
        error: true,
        createdAt: true,
        route: {
          select: {
            sourceTitle: true,
            destTitle: true,
            sourceGroupJid: true,
            destGroupJid: true,
          },
        },
      },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        routeId: r.routeId,
        routeLabel: r.route
          ? `${r.route.sourceTitle ?? r.route.sourceGroupJid} → ${r.route.destTitle ?? r.route.destGroupJid}`
          : null,
        senderNumber: r.senderNumber,
        rawText: r.rawText.slice(0, 500),
        status: r.status,
        createdJobOfferId: r.createdJobOfferId,
        error: r.error,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async ingest(dto: IngestMessageDto): Promise<{ ok: true; status: string }> {
    const text = (dto.text ?? '').trim();
    const groupJid = (dto.groupJid ?? '').trim();
    if (!groupJid) return { ok: true, status: 'ignored_no_group' };

    const routes = await this.prisma.jobOfferWhatsappRoute.findMany({
      where: { sourceGroupJid: groupJid, active: true },
      select: routeSelect,
    });
    if (!routes.length) return { ok: true, status: 'ignored_no_route' };

    const kind = dto.kind ?? 'text';
    if ((kind === 'image' || kind === 'video') && !text) {
      return { ok: true, status: 'ignored_media_no_caption' };
    }
    if (!text) return { ok: true, status: 'ignored_empty' };

    let lastStatus = 'ignored_no_route';
    for (const route of routes) {
      lastStatus = await this.processForRoute(dto, route, text);
    }
    return { ok: true, status: lastStatus };
  }

  private async processForRoute(
    dto: IngestMessageDto,
    route: RouteRow,
    text: string,
  ): Promise<string> {
    const senderNumber =
      canonicalPhoneDigits(dto.senderNumber) || digitsOnly(dto.senderNumber);
    const externalMessageId = dto.externalMessageId?.trim() || null;

    if (!route.monitorAllMembers) {
      if (
        route.monitoredNumbers.length === 0 ||
        !phonesMatchMonitored(senderNumber, route.monitoredNumbers)
      ) {
        if (process.env.JOB_OFFER_WHATSAPP_LOG_SENDER === '1') {
          this.logger.warn(
            `ignored_sender route=${route.id} sender=${senderNumber}`,
          );
        }
        return 'ignored_sender';
      }
    }

    const claim = await this.claimMessage({
      routeId: route.id,
      senderNumber,
      externalMessageId,
      rawText: text,
    });
    if (claim.duplicate) return 'ignored_duplicate';
    const recordId = claim.id;

    if (!this.listingOpenAi.isConfigured()) {
      await this.updateRecord(recordId, {
        status: JobOfferWhatsappMessageStatus.error,
        error: 'OPENAI_API_KEY em falta',
      });
      return 'error_openai_config';
    }

    let parsed;
    try {
      parsed = await this.listingOpenAi.extractJobOfferFromText(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`OpenAI (job offer whatsapp): ${msg}`);
      await this.updateRecord(recordId, {
        status: JobOfferWhatsappMessageStatus.error,
        error: msg.slice(0, 1000),
      });
      return 'error_openai';
    }

    if (!parsed.isJobOffer || !parsed.offer) {
      await this.updateRecord(recordId, {
        status: JobOfferWhatsappMessageStatus.ignored_not_offer,
        parsedJson: parsed as unknown as Prisma.InputJsonValue,
      });
      return 'ignored_not_offer';
    }

    const extracted = parsed.offer;
    const advertiserContacts = mergeAdvertiserContacts(
      extracted.advertiserContacts,
      extractAdvertiserContactsFromText(text),
    );
    if (!hasAdvertiserContact(text, advertiserContacts)) {
      await this.updateRecord(recordId, {
        status: JobOfferWhatsappMessageStatus.ignored_no_contact,
        parsedJson: parsed as unknown as Prisma.InputJsonValue,
      });
      return 'ignored_no_contact';
    }

    const publishedAt = new Date(`${extracted.publishedAt}T12:00:00.000Z`);
    if (Number.isNaN(publishedAt.getTime())) {
      await this.updateRecord(recordId, {
        status: JobOfferWhatsappMessageStatus.error,
        parsedJson: parsed as unknown as Prisma.InputJsonValue,
        error: 'Data de publicação inválida',
      });
      return 'error_invalid_date';
    }

    const destJid = route.destGroupJid.trim();

    try {
      const offer = await this.prisma.jobOffer.create({
        data: {
          title: extracted.title.trim(),
          jobFunction: extracted.jobFunction.trim(),
          city: extracted.city.trim(),
          company: extracted.company.trim(),
          summary: extracted.summary.trim().slice(0, 500),
          description: extracted.description.trim(),
          advertiserContacts: advertiserContacts as unknown as Prisma.InputJsonValue,
          publishedAt,
          active: true,
        },
      });

      const waText = formatJobOfferWhatsappText(offer);
      try {
        await this.whatsapp.sendText(destJid, waText, {
          requireDelivery: true,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(
          `Oferta ${offer.id} criada mas falha WhatsApp (rota ${route.id}): ${msg}`,
        );
        await this.updateRecord(recordId, {
          status: JobOfferWhatsappMessageStatus.created,
          parsedJson: parsed as unknown as Prisma.InputJsonValue,
          createdJobOfferId: offer.id,
          error: `WhatsApp destino: ${msg.slice(0, 800)}`,
        });
        return 'created_whatsapp_failed';
      }

      await this.updateRecord(recordId, {
        status: JobOfferWhatsappMessageStatus.created,
        parsedJson: parsed as unknown as Prisma.InputJsonValue,
        createdJobOfferId: offer.id,
      });
      return 'created';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.updateRecord(recordId, {
        status: JobOfferWhatsappMessageStatus.error,
        parsedJson: parsed as unknown as Prisma.InputJsonValue,
        error: msg.slice(0, 1000),
      });
      return 'error_create';
    }
  }

  private async claimMessage(input: {
    routeId: string;
    senderNumber: string;
    externalMessageId: string | null;
    rawText: string;
  }): Promise<{ id: string; duplicate: boolean }> {
    const rawText = input.rawText.slice(0, 8000);
    if (input.externalMessageId) {
      try {
        const created = await this.prisma.jobOfferWhatsappMessage.create({
          data: {
            routeId: input.routeId,
            senderNumber: input.senderNumber,
            externalMessageId: input.externalMessageId,
            rawText,
            status: JobOfferWhatsappMessageStatus.received,
          },
          select: { id: true },
        });
        return { id: created.id, duplicate: false };
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          return { id: '', duplicate: true };
        }
        throw e;
      }
    }

    const recent = await this.prisma.jobOfferWhatsappMessage.findFirst({
      where: {
        routeId: input.routeId,
        senderNumber: input.senderNumber,
        rawText,
        createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (recent) return { id: '', duplicate: true };

    const created = await this.prisma.jobOfferWhatsappMessage.create({
      data: {
        routeId: input.routeId,
        senderNumber: input.senderNumber,
        rawText,
        status: JobOfferWhatsappMessageStatus.received,
      },
      select: { id: true },
    });
    return { id: created.id, duplicate: false };
  }

  private async updateRecord(
    id: string,
    data: {
      status: JobOfferWhatsappMessageStatus;
      parsedJson?: Prisma.InputJsonValue;
      createdJobOfferId?: string;
      error?: string;
    },
  ) {
    await this.prisma.jobOfferWhatsappMessage.update({
      where: { id },
      data: {
        status: data.status,
        ...(data.parsedJson !== undefined ? { parsedJson: data.parsedJson } : {}),
        ...(data.createdJobOfferId !== undefined
          ? { createdJobOfferId: data.createdJobOfferId }
          : {}),
        ...(data.error !== undefined ? { error: data.error } : {}),
      },
    });
  }
}
