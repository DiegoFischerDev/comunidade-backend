import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRecommendedServiceDto } from './dto/create-recommended-service.dto';
import { UpdateRecommendedServiceDto } from './dto/update-recommended-service.dto';

@Injectable()
export class RecommendedServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublic() {
    const rows = await this.prisma.recommendedService.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        partnerShareLink: {
          select: { slug: true, title: true, whatsappPhrase: true },
        },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.partnerShareLink.slug,
      linkTitle: r.partnerShareLink.title,
      whatsappPhrase: r.partnerShareLink.whatsappPhrase,
      redirectPath: `/link?t=${encodeURIComponent(r.partnerShareLink.slug)}`,
    }));
  }

  async adminList() {
    const rows = await this.prisma.recommendedService.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        partnerShareLink: {
          select: {
            id: true,
            slug: true,
            title: true,
            whatsappDigits: true,
          },
        },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      sortOrder: r.sortOrder,
      active: r.active,
      createdAt: r.createdAt.toISOString(),
      partnerShareLink: r.partnerShareLink,
      redirectPath: `/link?t=${encodeURIComponent(r.partnerShareLink.slug)}`,
    }));
  }

  async adminAvailableLinks() {
    const links = await this.prisma.partnerShareLink.findMany({
      orderBy: { title: 'asc' },
      select: {
        id: true,
        slug: true,
        title: true,
        whatsappDigits: true,
        createdAt: true,
        recommendedServices: { select: { id: true } },
      },
    });

    return links.map((l) => ({
      id: l.id,
      slug: l.slug,
      title: l.title,
      whatsappDigits: l.whatsappDigits,
      createdAt: l.createdAt.toISOString(),
      alreadyUsed: l.recommendedServices.length > 0,
    }));
  }

  async adminCreate(dto: CreateRecommendedServiceDto) {
    const link = await this.prisma.partnerShareLink.findUnique({
      where: { id: dto.partnerShareLinkId },
    });
    if (!link) {
      throw new NotFoundException('Link de redirecionamento não encontrado.');
    }

    const existing = await this.prisma.recommendedService.findUnique({
      where: { partnerShareLinkId: dto.partnerShareLinkId },
    });
    if (existing) {
      throw new ConflictException(
        'Este link já está na lista de serviços indicados.',
      );
    }

    const maxOrder = await this.prisma.recommendedService.aggregate({
      _max: { sortOrder: true },
    });
    const sortOrder =
      dto.sortOrder ?? (maxOrder._max.sortOrder ?? -1) + 1;

    return this.prisma.recommendedService.create({
      data: {
        title: dto.title.trim(),
        partnerShareLinkId: dto.partnerShareLinkId,
        sortOrder,
        active: dto.active ?? true,
      },
      include: {
        partnerShareLink: {
          select: { id: true, slug: true, title: true, whatsappDigits: true },
        },
      },
    });
  }

  async adminUpdate(id: string, dto: UpdateRecommendedServiceDto) {
    const row = await this.prisma.recommendedService.findUnique({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException('Serviço indicado não encontrado.');
    }

    if (
      dto.partnerShareLinkId &&
      dto.partnerShareLinkId !== row.partnerShareLinkId
    ) {
      const link = await this.prisma.partnerShareLink.findUnique({
        where: { id: dto.partnerShareLinkId },
      });
      if (!link) {
        throw new NotFoundException('Link de redirecionamento não encontrado.');
      }
      const clash = await this.prisma.recommendedService.findUnique({
        where: { partnerShareLinkId: dto.partnerShareLinkId },
      });
      if (clash && clash.id !== id) {
        throw new ConflictException(
          'Este link já está na lista de serviços indicados.',
        );
      }
    }

    return this.prisma.recommendedService.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.partnerShareLinkId !== undefined
          ? { partnerShareLinkId: dto.partnerShareLinkId }
          : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
      include: {
        partnerShareLink: {
          select: { id: true, slug: true, title: true, whatsappDigits: true },
        },
      },
    });
  }

  async adminDelete(id: string): Promise<{ ok: true }> {
    const row = await this.prisma.recommendedService.findUnique({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException('Serviço indicado não encontrado.');
    }
    await this.prisma.recommendedService.delete({ where: { id } });
    return { ok: true };
  }
}
