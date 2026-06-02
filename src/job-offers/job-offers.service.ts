import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HouseListingOpenAiService } from '../listing-ai/house-listing-openai.service';
import { CreateJobOfferDto } from './dto/create-job-offer.dto';
import { UpdateJobOfferDto } from './dto/update-job-offer.dto';
import {
  normalizeAdvertiserContacts,
  type JobOfferAdvertiserContact,
} from './job-offer-contacts.util';

function mapContactsJson(
  value: Prisma.JsonValue | null | undefined,
): JobOfferAdvertiserContact[] {
  return normalizeAdvertiserContacts(value);
}

function mapPublicRow(r: {
  id: string;
  title: string;
  jobFunction: string;
  city: string;
  company: string;
  summary: string;
  description: string;
  advertiserContacts: Prisma.JsonValue;
  publishedAt: Date;
}) {
  return {
    id: r.id,
    title: r.title,
    jobFunction: r.jobFunction,
    city: r.city,
    company: r.company,
    summary: r.summary,
    description: r.description,
    advertiserContacts: mapContactsJson(r.advertiserContacts),
    publishedAt: r.publishedAt.toISOString(),
  };
}

function mapAdminRow(r: {
  id: string;
  title: string;
  jobFunction: string;
  city: string;
  company: string;
  summary: string;
  description: string;
  advertiserContacts: Prisma.JsonValue;
  publishedAt: Date;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    title: r.title,
    jobFunction: r.jobFunction,
    city: r.city,
    company: r.company,
    summary: r.summary,
    description: r.description,
    advertiserContacts: mapContactsJson(r.advertiserContacts),
    publishedAt: r.publishedAt.toISOString(),
    active: r.active,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function buildCreateData(dto: CreateJobOfferDto) {
  const summary =
    (dto.summary ?? '').trim() ||
    dto.description.trim().replace(/\s+/g, ' ').slice(0, 500);
  const contacts = normalizeAdvertiserContacts(dto.advertiserContacts ?? []);
  return {
    title: dto.title.trim(),
    jobFunction: dto.jobFunction.trim(),
    city: dto.city.trim(),
    company: (dto.company ?? '').trim(),
    summary: summary.slice(0, 500),
    description: dto.description.trim(),
    advertiserContacts: contacts as unknown as Prisma.InputJsonValue,
  };
}

@Injectable()
export class JobOffersService {
  private readonly logger = new Logger(JobOffersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly listingOpenAi: HouseListingOpenAiService,
  ) {}

  async adminParseFromText(text: string) {
    if (!this.listingOpenAi.isConfigured()) {
      throw new BadRequestException(
        'A extração automática não está disponível (OPENAI_API_KEY em falta no servidor).',
      );
    }

    try {
      const parsed = await this.listingOpenAi.extractJobOfferFromText(text);
      if (!parsed.isJobOffer || parsed.offer == null) {
        throw new BadRequestException(
          'O texto não foi identificado como uma oferta de trabalho. Só podes publicar vagas (empresa ou recrutador a contratar). Conversas, imóveis, serviços ou candidatos à procura de emprego não entram na lista.',
        );
      }

      const extracted = parsed.offer;
      const publishedAt = new Date(`${extracted.publishedAt}T12:00:00.000Z`);
      if (Number.isNaN(publishedAt.getTime())) {
        throw new Error('Data de publicação inválida.');
      }
      return {
        title: extracted.title,
        jobFunction: extracted.jobFunction,
        city: extracted.city,
        company: extracted.company,
        summary: extracted.summary,
        description: extracted.description,
        advertiserContacts: extracted.advertiserContacts,
        publishedAt: publishedAt.toISOString(),
      };
    } catch (e: unknown) {
      if (e instanceof BadRequestException) {
        throw e;
      }
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`OpenAI (oferta de trabalho): ${msg}`);
      if (msg.includes('abort')) {
        throw new BadRequestException(
          'A análise demorou demasiado. Tenta novamente com um texto mais curto.',
        );
      }
      throw new BadRequestException(
        'Não foi possível analisar o texto. Verifica o conteúdo e tenta de novo.',
      );
    }
  }

  async listPublic() {
    const rows = await this.prisma.jobOffer.findMany({
      where: { active: true },
      orderBy: { publishedAt: 'desc' },
      select: {
        id: true,
        title: true,
        jobFunction: true,
        city: true,
        company: true,
        summary: true,
        description: true,
        advertiserContacts: true,
        publishedAt: true,
      },
    });
    return rows.map(mapPublicRow);
  }

  /** Detalhe público de uma oferta ativa (inclui mensagem WhatsApp original, se existir). */
  async getPublicById(id: string) {
    const row = await this.prisma.jobOffer.findFirst({
      where: { id, active: true },
      select: {
        id: true,
        title: true,
        jobFunction: true,
        city: true,
        company: true,
        summary: true,
        description: true,
        advertiserContacts: true,
        publishedAt: true,
      },
    });
    if (!row) {
      throw new NotFoundException('Oferta de trabalho não encontrada.');
    }

    const source = await this.prisma.jobOfferWhatsappMessage.findFirst({
      where: { createdJobOfferId: id },
      orderBy: { createdAt: 'desc' },
      select: { rawText: true },
    });
    const raw = source?.rawText?.trim() || '';
    const sourceMessage = raw || row.description.trim();

    return {
      ...mapPublicRow(row),
      sourceMessage,
    };
  }

  async adminList() {
    const rows = await this.prisma.jobOffer.findMany({
      orderBy: { publishedAt: 'desc' },
    });
    return rows.map(mapAdminRow);
  }

  async adminCreate(dto: CreateJobOfferDto) {
    const publishedAt = dto.publishedAt
      ? new Date(dto.publishedAt)
      : new Date();
    const row = await this.prisma.jobOffer.create({
      data: {
        ...buildCreateData(dto),
        publishedAt,
        active: dto.active ?? true,
      },
    });
    return mapAdminRow(row);
  }

  async adminUpdate(id: string, dto: UpdateJobOfferDto) {
    await this.ensureExists(id);
    const row = await this.prisma.jobOffer.update({
      where: { id },
      data: {
        ...(dto.title != null ? { title: dto.title.trim() } : {}),
        ...(dto.jobFunction != null
          ? { jobFunction: dto.jobFunction.trim() }
          : {}),
        ...(dto.city != null ? { city: dto.city.trim() } : {}),
        ...(dto.company != null ? { company: dto.company.trim() } : {}),
        ...(dto.summary != null
          ? { summary: dto.summary.trim().slice(0, 500) }
          : {}),
        ...(dto.description != null
          ? { description: dto.description.trim() }
          : {}),
        ...(dto.advertiserContacts != null
          ? {
              advertiserContacts:
                normalizeAdvertiserContacts(
                  dto.advertiserContacts,
                ) as unknown as Prisma.InputJsonValue,
            }
          : {}),
        ...(dto.publishedAt != null
          ? { publishedAt: new Date(dto.publishedAt) }
          : {}),
        ...(dto.active != null ? { active: dto.active } : {}),
      },
    });
    return mapAdminRow(row);
  }

  async adminDelete(id: string) {
    await this.ensureExists(id);
    await this.prisma.jobOffer.delete({ where: { id } });
    return { ok: true as const };
  }

  private async ensureExists(id: string) {
    const row = await this.prisma.jobOffer.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Oferta de trabalho não encontrada.');
    }
  }
}
