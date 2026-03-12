import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { SaleStatus } from '@prisma/client';

@Injectable()
export class SaleService {
  constructor(private readonly prisma: PrismaService) {}

  private async getPartnerForUserOrThrow(userId: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { userId },
    });

    if (!partner) {
      throw new ForbiddenException('Parceiro não encontrado para este usuário.');
    }

    return partner;
  }

  async getPartnerLookup(userId: string) {
    const partner = await this.getPartnerForUserOrThrow(userId);

    const [leads, services] = await Promise.all([
      this.prisma.lead.findMany({
        where: { partnerId: partner.id },
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              whatsapp: true,
            },
          },
        },
      }),
      this.prisma.service.findMany({
        where: { partnerId: partner.id },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          title: true,
          price: true,
          commissionEuro: true,
        },
      }),
    ]);

    return { leads, services };
  }

  async createPartnerSale(params: {
    userId: string;
    leadId: string;
    serviceId: string;
    month: number;
    year: number;
    amount?: number;
  }) {
    const partner = await this.getPartnerForUserOrThrow(params.userId);

    const lead = await this.prisma.lead.findFirst({
      where: {
        id: params.leadId,
        partnerId: partner.id,
      },
      include: { user: true },
    });

    if (!lead) {
      throw new NotFoundException('Lead não encontrado para este parceiro.');
    }

    const service = await this.prisma.service.findFirst({
      where: {
        id: params.serviceId,
        partnerId: partner.id,
      },
    });

    if (!service) {
      throw new NotFoundException('Serviço não encontrado para este parceiro.');
    }

    const amount = params.amount ?? (service.price ? parseFloat(service.price) : 0);
    const commissionEuro = service.commissionEuro ?? 0;

    return this.prisma.sale.create({
      data: {
        partnerId: partner.id,
        userId: lead.userId,
        createdByUserId: params.userId,
        serviceId: service.id,
        month: params.month,
        year: params.year,
        amount,
        commissionEuro,
      },
    });
  }

  async listPartnerSales(userId: string) {
    const partner = await this.getPartnerForUserOrThrow(userId);

    const sales = await this.prisma.sale.findMany({
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
        service: {
          select: {
            title: true,
          },
        },
        createdByUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return {
      pending: sales.filter((s) => s.status === 'PENDING_PARTNER'),
      approved: sales.filter((s) => s.status === 'APPROVED'),
      rejected: sales.filter((s) => s.status === 'REJECTED'),
    };
  }

  async updatePartnerSaleStatus(params: {
    userId: string;
    saleId: string;
    status: SaleStatus;
  }) {
    const partner = await this.getPartnerForUserOrThrow(params.userId);

    const sale = await this.prisma.sale.findFirst({
      where: {
        id: params.saleId,
        partnerId: partner.id,
      },
    });

    if (!sale) {
      throw new NotFoundException('Venda não encontrada.');
    }

    // Regra de negócio:
    // - Registos APROVADOS não podem voltar a ser reprovados nem alterados.
    // - Registos PENDENTES podem ser aprovados ou reprovados.
    // - Registos REPROVADOS podem ser posteriormente aprovados.
    if (sale.status === 'APPROVED' && params.status !== 'APPROVED') {
      throw new ForbiddenException(
        'Registos de venda aprovados não podem ser alterados ou revertidos.',
      );
    }

    if (
      sale.status === 'PENDING_PARTNER' &&
      (params.status === 'APPROVED' || params.status === 'REJECTED')
    ) {
      // ok
    } else if (
      sale.status === 'REJECTED' &&
      params.status === 'APPROVED'
    ) {
      // ok - permitir REJECTED -> APPROVED
    } else if (sale.status !== params.status) {
      throw new ForbiddenException(
        'Estado da venda não permite esta transição.',
      );
    }

    return this.prisma.sale.update({
      where: { id: sale.id },
      data: {
        status: params.status,
      },
    });
  }

  async getUserLookup() {
    const partners = await this.prisma.partner.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        category: {
          select: {
            name: true,
          },
        },
      },
    });

    return { partners };
  }

  async listServicesForPartner(partnerId: string) {
    return this.prisma.service.findMany({
      where: { partnerId },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        title: true,
        price: true,
        commissionEuro: true,
      },
    });
  }

  async createUserSale(params: {
    userId: string;
    partnerId: string;
    serviceId: string;
    month: number;
    year: number;
    amount?: number;
  }) {
    const partner = await this.prisma.partner.findUnique({
      where: { id: params.partnerId },
    });

    if (!partner) {
      throw new NotFoundException('Parceiro não encontrado.');
    }

    const service = await this.prisma.service.findFirst({
      where: {
        id: params.serviceId,
        partnerId: partner.id,
      },
    });

    if (!service) {
      throw new NotFoundException('Serviço não encontrado para este parceiro.');
    }

    const amount = params.amount ?? (service.price ? parseFloat(service.price) : 0);
    const commissionEuro = service.commissionEuro ?? 0;

    return this.prisma.sale.create({
      data: {
        partnerId: partner.id,
        userId: params.userId,
        createdByUserId: params.userId,
        serviceId: service.id,
        month: params.month,
        year: params.year,
        amount,
        commissionEuro,
      },
    });
  }

  async listUserSales(userId: string) {
    const sales = await this.prisma.sale.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        partner: {
          select: {
            id: true,
            name: true,
          },
        },
        service: {
          select: {
            title: true,
          },
        },
      },
    });

    return sales.map((s) => ({
      ...s,
      cashbackEligible: s.status === 'APPROVED',
    }));
  }
}

