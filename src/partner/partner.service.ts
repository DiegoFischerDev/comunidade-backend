import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { UpdatePartnerProfileDto } from './dto/update-partner-profile.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { UpdateServiceAdminDto } from './dto/update-service-admin.dto';
import { UpdatePartnerAdminDto } from './dto/update-partner-admin.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { Role } from '@prisma/client';
import { unlink } from 'fs/promises';
import { join } from 'path';

const SALT_ROUNDS = 10;

@Injectable()
export class PartnerService {
  constructor(private readonly prisma: PrismaService) {}

  private async deleteUploadFileIfLocal(url?: string | null) {
    if (!url) return;

    let pathname = url;
    if (pathname.startsWith('http://') || pathname.startsWith('https://')) {
      try {
        pathname = new URL(pathname).pathname;
      } catch {
        return;
      }
    }

    if (!pathname.startsWith('/uploads/')) {
      return;
    }

    const filename = pathname.replace('/uploads/', '');
    if (!filename) return;

    const filePath = join(process.cwd(), 'uploads', filename);

    try {
      await unlink(filePath);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        // Intencionalmente ignoramos outros erros de deleção para não quebrar o fluxo de negócio
      }
    }
  }

  private normalizeWhatsapp(value: string): string {
    return value.replace(/\s+/g, '');
  }

  listPartners() {
    return this.prisma.partner.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  }

  async createPartner(dto: CreatePartnerDto) {
    const normalizedEmail = dto.email.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      throw new ConflictException('Já existe um usuário com este e-mail.');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    try {
      const user = await this.prisma.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          role: Role.PARTNER,
          name: dto.name,
          whatsapp: this.normalizeWhatsapp(dto.whatsapp),
        },
      });

      const partner = await this.prisma.partner.create({
        data: {
          userId: user.id,
          name: dto.name,
          whatsapp: this.normalizeWhatsapp(dto.whatsapp),
          logoUrl: dto.logoUrl,
          shortDescription: dto.shortDescription,
          fullDescription: dto.fullDescription,
          backgroundImageUrl: dto.backgroundImageUrl,
          rpmCommissionPercent: dto.rpmCommissionPercent,
        },
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        partner,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        'Erro ao criar parceiro. Tente novamente mais tarde.',
      );
    }
  }

  async deletePartner(id: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { id },
    });

    if (!partner) {
      throw new NotFoundException('Parceiro não encontrado.');
    }

    // Ao remover o usuário, o registro de Partner é removido em cascata
    await this.prisma.user.delete({
      where: { id: partner.userId },
    });
  }

  async updatePartnerAdmin(id: string, dto: UpdatePartnerAdminDto) {
    const partner = await this.prisma.partner.findUnique({
      where: { id },
    });

    if (!partner) {
      throw new NotFoundException('Parceiro não encontrado.');
    }

    return this.prisma.partner.update({
      where: { id },
      data: {
        categoryId: dto.categoryId ?? partner.categoryId,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  }

  listCategories() {
    return this.prisma.productCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async listCategoriesWithPartners() {
    const categories = await this.prisma.productCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        partners: {
          where: {
            categoryId: { not: null },
          },
          select: {
            id: true,
            name: true,
            backgroundImageUrl: true,
            shortDescription: true,
          },
        },
      },
    });

    return categories.filter((category) => category.partners.length > 0);
  }

  async getPartnerPublic(id: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            email: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        services: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            title: true,
            description: true,
            price: true,
            priceOnRequest: true,
            commission: true,
          },
        },
      },
    });

    if (!partner) {
      throw new NotFoundException('Parceiro não encontrado.');
    }

    return partner;
  }

  async createCategory(dto: CreateCategoryDto) {
    try {
      return await this.prisma.productCategory.create({
        data: {
          slug: dto.slug,
          name: dto.name,
          description: dto.description,
          backgroundImageUrl: dto.backgroundImageUrl,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException('Já existe uma categoria com este slug.');
      }
      throw new InternalServerErrorException(
        'Erro ao criar categoria. Tente novamente mais tarde.',
      );
    }
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    const existing = await this.prisma.productCategory.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Categoria não encontrada.');
    }

    let oldBackgroundToDelete: string | null = null;
    if (
      dto.backgroundImageUrl &&
      dto.backgroundImageUrl !== existing.backgroundImageUrl
    ) {
      oldBackgroundToDelete = existing.backgroundImageUrl;
    }

    try {
      const updated = await this.prisma.productCategory.update({
        where: { id },
        data: {
          slug: dto.slug ?? existing.slug,
          name: dto.name ?? existing.name,
          description: dto.description ?? existing.description,
          backgroundImageUrl:
            dto.backgroundImageUrl ?? existing.backgroundImageUrl,
          sortOrder: dto.sortOrder ?? existing.sortOrder,
        },
      });

      if (oldBackgroundToDelete) {
        await this.deleteUploadFileIfLocal(oldBackgroundToDelete);
      }

      return updated;
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException('Já existe uma categoria com este slug.');
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar categoria. Tente novamente mais tarde.',
      );
    }
  }

  async deleteCategory(id: string) {
    try {
      await this.prisma.productCategory.delete({
        where: { id },
      });
      return { success: true };
    } catch (error: any) {
      if (error.code === 'P2003') {
        throw new BadRequestException(
          'Não é possível remover a categoria porque existem parceiros ou serviços associados.',
        );
      }
      throw new InternalServerErrorException(
        'Erro ao remover categoria. Tente novamente mais tarde.',
      );
    }
  }

  async getCurrentPartner(userId: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { userId },
    });

    if (!partner) {
      throw new NotFoundException('Parceiro não encontrado para este usuário.');
    }

    return partner;
  }

  async updateCurrentPartner(userId: string, dto: UpdatePartnerProfileDto) {
    const partner = await this.prisma.partner.findUnique({
      where: { userId },
    });

    if (!partner) {
      throw new NotFoundException('Parceiro não encontrado para este usuário.');
    }
    let oldLogoToDelete: string | null = null;
    let oldBackgroundToDelete: string | null = null;
    const oldCatalogImages = partner.catalogImageUrls ?? [];

    if (dto.logoUrl && dto.logoUrl !== partner.logoUrl) {
      oldLogoToDelete = partner.logoUrl;
    }

    if (
      dto.backgroundImageUrl &&
      dto.backgroundImageUrl !== partner.backgroundImageUrl
    ) {
      oldBackgroundToDelete = partner.backgroundImageUrl;
    }

    const newCatalogImages =
      dto.catalogImageUrls?.filter((url) => !!url && url.trim() !== '') ?? oldCatalogImages;
    if (newCatalogImages.length > 5) {
      throw new BadRequestException(
        'O parceiro pode ter no máximo 5 imagens de catálogo.',
      );
    }

    // Se o parceiro alterar o WhatsApp no perfil, sincronizamos tanto no Partner
    // quanto no User associado.
    const whatsappToSet =
      dto.whatsapp !== undefined && dto.whatsapp !== null
        ? this.normalizeWhatsapp(dto.whatsapp)
        : undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (whatsappToSet !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { whatsapp: whatsappToSet },
        });
      }

      return tx.partner.update({
        where: { id: partner.id },
        data: {
          logoUrl: dto.logoUrl ?? partner.logoUrl,
          shortDescription: dto.shortDescription ?? partner.shortDescription,
          fullDescription: dto.fullDescription ?? partner.fullDescription,
          backgroundImageUrl:
            dto.backgroundImageUrl ?? partner.backgroundImageUrl,
          catalogImageUrls: newCatalogImages,
          instagram:
            dto.instagram !== undefined ? dto.instagram : partner.instagram,
          ...(whatsappToSet !== undefined && { whatsapp: whatsappToSet }),
        },
      });
    });

    if (oldLogoToDelete) {
      await this.deleteUploadFileIfLocal(oldLogoToDelete);
    }

    if (oldBackgroundToDelete) {
      await this.deleteUploadFileIfLocal(oldBackgroundToDelete);
    }

    // remove do servidor quaisquer imagens que deixaram de ser usadas
    const toDelete = oldCatalogImages.filter(
      (oldUrl) => !!oldUrl && !newCatalogImages.includes(oldUrl),
    );
    for (const url of toDelete) {
      await this.deleteUploadFileIfLocal(url);
    }

    return updated;
  }

  private async getPartnerForUserOrThrow(userId: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { userId },
    });

    if (!partner) {
      throw new NotFoundException('Parceiro não encontrado para este usuário.');
    }

    return partner;
  }

  async listMyServices(userId: string) {
    const partner = await this.getPartnerForUserOrThrow(userId);

    return this.prisma.service.findMany({
      where: { partnerId: partner.id },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        title: true,
        description: true,
        price: true,
        priceOnRequest: true,
        commission: true,
        createdAt: true,
      },
    });
  }

  async createMyService(userId: string, dto: CreateServiceDto) {
    const partner = await this.getPartnerForUserOrThrow(userId);

    if (!dto.description?.trim()) {
      throw new BadRequestException('A descrição é obrigatória.');
    }
    const priceOnRequest = dto.priceOnRequest ?? false;
    if (!priceOnRequest && (!dto.price || dto.price.trim() === '')) {
      throw new BadRequestException(
        'Valor é obrigatório quando o serviço não é "sob consulta".',
      );
    }

    return this.prisma.service.create({
      data: {
        partnerId: partner.id,
        title: dto.title,
        description: dto.description?.trim() ?? '',
        price: priceOnRequest ? null : (dto.price?.trim() || null),
        priceOnRequest,
      },
    });
  }

  async updateMyService(userId: string, id: string, dto: UpdateServiceDto) {
    const partner = await this.getPartnerForUserOrThrow(userId);

    const service = await this.prisma.service.findFirst({
      where: { id, partnerId: partner.id },
    });

    if (!service) {
      throw new NotFoundException('Serviço não encontrado.');
    }

    if (dto.description !== undefined && !dto.description.trim()) {
      throw new BadRequestException('A descrição é obrigatória.');
    }
    const priceOnRequest = dto.priceOnRequest ?? service.priceOnRequest;
    const title = dto.title ?? service.title;
    const description = dto.description !== undefined ? dto.description : service.description;
    const price =
      dto.price !== undefined
        ? (priceOnRequest ? null : dto.price || null)
        : (priceOnRequest ? null : service.price);

    if (!priceOnRequest && (!price || price.trim() === '')) {
      throw new BadRequestException(
        'Valor é obrigatório quando o serviço não é "sob consulta".',
      );
    }

    return this.prisma.service.update({
      where: { id: service.id },
      data: {
        title,
        description: description ?? service.description,
        price: price?.trim() || null,
        priceOnRequest,
      },
    });
  }

  async deleteMyService(userId: string, id: string) {
    const partner = await this.getPartnerForUserOrThrow(userId);

    const service = await this.prisma.service.findFirst({
      where: { id, partnerId: partner.id },
    });

    if (!service) {
      throw new NotFoundException('Serviço não encontrado.');
    }

    await this.prisma.service.delete({
      where: { id: service.id },
    });

    return { success: true };
  }

  async createLeadForPartner(
    partnerId: string,
    userId: string,
    _dto: CreateLeadDto,
  ) {
    const partner = await this.prisma.partner.findUnique({
      where: { id: partnerId },
    });

    if (!partner) {
      throw new NotFoundException('Parceiro não encontrado.');
    }

    // Garante apenas um lead por (parceiro, usuário)
    return this.prisma.lead.upsert({
      where: {
        lead_partner_user_unique: {
          partnerId: partner.id,
          userId,
        },
      },
      update: {},
      create: {
        partnerId: partner.id,
        userId,
      },
    });
  }

  async listMyLeads(userId: string) {
    const partner = await this.getPartnerForUserOrThrow(userId);

    return this.prisma.lead.findMany({
      where: { partnerId: partner.id },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            name: true,
            email: true,
            whatsapp: true,
          },
        },
      },
    });
  }

  async listAllServicesAdmin() {
    return this.prisma.service.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        partner: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  async updateServiceAdmin(id: string, dto: UpdateServiceAdminDto) {
    const service = await this.prisma.service.findUnique({
      where: { id },
    });

    if (!service) {
      throw new NotFoundException('Serviço não encontrado.');
    }

    return this.prisma.service.update({
      where: { id },
      data: {
        commission:
          dto.commission !== undefined ? dto.commission : service.commission,
      },
    });
  }
}

