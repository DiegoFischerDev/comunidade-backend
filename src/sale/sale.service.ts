import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { SaleStatus } from '@prisma/client';

@Injectable()
export class SaleService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Converte a string de comissão (ex. "10%" ou "5 €") no valor em euros
   * para esta venda. % = percentual do amount; € ou $ = valor fixo.
   */
  private parseCommissionToEuro(commissionStr: string | null, saleAmount: number): number {
    const s = commissionStr?.trim();
    if (!s) return 0;
    const numMatch = s.match(/^[\d.,]+/);
    const num = numMatch ? parseFloat(numMatch[0].replace(',', '.')) : NaN;
    if (Number.isNaN(num) || num < 0) return 0;
    if (/\d\s*%\s*$/i.test(s)) return (saleAmount * num) / 100;
    if (/\d\s*[€$]\s*$/i.test(s)) return num;
    return 0;
  }

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
          priceOnRequest: true,
          commission: true,
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

    let amount: number;
    if (service.priceOnRequest) {
      if (
        params.amount == null ||
        params.amount === undefined ||
        Number.isNaN(params.amount) ||
        params.amount <= 0
      ) {
        throw new BadRequestException(
          'Para serviços "sob consulta" o valor da venda é obrigatório.',
        );
      }
      amount = params.amount;
    } else {
      amount =
        params.amount ??
        (service.price ? parseFloat(service.price) : 0);
    }
    const commissionEuro = this.parseCommissionToEuro(
      service.commission,
      amount,
    );

    return this.prisma.sale.create({
      data: {
        partnerId: partner.id,
        userId: lead.userId,
        createdByUserId: params.userId,
        serviceId: service.id,
        serviceTitle: service.title,
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
            commission: true,
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
        priceOnRequest: true,
        commission: true,
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

    let amount: number;
    if (service.priceOnRequest) {
      if (
        params.amount == null ||
        params.amount === undefined ||
        Number.isNaN(params.amount) ||
        params.amount <= 0
      ) {
        throw new BadRequestException(
          'Para serviços "sob consulta" o valor da compra é obrigatório.',
        );
      }
      amount = params.amount;
    } else {
      amount =
        params.amount ??
        (service.price ? parseFloat(service.price) : 0);
    }
    const commissionEuro = this.parseCommissionToEuro(
      service.commission,
      amount,
    );

    return this.prisma.sale.create({
      data: {
        partnerId: partner.id,
        userId: params.userId,
        createdByUserId: params.userId,
        serviceId: service.id,
        serviceTitle: service.title,
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
      cashbackEligible: s.status === 'APPROVED' && !s.cashbackRequestedAt,
    }));
  }

  async requestCashback(params: {
    userId: string;
    saleId: string;
    mbwayNumber: string;
    mbwayName: string;
  }) {
    const sale = await this.prisma.sale.findFirst({
      where: {
        id: params.saleId,
        userId: params.userId,
      },
    });

    if (!sale) {
      throw new NotFoundException('Compra não encontrada.');
    }

    if (sale.status !== 'APPROVED') {
      throw new BadRequestException(
        'Só pode solicitar cashback em compras aprovadas.',
      );
    }

    if (sale.cashbackRequestedAt) {
      throw new BadRequestException('Cashback já foi solicitado para esta compra.');
    }

    const mbwayNumber = params.mbwayNumber.replace(/\s/g, '').trim();
    const mbwayName = params.mbwayName.trim();
    if (!mbwayNumber || !mbwayName) {
      throw new BadRequestException('Número e nome MB Way são obrigatórios.');
    }

    return this.prisma.sale.update({
      where: { id: params.saleId },
      data: {
        cashbackRequestedAt: new Date(),
        cashbackMbwayNumber: mbwayNumber,
        cashbackMbwayName: mbwayName,
      },
    });
  }

  async listAllSalesForAdmin(filters?: {
    partnerId?: string;
    status?: SaleStatus;
    cashbackOnly?: boolean;
  }) {
    const where: {
      partnerId?: string;
      status?: SaleStatus;
      cashbackRequestedAt?: { not: null };
    } = {};

    if (filters?.partnerId) where.partnerId = filters.partnerId;
    if (filters?.status) where.status = filters.status;
    if (filters?.cashbackOnly) where.cashbackRequestedAt = { not: null };

    const sales = await this.prisma.sale.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
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
      cashbackEligible: s.status === 'APPROVED' && !s.cashbackRequestedAt,
    }));
  }

  async markCashbackPaid(saleId: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
    });

    if (!sale) {
      throw new NotFoundException('Compra não encontrada.');
    }

    if (!sale.cashbackRequestedAt) {
      throw new BadRequestException(
        'Só pode marcar como pago um cashback que foi solicitado.',
      );
    }

    if (sale.cashbackPaidAt) {
      throw new BadRequestException('Cashback já foi marcado como pago.');
    }

    return this.prisma.sale.update({
      where: { id: saleId },
      data: { cashbackPaidAt: new Date() },
    });
  }

  async deleteSaleForAdmin(saleId: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
    });

    if (!sale) {
      throw new NotFoundException('Compra não encontrada.');
    }

    await this.prisma.sale.delete({
      where: { id: saleId },
    });

    return { id: saleId };
  }
}

