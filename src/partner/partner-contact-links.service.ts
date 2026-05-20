import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_ADMIN_CONTACT_DIGITS = '351936958429';

function normalizeWhatsappDigits(raw: string): string {
  return String(raw ?? '')
    .replace(/\D/g, '')
    .replace(/^0+/, '');
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

function partnerAtendimentoPhrase(partnerName: string): string {
  return `Olá, gostaria de atendimento com ${partnerName}`;
}

function partnerServiceInterestPhrase(
  partnerName: string,
  serviceTitle: string,
): string {
  return `Olá, gostaria de mais informações sobre o serviço "${serviceTitle}". Atendimento com ${partnerName}.`;
}

export function partnerShareLinkRedirectPath(slug: string): string {
  return `/link?t=${encodeURIComponent(slug)}`;
}

@Injectable()
export class PartnerContactLinksService {
  private readonly adminDigits = normalizeWhatsappDigits(
    process.env.PARTNER_CONTACT_WHATSAPP_DIGITS?.trim() ||
      DEFAULT_ADMIN_CONTACT_DIGITS,
  );

  constructor(private readonly prisma: PrismaService) {}

  private async uniqueSlug(baseTitle: string): Promise<string> {
    let base = slugifyTitle(baseTitle);
    if (!base) base = 'link';
    let slug = base;
    for (let attempt = 0; attempt < 24; attempt++) {
      const clash = await this.prisma.partnerShareLink.findUnique({
        where: { slug },
      });
      if (!clash) return slug;
      slug = `${base}-${randomBytes(3).toString('hex')}`;
    }
    const still = await this.prisma.partnerShareLink.findUnique({
      where: { slug },
    });
    if (still) {
      slug = `${base}-${randomBytes(4).toString('hex')}`;
    }
    return slug;
  }

  private async upsertShareLink(params: {
    existingId: string | null;
    title: string;
    phrase: string;
  }): Promise<{ id: string; slug: string }> {
    if (params.existingId) {
      const updated = await this.prisma.partnerShareLink.update({
        where: { id: params.existingId },
        data: {
          title: params.title,
          whatsappPhrase: params.phrase,
          whatsappDigits: this.adminDigits,
          destinationUrl: null,
        },
        select: { id: true, slug: true },
      });
      return updated;
    }
    const slug = await this.uniqueSlug(params.title);
    const created = await this.prisma.partnerShareLink.create({
      data: {
        slug,
        title: params.title,
        whatsappDigits: this.adminDigits,
        whatsappPhrase: params.phrase,
        destinationUrl: null,
      },
      select: { id: true, slug: true },
    });
    return created;
  }

  async setupPartnerContactLinks(partnerId: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      include: {
        heroShareLink: { select: { id: true, slug: true } },
        services: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            title: true,
            partnerShareLinkId: true,
            partnerShareLink: { select: { id: true, slug: true } },
          },
        },
      },
    });
    if (!partner) {
      throw new NotFoundException('Parceiro não encontrado.');
    }

    const hero = await this.upsertShareLink({
      existingId: partner.heroShareLinkId,
      title: `Contacto hero — ${partner.name}`,
      phrase: partnerAtendimentoPhrase(partner.name),
    });
    if (partner.heroShareLinkId !== hero.id) {
      await this.prisma.partner.update({
        where: { id: partnerId },
        data: { heroShareLinkId: hero.id },
      });
    }

    const services: {
      id: string;
      title: string;
      slug: string;
      redirectPath: string;
    }[] = [];

    for (const svc of partner.services) {
      const link = await this.upsertShareLink({
        existingId: svc.partnerShareLinkId,
        title: `Contacto serviço — ${partner.name} — ${svc.title}`,
        phrase: partnerServiceInterestPhrase(partner.name, svc.title),
      });
      if (svc.partnerShareLinkId !== link.id) {
        await this.prisma.service.update({
          where: { id: svc.id },
          data: { partnerShareLinkId: link.id },
        });
      }
      services.push({
        id: svc.id,
        title: svc.title,
        slug: link.slug,
        redirectPath: partnerShareLinkRedirectPath(link.slug),
      });
    }

    return {
      partnerId,
      hero: {
        slug: hero.slug,
        redirectPath: partnerShareLinkRedirectPath(hero.slug),
      },
      services,
    };
  }

  async getPartnerContactLinksAdmin(partnerId: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      include: {
        heroShareLink: {
          select: {
            id: true,
            slug: true,
            title: true,
            _count: { select: { clicks: true } },
          },
        },
        services: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            title: true,
            partnerShareLink: {
              select: {
                id: true,
                slug: true,
                title: true,
                _count: { select: { clicks: true } },
              },
            },
          },
        },
      },
    });
    if (!partner) {
      throw new NotFoundException('Parceiro não encontrado.');
    }

    return {
      partnerId,
      hero: partner.heroShareLink
        ? {
            id: partner.heroShareLink.id,
            slug: partner.heroShareLink.slug,
            title: partner.heroShareLink.title,
            clickCount: partner.heroShareLink._count.clicks,
            redirectPath: partnerShareLinkRedirectPath(
              partner.heroShareLink.slug,
            ),
          }
        : null,
      services: partner.services.map((s) => ({
        id: s.id,
        title: s.title,
        link: s.partnerShareLink
          ? {
              id: s.partnerShareLink.id,
              slug: s.partnerShareLink.slug,
              title: s.partnerShareLink.title,
              clickCount: s.partnerShareLink._count.clicks,
              redirectPath: partnerShareLinkRedirectPath(
                s.partnerShareLink.slug,
              ),
            }
          : null,
      })),
      servicesWithLink: partner.services.filter((s) => s.partnerShareLink).length,
      servicesTotal: partner.services.length,
    };
  }

  /** Novo serviço: cria link rastreado se o parceiro já tiver link da hero configurado. */
  async ensureServiceContactLinkForNewService(
    partnerId: string,
    serviceId: string,
    serviceTitle: string,
  ) {
    const partner = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      select: { name: true, heroShareLinkId: true },
    });
    if (!partner?.heroShareLinkId) return;

    const link = await this.upsertShareLink({
      existingId: null,
      title: `Contacto serviço — ${partner.name} — ${serviceTitle}`,
      phrase: partnerServiceInterestPhrase(partner.name, serviceTitle),
    });
    await this.prisma.service.update({
      where: { id: serviceId },
      data: { partnerShareLinkId: link.id },
    });
  }

  mapPublicContactFields(partner: {
    heroShareLink: { slug: string } | null;
    services: Array<{
      id: string;
      title: string;
      description: string | null;
      price: string | null;
      priceOnRequest: boolean;
      partnerShareLink: { slug: string } | null;
    }>;
  }) {
    return {
      heroContactRedirectPath: partner.heroShareLink
        ? partnerShareLinkRedirectPath(partner.heroShareLink.slug)
        : null,
      services: partner.services.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        price: s.price,
        priceOnRequest: s.priceOnRequest,
        contactRedirectPath: s.partnerShareLink
          ? partnerShareLinkRedirectPath(s.partnerShareLink.slug)
          : null,
      })),
    };
  }
}
