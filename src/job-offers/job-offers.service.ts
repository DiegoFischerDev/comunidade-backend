import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HouseListingOpenAiService } from '../listing-ai/house-listing-openai.service';
import { CreateJobOfferDto } from './dto/create-job-offer.dto';
import { UpdateJobOfferDto } from './dto/update-job-offer.dto';

function mapPublicRow(r: {
  id: string;
  title: string;
  jobFunction: string;
  city: string;
  description: string;
  publishedAt: Date;
}) {
  return {
    id: r.id,
    title: r.title,
    jobFunction: r.jobFunction,
    city: r.city,
    description: r.description,
    publishedAt: r.publishedAt.toISOString(),
  };
}

function mapAdminRow(r: {
  id: string;
  title: string;
  jobFunction: string;
  city: string;
  description: string;
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
    description: r.description,
    publishedAt: r.publishedAt.toISOString(),
    active: r.active,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
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
        description: extracted.description,
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
        description: true,
        publishedAt: true,
      },
    });
    return rows.map(mapPublicRow);
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
        title: dto.title.trim(),
        jobFunction: dto.jobFunction.trim(),
        city: dto.city.trim(),
        description: dto.description.trim(),
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
        ...(dto.description != null
          ? { description: dto.description.trim() }
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
