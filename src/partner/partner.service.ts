import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { UpdatePartnerProfileDto } from './dto/update-partner-profile.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { UpdatePartnerAdminDto } from './dto/update-partner-admin.dto';
import { CreatePartnerSaleDto } from './dto/create-partner-sale.dto';
import {
  PartnerHouse,
  PartnerHousePublicationStatus,
  PartnerHouseTypology,
  PartnerReactionType,
  PartnerSaleCommissionPaymentStatus,
  Prisma,
  Role,
} from '@prisma/client';
type HouseBusinessType = 'RENT' | 'SALE';

import { JwtService } from '@nestjs/jwt';
import { StripeService } from '../stripe/stripe.service';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { CreatePartnerHouseDto } from './dto/create-partner-house.dto';
import { UpdatePartnerHouseDto } from './dto/update-partner-house.dto';
import { AdminUpdatePartnerHouseDto } from './dto/admin-update-partner-house.dto';
import { AdminCreatePartnerHouseDto } from './dto/admin-create-partner-house.dto';
import {
  expandRelocationCityFilter,
  normalizeRelocationCityForAdminStorage,
} from './relocation-cities';
import { requirePartnerDeviceId, tryPartnerDeviceId } from './partner-device-id';
import { HouseImageStorageService } from './house-image-storage.service';
import { getFrontendBaseUrl } from '../config/frontend-base-url';
import {
  toAbsoluteMediaUrl,
  videoMimeForEvolutionSend,
} from '../common/public-media-url';
import { CreateHouseRelocationWhatsappGroupDto } from './dto/create-house-relocation-whatsapp-group.dto';
import { UpdateHouseRelocationWhatsappGroupDto } from './dto/update-house-relocation-whatsapp-group.dto';
import { PartnerAdvertisingService } from './partner-advertising.service';
import {
  isHousePubliclyVisible,
  nextPublishedUntil,
} from './house-publication.constants';
import {
  assertPartnerPublicSlugAllowed,
  normalizePartnerPublicSlugInput,
} from './partner-public-slug';
import { PartnerContactLinksService } from './partner-contact-links.service';
import {
  isPartnerCategorySlug,
  RELOCATION_CATEGORY_SLUG,
} from './partner-categories';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const SALT_ROUNDS = 10;

