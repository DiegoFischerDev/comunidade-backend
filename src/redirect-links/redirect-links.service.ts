import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  PartnerHouseBusinessType,
  Prisma,
  RedirectClickKind,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getFrontendBaseUrl } from '../config/frontend-base-url';
import { HouseImageStorageService } from '../partner/house-image-storage.service';
import { CreatePartnerShareLinkDto } from './dto/create-partner-share-link.dto';
import { UpdatePartnerShareLinkDto } from './dto/update-partner-share-link.dto';

function normalizeWhatsappDigits(raw: string): string {
  return String(raw ?? '')
    .replace(/\D/g, '')
    .replace(/^0+/, '');
}

export function buildWhatsAppUrl(digits: string, text: string): string {
  const d = normalizeWhatsappDigits(digits);
  const q = encodeURIComponent(text);
  return `https://wa.me/${d}?text=${q}`;
}

function parseDestinationUrl(raw: string): string {
  const t = raw.trim();
  if (!t) {
    throw new BadRequestException('Indica a URL de destino.');
  }
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    throw new BadRequestException('URL de destino inválida.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException(
      'A URL deve começar por http:// ou https://',
    );
  }
  return url.toString();
}

function shareLinkExitUrl(link: {
  destinationUrl: string | null;
  whatsappDigits: string;
  whatsappPhrase: string;
}): string {
  const dest = link.destinationUrl?.trim();
  if (dest) return dest;
  return buildWhatsAppUrl(link.whatsappDigits, link.whatsappPhrase);
}

function mapShareLinkResponse(
  link: {
    id: string;
    slug: string;
    title: string;
    whatsappDigits: string;
    whatsappPhrase: string;
    destinationUrl: string | null;
    ogImageUrl: string | null;
    createdAt: Date;
  },
  frontend: string,
) {
  return {
    id: link.id,
    slug: link.slug,
    title: link.title,
    whatsappDigits: link.whatsappDigits,
    whatsappPhrase: link.whatsappPhrase,
    destinationUrl: link.destinationUrl,
    ogImageUrl: link.ogImageUrl,
    createdAt: link.createdAt.toISOString(),
    entryUrl: `${frontend}/whatsapp?t=${encodeURIComponent(link.slug)}`,
    exitUrlPreview: shareLinkExitUrl(link),
  };
}

function slugifyTitle(title: string): string {
  const t = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return t;
}

/** URL de listagem / pré-visualização: capa, primeira foto ou poster do vídeo. */
function partnerHousePreviewImageUrl(h: {
  coverImageUrl: string | null;
  imageUrls: string[];
  videoPosterUrl: string | null;
}): string | null {
  const cover = h.coverImageUrl?.trim();
  if (cover) return cover;
  const first = h.imageUrls.find((u) => (u ?? '').trim());
  if (first) return first.trim();
  const poster = h.videoPosterUrl?.trim();
  if (poster) return poster;
  return null;
}

const HOUSE_TYPOLOGY_LABELS: Record<string, string> = {
  T0: 'T0',
  T1: 'T1',
  T2: 'T2',
  T3: 'T3',
  T4: 'T4',
  T5: 'T5',
  QUARTO_AP_COMPARTILHADO: 'Quarto em Ap compartilhado',
};

function formatHouseLeadPrice(
  priceEur: string,
  businessType: PartnerHouseBusinessType,
): string {
  const t = priceEur
    .trim()
    .replace(/\s*€\s*$/i, '')
    .replace(/\s*\/\s*m[eê]s?\s*$/i, '')
    .trim();
  return businessType === PartnerHouseBusinessType.SALE
    ? `${t} €`
    : `${t} € / mês`;
}

/**
 * Mensagem pré-preenchida ao abrir o WhatsApp do parceiro.
 * Tem de incluir `tenho interesse no imovel <houseId>` (com dígitos) para o Evolution +
 * `extractHouseIdFromHouseInterestMessage` identificarem o anúncio.
 */
