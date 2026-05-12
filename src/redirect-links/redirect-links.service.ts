import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { RedirectClickKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getFrontendBaseUrl } from '../config/frontend-base-url';
import { CreatePartnerShareLinkDto } from './dto/create-partner-share-link.dto';

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

/** Mensagem padrão para cliques em anúncios de imóvel (WhatsApp do parceiro). */
export function houseLeadWhatsAppMessage(params: {
  title: string;
  priceEur: string;
}): string {
  const title = params.title.trim();
  const price = params.priceEur.trim();
  return `Ola, vim pela Rafa e tenho interesse no imovel ${title} por ${price}`;
}

export function houseInterestTriggerMessage(params: {
  houseId: number;
  title: string;
}): string {
  // IMPORTANTE: precisa conter o gatilho para disparar o flow processHouseInterestInbound.
  return `Tenho interesse no imovel ${params.houseId}, ${params.title.trim()}`;
}

@Injectable()
export class RedirectLinksService {
  private readonly logger = new Logger(RedirectLinksService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Evita contagem duplicada por preview/crawler ou double-open. */
  private async shouldSkipDuplicateClick(params: {
    kind: RedirectClickKind;
    partnerShareLinkId?: string;
    partnerHouseId?: string;
    windowMs?: number;
  }): Promise<boolean> {
    const windowMs = Math.max(params.windowMs ?? 15000, 0);
    if (windowMs === 0) return false;
    const since = new Date(Date.now() - windowMs);
    const where: any = {
      kind: params.kind,
      clickedAt: { gte: since },
    };
    if (params.partnerShareLinkId) {
      where.partnerShareLinkId = params.partnerShareLinkId;
    }
    if (params.partnerHouseId) {
      where.partnerHouseId = params.partnerHouseId;
    }
    const last = await this.prisma.redirectClickEvent.findFirst({
      where,
      orderBy: { clickedAt: 'desc' },
      select: { id: true },
    });
    return Boolean(last);
  }

  async createPartnerShareLink(dto: CreatePartnerShareLinkDto) {
    const digits = normalizeWhatsappDigits(dto.whatsapp);
    if (digits.length < 9) {
      throw new BadRequestException(
        'Número de WhatsApp inválido (precisa de pelo menos 9 dígitos).',
      );
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
        whatsappPhrase: dto.whatsappPhrase.trim(),
      },
    });

    const frontend = getFrontendBaseUrl();
    return {
      id: created.id,
      slug: created.slug,
      title: created.title,
      whatsappDigits: created.whatsappDigits,
      whatsappPhrase: created.whatsappPhrase,
      createdAt: created.createdAt.toISOString(),
      entryUrl: `${frontend}/whatsapp?t=${encodeURIComponent(created.slug)}`,
      exitUrlPreview: buildWhatsAppUrl(
        created.whatsappDigits,
        created.whatsappPhrase,
      ),
    };
  }

  async adminClickHistory(params: {
    kind?: RedirectClickKind;
    limit: number;
    offset: number;
  }) {
    const take = Math.min(Math.max(params.limit, 1), 200);
    const skip = Math.max(params.offset, 0);
    const where =
      params.kind != null ? { kind: params.kind } : {};

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

  async adminOverview() {
    const frontend = getFrontendBaseUrl();

    const customRows = await this.prisma.partnerShareLink.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { clicks: true } },
      },
    });

    const customLinks = customRows.map((c) => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      whatsappDigits: c.whatsappDigits,
      whatsappPhrase: c.whatsappPhrase,
      clickCount: c._count.clicks,
      createdAt: c.createdAt.toISOString(),
      entryUrl: `${frontend}/whatsapp?t=${encodeURIComponent(c.slug)}`,
      exitUrlPreview: buildWhatsAppUrl(c.whatsappDigits, c.whatsappPhrase),
    }));

    const houseRows = await this.prisma.partnerHouse.findMany({
      orderBy: { createdAt: 'desc' },
      take: 1000,
      select: {
        id: true,
        houseId: true,
        title: true,
        priceEur: true,
        partner: { select: { name: true } },
        _count: { select: { redirectClicks: true } },
      },
    });

    const houseLinks = houseRows.map((h) => ({
      id: h.id,
      houseId: h.houseId,
      title: h.title,
      priceEur: h.priceEur,
      partnerName: h.partner.name,
      clickCount: h._count.redirectClicks,
      entryUrl: `${frontend}/imovel?id=${encodeURIComponent(String(h.houseId))}`,
      messagePreview: houseLeadWhatsAppMessage({
        title: h.title,
        priceEur: h.priceEur,
      }),
    }));

    return { customLinks, houseLinks };
  }

  /** Regista clique e devolve URL wa.me (HTTP redirect). */
  async resolveCustomRedirect(slugRaw: string): Promise<string> {
    const slug = decodeURIComponent(slugRaw).trim();
    const link = await this.prisma.partnerShareLink.findUnique({
      where: { slug },
    });
    if (!link) {
      this.logger.warn(`PartnerShareLink não encontrado: slug=${slug}`);
      return getFrontendBaseUrl();
    }
    const dup = await this.shouldSkipDuplicateClick({
      kind: RedirectClickKind.CUSTOM_LINK,
      partnerShareLinkId: link.id,
    });
    if (!dup) {
      await this.prisma.redirectClickEvent.create({
        data: {
          kind: RedirectClickKind.CUSTOM_LINK,
          partnerShareLinkId: link.id,
        },
      });
    }
    return buildWhatsAppUrl(link.whatsappDigits, link.whatsappPhrase);
  }

  async resolveHouseRedirect(
    houseKeyRaw: string,
    mode?: string,
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
    const m = String(mode || '').trim().toLowerCase();
    const text =
      m === 'interest'
        ? houseInterestTriggerMessage({ houseId: house.houseId, title: house.title })
        : houseLeadWhatsAppMessage({
            title: house.title,
            priceEur: house.priceEur,
          });
    const dup = await this.shouldSkipDuplicateClick({
      kind: RedirectClickKind.HOUSE,
      partnerHouseId: house.id,
    });
    if (!dup) {
      await this.prisma.redirectClickEvent.create({
        data: {
          kind: RedirectClickKind.HOUSE,
          partnerHouseId: house.id,
        },
      });
    }
    return buildWhatsAppUrl(digits, text);
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
