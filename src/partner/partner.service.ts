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
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { CreatePartnerSaleDto } from './dto/create-partner-sale.dto';
import { PartnerSaleCommissionPaymentStatus, Prisma, Role } from '@prisma/client';
import { StripeService } from '../stripe/stripe.service';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { CreatePartnerHouseDto } from './dto/create-partner-house.dto';
import { HouseImageStorageService } from './house-image-storage.service';

const SALT_ROUNDS = 10;

const RELOCATION_CATEGORY_SLUG = 'relocation';

/** Limite aproximado de vídeo no WhatsApp (Evolution); acima disto o envio costuma falhar. */
const WHATSAPP_VIDEO_MAX_BYTES = 16 * 1024 * 1024;

/** Limite opcional de caracteres base64 enviados à Evolution (JSON). Útil se o nginx tiver client_max_body_size baixo. */
function evolutionMaxMediaBase64Chars(): number {
  const raw = process.env.EVOLUTION_MAX_MEDIA_BASE64_CHARS?.trim();
  if (raw && /^\d+$/.test(raw)) {
    return parseInt(raw, 10);
  }
  return Number.MAX_SAFE_INTEGER;
}

/** Erros em que faz sentido omitir o vídeo e enviar só o texto (proxy, Evolution, limites). */
function isEvolutionVideoSendSkippableError(message: string): boolean {
  const m = message.slice(0, 2500);
  if (
    /413|entity too large|request entity too large|content too large|payload too large/i.test(
      m,
    )
  ) {
    return true;
  }
  if (/50[0-9]\b|502|503|504|408|429/i.test(m)) return true;
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|socket hang up|fetch failed/i.test(m))
    return true;
  if (
    /too large|file size|max(imum)? size|limit.*exceed|media.*(fail|error)|video.*(fail|error)/i.test(
      m,
    )
  ) {
    return true;
  }
  if (/400\b.*(media|video|send|file)|cannot.*(send|upload)/i.test(m)) return true;
  return false;
}

/** Falha que não deve ser mascarada com “só texto” (credenciais, instância). */
function isEvolutionMediaFatalError(message: string): boolean {
  return /401|403|apikey|unauthorized|forbidden|instance.*not found|not connected/i.test(
    message.slice(0, 1500),
  );
}

@Injectable()
export class PartnerService {
  private readonly logger = new Logger(PartnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly wa: WhatsAppService,
    private readonly houseImages: HouseImageStorageService,
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

  private extractImmigrationPlanAnswers(data: Prisma.JsonValue | null | undefined) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return null;
    }

    const root = data as Record<string, unknown>;
    const meta =
      root.meta && typeof root.meta === 'object' && !Array.isArray(root.meta)
        ? (root.meta as Record<string, unknown>)
        : null;

    if (!meta) return null;

    const answers = {
      visaType:
        typeof meta.visaType === 'string' && meta.visaType.trim()
          ? meta.visaType.trim()
          : null,
      cidade:
        typeof meta.cidade === 'string' && meta.cidade.trim()
          ? meta.cidade.trim()
          : null,
      cidadePlanoB:
        typeof meta.cidadePlanoB === 'string' && meta.cidadePlanoB.trim()
          ? meta.cidadePlanoB.trim()
          : null,
      agregadoFamiliar:
        typeof meta.agregadoFamiliar === 'string' && meta.agregadoFamiliar.trim()
          ? meta.agregadoFamiliar.trim()
          : null,
      numQuartos:
        typeof meta.numQuartos === 'string' && meta.numQuartos.trim()
          ? meta.numQuartos.trim()
          : null,
      profissoesPossiveis: Array.isArray(meta.profissoesPossiveis)
        ? meta.profissoesPossiveis.filter(
            (value): value is string => typeof value === 'string' && value.trim().length > 0,
          )
        : [],
      precisaCarro:
        typeof meta.precisaCarro === 'boolean' || meta.precisaCarro === null
          ? meta.precisaCarro
          : null,
      dataViagem:
        typeof meta.dataViagem === 'string' && meta.dataViagem.trim()
          ? meta.dataViagem.trim()
          : null,
      dataAima:
        typeof meta.dataAima === 'string' && meta.dataAima.trim()
          ? meta.dataAima.trim()
          : null,
      notas:
        typeof meta.notas === 'string' && meta.notas.trim()
          ? meta.notas.trim()
          : null,
    };