export function houseLeadWhatsAppMessage(params: {
  houseId: number;
  typology: string;
  city: string;
  priceEur: string;
  businessType: PartnerHouseBusinessType;
}): string {
  const typ =
    HOUSE_TYPOLOGY_LABELS[params.typology] ?? params.typology.trim();
  const city = params.city.trim();
  const price = formatHouseLeadPrice(params.priceEur, params.businessType);
  const id = params.houseId;
  return `Ola, vim pela Rafa e tenho interesse no imovel ${id} (${typ} disponível em ${city} por ${price})`;
}

@Injectable()
export class RedirectLinksService {
  private readonly logger = new Logger(RedirectLinksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly houseImageStorage: HouseImageStorageService,
  ) {}

  /**
   * Filtro opcional por intervalo de datas (UTC) em `clickedAt`.
   * Ambas vazias = sem filtro (totais desde sempre).
   */
  private parseOptionalDateRange(
    from?: string,
    to?: string,
  ): { gte: Date; lte: Date } | null {
    const f = (from ?? '').trim();
    const t = (to ?? '').trim();
    if (!f && !t) return null;
    if (!f || !t) {
      throw new BadRequestException(
        'Indica data inicial e final do período, ou deixa ambas vazias para todo o período.',
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t)) {
      throw new BadRequestException('Formato de data inválido (use AAAA-MM-DD).');
    }
    const gte = new Date(`${f}T00:00:00.000Z`);
    const lte = new Date(`${t}T23:59:59.999Z`);
    if (Number.isNaN(gte.getTime()) || Number.isNaN(lte.getTime())) {
      throw new BadRequestException('Datas inválidas.');
    }
    if (gte > lte) {
      throw new BadRequestException(
        'A data inicial deve ser anterior ou igual à final.',
      );
    }
    return { gte, lte };
  }

  async createPartnerShareLink(dto: CreatePartnerShareLinkDto) {
    const destRaw = dto.destinationUrl?.trim();
    const isUrlLink = Boolean(destRaw);
    let destinationUrl: string | null = null;
    let digits = '';
    let phrase = '';

    if (isUrlLink) {
      destinationUrl = parseDestinationUrl(destRaw!);
    } else {
      digits = normalizeWhatsappDigits(dto.whatsapp ?? '');
      if (digits.length < 9) {
        throw new BadRequestException(
          'Número de WhatsApp inválido (precisa de pelo menos 9 dígitos).',
        );
      }
      phrase = (dto.whatsappPhrase ?? '').trim();
      if (!phrase) {
        throw new BadRequestException('Indica a frase para o WhatsApp.');
      }
    }

    let base = slugifyTitle(dto.title);
    if (!base) base = 'link';
    let slug = base;
    for (let attempt = 0; attempt < 24; attempt++) {
      const clash = await this.prisma.partnerShareLink.findUnique({
        where: { slug },
      });
      if (!clash) break;
      slug = `${base}-${randomBytes(3).toString('hex')}`;
    }
    const stillClash = await this.prisma.partnerShareLink.findUnique({
      where: { slug },
    });
    if (stillClash) {
      throw new BadRequestException(
        'Não foi possível gerar um identificador único para o link. Tenta outro título.',
      );
    }

    const created = await this.prisma.partnerShareLink.create({
      data: {
        slug,
        title: dto.title.trim(),
        whatsappDigits: digits,
        whatsappPhrase: phrase,
        destinationUrl,
      },
    });

    const frontend = getFrontendBaseUrl();
    return mapShareLinkResponse(created, frontend);
  }

  async adminUpdatePartnerShareLink(id: string, dto: UpdatePartnerShareLinkDto) {
    const hasAny =
      dto.title !== undefined ||
      dto.whatsapp !== undefined ||
      dto.whatsappPhrase !== undefined ||
      dto.destinationUrl !== undefined;
    if (!hasAny) {
      throw new BadRequestException('Envia pelo menos um campo para atualizar.');
    }

    const existing = await this.prisma.partnerShareLink.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Link não encontrado.');
    }

    const data: Prisma.PartnerShareLinkUpdateInput = {};
    if (dto.title !== undefined) {
      const t = dto.title.trim();
      if (!t) {
        throw new BadRequestException('Indica um título.');
      }
      data.title = t;
    }

