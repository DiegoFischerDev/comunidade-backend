import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JobOfferWhatsappMessageStatus, Prisma } from '@prisma/client';
import { HouseListingOpenAiService } from '../listing-ai/house-listing-openai.service';
import { HouseImageStorageService } from '../partner/house-image-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import {
  canonicalPhoneDigits,
  digitsOnly,
  phonesMatchMonitored,
} from '../whatsapp-scan/phone-match.util';
import { IngestMessageDto } from '../whatsapp-scan/dto/ingest-message.dto';
import { CreateJobOfferWhatsappDestinationDto } from './dto/create-job-offer-whatsapp-destination.dto';
import { CreateJobOfferWhatsappScanDto } from './dto/create-job-offer-whatsapp-scan.dto';
import { UpdateJobOfferWhatsappScanDto } from './dto/update-job-offer-whatsapp-scan.dto';
import { UpdateJobOfferWhatsappDestinationDto } from './dto/update-job-offer-whatsapp-destination.dto';
import {
  JOB_OFFER_WHATSAPP_IMAGE_CAPTION_MAX,
  formatJobOfferWhatsappText,
} from './job-offer-format.util';
import { validateParsedJobOffer } from './job-offer-parse-validation.util';
import {
  type JobOfferDuplicateCompareInput,
  isNearDuplicateJobOffer,
  jobOfferDuplicateCheckEnabled,
  jobOfferDuplicateLookbackDays,
} from './job-offer-duplicate.util';
import { resolveJobOfferRegionFromCity } from './job-offer-region.util';
import { toAbsoluteMediaUrl } from '../common/public-media-url';

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
  id: string;
  destGroupJid: string;
  destTitle: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function jobOfferImageMimeForSend(
  imageUrl: string,
  publicNumber: number,
): { mimeType: string; fileName: string } {
  const path = imageUrl.split('?')[0]!.toLowerCase();
  if (path.endsWith('.png')) {
    return { mimeType: 'image/png', fileName: `oferta-${publicNumber}.png` };
  }
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) {
    return { mimeType: 'image/jpeg', fileName: `oferta-${publicNumber}.jpg` };
  }
  if (path.endsWith('.gif')) {
    return { mimeType: 'image/gif', fileName: `oferta-${publicNumber}.gif` };
  }
  return { mimeType: 'image/webp', fileName: `oferta-${publicNumber}.webp` };
}

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
  return {
    id: r.id,
    destGroupJid: r.destGroupJid,
    destTitle: r.destTitle,
    active: r.active,
    createdAt: r.createdAt.toISOString(),
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
  id: true,
  destGroupJid: true,
  destTitle: true,
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
    private readonly imageStorage: HouseImageStorageService,
  ) {}

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
    const rows = await this.prisma.jobOfferWhatsappDestination.findMany({
      orderBy: { createdAt: 'asc' },
      select: destinationSelect,
    });
    return { items: rows.map(mapDestinationRow) };
  }

  async createDestination(dto: CreateJobOfferWhatsappDestinationDto) {
    const destGroupJid = dto.destGroupJid.trim();
    let destTitle = dto.destTitle?.trim() || null;
    if (!destTitle) {
      destTitle = await this.whatsapp.getGroupSubject(destGroupJid);
    }

    try {
      const row = await this.prisma.jobOfferWhatsappDestination.create({
        data: {
          destGroupJid,
          destTitle,
          active: dto.active ?? true,
        },
        select: destinationSelect,
      });
      return mapDestinationRow(row);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Este grupo já está configurado como destino.',
        );
      }
      throw e;
    }
  }

  async updateDestination(
    id: string,
    dto: UpdateJobOfferWhatsappDestinationDto,
  ) {
    const existing = await this.prisma.jobOfferWhatsappDestination.findUnique({
      where: { id },
      select: destinationSelect,
    });
    if (!existing) throw new NotFoundException('Destino não encontrado.');

    const data: Prisma.JobOfferWhatsappDestinationUpdateInput = {};
    if (dto.destGroupJid !== undefined) {
      const jid = dto.destGroupJid?.trim();
      if (!jid) {
        throw new BadRequestException('Grupo de destino inválido.');
      }
      data.destGroupJid = jid;
    }
    if (typeof dto.destTitle === 'string') {
      data.destTitle = dto.destTitle.trim() || null;
    }
    if (typeof dto.active === 'boolean') {
      data.active = dto.active;
    }

    if (
      dto.destGroupJid !== undefined &&
      !dto.destTitle?.trim()
    ) {
      const jid =
        typeof data.destGroupJid === 'string'
          ? data.destGroupJid
          : existing.destGroupJid;
      data.destTitle = await this.whatsapp.getGroupSubject(jid);
    }

    try {
      const row = await this.prisma.jobOfferWhatsappDestination.update({
        where: { id },
        data,
        select: destinationSelect,
      });
      return mapDestinationRow(row);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Já existe outro destino com este grupo WhatsApp.',
        );
      }
      throw e;
    }
  }

  async deleteDestination(id: string) {
    const existing = await this.prisma.jobOfferWhatsappDestination.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Destino não encontrado.');
    await this.prisma.jobOfferWhatsappDestination.delete({ where: { id } });
    return { ok: true as const };
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
        parsedJson: true,
        sourceImageUrl: true,
        createdAt: true,
        scan: {
          select: {
            sourceTitle: true,
            sourceGroupJid: true,
          },
        },
        createdJobOffer: {
          select: { imageUrl: true },
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
        parsedJson: r.parsedJson ?? null,
        imageUrl:
          r.sourceImageUrl ?? r.createdJobOffer?.imageUrl ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async ingest(dto: IngestMessageDto): Promise<{ ok: true; status: string }> {
    const text = (dto.text ?? '').trim();
    const groupJid = (dto.groupJid ?? '').trim();
    const kind = dto.kind ?? 'text';
    if (!groupJid) return { ok: true, status: 'ignored_no_group' };

    const scans = await this.prisma.jobOfferWhatsappScan.findMany({
      where: { sourceGroupJid: groupJid, active: true },
      select: scanSelect,
    });
    if (!scans.length) {
      this.logIngestOutcome('ignored_no_scan', groupJid, kind, text);
      return { ok: true, status: 'ignored_no_scan' };
    }
    const hasBase64 = !!dto.base64?.length;
    const canFetchMedia = !!dto.externalMessageId?.trim();
    const isImage = kind === 'image';
    const processableImage =
      isImage && (hasBase64 || canFetchMedia);

    if (kind === 'video' && !text) {
      return { ok: true, status: 'ignored_media_video' };
    }
    if (!text && !processableImage) {
      return { ok: true, status: 'ignored_empty' };
    }

    const destinations = await this.prisma.jobOfferWhatsappDestination.findMany({
      where: { active: true },
      select: destinationSelect,
    });

    let lastStatus = 'ignored_no_scan';
    for (const scan of scans) {
      lastStatus = await this.processForScan(dto, scan, destinations);
    }
    this.logIngestOutcome(lastStatus, groupJid, kind, text);
    return { ok: true, status: lastStatus };
  }

  /** Ativa com JOB_OFFER_WHATSAPP_LOG_INGEST=1 no servidor. */
  private logIngestOutcome(
    status: string,
    groupJid: string,
    kind: string,
    text: string,
  ): void {
    if (process.env.JOB_OFFER_WHATSAPP_LOG_INGEST !== '1') return;
    this.logger.log(
      `ingest status=${status} group=${groupJid} kind=${kind} textLen=${text.length}`,
    );
  }

  private async resolveImagePayload(
    dto: IngestMessageDto,
  ): Promise<{ base64: string; mimeType: string } | null> {
    let base64 = dto.base64?.trim() || '';
    let mimeType = dto.mimeType?.trim() || 'image/jpeg';

    if (!base64 && dto.externalMessageId?.trim()) {
      const instance = dto.instance?.trim() || this.whatsapp.getPrimaryInstanceName();
      const fetched = await this.whatsapp.getMediaBase64(
        instance,
        dto.externalMessageId.trim(),
      );
      if (fetched) {
        base64 = fetched.base64;
        mimeType = mimeType || fetched.mimetype || 'image/jpeg';
      }
    }

    if (!base64) return null;
    return { base64, mimeType };
  }

  private async processForScan(
    dto: IngestMessageDto,
    scan: ScanRow,
    destinations: DestinationRow[],
  ): Promise<string> {
    const text = (dto.text ?? '').trim();
    const kind = dto.kind ?? 'text';
    const isImage = kind === 'image';
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

    const claimRaw = text || (isImage ? '[image]' : '');
    const claim = await this.claimMessage({
      scanId: scan.id,
      senderNumber,
      externalMessageId,
      rawText: claimRaw,
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

    const imageMedia = isImage ? await this.resolveImagePayload(dto) : null;
    if (isImage && !imageMedia) {
      await this.updateRecord(recordId, {
        status: JobOfferWhatsappMessageStatus.error,
        error: 'Imagem sem bytes (Webhook Base64 / Evolution getBase64).',
      });
      return 'error_media_no_bytes';
    }

    let storedImageUrl: string | null = null;
    if (isImage && imageMedia) {
      try {
        const buf = Buffer.from(imageMedia.base64, 'base64');
        const stored = await this.imageStorage.processJobOfferImageBuffer(buf);
        storedImageUrl = stored.publicUrl;
        await this.updateRecord(recordId, {
          status: JobOfferWhatsappMessageStatus.received,
          sourceImageUrl: storedImageUrl,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await this.updateRecord(recordId, {
          status: JobOfferWhatsappMessageStatus.error,
          error: msg.slice(0, 1000),
        });
        return 'error_media';
      }
    }

    let parsed;
    try {
      if (isImage && imageMedia) {
        parsed = await this.listingOpenAi.extractJobOfferFromImage(
          imageMedia.base64,
          imageMedia.mimeType,
          text,
        );
      } else {
        parsed = await this.listingOpenAi.extractJobOfferFromText(text);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`OpenAI (job offer whatsapp): ${msg}`);
      await this.updateRecord(recordId, {
        status: JobOfferWhatsappMessageStatus.error,
        error: msg.slice(0, 1000),
      });
      return 'error_openai';
    }

    const textForContacts = [text, parsed.offer?.description ?? '']
      .filter(Boolean)
      .join('\n');
    const validation = validateParsedJobOffer(parsed, textForContacts);

    if (!validation.ok) {
      const statusByReason: Record<
        typeof validation.reason,
        JobOfferWhatsappMessageStatus
      > = {
        not_offer: JobOfferWhatsappMessageStatus.ignored_not_offer,
        no_city: JobOfferWhatsappMessageStatus.ignored_no_city,
        no_contact: JobOfferWhatsappMessageStatus.ignored_no_contact,
        invalid_date: JobOfferWhatsappMessageStatus.error,
      };
      await this.updateRecord(recordId, {
        status: statusByReason[validation.reason],
        parsedJson: parsed as unknown as Prisma.InputJsonValue,
        ...(validation.reason === 'invalid_date'
          ? { error: 'Data de publicação inválida' }
          : {}),
      });
      return validation.reason === 'invalid_date'
        ? 'error_invalid_date'
        : validation.reason === 'no_city'
          ? 'ignored_no_city'
          : validation.reason === 'no_contact'
            ? 'ignored_no_contact'
            : 'ignored_not_offer';
    }

    const { offer: extracted, advertiserContacts, city } = validation;
    const publishedAt = new Date(`${extracted.publishedAt}T12:00:00.000Z`);
    const region = resolveJobOfferRegionFromCity(city);

    const candidate: JobOfferDuplicateCompareInput = {
      title: extracted.title.trim(),
      jobFunction: extracted.jobFunction.trim(),
      city,
      company: extracted.company.trim(),
      summary: extracted.summary.trim(),
      description: extracted.description.trim(),
    };

    if (jobOfferDuplicateCheckEnabled()) {
      const duplicate = await this.findRecentDuplicateOffer(candidate);
      if (duplicate) {
        const days = jobOfferDuplicateLookbackDays();
        await this.updateRecord(recordId, {
          status: JobOfferWhatsappMessageStatus.ignored_duplicate_offer,
          parsedJson: parsed as unknown as Prisma.InputJsonValue,
          error: `Oferta muito semelhante à #${duplicate.publicNumber} publicada nos últimos ${days} dias (mesma empresa/vaga).`,
        });
        this.logger.log(
          `Oferta ignorada (duplicada): semelhante a ${duplicate.id} (#${duplicate.publicNumber})`,
        );
        return 'ignored_duplicate_offer';
      }
    }

    const activeDestinations = destinations.filter(
      (d) => d.active && d.destGroupJid.trim().length > 0,
    );

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
          imageUrl: storedImageUrl,
          active: true,
        },
      });

      if (activeDestinations.length === 0) {
        await this.updateRecord(recordId, {
          status: JobOfferWhatsappMessageStatus.skipped_no_destination,
          parsedJson: parsed as unknown as Prisma.InputJsonValue,
          createdJobOfferId: offer.id,
          error:
            'Oferta guardada; nenhum grupo de destino ativo configurado.',
        });
        return 'skipped_no_destination';
      }

      const imageUrl = (offer.imageUrl ?? storedImageUrl)?.trim() || '';
      const sendErrors: string[] = [];
      for (const dest of activeDestinations) {
        try {
          await this.publishOfferToWhatsappDestination({
            destGroupJid: dest.destGroupJid,
            offer,
            imageUrl,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const label = dest.destTitle ?? dest.destGroupJid;
          this.logger.error(
            `Oferta ${offer.id} criada mas falha WhatsApp (${label}): ${msg}`,
          );
          sendErrors.push(`${label}: ${msg.slice(0, 200)}`);
        }
      }

      if (sendErrors.length === activeDestinations.length) {
        await this.updateRecord(recordId, {
          status: JobOfferWhatsappMessageStatus.created,
          parsedJson: parsed as unknown as Prisma.InputJsonValue,
          createdJobOfferId: offer.id,
          error: `WhatsApp (todos os destinos falharam): ${sendErrors.join(' | ').slice(0, 800)}`,
        });
        return 'created_whatsapp_failed';
      }

      await this.updateRecord(recordId, {
        status: JobOfferWhatsappMessageStatus.created,
        parsedJson: parsed as unknown as Prisma.InputJsonValue,
        createdJobOfferId: offer.id,
        ...(sendErrors.length > 0
          ? {
              error: `WhatsApp (parcial): ${sendErrors.join(' | ').slice(0, 800)}`,
            }
          : {}),
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

  /**
   * Republica a oferta no grupo destino: imagem + texto na mesma mensagem (caption),
   * ou só texto quando não há imagem.
   */
  private async publishOfferToWhatsappDestination(input: {
    destGroupJid: string;
    offer: {
      publicNumber: number;
      jobFunction: string;
      city: string;
      company: string;
      summary: string;
      advertiserContacts: unknown;
    };
    imageUrl: string;
  }): Promise<void> {
    const hasImage = Boolean(input.imageUrl);
    const waText = formatJobOfferWhatsappText(input.offer, {
      maxLength: hasImage ? JOB_OFFER_WHATSAPP_IMAGE_CAPTION_MAX : 4000,
    });

    if (!hasImage) {
      await this.whatsapp.sendText(input.destGroupJid, waText, {
        requireDelivery: true,
      });
      return;
    }

    const abs = toAbsoluteMediaUrl(input.imageUrl);
    const { mimeType, fileName } = jobOfferImageMimeForSend(
      input.imageUrl,
      input.offer.publicNumber,
    );
    await this.whatsapp.sendMedia({
      to: input.destGroupJid,
      caption: waText,
      mediaUrl: abs,
      mimeType,
      fileName,
      mediaType: 'image',
      requireDelivery: true,
    });
  }

  /** Ofertas criadas nos últimos N dias com perfil semelhante (republicação no grupo). */
  private async findRecentDuplicateOffer(
    candidate: JobOfferDuplicateCompareInput,
  ): Promise<{ id: string; publicNumber: number } | null> {
    const days = jobOfferDuplicateLookbackDays();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const recent = await this.prisma.jobOffer.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true,
        publicNumber: true,
        title: true,
        jobFunction: true,
        city: true,
        company: true,
        summary: true,
        description: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 400,
    });

    for (const row of recent) {
      if (isNearDuplicateJobOffer(candidate, row)) {
        return { id: row.id, publicNumber: row.publicNumber };
      }
    }
    return null;
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
      sourceImageUrl?: string | null;
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
        ...(data.sourceImageUrl !== undefined
          ? { sourceImageUrl: data.sourceImageUrl }
          : {}),
        ...(data.error !== undefined ? { error: data.error } : {}),
      },
    });
  }
}