    const hasAnyAnswer = Object.values(answers).some((value) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== null;
    });

    if (!hasAnyAnswer) return null;

    return answers;
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
    const normalizedWhatsapp = this.normalizeWhatsapp(dto.whatsapp);

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    try {
      const user = await this.prisma.user.create({
        data: {
          email: null,
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
      // WhatsApp é único em User. Se já existir, devolve uma mensagem clara.
      if (error?.code === 'P2002') {
        throw new ConflictException('Já existe um usuário com este WhatsApp.');
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
            logoUrl: true,
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
          shortDescription: dto.shortDescription,
          fullDescription: dto.fullDescription,
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
          shortDescription: dto.shortDescription ?? existing.shortDescription,
          fullDescription: dto.fullDescription ?? existing.fullDescription,
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
      include: {
        category: { select: { id: true, slug: true, name: true } },
      },
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

    const nameToSet =
      dto.name !== undefined && dto.name !== null
        ? dto.name.trim()
        : undefined;
    if (nameToSet !== undefined && !nameToSet) {
      throw new BadRequestException('O nome da empresa não pode ser vazio.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
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
        },
        include: {
          category: { select: { id: true, slug: true, name: true } },
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

  /** Parceiros de casas/relocation: categoria obrigatória e slug relocation. */
  private async getRelocationPartnerOrThrow(userId: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { userId },
      include: { category: { select: { id: true, slug: true, name: true } } },
    });

    if (!partner) {
      throw new NotFoundException('Parceiro não encontrado para este usuário.');
    }

    if (partner.category?.slug !== RELOCATION_CATEGORY_SLUG) {
      throw new ForbiddenException(
        'Apenas parceiros na categoria Relocation podem gerir anúncios de imóveis.',
      );
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

    const leads = await this.prisma.lead.findMany({
      where: {
        partnerId: partner.id,
        user: {
          role: { notIn: [Role.PARTNER, Role.ADMIN] },
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            whatsapp: true,
            tier: true,
            immigrationChecklist: {
              select: {
                data: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });

    return leads.map((lead) => {
      const answers = this.extractImmigrationPlanAnswers(lead.user.immigrationChecklist?.data);

      return {
        id: lead.id,
        createdAt: lead.createdAt,
        user: {
          id: lead.user.id,
          name: lead.user.name,
          email: lead.user.email,
          whatsapp: lead.user.whatsapp,
          tier: lead.user.tier,
        },
        immigrationPlan:
          answers && lead.user.immigrationChecklist?.updatedAt
            ? {
                updatedAt: lead.user.immigrationChecklist.updatedAt,
                answers,
              }
            : null,
      };
    });
  }

  async listMySales(userId: string) {
    const partner = await this.getPartnerForUserOrThrow(userId);
    return this.prisma.partnerSale.findMany({
      where: { partnerId: partner.id },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, whatsapp: true, tier: true } },
        service: { select: { id: true, title: true, rpmCommissionEur: true } },
      },
    });
  }

  private get housesGroupJid(): string {
    return (
      process.env.EVOLUTION_HOUSES_RELOCATION_GROUP_JID ||
      process.env.EVOLUTION_HOUSES_GROUP_JID ||
      ''
    ).trim();
  }

  private get frontendBaseUrl(): string {
    return (
      process.env.FRONTEND_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      'https://comunidade.rafaapelomundo.com'
    ).replace(/\/$/, '');
  }

  /** Página pública do anúncio (detalhes + parceiro); pré-visualização WhatsApp usa OG desta URL, não a imagem genérica da comunidade. */
  private buildHousePublicPageLink(houseId: string): string {
    return `${this.frontendBaseUrl}/casas/${houseId}`;
  }

  /**
   * URL absoluta acessível pela Evolution (GET) para enviar media sem base64 no JSON.
   * Caminhos `/uploads/...` usam PUBLIC_API_BASE_URL ou NEXT_PUBLIC_API_URL.
   */
  private resolvePublicMediaUrlForEvolution(publicUrl: string): string | null {
    const u = (publicUrl || '').trim();
    if (!u) return null;
    if (u.startsWith('https://') || u.startsWith('http://')) {
      return u;
    }
    const base = (
      process.env.PUBLIC_API_BASE_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      ''
    ).replace(/\/$/, '');
    if (!base) {
      return null;
    }
    return u.startsWith('/') ? `${base}${u}` : `${base}/${u}`;
  }

  private formatHouseEntradaLine(caucoes: number, rendas: number): string {
    const c = caucoes === 1 ? '1 caução' : `${caucoes} cauções`;
    const r = rendas === 1 ? '1 renda antecipada' : `${rendas} rendas antecipadas`;
    return `${c} + ${r}`;
  }

  private formatHousePostText(params: {
    houseId: string;
    partnerId: string;
    title: string;
    description: string;
    city: string;
    typology: string;
    availableFrom: Date;
    priceEur: string;
    caucoesCount: number;
    rendasEntradaCount: number;
    relocationFeeEur: string;
    furnished: boolean;
    /** Vídeo não foi anexado no grupo (Evolution/WhatsApp ou limites de envio). */
    videoNotAttachedToGroup?: boolean;
  }): string {
    const datePt = params.availableFrom.toLocaleDateString('pt-PT');
    const typologyLabel = this.formatHouseTypologyLabel(params.typology);
    const cityLabel = this.formatHouseCityLabel(params.city);
    const housePageUrl = this.buildHousePublicPageLink(params.houseId);
    const entrada = this.formatHouseEntradaLine(params.caucoesCount, params.rendasEntradaCount);
    const fee = params.relocationFeeEur.trim();
    const mobilado = params.furnished ? 'Sim' : 'Não';
    const lines = [
      `🏠 *${params.title.trim()}*`,
      ``,
      `📍 *Cidade:* ${cityLabel}`,
      `🏘️ *Tipologia:* ${typologyLabel}`,
      `🛋️ *Mobilado:* ${mobilado}`,
      `📅 *Disponível em:* ${datePt}`,
      `💶 *Renda:* ${params.priceEur.trim()} / mês`,
      `🧾 *Entrada (taxa relocation, cauções e rendas antecipadas):*`,
      `• Taxa relocation: ${fee} €`,
      `• Cauções e rendas: ${entrada}`,
    ];
    lines.push(
      ``,
      `📝 *Descrição:*`,
      params.description.trim(),
      ``,
      `🔗 *Página do anúncio (Comunidade RPM):*`,
      housePageUrl,
    );
    if (params.videoNotAttachedToGroup) {
      lines.push(
        ``,
        `ℹ️ _O vídeo não foi anexado nesta mensagem (o envio pelo WhatsApp passa pela Evolution e tem limites variáveis). Vê o anúncio completo, com vídeo, na página acima._`,
      );
    }
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

  /**
   * Página pública do anúncio: imóvel relocation + dados mínimos do parceiro (nome, logo, categoria).
   */
  async getPublicHousePage(houseId: string) {
    const cat = await this.prisma.productCategory.findUnique({
      where: { slug: RELOCATION_CATEGORY_SLUG },
      select: { id: true },
    });
    if (!cat) {
      throw new NotFoundException('Imóvel não encontrado.');
    }

    const house = await this.prisma.partnerHouse.findFirst({
      where: {
        id: houseId,
        partner: { categoryId: cat.id },
      },
      include: {
        partner: {
          select: {
            id: true,
            name: true,
            whatsapp: true,
            logoUrl: true,
            category: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    });

    if (!house) {
      throw new NotFoundException('Imóvel não encontrado.');
    }

    return house;
  }

  /** Qualquer utilizador autenticado: dados mínimos para contacto e verificação de disponibilidade. */
  async getHouseListingForContact(houseId: string) {
    const row = await this.prisma.partnerHouse.findUnique({
      where: { id: houseId },
      select: {
        id: true,
        status: true,
        title: true,
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
    return row;
  }

  async createMyHousePost(
    userId: string,
    dto: CreatePartnerHouseDto,
    imageFiles: Express.Multer.File[],
    videoFile: Express.Multer.File | null,
  ) {
    const partner = await this.getRelocationPartnerOrThrow(userId);
    if (!this.housesGroupJid) {
      throw new BadRequestException(
        'EVOLUTION_HOUSES_RELOCATION_GROUP_JID não configurado no backend.',
      );
    }

    const images = (imageFiles ?? []).filter((f) => !!f);
    const hasVideo = !!videoFile;
    if (hasVideo && images.length > 0) {
      throw new BadRequestException(
        'Envia só um vídeo ou só imagens (até 6), não ambos.',
      );
    }
    if (!hasVideo && images.length === 0) {
      throw new BadRequestException('Envia pelo menos 1 imagem ou 1 vídeo.');
    }
    if (!hasVideo && images.length > 6) {
      throw new BadRequestException('Podes enviar no máximo 6 imagens.');
    }

    const availableFrom = new Date(dto.availableFrom);
    if (Number.isNaN(availableFrom.getTime())) {
      throw new BadRequestException('Data "Disponível em" inválida.');
    }

    let imageUrls: string[] = [];
    let videoUrl: string | null = null;

    const processedImages: {
      publicUrl: string;
      waBase64: string;
      waMimeType: string;
      waFileName: string;
      mediaType: 'image';
    }[] = [];

    let processedVideo: {
      publicUrl: string;
      waBase64: string;
      waMimeType: string;
      waFileName: string;
      mediaType: 'video';
    } | null = null;

    if (hasVideo && videoFile) {
      try {
        const v = await this.houseImages.storeHouseVideo(videoFile);
        videoUrl = v.publicUrl;
        processedVideo = {
          publicUrl: v.publicUrl,
          waBase64: v.waBase64,
          waMimeType: v.waMimeType,
          waFileName: v.waFileName,
          mediaType: 'video',
        };
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
    } else {
      for (const file of images) {
        try {
          const { publicUrl, waBase64, waMimeType } =
            await this.houseImages.processHouseImageForListing(file);
          const baseName = (file.originalname || 'imagem').replace(/\.[^.]+$/, '');
          processedImages.push({
            publicUrl,
            waBase64,
            waMimeType,
            waFileName: `${baseName}.webp`,
            mediaType: 'image',
          });
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
      imageUrls = processedImages.map((p) => p.publicUrl);
    }

    const caucoesCount = Math.min(12, Math.max(0, parseInt(dto.caucoesCount, 10)));
    const rendasEntradaCount = Math.min(12, Math.max(0, parseInt(dto.rendasEntradaCount, 10)));

    const furnished = dto.furnished === 'true';

    const created = await this.prisma.partnerHouse.create({
      data: {
        partnerId: partner.id,
        title: dto.title.trim(),
        description: dto.description.trim(),
        typology: dto.typology,
        city: dto.city,
        availableFrom,
        priceEur: dto.priceEur.trim(),
        relocationFeeEur: dto.relocationFeeEur.trim(),
        caucoesCount,
        rendasEntradaCount,
        furnished,
        status: 'AVAILABLE',
        imageUrls,
        videoUrl,
      },
    });

    let videoSkippedForWhatsapp = false;

    try {
      if (processedVideo) {
        const videoBytes = Math.floor((processedVideo.waBase64.length * 3) / 4);
        if (videoBytes > WHATSAPP_VIDEO_MAX_BYTES) {
          const mb = (videoBytes / 1024 / 1024).toFixed(1);
          const detail = `O vídeo tem cerca de ${mb} MB; o WhatsApp aceita no máximo ~16 MB. Comprime ou recorta o ficheiro e tenta outra vez.`;
          await this.prisma.partnerHouse.update({
            where: { id: created.id },
            data: { whatsappError: detail },
          });
          throw new BadRequestException(detail);
        }

        const absVideoUrl = this.resolvePublicMediaUrlForEvolution(
          processedVideo.publicUrl,
        );
        let videoSentToGroup = false;

        const sendHouseVideoMedia = (opts: {
          mediaUrl?: string;
          base64?: string;
          mediaType: 'video' | 'document';
        }) =>
          this.wa.sendMedia({
            to: this.housesGroupJid,
            caption: '',
            mediaUrl: opts.mediaUrl,
            base64: opts.base64,
            mimeType: processedVideo.waMimeType,
            fileName: processedVideo.waFileName,
            mediaType: opts.mediaType,
            requireDelivery: true,
          });

        const trySendVideoToGroup = async (label: string, fn: () => Promise<void>) => {
          try {
            await fn();
            return true;
          } catch (err: unknown) {
            const msg =
              err && typeof err === 'object' && 'message' in err
                ? String((err as { message?: string }).message)
                : '';
            if (isEvolutionMediaFatalError(msg)) {
              throw err;
            }
            this.logger.warn(
              `WhatsApp envio vídeo (${label}) falhou; a tentar outro modo. ${msg.slice(0, 400)}`,
            );
            return false;
          }
        };

        if (absVideoUrl) {
          const urlChain: Array<{ label: string; fn: () => Promise<void> }> = [
            {
              label: 'sendVideo+URL',
              fn: () =>
                this.wa.sendVideo({
                  to: this.housesGroupJid,
                  caption: '',
                  mediaUrl: absVideoUrl,
                  mimeType: processedVideo.waMimeType,
                  requireDelivery: true,
                }),
            },
            {
              label: 'sendMedia+video+URL',
              fn: () =>
                sendHouseVideoMedia({
                  mediaUrl: absVideoUrl,
                  mediaType: 'video',
                }),
            },
            {
              label: 'sendMedia+document+URL',
              fn: () =>
                sendHouseVideoMedia({
                  mediaUrl: absVideoUrl,
                  mediaType: 'document',
                }),
            },
          ];
          for (const step of urlChain) {
            if (await trySendVideoToGroup(step.label, step.fn)) {
              videoSentToGroup = true;
              break;
            }
          }
        }

        if (!videoSentToGroup) {
          const maxB64 = evolutionMaxMediaBase64Chars();
          if (processedVideo.waBase64.length > maxB64) {
            this.logger.warn(
              `Vídeo omitido no WhatsApp: base64 (${processedVideo.waBase64.length} chars) > EVOLUTION_MAX_MEDIA_BASE64_CHARS (${maxB64}).`,
            );
            videoSkippedForWhatsapp = true;
          } else {
            let lastBase64Err = '';
            const b64 = processedVideo.waBase64;
            const baseChain: Array<{ label: string; fn: () => Promise<void> }> = [
              {
                label: 'sendVideo+base64(data:…)',
                fn: () =>
                  this.wa.sendVideo({
                    to: this.housesGroupJid,
                    caption: '',
                    base64: b64,
                    mimeType: processedVideo.waMimeType,
                    requireDelivery: true,
                  }),
              },
              {
                label: 'sendMedia+video+base64',
                fn: () =>
                  sendHouseVideoMedia({ base64: b64, mediaType: 'video' }),
              },
              {
                label: 'sendMedia+document+base64',
                fn: () =>
                  sendHouseVideoMedia({ base64: b64, mediaType: 'document' }),
              },
            ];
            for (const step of baseChain) {
              try {
                await step.fn();
                videoSentToGroup = true;
                break;
              } catch (mediaErr: unknown) {
                const mediaMsg =
                  mediaErr &&
                  typeof mediaErr === 'object' &&
                  'message' in mediaErr
                    ? String((mediaErr as { message?: string }).message)
                    : '';
                lastBase64Err = mediaMsg;
                if (isEvolutionMediaFatalError(mediaMsg)) {
                  throw mediaErr;
                }
                this.logger.warn(
                  `WhatsApp vídeo (${step.label}) falhou. ${mediaMsg.slice(0, 400)}`,
                );
              }
            }
            if (!videoSentToGroup) {
              if (
                lastBase64Err &&
                isEvolutionVideoSendSkippableError(lastBase64Err)
              ) {
                this.logger.warn(
                  `Evolution/WhatsApp não aceitou o vídeo. A enviar só o texto do anúncio. ${lastBase64Err.slice(0, 400)}`,
                );
                videoSkippedForWhatsapp = true;
              } else if (lastBase64Err) {
                throw new Error(lastBase64Err);
              } else {
                videoSkippedForWhatsapp = true;
              }
            }
          }
        }
      } else {
        for (const p of processedImages) {
          await this.wa.sendMedia({
            to: this.housesGroupJid,
            caption: '',
            base64: p.waBase64,
            mimeType: p.waMimeType,
            fileName: p.waFileName,
            mediaType: 'image',
            requireDelivery: true,
          });
        }
      }

      const text = this.formatHousePostText({
        houseId: created.id,
        partnerId: partner.id,
        title: dto.title,
        description: dto.description,
        city: dto.city,
        typology: dto.typology,
        availableFrom,
        priceEur: dto.priceEur,
        caucoesCount,
        rendasEntradaCount,
        relocationFeeEur: dto.relocationFeeEur,
        furnished,
        videoNotAttachedToGroup:
          Boolean(processedVideo) && videoSkippedForWhatsapp,
      });
      await this.wa.sendText(this.housesGroupJid, text, { requireDelivery: true });

      await this.prisma.partnerHouse.update({
        where: { id: created.id },
        data: {
          whatsappSentAt: new Date(),
          whatsappError: null,
        },
      });
      if (videoSkippedForWhatsapp) {
        this.logger.warn(
          `Post ${created.id}: texto enviado ao grupo WhatsApp; vídeo omitido (URL falhou + 413/base64 ou EVOLUTION_MAX_MEDIA_BASE64_CHARS).`,
        );
      }
    } catch (err: unknown) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: string }).message)
          : 'Falha ao enviar no WhatsApp.';
      await this.prisma.partnerHouse.update({
        where: { id: created.id },
        data: { whatsappError: message },
      });
      this.logger.error(
        `Falha ao enviar post de imóvel ${created.id} para o WhatsApp: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      const safeDetail =
        message.length > 1500 ? `${message.slice(0, 1500)}…` : message;
      throw new HttpException(
        `Não foi possível enviar o post no WhatsApp. Detalhes: ${safeDetail}`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return created;
  }

  private async removeHouseMediaFiles(house: {
    imageUrls: string[];
    videoUrl: string | null;
  }) {
    for (const u of house.imageUrls ?? []) {
      await this.houseImages.deleteStoredUrl(u);
    }
    await this.houseImages.deleteStoredUrl(house.videoUrl);
  }

  /** Listagem pública: relocation — disponíveis primeiro; depois por data de disponibilidade mais futura. */
  async listPublicRelocationHouses() {
    const cat = await this.prisma.productCategory.findUnique({
      where: { slug: RELOCATION_CATEGORY_SLUG },
      select: { id: true },
    });
    if (!cat) {
      return [];
    }

    return this.prisma.partnerHouse.findMany({
      where: {
        partner: { categoryId: cat.id },
      },
      orderBy: [{ status: 'asc' }, { availableFrom: 'desc' }],
      select: {
        id: true,
        title: true,
        description: true,
        typology: true,
        city: true,
        availableFrom: true,
        priceEur: true,
        relocationFeeEur: true,
        caucoesCount: true,
        rendasEntradaCount: true,
        furnished: true,
        imageUrls: true,
        videoUrl: true,
        partnerId: true,
        status: true,
        partner: {
          select: {
            id: true,
            name: true,
            whatsapp: true,
            logoUrl: true,
            shortDescription: true,
          },
        },
      },
    });
  }

  async adminListAllHouses() {
    return this.prisma.partnerHouse.findMany({
      orderBy: [{ createdAt: 'desc' }],
      include: {
        partner: {
          select: {
            id: true,
            name: true,
            category: { select: { slug: true, name: true } },
          },
        },
      },
    });
  }

  async adminDeleteHouse(houseId: string) {
    const house = await this.prisma.partnerHouse.findUnique({
      where: { id: houseId },
      select: { id: true, imageUrls: true, videoUrl: true },
    });
    if (!house) {
      throw new NotFoundException('Imóvel não encontrado.');
    }
    await this.removeHouseMediaFiles(house);
    await this.prisma.partnerHouse.delete({ where: { id: houseId } });
    return { ok: true as const };
  }

  /** Anúncios indisponíveis com data de disponibilidade há pelo menos 2 meses — remove registo e médias. */
  async purgeStaleUnavailableHouses(): Promise<{ deleted: number }> {
    const threshold = new Date();
    threshold.setMonth(threshold.getMonth() - 2);
    const stale = await this.prisma.partnerHouse.findMany({
      where: {
        status: 'UNAVAILABLE',
        availableFrom: { lte: threshold },
      },
      select: { id: true, imageUrls: true, videoUrl: true },
    });
    for (const h of stale) {
      await this.removeHouseMediaFiles(h);
      await this.prisma.partnerHouse.delete({ where: { id: h.id } });
    }
    return { deleted: stale.length };
  }

  async listMyHouses(userId: string) {
    const partner = await this.getRelocationPartnerOrThrow(userId);
    return this.prisma.partnerHouse.findMany({
      where: { partnerId: partner.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateMyHouseStatus(userId: string, houseId: string, status: 'AVAILABLE' | 'UNAVAILABLE') {
    const partner = await this.getRelocationPartnerOrThrow(userId);
    const exists = await this.prisma.partnerHouse.findFirst({
      where: { id: houseId, partnerId: partner.id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Imóvel não encontrado.');
    return this.prisma.partnerHouse.update({
      where: { id: houseId },
      data: { status } as any,
    });
  }

  async createMySale(userId: string, dto: CreatePartnerSaleDto) {
    const partner = await this.getPartnerForUserOrThrow(userId);

    // valida lead pertence ao parceiro
    const lead = await this.prisma.lead.findUnique({
      where: {
        lead_partner_user_unique: { partnerId: partner.id, userId: dto.leadUserId },
      },
      select: { id: true },
    });
    if (!lead) {
      throw new BadRequestException('Lead inválido para este parceiro.');
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
        user: { select: { id: true, name: true, whatsapp: true, tier: true } },
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