@Injectable()
export class PartnerService {
  private readonly logger = new Logger(PartnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly wa: WhatsAppService,
    private readonly houseImages: HouseImageStorageService,
    private readonly jwtService: JwtService,
    private readonly advertising: PartnerAdvertisingService,
    private readonly partnerContactLinks: PartnerContactLinksService,
  ) {}

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
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }] as any,
      select: {
        id: true,
        name: true,
        whatsapp: true,
        logoUrl: true,
        priority: true,
        createdAt: true,
        advertisingBalanceEurCents: true,
        publicSlug: true,
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
        categorySlug: true,
        heroShareLink: {
          select: {
            id: true,
            slug: true,
            _count: { select: { clicks: true } },
          },
        },
        services: {
          select: { id: true, partnerShareLinkId: true },
        },
      },
    });
  }

  setupPartnerContactLinks(partnerId: string) {
    return this.partnerContactLinks.setupPartnerContactLinks(partnerId);
  }

  getPartnerContactLinksAdmin(partnerId: string) {
    return this.partnerContactLinks.getPartnerContactLinksAdmin(partnerId);
  }

  async getMyContactLinks(userId: string) {
    const partner = await this.getPartnerForUserOrThrow(userId);
    return this.partnerContactLinks.getPartnerContactLinksAdmin(partner.id);
  }

  async createPartner(dto: CreatePartnerDto) {
    const normalizedWhatsapp = this.normalizeWhatsapp(dto.whatsapp);
    const emailTrim = dto.email?.trim();
    const emailNormalized = emailTrim ? emailTrim.toLowerCase() : null;

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    try {
      const user = await this.prisma.user.create({
        data: {
          email: emailNormalized,
          passwordHash,
          role: Role.PARTNER,
          name: dto.name,
          whatsapp: normalizedWhatsapp,
        },
      });

      const partner = await this.prisma.partner.create({
        data: {
          userId: user.id,
          name: dto.name,
          whatsapp: normalizedWhatsapp,
          logoUrl: dto.logoUrl,
          shortDescription: dto.shortDescription,
          fullDescription: dto.fullDescription,
          backgroundImageUrl: dto.backgroundImageUrl,
          rpmCommissionPercent: dto.rpmCommissionPercent,
          publicSlug: null,
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
    } catch (error: any) {
      // WhatsApp e e-mail são únicos em User.
      if (error?.code === 'P2002') {
        throw new ConflictException(
          'Já existe um utilizador com este WhatsApp ou com este e-mail.',
        );
      }
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

    // Valida o slug recebido (apenas os slugs constantes são aceites; `null` limpa).
    let nextCategorySlug: string | null | undefined = undefined;
    if (Object.prototype.hasOwnProperty.call(dto, 'categorySlug')) {
      if (dto.categorySlug === null || dto.categorySlug === undefined || dto.categorySlug === '') {
        nextCategorySlug = null;
      } else if (isPartnerCategorySlug(dto.categorySlug)) {
        nextCategorySlug = dto.categorySlug;
      } else {
        throw new BadRequestException('Categoria inválida.');
      }
    }

    return this.prisma.partner.update({
      where: { id },
      data: {
        ...(nextCategorySlug !== undefined ? { categorySlug: nextCategorySlug } : {}),
        priority:
          Object.prototype.hasOwnProperty.call(dto, 'priority') && typeof dto.priority === 'number'
            ? dto.priority
            : (partner as any).priority ?? 0,
      } as any,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
    });
  }

  async adminListRelocationHouseCities(): Promise<{ cities: string[] }> {
    const rows = await this.prisma.partnerHouse.findMany({
      where: { partner: { categorySlug: RELOCATION_CATEGORY_SLUG } },
      select: { city: true },
      distinct: ['city'] as any,
    });

    const cities = (rows ?? [])
      .map((r) => (r.city ?? '').trim())
      .filter((c): c is string => Boolean(c))
      .sort((a, b) => a.localeCompare(b, 'pt-PT'));

    return { cities };
  }

  private async getEngagementSummariesForPartnerIds(
    partnerIds: string[],
  ): Promise<
    Map<
      string,
      {
        likeCount: number;
        dislikeCount: number;
        commentCount: number;
        shareCount: number;
      }
    >
  > {
    const map = new Map<
      string,
      {
        likeCount: number;
        dislikeCount: number;
        commentCount: number;
        shareCount: number;
      }
    >();
    for (const id of partnerIds) {
      map.set(id, { likeCount: 0, dislikeCount: 0, commentCount: 0, shareCount: 0 });
    }
    if (partnerIds.length === 0) {
      return map;
    }
    const [reactionGroups, commentGroups, partners] = await Promise.all([
      this.prisma.partnerReaction.groupBy({
        by: ['partnerId', 'type'],
        where: { partnerId: { in: partnerIds } },
        _count: { _all: true },
      }),
      this.prisma.partnerComment.groupBy({
        by: ['partnerId'],
        where: { partnerId: { in: partnerIds } },
        _count: { _all: true },
      }),
      this.prisma.partner.findMany({
        where: { id: { in: partnerIds } },
        select: { id: true, shareCount: true },
      }),
    ]);
    for (const p of partners) {
      const e = map.get(p.id);
      if (e) e.shareCount = p.shareCount;
    }
    for (const c of commentGroups) {
      const e = map.get(c.partnerId);
      if (e) e.commentCount = c._count._all;
    }
    for (const r of reactionGroups) {
      const e = map.get(r.partnerId);
      if (!e) continue;
      if (r.type === 'LIKE') e.likeCount = r._count._all;
      if (r.type === 'DISLIKE') e.dislikeCount = r._count._all;
    }
    return map;
  }

  getOptionalUserIdFromAuthHeader(authorization?: string): string | null {
    if (!authorization?.trim().toLowerCase().startsWith('bearer ')) {
      return null;
    }
    const token = authorization.slice(7).trim();
    if (!token) return null;
    try {
      const payload = this.jwtService.verify<{ sub: string }>(token);
      return typeof payload?.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  async getOptionalAuthUser(
    authorization?: string,
  ): Promise<{ id: string; role: Role } | null> {
    const id = this.getOptionalUserIdFromAuthHeader(authorization);
    if (!id) return null;
    const u = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });
    return u ?? null;
  }

  async getPartnerEngagement(
    partnerId: string,
    userId: string | null,
    deviceHeader?: string,
  ) {
    const p = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      select: { id: true, shareCount: true },
    });
    if (!p) {
      throw new NotFoundException('Parceiro não encontrado.');
    }
    const deviceId = tryPartnerDeviceId(deviceHeader);
    const [likeCount, dislikeCount, commentCount, myReaction, hasDeviceComment] =
      await Promise.all([
        this.prisma.partnerReaction.count({ where: { partnerId, type: 'LIKE' } }),
        this.prisma.partnerReaction.count({ where: { partnerId, type: 'DISLIKE' } }),
        this.prisma.partnerComment.count({ where: { partnerId } }),
        userId
          ? this.prisma.partnerReaction.findFirst({
              where: { userId, partnerId },
              select: { type: true },
            })
          : deviceId
            ? this.prisma.partnerReaction.findFirst({
                where: { deviceId, partnerId },
                select: { type: true },
              })
            : Promise.resolve(null),
        deviceId
          ? this.prisma.partnerComment.count({
              where: { partnerId, deviceId },
            })
          : Promise.resolve(0),
      ]);
    return {
      likeCount,
      dislikeCount,
      commentCount,
      shareCount: p.shareCount,
      myReaction: myReaction?.type ?? null,
      hasDeviceComment: hasDeviceComment > 0,
    };
  }

  async setPartnerReaction(
    partnerId: string,
    authUserId: string | null,
    deviceHeader: string | undefined,
    type: PartnerReactionType | null,
  ) {
    await this.prisma.partner.findUniqueOrThrow({
      where: { id: partnerId },
      select: { id: true },
    });

    if (authUserId) {
      const existing = await this.prisma.partnerReaction.findFirst({
        where: { userId: authUserId, partnerId },
        select: { id: true },
      });
      if (type === null) {
        if (existing) {
          await this.prisma.partnerReaction.delete({ where: { id: existing.id } });
        }
        return { myReaction: null as PartnerReactionType | null };
      }
      if (existing) {
        await this.prisma.partnerReaction.update({
          where: { id: existing.id },
          data: { type },
        });
      } else {
        await this.prisma.partnerReaction.create({
          data: { userId: authUserId, partnerId, type },
        });
      }
      return { myReaction: type };
    }

    const deviceId = requirePartnerDeviceId(deviceHeader);
    const existing = await this.prisma.partnerReaction.findFirst({
      where: { deviceId, partnerId },
      select: { id: true, type: true },
    });
    if (!existing) {
      if (!type) {
        return { myReaction: null as PartnerReactionType | null };
      }
      await this.prisma.partnerReaction.create({
        data: { deviceId, partnerId, type },
      });
      return { myReaction: type };
    }
    if (!type || type !== existing.type) {
      throw new ConflictException(
        'Este dispositivo já registou a sua avaliação (gosto ou desgosto).',
      );
    }
    return { myReaction: existing.type };
  }

  async listPartnerComments(partnerId: string, take: number, deviceHeader?: string) {
    const exists = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Parceiro não encontrado.');
    }
    const takeN = Math.min(Math.max(take, 1), 2000);
    const requestDeviceId = tryPartnerDeviceId(deviceHeader);
    const total = await this.prisma.partnerComment.count({ where: { partnerId } });
    const rows = await this.prisma.partnerComment.findMany({
      where: { partnerId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: takeN,
      include: { user: { select: { id: true, name: true } } },
    });
    return {
      items: rows.map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
        parentId: c.parentId,
        user: c.user,
        guestName: c.guestName,
        ownedByRequestDevice:
          !!requestDeviceId && !!c.deviceId && c.deviceId === requestDeviceId,
      })),
      hasMore: total > takeN,
      total,
    };
  }

  async createPartnerComment(
    partnerId: string,
    authUserId: string | null,
    body: string,
    parentId: string | undefined,
    guestNameRaw: string | undefined,
    deviceHeader: string | undefined,
  ) {
    const exists = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Parceiro não encontrado.');
    }
    const text = body.trim();
    if (!text) {
      throw new BadRequestException('O comentário não pode ser vazio.');
    }

    if (authUserId) {
      let parent: { id: string; partnerId: string } | null = null;
      if (parentId?.trim()) {
        parent = await this.prisma.partnerComment.findUnique({
          where: { id: parentId.trim() },
          select: { id: true, partnerId: true },
        });
        if (!parent) {
          throw new BadRequestException('Comentário a que responde não foi encontrado.');
        }
        if (parent.partnerId !== partnerId) {
          throw new BadRequestException('Não podes responder a um comentário de outro parceiro.');
        }
      }
      const c = await this.prisma.partnerComment.create({
        data: {
          partnerId,
          userId: authUserId,
          body: text,
          parentId: parent?.id ?? null,
        },
        include: { user: { select: { id: true, name: true } } },
      });
      return {
        id: c.id,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
        parentId: c.parentId,
        user: c.user,
        guestName: null as string | null,
        ownedByRequestDevice: false as boolean,
      };
    }

    if (parentId?.trim()) {
      throw new BadRequestException(
        'Inicia sessão na Comunidade para responderes a comentários.',
      );
    }
    const deviceId = requirePartnerDeviceId(deviceHeader);
    const dup = await this.prisma.partnerComment.findFirst({
      where: { partnerId, deviceId },
      select: { id: true },
    });
    if (dup) {
      throw new ConflictException(
        'Este dispositivo já publicou um comentário neste perfil.',
      );
    }
    const guestTrim = guestNameRaw?.trim() ?? '';
    const guestName = guestTrim.length > 0 ? guestTrim.slice(0, 120) : null;
    const c = await this.prisma.partnerComment.create({
      data: {
        partnerId,
        deviceId,
        guestName,
        body: text,
        parentId: null,
      },
      include: { user: { select: { id: true, name: true } } },
    });
    return {
      id: c.id,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
      parentId: c.parentId,
      user: c.user,
      guestName: c.guestName,
      ownedByRequestDevice: true,
    };
  }

  async deletePartnerComment(
    partnerId: string,
    commentId: string,
    authUser: { id: string; role: Role } | null,
    deviceHeader: string | undefined,
  ) {
    const c = await this.prisma.partnerComment.findUnique({
      where: { id: commentId },
      select: { id: true, partnerId: true, userId: true, deviceId: true },
    });
    if (!c) {
      throw new NotFoundException('Comentário não encontrado.');
    }
    if (c.partnerId !== partnerId) {
      throw new BadRequestException('Comentário não pertence a este parceiro.');
    }
    if (authUser?.role === Role.ADMIN) {
      await this.prisma.partnerComment.delete({ where: { id: commentId } });
      return { ok: true as const, partnerId: c.partnerId };
    }
    if (c.userId && authUser && c.userId === authUser.id) {
      await this.prisma.partnerComment.delete({ where: { id: commentId } });
      return { ok: true as const, partnerId: c.partnerId };
    }
    const deviceId = tryPartnerDeviceId(deviceHeader);
    if (c.deviceId && deviceId && c.deviceId === deviceId) {
      await this.prisma.partnerComment.delete({ where: { id: commentId } });
      return { ok: true as const, partnerId: c.partnerId };
    }
    throw new ForbiddenException('Não tens permissão para eliminar este comentário.');
  }

  async recordPartnerShare(partnerId: string) {
    try {
      const p = await this.prisma.partner.update({
        where: { id: partnerId },
        data: { shareCount: { increment: 1 } },
        select: { shareCount: true },
      });
      return { shareCount: p.shareCount };
    } catch (e) {
      if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2025') {
        throw new NotFoundException('Parceiro não encontrado.');
      }
      throw e;
    }
  }

  async getPartnerPublic(lookup: string) {
    const key = lookup.trim();
    if (!key) {
      throw new NotFoundException('Parceiro não encontrado.');
    }
    const lower = key.toLowerCase();
    const partner = await this.prisma.partner.findFirst({
      where: {
        publicSlug: { not: null },
        OR: [{ id: key }, { publicSlug: lower }],
      },
      include: {
        user: {
          select: {
            email: true,
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
            partnerShareLink: { select: { slug: true } },
          },
        },
        heroShareLink: { select: { slug: true } },
      },
    });

    if (!partner) {
      throw new NotFoundException('Parceiro não encontrado.');
    }

    const contact = this.partnerContactLinks.mapPublicContactFields(partner);
    const { heroShareLink: _h, services: _s, ...rest } = partner;
    return {
      ...rest,
      ...contact,
    };
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
    let oldCatalogVideoToDelete: string | null = null;
    const oldCatalogImages = partner.catalogImageUrls ?? [];

    const nextCatalogVideoUrl =
      dto.catalogVideoUrl !== undefined
        ? dto.catalogVideoUrl.trim() || null
        : partner.catalogVideoUrl;
    if (
      dto.catalogVideoUrl !== undefined &&
      partner.catalogVideoUrl &&
      partner.catalogVideoUrl !== nextCatalogVideoUrl
    ) {
      oldCatalogVideoToDelete = partner.catalogVideoUrl;
    }

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

    const nameToSet =
      dto.name !== undefined && dto.name !== null
        ? dto.name.trim()
        : undefined;
    if (nameToSet !== undefined && !nameToSet) {
      throw new BadRequestException('O nome da empresa não pode ser vazio.');
    }

    let publicSlugToSet: string | null | undefined = undefined;
    if (Object.prototype.hasOwnProperty.call(dto, 'publicSlug')) {
      const raw =
        dto.publicSlug === null || dto.publicSlug === undefined
          ? ''
          : String(dto.publicSlug).trim();
      if (!raw) {
        publicSlugToSet = null;
      } else {
        const normalized = normalizePartnerPublicSlugInput(raw);
        assertPartnerPublicSlugAllowed(normalized);
        const current = partner.publicSlug ?? null;
        if (normalized === current) {
          publicSlugToSet = undefined;
        } else {
          const taken = await this.prisma.partner.findFirst({
            where: { publicSlug: normalized, NOT: { id: partner.id } },
            select: { id: true },
          });
          if (taken) {
            throw new ConflictException('Este endereço público já está em uso.');
          }
          publicSlugToSet = normalized;
        }
      }
    }

    let updated;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
      const userPatch: { whatsapp?: string; name?: string } = {};
      if (whatsappToSet !== undefined) userPatch.whatsapp = whatsappToSet;
      if (nameToSet !== undefined) userPatch.name = nameToSet;
      if (Object.keys(userPatch).length) {
        await tx.user.update({
          where: { id: userId },
          data: userPatch,
        });
      }

      return tx.partner.update({
        where: { id: partner.id },
        data: {
          name: nameToSet !== undefined ? nameToSet : partner.name,
          logoUrl: dto.logoUrl ?? partner.logoUrl,
          shortDescription: dto.shortDescription ?? partner.shortDescription,
          fullDescription: dto.fullDescription ?? partner.fullDescription,
          backgroundImageUrl:
            dto.backgroundImageUrl ?? partner.backgroundImageUrl,
          catalogImageUrls: newCatalogImages,
          catalogVideoUrl: nextCatalogVideoUrl,
          instagram:
            dto.instagram !== undefined ? dto.instagram : partner.instagram,
          billingName:
            dto.billingName !== undefined ? dto.billingName : partner.billingName,
          billingNif:
            dto.billingNif !== undefined ? dto.billingNif : partner.billingNif,
          billingAddress:
            dto.billingAddress !== undefined
              ? dto.billingAddress
              : partner.billingAddress,
          billingPostalCode:
            dto.billingPostalCode !== undefined
              ? dto.billingPostalCode
              : partner.billingPostalCode,
          ...(whatsappToSet !== undefined && { whatsapp: whatsappToSet }),
          ...(publicSlugToSet !== undefined && { publicSlug: publicSlugToSet }),
        },
      });
    });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException('Este endereço público já está em uso.');
      }
      throw e;
    }

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

    if (oldCatalogVideoToDelete) {
      await this.houseImages.deleteStoredUrl(oldCatalogVideoToDelete);
    }

    return updated;
  }

  async uploadMyCatalogVideo(
    userId: string,
    videoFile: Express.Multer.File | undefined,
  ) {
    if (!videoFile?.size) {
      throw new BadRequestException(
        'Envia um ficheiro de vídeo no campo «video».',
      );
    }

    const partner = await this.prisma.partner.findUnique({
      where: { userId },
    });
    if (!partner) {
      throw new NotFoundException('Parceiro não encontrado para este usuário.');
    }

    const oldUrl = partner.catalogVideoUrl;

    const { publicUrl } = await this.houseImages.storeHouseVideo(videoFile);
    if (videoFile.path) {
      await unlink(videoFile.path).catch(() => undefined);
    }

    const updated = await this.prisma.partner.update({
      where: { id: partner.id },
      data: { catalogVideoUrl: publicUrl },
    });

    if (oldUrl && oldUrl !== publicUrl) {
      await this.houseImages.deleteStoredUrl(oldUrl);
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

  /** Parceiros de casas/relocation: categoria obrigatória e slug relocation. */
  private async getRelocationPartnerOrThrow(userId: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { userId },
    });

    if (!partner) {
      throw new NotFoundException('Parceiro não encontrado para este usuário.');
    }

    if (partner.categorySlug !== RELOCATION_CATEGORY_SLUG) {
      throw new ForbiddenException(
        'Apenas parceiros na categoria Relocation podem gerir anúncios de imóveis.',
      );
    }

    return partner;
  }

  private async getOrCreateRelocationPartnerForAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        name: true,
        whatsapp: true,
        partner: {
          select: {
            id: true,
            name: true,
            whatsapp: true,
            categorySlug: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Administrador não encontrado.');
    }
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Apenas administradores podem criar anúncios nesta área.');
    }

    if (!user.partner) {
      return this.prisma.partner.create({
        data: {
          userId: user.id,
          name: user.name?.trim() || 'Admin',
          whatsapp: user.whatsapp,
          categorySlug: RELOCATION_CATEGORY_SLUG,
          publicSlug: null,
        },
      });
    }

    if (
      user.partner.categorySlug !== RELOCATION_CATEGORY_SLUG ||
      user.partner.whatsapp !== user.whatsapp ||
      user.partner.name !== user.name
    ) {
      return this.prisma.partner.update({
        where: { id: user.partner.id },
        data: {
          categorySlug: RELOCATION_CATEGORY_SLUG,
          whatsapp: user.whatsapp,
          ...(user.name ? { name: user.name } : {}),
        },
      });
    }

    return user.partner;
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
        rpmCommissionEur: true,
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

    const created = await this.prisma.service.create({
      data: {
        partnerId: partner.id,
        title: dto.title,
        description: dto.description?.trim() ?? '',
        price: priceOnRequest ? null : (dto.price?.trim() || null),
        priceOnRequest,
      },
    });
    await this.partnerContactLinks.ensureServiceContactLinkForNewService(
      partner.id,
      created.id,
      created.title,
    );
    return created;
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

  async adminListServicesGroupedByPartner() {
    const partners = await this.prisma.partner.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        services: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            title: true,
            price: true,
            priceOnRequest: true,
            rpmCommissionEur: true,
          },
        },
      },
    });

    return partners.filter((p) => p.services.length > 0);
  }

  async adminUpdateServiceCommission(
    serviceId: string,
    rpmCommissionEur: string | null | undefined,
  ) {
    const exists = await this.prisma.service.findUnique({
      where: { id: serviceId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Serviço não encontrado.');
    }

    const normalized =
      rpmCommissionEur === undefined
        ? undefined
        : rpmCommissionEur === null
          ? null
          : rpmCommissionEur.trim() === ''
            ? null
            : rpmCommissionEur.trim();

    return this.prisma.service.update({
      where: { id: serviceId },
      data: { rpmCommissionEur: normalized },
      select: {
        id: true,
        rpmCommissionEur: true,
      },
    });
  }

  async listMySales(userId: string) {
    const partner = await this.getPartnerForUserOrThrow(userId);
    return this.prisma.partnerSale.findMany({
      where: { partnerId: partner.id },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            whatsapp: true,
            tier: true,
          },
        },
        service: { select: { id: true, title: true, rpmCommissionEur: true } },
      },
    });
  }

  /** Texto curto: «2 cauções · 1 renda» (alinhado à página pública). */
  private formatHouseEntradaShortLine(caucoes: number, rendas: number): string {
    const cNum = Number.isFinite(caucoes) ? caucoes : 0;
    const rNum = Number.isFinite(rendas) ? rendas : 0;
    if (cNum <= 0 && rNum <= 0) return '';
    const c = cNum === 1 ? '1 caução' : `${cNum} cauções`;
    const r = rNum === 1 ? '1 renda' : `${rNum} rendas`;
    return `${c} · ${r}`;
  }

  private formatHousePostText(params: {
    houseId: number;
    title: string;
    description: string;
    businessType: HouseBusinessType;
    city: string;
    typology: string;
    availableFrom: Date;
    priceEur: string;
    caucoesCount: number;
    rendasEntradaCount: number;
    relocationFeeEur: string;
    furnished: boolean;
    featured: boolean;
    partnerName: string;
    partnerWhatsapp: string;
  }): string {
    const datePt = params.availableFrom.toLocaleDateString('pt-PT');
    const typologyLabel = this.formatHouseTypologyLabel(params.typology);
    const cityLabel = this.formatHouseCityLabel(params.city);
    const businessTypeLabel = this.formatHouseBusinessTypeLabel(params.businessType);
    const entrada = this.formatHouseEntradaShortLine(
      params.caucoesCount,
      params.rendasEntradaCount,
    );
    const fee = params.relocationFeeEur.trim();
    const mobilado = params.furnished ? 'Sim' : 'Não';
    const priceLabel = params.businessType === 'SALE' ? 'Preço de venda' : 'Renda';
    const priceValue = `${params.priceEur.trim()}${params.businessType === 'SALE' ? '' : ' / mês'}`;
    const frontendBase = getFrontendBaseUrl();
    /** Sem `https://` para o WhatsApp não gerar preview com metadados no grupo. */
    const frontendHostPath = frontendBase.replace(/^https?:\/\//i, '');
    const partnerWaLink = `${frontendHostPath}/imovel?id=${encodeURIComponent(String(params.houseId))}`;
    const lines = [
      `👆 *${params.title.trim()}*`,
      ``,
      ...(params.featured ? ['⭐ *Esse imóvel está em Destaque!*', ``] : []),
      `💶 *${priceLabel}:* ${priceValue}`,
      ``,
      `*Id:* ${params.houseId}`,
      ``,
      `*Casa para ${params.businessType === 'SALE' ? 'venda' : 'arrendamento'}*`,
      `📍 *Cidade:* ${cityLabel}`,
      `🏘️ *Tipologia:* ${typologyLabel}`,
      `🏷️ *Finalidade:* ${businessTypeLabel}`,
      `🛋️ *Mobilado:* ${mobilado}`,
      `📅 *Disponível em:* ${datePt}`,
      `*Taxa relocation:* ${fee} €`,
      ...(entrada ? [`*Entrada:* ${entrada}`] : []),
    ];
    lines.push(
      ``,
      `📝 *Descrição:*`,
      params.description.trim(),
      ``,
      `📲 *Falar com ${params.partnerName.trim() || 'o parceiro'}:* ${partnerWaLink}`,
    );
    return lines.join('\n');
  }

  private formatHouseCityLabel(city: string): string {
    switch (city) {
      case 'INTERIOR':
        return 'Interior';
      case 'LISBOA':
        return 'Lisboa';
      case 'PORTO':
        return 'Porto';
      case 'BRAGA':
        return 'Braga';
      case 'COIMBRA':
        return 'Coimbra';
      case 'AVEIRO':
        return 'Aveiro';
      case 'FARO':
        return 'Faro';
      case 'ALGARVE':
        return 'Algarve';
      case 'EVORA':
        return 'Évora';
      case 'VISEU':
        return 'Viseu';
      default:
        return city;
    }
  }

  private formatHouseTypologyLabel(typology: string): string {
    switch (typology) {
      case 'T0':
        return 'T0';
      case 'T1':
        return 'T1';
      case 'T2':
        return 'T2';
      case 'T3':
        return 'T3';
      case 'T4':
        return 'T4';
      case 'T5':
        return 'T5';
      case 'QUARTO_AP_COMPARTILHADO':
        return 'Quarto em Ap compartilhado';
      default:
        return typology;
    }
  }

  private formatHouseBusinessTypeLabel(type: HouseBusinessType): string {
    return type === 'SALE' ? 'Venda' : 'Arrendamento';
  }

  private relocationHousePublicInclude = {
    partner: {
      select: {
        id: true,
        publicSlug: true,
        name: true,
        whatsapp: true,
        logoUrl: true,
        shortDescription: true,
        categorySlug: true,
      },
    },
  } as const;

  /** Resolve imóvel relocation por UUID (`id`) ou identificador numérico (`houseId`). */
  private async findRelocationHouseByPublicKey(houseKey: string) {
    const baseWhere = {
      partner: { categorySlug: RELOCATION_CATEGORY_SLUG },
    } as const;
    const include = this.relocationHousePublicInclude;

    const byId = await this.prisma.partnerHouse.findFirst({
      where: { id: houseKey, ...baseWhere },
      include,
    });
    if (byId) return byId;

    if (/^\d+$/.test(houseKey)) {
      const n = parseInt(houseKey, 10);
      if (!Number.isNaN(n)) {
        return this.prisma.partnerHouse.findFirst({
          where: { houseId: n, ...baseWhere },
          include,
        });
      }
    }
    return null;
  }

  private async canViewNonPublicHouse(
    viewer: { id: string; role: Role },
    housePartnerId: string,
  ): Promise<boolean> {
    if (viewer.role === Role.ADMIN) return true;
    if (viewer.role !== Role.PARTNER) return false;
    const owned = await this.prisma.partner.findFirst({
      where: { userId: viewer.id, id: housePartnerId },
      select: { id: true },
    });
    return !!owned;
  }

  /**
   * Página pública do anúncio: imóvel relocation + dados mínimos do parceiro (nome, logo, categoria).
   * Admin ou parceiro dono do imóvel podem ver anúncios ocultos ou expirados.
   */
  async getPublicHousePage(
    houseId: string,
    viewer?: { id: string; role: Role } | null,
  ) {
    const house = await this.findRelocationHouseByPublicKey(houseId);
    if (!house) {
      throw new NotFoundException('Imóvel não encontrado.');
    }
    if (!isHousePubliclyVisible(house)) {
      const allowed =
        viewer &&
        (await this.canViewNonPublicHouse(viewer, house.partnerId));
      if (!allowed) {
        throw new NotFoundException('Imóvel não encontrado.');
      }
    }

    return house;
  }

  /** Qualquer utilizador autenticado: dados mínimos para contacto e verificação de disponibilidade. */
  async getHouseListingForContact(houseId: string) {
    const row = await this.prisma.partnerHouse.findUnique({
      where: { id: houseId },
      select: {
        id: true,
        houseId: true,
        publicationStatus: true,
        publishedUntil: true,
        title: true,
        businessType: true,
        city: true,
        typology: true,
        priceEur: true,
        furnished: true,
        partnerId: true,
      },
    });
    if (!row) {
      throw new NotFoundException('Imóvel não encontrado.');
    }
    if (!isHousePubliclyVisible(row)) {
      throw new NotFoundException('Imóvel não encontrado.');
    }
    return row;
  }

  async getMyAdvertisingBalance(userId: string) {
    return this.advertising.getBalanceByUserId(userId);
  }

  async startAdvertisingBalanceTopup(
    userId: string,
    userEmail: string | null | undefined,
    dto: {
      amountEurCents: number;
      successUrl?: string;
      cancelUrl?: string;
    },
  ) {
    const partner = await this.getRelocationPartnerOrThrow(userId);
    const frontendBase = getFrontendBaseUrl();
    const successUrl =
      dto.successUrl ?? `${frontendBase}/dashboard/casas?topup=success`;
    const cancelUrl = dto.cancelUrl ?? `${frontendBase}/dashboard/casas?topup=cancel`;
    return this.stripeService.createPartnerAdvertisingTopupCheckout({
      partnerUserId: userId,
      partnerId: partner.id,
      partnerEmail: userEmail,
      amountEurCents: dto.amountEurCents,
      successUrl,
      cancelUrl,
    });
  }

  async adminCreditPartnerAdvertisingBalance(
    adminUserId: string,
    partnerId: string,
    amountEurCents: number,
    note?: string,
  ) {
    const partner = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      select: { id: true },
    });
    if (!partner) throw new NotFoundException('Parceiro não encontrado.');
    return this.advertising.credit(partnerId, amountEurCents, 'ADMIN_CREDIT', {
      adminUserId,
      note: note?.trim() || 'Crédito manual pelo admin',
    });
  }

  async adminGetPartnerAdvertisingBalance(partnerId: string) {
    return this.advertising.getBalance(partnerId);
  }

  async adminSetPartnerAdvertisingBalance(
    adminUserId: string,
    partnerId: string,
    balanceEurCents: number,
    note?: string,
  ) {
    const partner = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      select: { id: true },
    });
    if (!partner) throw new NotFoundException('Parceiro não encontrado.');
    return this.advertising.setBalance(partnerId, balanceEurCents, {
      adminUserId,
      note: note?.trim() || 'Saldo definido manualmente pelo admin',
    });
  }

  async publishMyHouse(userId: string, houseId: string) {
    const partner = await this.getRelocationPartnerOrThrow(userId);
    const house = await this.prisma.partnerHouse.findFirst({
      where: { id: houseId, partnerId: partner.id },
      select: { id: true },
    });
    if (!house) {
      throw new NotFoundException('Imóvel não encontrado.');
    }
    return this.publishHouseToChannels(houseId, { chargePartner: true });
  }

  /** Parceiro: oculta o anúncio no site (sem reembolso do saldo já gasto). */
  async unpublishMyHouse(userId: string, houseId: string) {
    const partner = await this.getRelocationPartnerOrThrow(userId);
    const house = await this.prisma.partnerHouse.findFirst({
      where: { id: houseId, partnerId: partner.id },
      select: { id: true, publicationStatus: true },
    });
    if (!house) {
      throw new NotFoundException('Imóvel não encontrado.');
    }
    if (house.publicationStatus !== PartnerHousePublicationStatus.PUBLISHED) {
      throw new BadRequestException('Este imóvel já está oculto.');
    }
    const updated = await this.prisma.partnerHouse.update({
      where: { id: houseId },
      data: { publicationStatus: PartnerHousePublicationStatus.HIDDEN },
      select: {
        id: true,
        publicationStatus: true,
        publishedUntil: true,
      },
    });
    return {
      ok: true as const,
      publicationStatus: updated.publicationStatus,
      publishedUntil: updated.publishedUntil?.toISOString() ?? null,
    };
  }

  private partnerHouseCreatePayloadFromStrictDto(
    dto: CreatePartnerHouseDto,
  ): {
    title: string;
    description: string;
    businessType: HouseBusinessType;
    typology: PartnerHouseTypology;
    city: string;
    availableFrom: Date;
    priceEur: string;
    relocationFeeEur: string;
    caucoesCount: number;
    rendasEntradaCount: number;
    furnished: boolean;
    coverImageIndex?: string;
  } {
    const availableFrom = new Date(dto.availableFrom);
    if (Number.isNaN(availableFrom.getTime())) {
      throw new BadRequestException('Data "Disponível em" inválida.');
    }
    return {
      title: dto.title.trim(),
      description: dto.description.trim(),
      businessType: (dto.businessType ?? 'RENT') as HouseBusinessType,
      typology: dto.typology,
      city: dto.city.trim(),
      availableFrom,
      priceEur: dto.priceEur.trim(),
      relocationFeeEur: dto.relocationFeeEur.trim(),
      caucoesCount: Math.min(12, Math.max(0, parseInt(dto.caucoesCount, 10))),
      rendasEntradaCount: Math.min(12, Math.max(0, parseInt(dto.rendasEntradaCount, 10))),
      furnished: dto.furnished === 'true',
      coverImageIndex: dto.coverImageIndex,
    };
  }

  private partnerHouseCreatePayloadFromAdminDto(dto: AdminCreatePartnerHouseDto): {
    title: string;
    description: string;
    businessType: HouseBusinessType;
    typology: PartnerHouseTypology;
    city: string;
    availableFrom: Date;
    priceEur: string;
    relocationFeeEur: string;
    caucoesCount: number;
    rendasEntradaCount: number;
    furnished: boolean;
    coverImageIndex?: string;
  } {
    const rawDate = dto.availableFrom?.trim();
    let availableFrom = rawDate ? new Date(rawDate) : new Date();
    if (Number.isNaN(availableFrom.getTime())) {
      availableFrom = new Date();
    }

    const typRaw = dto.typology?.trim();
    const typology =
      typRaw &&
      (Object.values(PartnerHouseTypology) as string[]).includes(typRaw)
        ? (typRaw as PartnerHouseTypology)
        : PartnerHouseTypology.T2;

    const parseEntrada = (s: string | undefined, fallback: number) => {
      if (s == null || String(s).trim() === '') return fallback;
      const n = parseInt(String(s), 10);
      if (Number.isNaN(n)) return fallback;
      return Math.min(12, Math.max(0, n));
    };

    return {
      title: (dto.title ?? '').trim() || 'Sem título',
      description: (dto.description ?? '').trim() || '—',
      businessType: (dto.businessType === 'SALE' ? 'SALE' : 'RENT') as HouseBusinessType,
      typology,
      city: normalizeRelocationCityForAdminStorage(dto.city),
      availableFrom,
      priceEur: (dto.priceEur ?? '').trim() || '—',
      relocationFeeEur: (dto.relocationFeeEur ?? '').trim() || '0',
      caucoesCount: parseEntrada(dto.caucoesCount, 0),
      rendasEntradaCount: parseEntrada(dto.rendasEntradaCount, 0),
      furnished: dto.furnished === 'true',
      coverImageIndex: dto.coverImageIndex,
    };
  }

  private async createHousePostForPartner(
    partnerId: string,
    dto: CreatePartnerHouseDto | AdminCreatePartnerHouseDto,
    imageFiles: Express.Multer.File[],
    videoFile: Express.Multer.File | null,
    thumbnailFile: Express.Multer.File | null,
    options: { strict: boolean },
  ) {
    const payload = options.strict
      ? this.partnerHouseCreatePayloadFromStrictDto(dto as CreatePartnerHouseDto)
      : this.partnerHouseCreatePayloadFromAdminDto(dto as AdminCreatePartnerHouseDto);

    const images = (imageFiles ?? []).filter((f) => !!f);
    const hasVideo = !!videoFile;
    if (images.length > 6) {
      throw new BadRequestException('Podes enviar no máximo 6 imagens.');
    }
    if (options.strict && images.length === 0 && !hasVideo) {
      throw new BadRequestException('Envia pelo menos 1 imagem ou 1 vídeo.');
    }

    let imageUrls: string[] = [];
    let videoUrl: string | null = null;
    let videoPosterUrl: string | null = null;

    for (const file of images) {
      try {
        const { publicUrl } = await this.houseImages.processHouseImageForListing(file);
        imageUrls.push(publicUrl);
        if (file.path) {
          await unlink(file.path).catch(() => undefined);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('processar') || msg.includes('inválida')) {
          throw new BadRequestException(msg);
        }
        throw e;
      }
    }

    let coverImageUrl: string | null = null;
    if (imageUrls.length > 0) {
      const raw = payload.coverImageIndex?.trim();
      const idx =
        raw != null && raw !== ''
          ? Math.min(
              Math.max(0, parseInt(raw, 10)),
              imageUrls.length - 1,
            )
          : 0;
      coverImageUrl = imageUrls[idx]!;
    }

    if (hasVideo && videoFile) {
      try {
        const v = await this.houseImages.storeHouseVideo(videoFile);
        videoUrl = v.publicUrl;
        if (videoFile.path) {
          await unlink(videoFile.path).catch(() => undefined);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('inválido') || msg.includes('suportado') || msg.includes('Formato')) {
          throw new BadRequestException(msg);
        }
        throw e;
      }
    }

    // Thumbnail manual (admin): guardada em `videoPosterUrl` para uso nos cards/listas.
    if (thumbnailFile) {
      try {
        const { publicUrl } = await this.houseImages.processHouseImageForListing(thumbnailFile);
        videoPosterUrl = publicUrl;
        if (thumbnailFile.path) {
          await unlink(thumbnailFile.path).catch(() => undefined);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('processar') || msg.includes('inválida')) {
          throw new BadRequestException(msg);
        }
        throw e;
      }
    }

    const created = await this.prisma.partnerHouse.create({
      data: {
        partnerId,
        title: payload.title,
        description: payload.description,
        businessType: payload.businessType,
        typology: payload.typology,
        city: payload.city,
        availableFrom: payload.availableFrom,
        priceEur: payload.priceEur,
        relocationFeeEur: payload.relocationFeeEur,
        caucoesCount: payload.caucoesCount,
        rendasEntradaCount: payload.rendasEntradaCount,
        furnished: payload.furnished,
        imageUrls,
        coverImageUrl,
        videoUrl,
        videoPosterUrl,
      } as any,
    });

    return created;
  }

  async createMyHousePost(
    userId: string,
    dto: CreatePartnerHouseDto,
    imageFiles: Express.Multer.File[],
    videoFile: Express.Multer.File | null,
    thumbnailFile: Express.Multer.File | null,
  ) {
    const partner = await this.getRelocationPartnerOrThrow(userId);
    return this.createHousePostForPartner(partner.id, dto, imageFiles, videoFile, thumbnailFile, {
      strict: true,
    });
  }

  async adminCreateHousePost(
    adminUserId: string,
    dto: AdminCreatePartnerHouseDto,
    imageFiles: Express.Multer.File[],
    videoFile: Express.Multer.File | null,
    thumbnailFile: Express.Multer.File | null,
  ) {
    const requestedPartnerId = dto.partnerId?.trim();
    let partnerId: string;

    if (requestedPartnerId) {
      const assigned = await this.prisma.partner.findFirst({
        where: {
          id: requestedPartnerId,
          categorySlug: RELOCATION_CATEGORY_SLUG,
        },
        select: { id: true },
      });
      if (!assigned) {
        throw new BadRequestException(
          'Parceiro não encontrado ou não pertence à categoria Relocation.',
        );
      }
      partnerId = assigned.id;
    } else {
      const partner = await this.getOrCreateRelocationPartnerForAdmin(adminUserId);
      partnerId = partner.id;
    }

    return this.createHousePostForPartner(partnerId, dto, imageFiles, videoFile, thumbnailFile, {
      strict: false,
    });
  }

  async getMyHouse(userId: string, houseId: string) {
    const partner = await this.getRelocationPartnerOrThrow(userId);
    const house = await this.prisma.partnerHouse.findFirst({
      where: { id: houseId, partnerId: partner.id },
    });
    if (!house) {
      throw new NotFoundException('Imóvel não encontrado.');
    }
    return house;
  }

  /** Remove o anúncio e ficheiros associados (apenas imóveis do próprio parceiro relocation). */
  async deleteMyHouse(userId: string, houseId: string) {
    const partner = await this.getRelocationPartnerOrThrow(userId);
    const house = await this.prisma.partnerHouse.findFirst({
      where: { id: houseId, partnerId: partner.id },
      select: { id: true, imageUrls: true, videoUrl: true, videoPosterUrl: true } as any,
    });
    if (!house) {
      throw new NotFoundException('Imóvel não encontrado.');
    }
    await this.removeHouseMediaFiles({
      imageUrls: Array.isArray((house as any).imageUrls) ? (house as any).imageUrls : [],
      videoUrl: typeof (house as any).videoUrl === 'string' ? (house as any).videoUrl : null,
      videoPosterUrl:
        typeof (house as any).videoPosterUrl === 'string' ? (house as any).videoPosterUrl : null,
    });
    await this.prisma.partnerHouse.delete({ where: { id: houseId } });
    return { ok: true as const };
  }

  async updateMyHouse(
    userId: string,
    houseId: string,
    dto: UpdatePartnerHouseDto,
    imageFiles: Express.Multer.File[],
    videoFile: Express.Multer.File | null,
    thumbnailFile: Express.Multer.File | null,
  ) {
    const partner = await this.getRelocationPartnerOrThrow(userId);
    const house = await this.prisma.partnerHouse.findFirst({
      where: { id: houseId, partnerId: partner.id },
    });
    if (!house) {
      throw new NotFoundException('Imóvel não encontrado.');
    }
    return this.applyHouseListingUpdate(house, houseId, dto, imageFiles, videoFile, thumbnailFile);
  }

  /** Admin: carregar qualquer anúncio para edição. */
  async adminGetHouse(houseId: string) {
    const house = await this.prisma.partnerHouse.findUnique({
      where: { id: houseId },
      include: {
        partner: {
          select: {
            id: true,
            name: true,
            categorySlug: true,
          },
        },
      },
    });
    if (!house) {
      throw new NotFoundException('Imóvel não encontrado.');
    }
    return house;
  }

  async adminUpdateHouse(
    adminUserId: string,
    houseId: string,
    dto: AdminUpdatePartnerHouseDto,
    imageFiles: Express.Multer.File[],
    videoFile: Express.Multer.File | null,
    thumbnailFile: Express.Multer.File | null,
  ) {
    const house = await this.prisma.partnerHouse.findUnique({
      where: { id: houseId },
    });
    if (!house) {
      throw new NotFoundException('Imóvel não encontrado.');
    }
    let partnerIdOpt: string | undefined = undefined;
    if (dto.partnerId !== undefined) {
      const requestedPartnerId = (dto.partnerId ?? '').trim();
      if (requestedPartnerId) {
        const assigned = await this.prisma.partner.findFirst({
          where: {
            id: requestedPartnerId,
            categorySlug: RELOCATION_CATEGORY_SLUG,
          },
          select: { id: true },
        });
        if (!assigned) {
          throw new BadRequestException(
            'Parceiro não encontrado ou não pertence à categoria Relocation.',
          );
        }
        partnerIdOpt = assigned.id;
      } else {
        const partner = await this.getOrCreateRelocationPartnerForAdmin(adminUserId);
        partnerIdOpt = partner.id;
      }
    }

    return this.applyHouseListingUpdate(house, houseId, dto, imageFiles, videoFile, thumbnailFile, {
      partnerId: partnerIdOpt,
    });
  }

  private async applyHouseListingUpdate(
    house: PartnerHouse,
    houseId: string,
    dto: UpdatePartnerHouseDto,
    imageFiles: Express.Multer.File[],
    videoFile: Express.Multer.File | null,
    thumbnailFile: Express.Multer.File | null,
    opts?: { partnerId?: string },
  ) {
    const images = (imageFiles ?? []).filter((f) => !!f);
    if (images.length > 6) {
      throw new BadRequestException('Podes enviar no máximo 6 imagens de uma vez.');
    }

    const newUrlsFromFiles: string[] = [];
    for (const file of images) {
      try {
        const { publicUrl } = await this.houseImages.processHouseImageForListing(file);
        newUrlsFromFiles.push(publicUrl);
        if (file.path) {
          await unlink(file.path).catch(() => undefined);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('processar') || msg.includes('inválida')) {
          throw new BadRequestException(msg);
        }
        throw e;
      }
    }

    const rawKeep = dto.keepImageUrls?.trim();
    let imageUrls: string[];

    if (rawKeep != null && rawKeep !== '') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawKeep);
      } catch {
        throw new BadRequestException(
          'keepImageUrls deve ser JSON válido (array de URLs).',
        );
      }
      if (!Array.isArray(parsed) || !parsed.every((u) => typeof u === 'string')) {
        throw new BadRequestException('keepImageUrls deve ser um array de strings (URLs).');
      }
      for (const u of parsed) {
        if (!house.imageUrls.includes(u)) {
          throw new BadRequestException(
            'Uma das imagens a manter não pertence a este imóvel.',
          );
        }
      }
      imageUrls = [...parsed, ...newUrlsFromFiles].slice(0, 6);
    } else if (newUrlsFromFiles.length > 0) {
      imageUrls = [...house.imageUrls, ...newUrlsFromFiles].slice(0, 6);
    } else {
      imageUrls = [...house.imageUrls];
    }

    for (const u of house.imageUrls) {
      if (!imageUrls.includes(u)) {
        await this.houseImages.deleteStoredUrl(u);
      }
    }

    let videoUrl = house.videoUrl;
    let videoPosterUrl = (house as any).videoPosterUrl as string | null | undefined;
    if (videoPosterUrl === undefined) videoPosterUrl = null;
    if (dto.removeVideo?.toLowerCase() === 'true') {
      if (videoUrl) {
        await this.houseImages.deleteStoredUrl(videoUrl);
      }
      videoUrl = null;
    }
    if (videoFile) {
      if (videoUrl) {
        await this.houseImages.deleteStoredUrl(videoUrl);
      }
      try {
        const v = await this.houseImages.storeHouseVideo(videoFile);
        videoUrl = v.publicUrl;
        if (videoFile.path) {
          await unlink(videoFile.path).catch(() => undefined);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('inválido') || msg.includes('suportado') || msg.includes('Formato')) {
          throw new BadRequestException(msg);
        }
        throw e;
      }
    }

    // Thumbnail manual (admin): substitui a atual se enviada.
    if (thumbnailFile) {
      if (videoPosterUrl) {
        await this.houseImages.deleteStoredUrl(videoPosterUrl);
      }
      try {
        const { publicUrl } = await this.houseImages.processHouseImageForListing(thumbnailFile);
        videoPosterUrl = publicUrl;
        if (thumbnailFile.path) {
          await unlink(thumbnailFile.path).catch(() => undefined);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('processar') || msg.includes('inválida')) {
          throw new BadRequestException(msg);
        }
        throw e;
      }
    }

    if (imageUrls.length === 0 && !videoUrl) {
      throw new BadRequestException('O anúncio deve ter pelo menos 1 imagem ou 1 vídeo.');
    }

    if (dto.availableFrom != null) {
      const d = new Date(dto.availableFrom);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException('Data «Disponível em» inválida.');
      }
    }

    const caucoesCount =
      dto.caucoesCount != null
        ? Math.min(12, Math.max(0, parseInt(dto.caucoesCount, 10)))
        : house.caucoesCount;
    const rendasEntradaCount =
      dto.rendasEntradaCount != null
        ? Math.min(12, Math.max(0, parseInt(dto.rendasEntradaCount, 10)))
        : house.rendasEntradaCount;
    const furnished =
      dto.furnished != null ? dto.furnished === 'true' : house.furnished;

    let coverImageUrl: string | null = house.coverImageUrl;
    if (imageUrls.length === 0) {
      coverImageUrl = null;
    } else if (dto.coverImageIndex != null && dto.coverImageIndex.trim() !== '') {
      const idx = Math.min(
        Math.max(0, parseInt(dto.coverImageIndex.trim(), 10)),
        imageUrls.length - 1,
      );
      coverImageUrl = imageUrls[idx]!;
    } else if (
      house.coverImageUrl &&
      imageUrls.includes(house.coverImageUrl)
    ) {
      coverImageUrl = house.coverImageUrl;
    } else {
      coverImageUrl = imageUrls[0]!;
    }

    return this.prisma.partnerHouse.update({
      where: { id: houseId },
      data: {
        ...(opts?.partnerId != null && { partnerId: opts.partnerId }),
        ...(dto.title != null && { title: dto.title.trim() }),
        ...(dto.description != null && { description: dto.description.trim() }),
        ...(dto.city != null && { city: dto.city.trim() }),
        ...(dto.typology != null && { typology: dto.typology }),
        ...(dto.businessType != null && { businessType: dto.businessType }),
        ...(dto.availableFrom != null && {
          availableFrom: new Date(dto.availableFrom),
        }),
        ...(dto.priceEur != null && { priceEur: dto.priceEur.trim() }),
        ...(dto.relocationFeeEur != null && {
          relocationFeeEur: dto.relocationFeeEur.trim(),
        }),
        caucoesCount,
        rendasEntradaCount,
        furnished,
        imageUrls,
        coverImageUrl,
        videoUrl,
        videoPosterUrl,
      },
    });
  }

  private async removeHouseMediaFiles(house: {
    imageUrls: string[];
    videoUrl: string | null;
    videoPosterUrl?: string | null;
  }) {
    for (const u of house.imageUrls ?? []) {
      await this.houseImages.deleteStoredUrl(u);
    }
    await this.houseImages.deleteStoredUrl(house.videoUrl);
    await this.houseImages.deleteStoredUrl(house.videoPosterUrl ?? null);
  }

  /** Listagem pública: relocation — disponíveis primeiro; depois por data de disponibilidade mais futura. */
  async listPublicRelocationHouses(filters?: {
    partnerId?: string;
    city?: string;
    typology?: string;
    businessType?: string;
    minPriceEur?: string;
    maxPriceEur?: string;
    page?: string;
    pageSize?: string;
  }) {
    const parseEurLikeToInt = (raw: unknown): number | null => {
      if (typeof raw !== 'string') return null;
      const digits = raw.replace(/[^\d]/g, '');
      if (!digits) return null;
      const n = Number(digits);
      return Number.isFinite(n) ? n : null;
    };

    const partnerId = filters?.partnerId?.trim() || undefined;
    const city = filters?.city?.trim() || undefined;
    const rawTyp = filters?.typology?.trim();
    const typology: PartnerHouseTypology | undefined =
      rawTyp &&
      (Object.values(PartnerHouseTypology) as string[]).includes(rawTyp)
        ? (rawTyp as PartnerHouseTypology)
        : undefined;
    const rawBusinessType = filters?.businessType?.trim();
    const businessType: HouseBusinessType | undefined =
      rawBusinessType &&
      (['RENT', 'SALE'] as string[]).includes(rawBusinessType)
        ? (rawBusinessType as HouseBusinessType)
        : undefined;

    const minPrice = parseEurLikeToInt(filters?.minPriceEur);
    const maxPrice = parseEurLikeToInt(filters?.maxPriceEur);

    const page =
      typeof filters?.page === 'string' && /^\d+$/.test(filters.page)
        ? Math.max(1, Number(filters.page))
        : 1;
    const requestedPageSize =
      typeof filters?.pageSize === 'string' && /^\d+$/.test(filters.pageSize)
        ? Math.max(1, Number(filters.pageSize))
        : 10;
    const pageSize = Math.min(10, requestedPageSize);

    const now = new Date();
    const rows = (await this.prisma.partnerHouse.findMany({
      where: {
        partner: { categorySlug: RELOCATION_CATEGORY_SLUG },
        publicationStatus: PartnerHousePublicationStatus.PUBLISHED,
        publishedUntil: { gt: now },
        ...(partnerId ? { partnerId } : {}),
        ...(city
          ? {
              city: {
                in: expandRelocationCityFilter(city),
              },
            }
          : {}),
        ...(typology ? { typology } : {}),
        ...(businessType ? { businessType } : {}),
      },
      select: {
        id: true,
        houseId: true,
        title: true,
        description: true,
        businessType: true,
        typology: true,
        city: true,
        availableFrom: true,
        priceEur: true,
        relocationFeeEur: true,
        caucoesCount: true,
        rendasEntradaCount: true,
        furnished: true,
        imageUrls: true,
        coverImageUrl: true,
        videoUrl: true,
        videoPosterUrl: true,
        partnerId: true,
        publicationStatus: true,
        publishedUntil: true,
        featured: true,
        partner: {
          select: {
            id: true,
            name: true,
            whatsapp: true,
            logoUrl: true,
            shortDescription: true,
          },
        },
      } as any,
    })) as any[];

    const filteredByPrice =
      minPrice == null && maxPrice == null
        ? rows
        : rows.filter((r) => {
            const p = parseEurLikeToInt(r.priceEur);
            if (p == null) return false;
            if (minPrice != null && p < minPrice) return false;
            if (maxPrice != null && p > maxPrice) return false;
            return true;
          });
    filteredByPrice.sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      return (
        new Date(b.availableFrom as any).getTime() -
        new Date(a.availableFrom as any).getTime()
      );
    });

    const total = filteredByPrice.length;
    const start = (page - 1) * pageSize;
    const items = filteredByPrice.slice(start, start + pageSize);
    return { items, total, page, pageSize };
  }

  async adminListHouseRelocationWhatsappGroups() {
    return this.prisma.houseRelocationWhatsappGroup.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async adminCreateHouseRelocationWhatsappGroup(dto: CreateHouseRelocationWhatsappGroupDto) {
    const name = dto.name.trim();
    const groupJid = dto.groupJid.trim();
    const agg = await this.prisma.houseRelocationWhatsappGroup.aggregate({
      _max: { sortOrder: true },
    });
    const sortOrder = (agg._max.sortOrder ?? -1) + 1;
    try {
      return await this.prisma.houseRelocationWhatsappGroup.create({
        data: {
          name,
          groupJid,
          businessType: dto.businessType,
          active: true,
          sortOrder,
        },
      });
    } catch (e: unknown) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Já existe um grupo com este JID.');
      }
      throw e;
    }
  }

  async adminUpdateHouseRelocationWhatsappGroup(
    id: string,
    dto: UpdateHouseRelocationWhatsappGroupDto,
  ) {
    const exists = await this.prisma.houseRelocationWhatsappGroup.findUnique({
      where: { id },
    });
    if (!exists) {
      throw new NotFoundException('Grupo não encontrado.');
    }
    const data: {
      name?: string;
      active?: boolean;
      businessType?: 'RENT' | 'SALE';
    } = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.businessType !== undefined) data.businessType = dto.businessType;
    if (Object.keys(data).length === 0) {
      return exists;
    }
    return this.prisma.houseRelocationWhatsappGroup.update({
      where: { id },
      data,
    });
  }

  async adminDeleteHouseRelocationWhatsappGroup(id: string) {
    const exists = await this.prisma.houseRelocationWhatsappGroup.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Grupo não encontrado.');
    }
    await this.prisma.houseRelocationWhatsappGroup.delete({ where: { id } });
    return { ok: true as const };
  }

  /**
   * Admin: envia WhatsApp sem cobrança e prolonga a janela de publicação (+7 dias).
   */
  async adminSendHouseToRelocationWhatsappGroups(houseId: string) {
    return this.publishHouseToChannels(houseId, { chargePartner: false });
  }

  private async publishHouseToChannels(
    houseId: string,
    options: { chargePartner: boolean },
  ) {
    const house = await this.prisma.partnerHouse.findFirst({
      where: {
        id: houseId,
        partner: { categorySlug: RELOCATION_CATEGORY_SLUG },
      },
      select: {
        id: true,
        partnerId: true,
        publicationStatus: true,
        publishedUntil: true,
        lastPublishedAt: true,
      },
    });
    if (!house) {
      throw new NotFoundException('Imóvel relocation não encontrado.');
    }

    const prevPublication = {
      publicationStatus: house.publicationStatus,
      publishedUntil: house.publishedUntil,
      lastPublishedAt: house.lastPublishedAt,
    };

    if (options.chargePartner) {
      await this.advertising.debitForPublication(house.partnerId, houseId);
    }

    const publishedUntil = nextPublishedUntil(house.publishedUntil);
    const now = new Date();

    try {
      await this.prisma.partnerHouse.update({
        where: { id: houseId },
        data: {
          publicationStatus: PartnerHousePublicationStatus.PUBLISHED,
          publishedUntil,
          lastPublishedAt: now,
        },
      });

      const result = await this.sendHouseToRelocationWhatsappGroups(houseId);

      if (options.chargePartner) {
        const balance = await this.advertising.getBalance(house.partnerId);
        return { ...result, publishedUntil, balanceEurCents: balance.balanceEurCents };
      }

      return { ...result, publishedUntil };
    } catch (err) {
      if (options.chargePartner) {
        await this.advertising.refundPublicationDebit(house.partnerId, houseId);
      }
      await this.prisma.partnerHouse.update({
        where: { id: houseId },
        data: prevPublication,
      });
      throw err;
    }
  }

  /**
   * Envia o anúncio aos grupos ativos: imagens (ordem), vídeo, texto (formato existente).
   */
  private async sendHouseToRelocationWhatsappGroups(houseId: string) {
    const house = await this.prisma.partnerHouse.findFirst({
      where: {
        id: houseId,
        partner: { categorySlug: RELOCATION_CATEGORY_SLUG },
      },
      include: { partner: { select: { name: true, whatsapp: true } } },
    });
    if (!house) {
      throw new NotFoundException('Imóvel relocation não encontrado.');
    }

    const groups = await this.prisma.houseRelocationWhatsappGroup.findMany({
      where: {
        active: true,
        businessType: house.businessType,
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (!groups.length) {
      const purposeLabel =
        house.businessType === 'SALE' ? 'venda' : 'arrendamento';
      throw new BadRequestException(
        `Não há grupos ativos para a finalidade «${purposeLabel}». Adiciona e ativa um grupo com essa finalidade.`,
      );
    }

    const text = this.formatHousePostText({
      houseId: house.houseId,
      title: house.title,
      description: house.description,
      businessType: house.businessType as HouseBusinessType,
      city: house.city,
      typology: house.typology,
      availableFrom: house.availableFrom,
      priceEur: house.priceEur,
      caucoesCount: house.caucoesCount,
      rendasEntradaCount: house.rendasEntradaCount,
      relocationFeeEur: house.relocationFeeEur,
      furnished: house.furnished,
      featured: Boolean((house as any).featured),
      partnerName: house.partner?.name ?? 'Parceiro',
      partnerWhatsapp: house.partner?.whatsapp ?? '',
    });

    const failures: string[] = [];
    let successCount = 0;

    for (const g of groups) {
      const to = g.groupJid.trim();
      try {
        let idx = 0;
        for (const url of house.imageUrls) {
          idx += 1;
          const abs = toAbsoluteMediaUrl(url);
          await this.wa.sendMedia({
            to,
            caption: '',
            mediaUrl: abs,
            mimeType: 'image/webp',
            fileName: `imovel-${idx}.webp`,
            mediaType: 'image',
            requireDelivery: true,
          });
          await sleep(650);
        }
        if (house.videoUrl) {
          const abs = toAbsoluteMediaUrl(house.videoUrl);
          const { mime, fileName } = await videoMimeForEvolutionSend(abs);
          await this.wa.sendMedia({
            to,
            caption: '',
            mediaUrl: abs,
            mimeType: mime,
            fileName,
            mediaType: 'video',
            requireDelivery: true,
          });
          await sleep(650);
        }
        await this.wa.sendText(to, text, { requireDelivery: true });
        successCount += 1;
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : 'Erro desconhecido ao enviar.';
        failures.push(`${g.name}: ${msg}`);
        this.logger.warn(
          `Envio imóvel ${houseId} para grupo ${g.name} (${to}): ${msg}`,
        );
      }
    }

    const summaryError =
      failures.length > 0 ? failures.join(' | ').slice(0, 4000) : null;
    const sentAt = successCount > 0 ? new Date() : null;
    await this.prisma.partnerHouse.update({
      where: { id: houseId },
      data: {
        whatsappSentAt: sentAt ?? house.whatsappSentAt,
        whatsappError: failures.length ? summaryError : null,
      },
    });

    if (sentAt) {
      await (this.prisma as any).partnerHouseWhatsappSend.create({
        data: { houseId, sentAt },
      });
    }

    if (successCount === 0) {
      throw new HttpException(
        failures.join(' | ') || 'Falha ao enviar para todos os grupos.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return {
      ok: true as const,
      sentToGroups: successCount,
      failed: failures,
    };
  }

  async adminListAllHouses() {
    return this.prisma.partnerHouse.findMany({
      // Cast para evitar cache desatualizado de tipos no IDE após novas migrations.
      orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }] as any,
      include: {
        partner: {
          select: {
            id: true,
            name: true,
            categorySlug: true,
          },
        },
        whatsappSends: {
          select: { sentAt: true },
          orderBy: { sentAt: 'desc' },
        },
        _count: {
          select: { redirectClicks: true },
        },
      } as any,
    });
  }

  async adminDeleteHouse(houseId: string) {
    const house = await this.prisma.partnerHouse.findUnique({
      where: { id: houseId },
      select: { id: true, imageUrls: true, videoUrl: true, videoPosterUrl: true } as any,
    });
    if (!house) {
      throw new NotFoundException('Imóvel não encontrado.');
    }
    await this.removeHouseMediaFiles({
      imageUrls: Array.isArray((house as any).imageUrls) ? (house as any).imageUrls : [],
      videoUrl: typeof (house as any).videoUrl === 'string' ? (house as any).videoUrl : null,
      videoPosterUrl:
        typeof (house as any).videoPosterUrl === 'string' ? (house as any).videoPosterUrl : null,
    });
    await this.prisma.partnerHouse.delete({ where: { id: houseId } });
    return { ok: true as const };
  }

  async adminSetHouseFeatured(houseId: string, featured: boolean) {
    const exists = await this.prisma.partnerHouse.findUnique({
      where: { id: houseId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Imóvel não encontrado.');
    }
    return this.prisma.partnerHouse.update({
      where: { id: houseId },
      data: { featured } as any,
      select: { id: true, featured: true } as any,
    });
  }

  async listMyHouses(userId: string) {
    const partner = await this.getRelocationPartnerOrThrow(userId);
    return this.prisma.partnerHouse.findMany({
      where: { partnerId: partner.id },
      orderBy: { createdAt: 'desc' },
      include: {
        whatsappSends: {
          select: { sentAt: true },
          orderBy: { sentAt: 'desc' },
        },
        _count: {
          select: { redirectClicks: true },
        },
      } as any,
    });
  }

  async createMySale(userId: string, dto: CreatePartnerSaleDto) {
    const partner = await this.getPartnerForUserOrThrow(userId);

    const buyer = await this.prisma.user.findFirst({
      where: { id: dto.leadUserId, role: Role.USER },
      select: { id: true },
    });
    if (!buyer) {
      throw new BadRequestException(
        'Cliente inválido: indica o ID de um utilizador com conta de membro (role USER).',
      );
    }

    // valida serviço pertence ao parceiro
    const service = await this.prisma.service.findFirst({
      where: { id: dto.serviceId, partnerId: partner.id },
      select: { id: true, rpmCommissionEur: true },
    });
    if (!service) {
      throw new BadRequestException('Serviço inválido para este parceiro.');
    }

    const amount = dto.amountEur?.trim();
    if (!amount) throw new BadRequestException('Valor da venda é obrigatório.');

    return this.prisma.partnerSale.create({
      data: {
        partnerId: partner.id,
        userId: dto.leadUserId,
        serviceId: service.id,
        amountEur: amount,
        commissionSuggestedEur: service.rpmCommissionEur ?? null,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            whatsapp: true,
            tier: true,
          },
        },
        service: { select: { id: true, title: true, rpmCommissionEur: true } },
      },
    });
  }

  async deleteMySale(userId: string, saleId: string) {
    const partner = await this.getPartnerForUserOrThrow(userId);
    const sale = await this.prisma.partnerSale.findFirst({
      where: { id: saleId, partnerId: partner.id },
      select: { id: true, commissionPaymentStatus: true },
    });
    if (!sale) throw new NotFoundException('Venda não encontrada.');
    if (sale.commissionPaymentStatus === PartnerSaleCommissionPaymentStatus.PAID) {
      throw new BadRequestException('Não é possível apagar uma venda já paga.');
    }
    await this.prisma.partnerSale.delete({ where: { id: sale.id } });
    return { ok: true };
  }

  async adminListAllSales() {
    return this.prisma.partnerSale.findMany({
      orderBy: [{ createdAt: 'desc' }],
      include: {
        partner: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, whatsapp: true, tier: true } },
        service: { select: { id: true, title: true } },
      },
    });
  }

  async startMySaleCommissionCheckout(params: {
    partnerUserId: string;
    partnerEmail: string | null | undefined;
    saleId: string;
    commissionEur: string;
    wantsInvoice: boolean;
    successUrl: string;
    cancelUrl: string;
    method: 'card' | 'mbway';
  }) {
    const partner = await this.getPartnerForUserOrThrow(params.partnerUserId);

    const sale = await this.prisma.partnerSale.findFirst({
      where: { id: params.saleId, partnerId: partner.id },
      include: { service: { select: { rpmCommissionEur: true } } },
    });
    if (!sale) throw new NotFoundException('Venda não encontrada.');
    if (sale.commissionPaymentStatus === PartnerSaleCommissionPaymentStatus.PAID) {
      throw new BadRequestException('Esta comissão já foi paga.');
    }

    const commission = params.commissionEur.trim();
    if (!commission) throw new BadRequestException('Valor da comissão é obrigatório.');
    const commissionCents = Math.round(Number(commission.replace(',', '.')) * 100);
    if (!Number.isFinite(commissionCents) || commissionCents <= 0) {
      throw new BadRequestException('Valor da comissão inválido.');
    }

    // snapshot faturação do parceiro (se solicitar fatura)
    const partnerBilling = await this.prisma.partner.findUnique({
      where: { id: partner.id },
      select: {
        billingName: true,
        billingNif: true,
        billingAddress: true,
        billingPostalCode: true,
      },
    });

    await this.prisma.partnerSale.update({
      where: { id: sale.id },
      data: {
        commissionSuggestedEur: sale.commissionSuggestedEur ?? sale.service.rpmCommissionEur ?? null,
        commissionPaidEur: commission,
        wantsInvoice: params.wantsInvoice,
        invoiceName: params.wantsInvoice ? partnerBilling?.billingName ?? null : null,
        invoiceNif: params.wantsInvoice ? partnerBilling?.billingNif ?? null : null,
        invoiceAddress: params.wantsInvoice ? partnerBilling?.billingAddress ?? null : null,
        invoicePostalCode: params.wantsInvoice ? partnerBilling?.billingPostalCode ?? null : null,
        invoiceRequestedAt: params.wantsInvoice ? new Date() : null,
      },
    });

    const session =
      params.method === 'mbway'
        ? await this.stripeService.createPartnerSaleCommissionMbWayCheckoutSession({
            saleId: sale.id,
            partnerUserId: params.partnerUserId,
            partnerEmail: params.partnerEmail,
            commissionEurCents: commissionCents,
            successUrl: params.successUrl,
            cancelUrl: params.cancelUrl,
          })
        : await this.stripeService.createPartnerSaleCommissionCheckoutSession({
            saleId: sale.id,
            partnerUserId: params.partnerUserId,
            partnerEmail: params.partnerEmail,
            commissionEurCents: commissionCents,
            successUrl: params.successUrl,
            cancelUrl: params.cancelUrl,
          });

    await this.prisma.partnerSale.update({
      where: { id: sale.id },
      data: { stripeCheckoutSessionId: session.sessionId },
    });

    return { url: session.url };
  }

  // Endpoints admin/services removidos (sem aprovação e sem comissão/cashback).
}

