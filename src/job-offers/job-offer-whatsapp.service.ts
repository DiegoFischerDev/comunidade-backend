import {
  BadRequestException,
  Injectable,
  Logger,
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
import { UpdateJobOfferWhatsappConfigDto } from './dto/update-job-offer-whatsapp-config.dto';

const CONFIG_ID = 'default';

function mapConfigRow(r: {
  sourceGroupJid: string | null;
  sourceTitle: string | null;
  destGroupJid: string | null;
  destTitle: string | null;
  monitoredNumbers: string[];
  monitorAllMembers: boolean;
  active: boolean;
  updatedAt: Date;
}) {
  const automationReady =
    r.active &&
    !!r.sourceGroupJid?.trim() &&
    !!r.destGroupJid?.trim();
  return {
    sourceGroupJid: r.sourceGroupJid,
    sourceTitle: r.sourceTitle,
    destGroupJid: r.destGroupJid,
    destTitle: r.destTitle,
    monitoredNumbers: r.monitoredNumbers,
    monitorAllMembers: r.monitorAllMembers,
    active: r.active,
    automationReady,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Texto republicado no grupo de destino. */
export function formatJobOfferWhatsappText(offer: {
  jobFunction: string;
  title: string;
  city: string;
  description: string;
}): string {
  const lines: string[] = [];
  const fn = offer.jobFunction.trim();
  const city = offer.city.trim();
  if (fn) {
    lines.push(city ? `💼 *${fn}* — ${city}` : `💼 *${fn}*`);
  } else if (city) {
    lines.push(`💼 ${city}`);
  } else {
    lines.push('💼 Oferta de trabalho');
  }
  const title = offer.title.trim();
  if (title) lines.push(title);
  const desc = offer.description.trim();
  if (desc) {
    if (lines.length) lines.push('');
    lines.push(desc);
  }
  return lines.join('\n').slice(0, 4000);
}

@Injectable()
export class JobOfferWhatsappService {
  private readonly logger = new Logger(JobOfferWhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly listingOpenAi: HouseListingOpenAiService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  private async getConfigRow() {
    return this.prisma.jobOfferWhatsappConfig.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID },
      update: {},
      select: {
        sourceGroupJid: true,
        sourceTitle: true,
        destGroupJid: true,
        destTitle: true,
        monitoredNumbers: true,
        monitorAllMembers: true,
        active: true,
        updatedAt: true,
      },
    });
  }

  async getConfig() {
    const row = await this.getConfigRow();
    return mapConfigRow(row);
  }

  async updateConfig(dto: UpdateJobOfferWhatsappConfigDto) {
    const data: Prisma.JobOfferWhatsappConfigUpdateInput = {};

    if (dto.sourceGroupJid !== undefined) {
      const jid = dto.sourceGroupJid?.trim() || null;
      data.sourceGroupJid = jid;
      if (!jid) data.sourceTitle = null;
    }
    if (dto.sourceTitle !== undefined) {
      data.sourceTitle = dto.sourceTitle?.trim() || null;
    }
    if (dto.destGroupJid !== undefined) {
      const jid = dto.destGroupJid?.trim() || null;
      data.destGroupJid = jid;
      if (!jid) data.destTitle = null;
    }
    if (dto.destTitle !== undefined) {
      data.destTitle = dto.destTitle?.trim() || null;
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
      if (dto.monitorAllMembers) {
        data.monitoredNumbers = [];
      }
    }
    if (typeof dto.active === 'boolean') {
      data.active = dto.active;
    }

    const current = await this.getConfigRow();
    const nextSource =
      dto.sourceGroupJid !== undefined
        ? dto.sourceGroupJid?.trim() || null
        : current.sourceGroupJid;
    const nextDest =
      dto.destGroupJid !== undefined
        ? dto.destGroupJid?.trim() || null
        : current.destGroupJid;
    if (
      nextSource &&
      nextDest &&
      nextSource === nextDest
    ) {
      throw new BadRequestException(
        'O grupo de origem e o de destino não podem ser o mesmo.',
      );
    }

    if (
      typeof dto.sourceGroupJid === 'string' &&
      dto.sourceGroupJid.trim() &&
      !dto.sourceTitle?.trim()
    ) {
      const subject = await this.whatsapp.getGroupSubject(
        dto.sourceGroupJid.trim(),
      );
      if (subject) data.sourceTitle = subject;
    }
    if (
      typeof dto.destGroupJid === 'string' &&
      dto.destGroupJid.trim() &&
      !dto.destTitle?.trim()
    ) {
      const subject = await this.whatsapp.getGroupSubject(
        dto.destGroupJid.trim(),
      );
      if (subject) data.destTitle = subject;
    }

    const row = await this.prisma.jobOfferWhatsappConfig.update({
      where: { id: CONFIG_ID },
      data,
      select: {
        sourceGroupJid: true,
        sourceTitle: true,
        destGroupJid: true,
        destTitle: true,
        monitoredNumbers: true,
        monitorAllMembers: true,
        active: true,
        updatedAt: true,
      },
    });
    return mapConfigRow(row);
  }

  async listEvolutionGroups() {
    const instance = this.whatsapp.getPrimaryInstanceName();
    const items = await this.whatsapp.fetchInstanceGroupTargets(instance);
    return { instance, items };
  }

  async listMessages(limit = 80) {
    const rows = await this.prisma.jobOfferWhatsappMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
      select: {
        id: true,
        senderNumber: true,
        rawText: true,
        status: true,
        createdJobOfferId: true,
        error: true,
        createdAt: true,
      },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
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

    const config = await this.getConfigRow();
    if (!config.active) return { ok: true, status: 'ignored_inactive' };
    const sourceJid = config.sourceGroupJid?.trim();
    if (!sourceJid || groupJid !== sourceJid) {
      return { ok: true, status: 'ignored_not_source_group' };
    }
    const destJid = config.destGroupJid?.trim();
    if (!destJid) return { ok: true, status: 'ignored_no_dest' };

    const kind = dto.kind ?? 'text';
    if ((kind === 'image' || kind === 'video') && !text) {
      return { ok: true, status: 'ignored_media_no_caption' };
    }
    if (!text) return { ok: true, status: 'ignored_empty' };

    const senderNumber =
      canonicalPhoneDigits(dto.senderNumber) || digitsOnly(dto.senderNumber);
    const externalMessageId = dto.externalMessageId?.trim() || null;

    if (!config.monitorAllMembers) {
      if (
        config.monitoredNumbers.length === 0 ||
        !phonesMatchMonitored(senderNumber, config.monitoredNumbers)
      ) {
        if (process.env.JOB_OFFER_WHATSAPP_LOG_SENDER === '1') {
          this.logger.warn(
            `ignored_sender sender=${senderNumber} monitored=${config.monitoredNumbers.join(',')}`,
          );
        }
        return { ok: true, status: 'ignored_sender' };
      }
    }

    const claim = await this.claimMessage({
      senderNumber,
      externalMessageId,
      rawText: text,
    });
    if (claim.duplicate) return { ok: true, status: 'ignored_duplicate' };
    const recordId = claim.id;

    if (!this.listingOpenAi.isConfigured()) {
      await this.updateRecord(recordId, {
        status: JobOfferWhatsappMessageStatus.error,
        error: 'OPENAI_API_KEY em falta',
      });
      return { ok: true, status: 'error_openai_config' };
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
      return { ok: true, status: 'error_openai' };
    }

    if (!parsed.isJobOffer || !parsed.offer) {
      await this.updateRecord(recordId, {
        status: JobOfferWhatsappMessageStatus.ignored_not_offer,
        parsedJson: parsed as unknown as Prisma.InputJsonValue,
      });
      return { ok: true, status: 'ignored_not_offer' };
    }

    const extracted = parsed.offer;
    const publishedAt = new Date(`${extracted.publishedAt}T12:00:00.000Z`);
    if (Number.isNaN(publishedAt.getTime())) {
      await this.updateRecord(recordId, {
        status: JobOfferWhatsappMessageStatus.error,
        parsedJson: parsed as unknown as Prisma.InputJsonValue,
        error: 'Data de publicação inválida',
      });
      return { ok: true, status: 'error_invalid_date' };
    }

    try {
      const offer = await this.prisma.jobOffer.create({
        data: {
          title: extracted.title.trim(),
          jobFunction: extracted.jobFunction.trim(),
          city: extracted.city.trim(),
          description: extracted.description.trim(),
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
          `Oferta ${offer.id} criada mas falha ao publicar no WhatsApp: ${msg}`,
        );
        await this.updateRecord(recordId, {
          status: JobOfferWhatsappMessageStatus.created,
          parsedJson: parsed as unknown as Prisma.InputJsonValue,
          createdJobOfferId: offer.id,
          error: `WhatsApp destino: ${msg.slice(0, 800)}`,
        });
        return { ok: true, status: 'created_whatsapp_failed' };
      }

      await this.updateRecord(recordId, {
        status: JobOfferWhatsappMessageStatus.created,
        parsedJson: parsed as unknown as Prisma.InputJsonValue,
        createdJobOfferId: offer.id,
      });
      return { ok: true, status: 'created' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.updateRecord(recordId, {
        status: JobOfferWhatsappMessageStatus.error,
        parsedJson: parsed as unknown as Prisma.InputJsonValue,
        error: msg.slice(0, 1000),
      });
      return { ok: true, status: 'error_create' };
    }
  }

  private async claimMessage(input: {
    senderNumber: string;
    externalMessageId: string | null;
    rawText: string;
  }): Promise<{ id: string; duplicate: boolean }> {
    const rawText = input.rawText.slice(0, 8000);
    if (input.externalMessageId) {
      try {
        const created = await this.prisma.jobOfferWhatsappMessage.create({
          data: {
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
        senderNumber: input.senderNumber,
        rawText,
        createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (recent) return { id: '', duplicate: true };

    const created = await this.prisma.jobOfferWhatsappMessage.create({
      data: {
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