    if (dto.destinationUrl !== undefined) {
      const destRaw = dto.destinationUrl.trim();
      if (destRaw) {
        data.destinationUrl = parseDestinationUrl(destRaw);
        data.whatsappDigits = '';
        data.whatsappPhrase = '';
      } else {
        data.destinationUrl = null;
      }
    }

    const switchingToWhatsapp =
      dto.destinationUrl !== undefined && !dto.destinationUrl.trim();

    if (dto.whatsapp !== undefined || switchingToWhatsapp) {
      const digits = normalizeWhatsappDigits(
        dto.whatsapp ?? existing.whatsappDigits,
      );
      if (digits.length < 9) {
        throw new BadRequestException(
          'Número de WhatsApp inválido (precisa de pelo menos 9 dígitos).',
        );
      }
      data.whatsappDigits = digits;
      data.destinationUrl = null;
    }
    if (dto.whatsappPhrase !== undefined || switchingToWhatsapp) {
      const p = (dto.whatsappPhrase ?? existing.whatsappPhrase).trim();
      if (!p) {
        throw new BadRequestException('Indica a frase para o WhatsApp.');
      }
      data.whatsappPhrase = p;
    }

    const updated = await this.prisma.partnerShareLink.update({
      where: { id },
      data,
    });

    const frontend = getFrontendBaseUrl();
    return mapShareLinkResponse(updated, frontend);
  }

  /** Remove o link; eventos em `redirect_click_events` apagam-se por FK CASCADE. */
  async adminDeletePartnerShareLink(id: string): Promise<{ ok: true }> {
    const row = await this.prisma.partnerShareLink.findUnique({
      where: { id },
      select: { ogImageUrl: true },
    });
    if (!row) {
      throw new NotFoundException('Link não encontrado.');
    }
    if (row.ogImageUrl) {
      await this.houseImageStorage.deleteStoredUrl(row.ogImageUrl);
    }
    try {
      await this.prisma.partnerShareLink.delete({ where: { id } });
    } catch (e: unknown) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2025'
      ) {
        throw new NotFoundException('Link não encontrado.');
      }
      throw e;
    }
    return { ok: true };
  }

  async adminClickHistory(params: {
    kind?: RedirectClickKind;
    /** Se definido, lista só cliques deste link personalizado (ignora `kind`). */
    partnerShareLinkId?: string;
    /** Intervalo opcional em `clickedAt` (AAAA-MM-DD, UTC); ambas vazias = sem filtro. */
    from?: string;
    to?: string;
    limit: number;
    offset: number;
  }) {
    const take = Math.min(Math.max(params.limit, 1), 200);
    const skip = Math.max(params.offset, 0);
    const range = this.parseOptionalDateRange(params.from, params.to);

    let where: Prisma.RedirectClickEventWhereInput = {};
    if (params.partnerShareLinkId) {
      where = {
        kind: RedirectClickKind.CUSTOM_LINK,
        partnerShareLinkId: params.partnerShareLinkId,
      };
    } else if (params.kind != null) {
      where = { kind: params.kind };
    }
    if (range) {
      where = {
        ...where,
        clickedAt: { gte: range.gte, lte: range.lte },
      };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.redirectClickEvent.findMany({
        where,
        orderBy: { clickedAt: 'desc' },
        skip,
        take,
        include: {
          partnerShareLink: {
            select: { id: true, title: true, slug: true },
          },
          partnerHouse: {
            select: {
              id: true,
              houseId: true,
              title: true,
              partner: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.redirectClickEvent.count({ where }),
    ]);

    const items = rows.map((e) => ({
      id: e.id,
      kind: e.kind as 'CUSTOM_LINK' | 'HOUSE',
      clickedAt: e.clickedAt.toISOString(),
      visitorKey: e.visitorKey,
      visitorCountryCode: e.visitorCountryCode,
      customLink: e.partnerShareLink
        ? {
            id: e.partnerShareLink.id,
            title: e.partnerShareLink.title,
            slug: e.partnerShareLink.slug,
          }
        : null,
      house: e.partnerHouse
        ? {
            id: e.partnerHouse.id,
            houseId: e.partnerHouse.houseId,
            title: e.partnerHouse.title,
            partnerName: e.partnerHouse.partner.name,
          }
        : null,
    }));

    return {
      items,
      total,
      limit: take,
      offset: skip,
      hasMore: skip + items.length < total,
    };
  }

  /** Metadados de um link personalizado (admin). */
  async adminGetPartnerShareLink(id: string) {
    const link = await this.prisma.partnerShareLink.findUnique({
      where: { id },
    });
    if (!link) {
      throw new NotFoundException('Link não encontrado.');
    }
    const frontend = getFrontendBaseUrl();
    return {
      id: link.id,
      title: link.title,
      slug: link.slug,
      ogImageUrl: link.ogImageUrl,
      entryUrl: `${frontend}/whatsapp?t=${encodeURIComponent(link.slug)}`,
    };
  }

  async adminUploadPartnerShareOgImage(
    id: string,
    file: Express.Multer.File | undefined,
  ): Promise<{ ogImageUrl: string }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Ficheiro de imagem em falta.');
    }
    const existing = await this.prisma.partnerShareLink.findUnique({
      where: { id },
      select: { ogImageUrl: true },
    });
    if (!existing) {
      throw new NotFoundException('Link não encontrado.');
    }
    let publicUrl: string;
    try {
      ({ publicUrl } =
        await this.houseImageStorage.processShareLinkOgImage(file));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao processar imagem.';
      throw new BadRequestException(msg);
    }
    if (existing.ogImageUrl) {
      await this.houseImageStorage.deleteStoredUrl(existing.ogImageUrl);
    }
    const updated = await this.prisma.partnerShareLink.update({
      where: { id },
      data: { ogImageUrl: publicUrl },
      select: { ogImageUrl: true },
    });
    return { ogImageUrl: updated.ogImageUrl! };
  }

  async adminDeletePartnerShareOgImage(
    id: string,
  ): Promise<{ ok: true; ogImageUrl: null }> {
    const row = await this.prisma.partnerShareLink.findUnique({
      where: { id },
      select: { ogImageUrl: true },
    });
    if (!row) {
      throw new NotFoundException('Link não encontrado.');
    }
    if (row.ogImageUrl) {
      await this.houseImageStorage.deleteStoredUrl(row.ogImageUrl);
    }
    await this.prisma.partnerShareLink.update({
      where: { id },
      data: { ogImageUrl: null },
    });
    return { ok: true, ogImageUrl: null };
  }

  /** Apaga todos os eventos de clique deste link (o link em si mantém-se). */
  async adminClearPartnerShareLinkClicks(id: string): Promise<{ deleted: number }> {
    const link = await this.prisma.partnerShareLink.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!link) {
      throw new NotFoundException('Link não encontrado.');
    }
    const res = await this.prisma.redirectClickEvent.deleteMany({
      where: {
        kind: RedirectClickKind.CUSTOM_LINK,
        partnerShareLinkId: id,
      },
    });
    return { deleted: res.count };
  }

  async adminOverview(params?: { from?: string; to?: string }) {
    const frontend = getFrontendBaseUrl();
    const range = this.parseOptionalDateRange(params?.from, params?.to);

    let customCountMap = new Map<string, number>();
    let houseCountMap = new Map<string, number>();

    if (range) {
      const [customGb, houseGb] = await Promise.all([
        this.prisma.redirectClickEvent.groupBy({
          by: ['partnerShareLinkId'],
          where: {
            kind: RedirectClickKind.CUSTOM_LINK,
            partnerShareLinkId: { not: null },
            clickedAt: { gte: range.gte, lte: range.lte },
          },
          _count: { _all: true },
        }),
        this.prisma.redirectClickEvent.groupBy({
          by: ['partnerHouseId'],
          where: {
            kind: RedirectClickKind.HOUSE,
            partnerHouseId: { not: null },
            clickedAt: { gte: range.gte, lte: range.lte },
          },
          _count: { _all: true },
        }),
      ]);
      for (const row of customGb) {
        if (row.partnerShareLinkId) {
          customCountMap.set(row.partnerShareLinkId, row._count._all);
        }
      }
      for (const row of houseGb) {
        if (row.partnerHouseId) {
          houseCountMap.set(row.partnerHouseId, row._count._all);
        }
      }
    }

    const customRows = await this.prisma.partnerShareLink.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { clicks: true } },
      },
    });

    const customLinks = customRows
      .map((c) => ({
        id: c.id,
        slug: c.slug,
        title: c.title,
        whatsappDigits: c.whatsappDigits,
        whatsappPhrase: c.whatsappPhrase,
        destinationUrl: c.destinationUrl,
        ogImageUrl: c.ogImageUrl,
        clickCount: range
          ? (customCountMap.get(c.id) ?? 0)
          : c._count.clicks,
        createdAt: c.createdAt.toISOString(),
        entryUrl: `${frontend}/whatsapp?t=${encodeURIComponent(c.slug)}`,
        exitUrlPreview: shareLinkExitUrl(c),
      }))
      .sort((a, b) => b.clickCount - a.clickCount);

    const houseRows = await this.prisma.partnerHouse.findMany({
      orderBy: { createdAt: 'desc' },
      take: 1000,
      select: {
        id: true,
        houseId: true,
        title: true,
        typology: true,
        city: true,
        priceEur: true,
        businessType: true,
        coverImageUrl: true,
        imageUrls: true,
        videoPosterUrl: true,
        partner: { select: { name: true } },
        _count: { select: { redirectClicks: true } },
      },
    });

    const houseLinks = houseRows
      .map((h) => ({
        id: h.id,
        houseId: h.houseId,
        title: h.title,
        priceEur: h.priceEur,
        partnerName: h.partner.name,
        previewImageUrl: partnerHousePreviewImageUrl(h),
        clickCount: range
          ? (houseCountMap.get(h.id) ?? 0)
          : h._count.redirectClicks,
        entryUrl: `${frontend}/imovel?id=${encodeURIComponent(String(h.houseId))}`,
        messagePreview: houseLeadWhatsAppMessage({
          houseId: h.houseId,
          typology: h.typology,
          city: h.city,
          priceEur: h.priceEur,
          businessType: h.businessType,
        }),
      }))
      .sort((a, b) => b.clickCount - a.clickCount);

    return {
      customLinks,
      houseLinks,
      clickPeriod:
        range != null
          ? {
              from: (params?.from ?? '').trim(),
              to: (params?.to ?? '').trim(),
            }
          : null,
    };
  }

  /** URL wa.me para partilha manual (não regista clique). */
  async getPublicCustomWhatsappTarget(
    slugRaw: string,
  ): Promise<{ whatsappUrl: string } | null> {
    const slug = decodeURIComponent(slugRaw).trim();
    const link = await this.prisma.partnerShareLink.findUnique({
      where: { slug },
    });
    if (!link) return null;
    return {
      whatsappUrl: shareLinkExitUrl(link),
    };
  }

  /** Metadados para Open Graph (WhatsApp, etc.) — sem registo de clique. */
  async getPublicOgMetaBySlug(slugRaw: string): Promise<{
    title: string;
    description: string;
    ogImageUrl: string | null;
  } | null> {
    const slug = decodeURIComponent(slugRaw).trim();
    const link = await this.prisma.partnerShareLink.findUnique({
      where: { slug },
      select: {
        title: true,
        whatsappPhrase: true,
        destinationUrl: true,
        ogImageUrl: true,
      },
    });
    if (!link) return null;
    const title = link.title.trim() || 'WhatsApp';
    const dest = link.destinationUrl?.trim();
    const phrase = link.whatsappPhrase.trim();
    const description = dest
      ? 'Segue o link para continuar.'
      : phrase ||
        'Abre o WhatsApp com a mensagem preparada para contactar o parceiro.';
    const maxDesc = 2000;
    const descriptionClamped =
      description.length > maxDesc
        ? `${description.slice(0, maxDesc - 1)}…`
        : description;
    return { title, description: descriptionClamped, ogImageUrl: link.ogImageUrl };
  }

  async getPublicHouseWhatsappTarget(
    houseKeyRaw: string,
  ): Promise<{ whatsappUrl: string } | null> {
    const key = decodeURIComponent(houseKeyRaw).trim();
    const house = await this.findHouseByPublicKey(key);
    if (!house) return null;
    const digits = normalizeWhatsappDigits(house.partner.whatsapp);
    if (digits.length < 9) return null;
    const text = houseLeadWhatsAppMessage({
      houseId: house.houseId,
      typology: house.typology,
      city: house.city,
      priceEur: house.priceEur,
      businessType: house.businessType,
    });
    return { whatsappUrl: buildWhatsAppUrl(digits, text) };
  }

  /**
   * Regista clique (no máximo uma vez por visitante por link — cookie `rd_vid`) e devolve URL wa.me.
   */
  async resolveCustomRedirect(
    slugRaw: string,
    visitorKey: string,
    visitorCountryCode?: string | null,
  ): Promise<string> {
    const slug = decodeURIComponent(slugRaw).trim();
    const link = await this.prisma.partnerShareLink.findUnique({
      where: { slug },
    });
    if (!link) {
      this.logger.warn(`PartnerShareLink não encontrado: slug=${slug}`);
      return getFrontendBaseUrl();
    }
    await this.tryRecordRedirectClick({
      kind: RedirectClickKind.CUSTOM_LINK,
      visitorKey,
      visitorCountryCode: visitorCountryCode ?? null,
      partnerShareLinkId: link.id,
    });
    return shareLinkExitUrl(link);
  }

  async resolveHouseRedirect(
    houseKeyRaw: string,
    visitorKey: string,
    visitorCountryCode?: string | null,
  ): Promise<string> {
    const key = decodeURIComponent(houseKeyRaw).trim();
    const house = await this.findHouseByPublicKey(key);
    if (!house) {
      this.logger.warn(`PartnerHouse não encontrado: key=${key}`);
      return getFrontendBaseUrl();
    }
    const digits = normalizeWhatsappDigits(house.partner.whatsapp);
    if (digits.length < 9) {
      this.logger.warn(
        `Parceiro sem WhatsApp válido para imóvel ${house.id}`,
      );
      return getFrontendBaseUrl();
    }
    const text = houseLeadWhatsAppMessage({
      houseId: house.houseId,
      typology: house.typology,
      city: house.city,
      priceEur: house.priceEur,
      businessType: house.businessType,
    });
    await this.tryRecordRedirectClick({
      kind: RedirectClickKind.HOUSE,
      visitorKey,
      visitorCountryCode: visitorCountryCode ?? null,
      partnerHouseId: house.id,
    });
    return buildWhatsAppUrl(digits, text);
  }

  /**
   * Insere evento de clique uma vez por (`visitorKey`, link/imóvel). Pedidos em paralelo:
   * índice único parcial + P2002.
   */
  private async tryRecordRedirectClick(params: {
    kind: RedirectClickKind;
    visitorKey: string;
    visitorCountryCode?: string | null;
    partnerShareLinkId?: string;
    partnerHouseId?: string;
  }): Promise<void> {
    try {
      await this.prisma.redirectClickEvent.create({
        data: {
          kind: params.kind,
          visitorKey: params.visitorKey,
          visitorCountryCode: params.visitorCountryCode ?? null,
          partnerShareLinkId: params.partnerShareLinkId,
          partnerHouseId: params.partnerHouseId,
        },
      });
    } catch (e: unknown) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return;
      }
      throw e;
    }
  }

  private async findHouseByPublicKey(key: string) {
    const byId = await this.prisma.partnerHouse.findUnique({
      where: { id: key },
      include: { partner: true },
    });
    if (byId) return byId;
    if (/^\d+$/.test(key)) {
      const n = parseInt(key, 10);
      if (!Number.isNaN(n)) {
        return this.prisma.partnerHouse.findFirst({
          where: { houseId: n },
          include: { partner: true },
        });
      }
    }
    return null;
  }
}
