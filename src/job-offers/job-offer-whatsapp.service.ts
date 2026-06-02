import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  JobOfferRegion,
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
import { CreateJobOfferWhatsappScanDto } from './dto/create-job-offer-whatsapp-scan.dto';
import { UpdateJobOfferWhatsappScanDto } from './dto/update-job-offer-whatsapp-scan.dto';
import { UpdateJobOfferWhatsappDestinationDto } from './dto/update-job-offer-whatsapp-destination.dto';
import {
  extractAdvertiserContactsFromText,
  hasAdvertiserContact,
  mergeAdvertiserContacts,
} from './job-offer-contacts.util';
import { formatJobOfferWhatsappText } from './job-offer-format.util';
import {
  JOB_OFFER_REGION_LABELS,
  resolveJobOfferRegionFromCity,
} from './job-offer-region.util';

const REGIONS: JobOfferRegion[] = ['NORTE', 'CENTRO', 'SUL'];

type ScanRow = {
  id: string;
  sourceGroupJid: string;
  sourceTitle: string | null;
  monitoredNumbers: string[];
  monitorAllMembers: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type DestinationRow = {
  region: JobOfferRegion;
  destGroupJid: string | null;
  destTitle: string | null;
  active: boolean;
  updatedAt: Date;
};

function mapScanRow(r: ScanRow) {
  return {
    id: r.id,
    sourceGroupJid: r.sourceGroupJid,
    sourceTitle: r.sourceTitle,
    monitoredNumbers: r.monitoredNumbers,
    monitorAllMembers: r.monitorAllMembers,
    active: r.active,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function mapDestinationRow(r: DestinationRow) {
  const configured = Boolean(r.destGroupJid?.trim());
  return {
    region: r.region,
    regionLabel: JOB_OFFER_REGION_LABELS[r.region],
    destGroupJid: r.destGroupJid,
    destTitle: r.destTitle,
    active: r.active,
    configured,
    updatedAt: r.updatedAt.toISOString(),
  };
}

const scanSelect = {
  id: true,
  sourceGroupJid: true,
  sourceTitle: true,
  monitoredNumbers: true,
  monitorAllMembers: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

const destinationSelect = {
  region: true,
  destGroupJid: true,
  destTitle: true,
  active: true,
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

  private async ensureDestinations(): Promise<DestinationRow[]> {
    await this.prisma.jobOfferWhatsappDestination.createMany({
      data: REGIONS.map((region) => ({ region, active: false })),
      skipDuplicates: true,
    });
    return this.prisma.jobOfferWhatsappDestination.findMany({
      orderBy: { region: 'asc' },
      select: destinationSelect,
    });
  }

  async listScans() {
    const rows = await this.prisma.jobOfferWhatsappScan.findMany({
      orderBy: { createdAt: 'asc' },
      select: scanSelect,
    });
    return { items: rows.map(mapScanRow) };
  }

  async createScan(dto: CreateJobOfferWhatsappScanDto) {
    const sourceGroupJid = dto.sourceGroupJid.trim();
    const monitoredNumbers = (dto.monitoredNumbers ?? [])
      .map((n) => canonicalPhoneDigits(n) || digitsOnly(n))
      .filter((n) => n.length > 0);
    const monitorAllMembers =
      dto.monitorAllMembers === true ||
      (dto.monitorAllMembers !== false && monitoredNumbers.length === 0);

    let sourceTitle = dto.sourceTitle?.trim() || null;
    if (!sourceTitle) {
      sourceTitle = await this.whatsapp.getGroupSubject(sourceGroupJid);
    }

    try {
      const row = await this.prisma.jobOfferWhatsappScan.create({
        data: {
          sourceGroupJid,
          sourceTitle,
          monitoredNumbers: monitorAllMembers ? [] : monitoredNumbers,
          monitorAllMembers,
          active: dto.active ?? true,
        },
        select: scanSelect,
      });
      return mapScanRow(row);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Este grupo de origem já está configurado para scan.',
        );
      }
      throw e;
    }
  }

  async updateScan(id: string, dto: UpdateJobOfferWhatsappScanDto) {
    const existing = await this.prisma.jobOfferWhatsappScan.findUnique({
      where: { id },
      select: scanSelect,
    });
    if (!existing) throw new NotFoundException('Grupo de scan não encontrado.');

    const data: Prisma.JobOfferWhatsappScanUpdateInput = {};
    if (typeof dto.sourceTitle === 'string') {
      data.sourceTitle = dto.sourceTitle.trim() || null;
    }
    if (typeof dto.sourceGroupJid === 'string') {
      data.sourceGroupJid = dto.sourceGroupJid.trim();
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

    try {
      const row = await this.prisma.jobOfferWhatsappScan.update({
        where: { id },
        data,
        select: scanSelect,
      });
      return mapScanRow(row);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Já existe outro scan com este grupo de origem.',
        );
      }
      throw e;
    }
  }

  async deleteScan(id: string) {
    const existing = await this.prisma.jobOfferWhatsappScan.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Grupo de scan não encontrado.');
    await this.prisma.jobOfferWhatsappScan.delete({ where: { id } });
    return { ok: true as const };
  }

  async listDestinations() {
    const rows = await this.ensureDestinations();
    return { items: rows.map(mapDestinationRow) };
  }

  async updateDestination(
    region: JobOfferRegion,
    dto: UpdateJobOfferWhatsappDestinationDto,
  ) {
    if (!REGIONS.includes(region)) {
      throw new BadRequestException('Região inválida.');
    }
    await this.ensureDestinations();

    const data: Prisma.JobOfferWhatsappDestinationUpdateInput = {};
    if (dto.destGroupJid !== undefined) {
      const jid = dto.destGroupJid?.trim() || null;
      data.destGroupJid = jid;
    }
    if (typeof dto.destTitle === 'string') {
      data.destTitle = dto.destTitle.trim() || null;
    }
    if (typeof dto.active === 'boolean') {
      data.active = dto.active;
    }

    const existing = await this.prisma.jobOfferWhatsappDestination.findUnique({
      where: { region },
      select: destinationSelect,
    });
    if (!existing) throw new NotFoundException('Destino não encontrado.');

    let destGroupJid =
      dto.destGroupJid !== undefined
        ? dto.destGroupJid?.trim() || null
        : existing.destGroupJid;
    if (destGroupJid && !dto.destTitle?.trim() && dto.destGroupJid !== undefined) {
      const title = await this.whatsapp.getGroupSubject(destGroupJid);
      data.destTitle = title;
    }

    const row = await this.prisma.jobOfferWhatsappDestination.update({
      where: { region },
      data,
      select: destinationSelect,
    });
    return mapDestinationRow(row);
  }

  async listEvolutionGroups() {
    const instance = this.whatsapp.getPrimaryInstanceName();
    const items = await this.whatsapp.fetchInstanceGroups(instance);
    return { instance, items };
  }

  async listMessages(limit = 80, scanId?: string) {
    const rows = await this.prisma.jobOfferWhatsappMessage.findMany({
      where: scanId ? { scanId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
      select: {
        id: true,
        scanId: true,
        senderNumber: true,
        rawText: true,
        status: true,
        createdJobOfferId: true,
        error: true,
        createdAt: true,
        scan: {
          select: {
            sourceTitle: true,
            sourceGroupJid: true,
          },
        },
      },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        scanId: r.scanId,
        scanLabel: r.scan
          ? (r.scan.sourceTitle ?? r.scan.sourceGroupJid)
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

    const scans = await this.prisma.jobOfferWhatsappScan.findMany({
      where: { sourceGroupJid: groupJid, active: true },
      select: scanSelect,
    });
    if (!scans.length) return { ok: true, status: 'ignored_no_scan' };

    const kind = dto.kind ?? 'text';
    if ((kind === 'image' || kind === 'video') && !text) {
      return { ok: true, status: 'ignored_media_no_caption' };
    }
    if (!text) return { ok: true, status: 'ignored_empty' };

    const destinations = await this.ensureDestinations();
    const destByRegion = new Map(
      destinations.map((d) => [d.region, d]),
    );

    let lastStatus = 'ignored_no_scan';
    for (const scan of scans) {
      lastStatus = await this.processForScan(
        dto,
        scan,
        text,
        destByRegion,
      );
    }
    return { ok: true, status: lastStatus };
  }

  private async processForScan(
    dto: IngestMessageDto,
    scan: ScanRow,
    text: string,
    destByRegion: Map<JobOfferRegion, DestinationRow>,
  ): Promise<string> {
    const senderNumber =
      canonicalPhoneDigits(dto.senderNumber) || digitsOnly(dto.senderNumber);
    const externalMessageId = dto.externalMessageId?.trim() || null;

    if (!scan.monitorAllMembers) {
      if (
        scan.monitoredNumbers.length === 0 ||
        !phonesMatchMonitored(senderNumber, scan.monitoredNumbers)
      ) {
        if (process.env.JOB_OFFER_WHATSAPP_LOG_SENDER === '1') {
          this.logger.warn(
            `ignored_sender scan=${scan.id} sender=${senderNumber}`,
          );
        }
        return 'ignored_sender';
      }
    }

    const claim = await this.claimMessage({
      scanId: scan.id,
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

    const city = extracted.city.trim();
    const region = resolveJobOfferRegionFromCity(city);
    const destination = destByRegion.get(region);

    try {
      const offer = await this.prisma.jobOffer.create({
        data: {
          title: extracted.title.trim(),
          jobFunction: extracted.jobFunction.trim(),
          city,
          company: extracted.company.trim(),
          summary: extracted.summary.trim().slice(0, 500),
          description: extracted.description.trim(),
          advertiserContacts: advertiserContacts as unknown as Prisma.InputJsonValue,
          publishedAt,
          region,
          active: true,
        },
      });

      const destJid = destination?.destGroupJid?.trim();
      if (!destination?.active || !destJid) {
        const regionLabel = JOB_OFFER_REGION_LABELS[region];
        await this.updateRecord(recordId, {
          status: JobOfferWhatsappMessageStatus.skipped_no_destination,
          parsedJson: parsed as unknown as Prisma.InputJsonValue,
          createdJobOfferId: offer.id,
          error: `Oferta guardada (${regionLabel}); grupo de destino ${regionLabel} não configurado ou inativo.`,
        });
        return 'skipped_no_destination';
      }

      const waText = formatJobOfferWhatsappText(offer);
      try {
        await this.whatsapp.sendText(destJid, waText, {
          requireDelivery: true,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(
          `Oferta ${offer.id} criada mas falha WhatsApp (${region}): ${msg}`,
        );
        await this.updateRecord(recordId, {
          status: JobOfferWhatsappMessageStatus.created,
          parsedJson: parsed as unknown as Prisma.InputJsonValue,
          createdJobOfferId: offer.id,
          error: `WhatsApp destino (${JOB_OFFER_REGION_LABELS[region]}): ${msg.slice(0, 800)}`,
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
    scanId: string;
    senderNumber: string;
    externalMessageId: string | null;
    rawText: string;
  }): Promise<{ id: string; duplicate: boolean }> {
    const rawText = input.rawText.slice(0, 8000);
    if (input.externalMessageId) {
      try {
        const created = await this.prisma.jobOfferWhatsappMessage.create({
          data: {
            scanId: input.scanId,
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
        scanId: input.scanId,
        senderNumber: input.senderNumber,
        rawText,
        createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (recent) return { id: '', duplicate: true };

    const created = await this.prisma.jobOfferWhatsappMessage.create({
      data: {
        scanId: input.scanId,
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
