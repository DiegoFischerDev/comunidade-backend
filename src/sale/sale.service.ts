import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { SaleStatus } from '@prisma/client';
import { StripeService } from '../stripe/stripe.service';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { sendEmailWithPdfAttachment } from '../email/resend.client';

@Injectable()
export class SaleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
  ) {}

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
        // ignoramos outros erros para não quebrar o fluxo de negócio
      }
    }
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
          cashbackEuro: true,
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

  async createPartnerCommissionPayment(params: {
    userId: string;
    saleId: string;
    amountEuro: number;
    successUrl: string;
    cancelUrl: string;
    wantsInvoice?: boolean;
  }) {
    const {
      userId,
      saleId,
      amountEuro,
      successUrl,
      cancelUrl,
      wantsInvoice,
    } = params;

    if (!amountEuro || Number.isNaN(amountEuro) || amountEuro <= 0) {
      throw new BadRequestException('Valor da comissão inválido.');
    }

    const partner = await this.getPartnerForUserOrThrow(userId);

    const sale = await this.prisma.sale.findFirst({
      where: {
        id: saleId,
        partnerId: partner.id,
      },
      include: {
        service: true,
        user: true,
        partner: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!sale) {
      throw new NotFoundException('Venda não encontrada.');
    }

    if (sale.status !== 'APPROVED') {
      throw new BadRequestException(
        'Só é possível pagar comissão de vendas aprovadas.',
      );
    }

    if (sale.commissionPaymentStatus === 'PAID') {
      throw new BadRequestException('Comissão já foi marcada como paga.');
    }

    const partnerBilling = await this.prisma.partner.findUnique({
      where: { id: sale.partnerId },
      select: {
        billingName: true,
        billingNif: true,
        billingAddress: true,
        billingPostalCode: true,
      },
    });

    if (wantsInvoice) {
      const name = partnerBilling?.billingName?.trim() ?? '';
      const nif = partnerBilling?.billingNif?.replace(/\s+/g, '').trim() ?? '';
      const address = partnerBilling?.billingAddress?.trim() ?? '';
      const postalCode = partnerBilling?.billingPostalCode?.trim() ?? '';

      if (!name || !nif || !address || !postalCode) {
        throw new BadRequestException(
          'Para solicitar fatura, preencha os dados de faturação no seu perfil (Parceiro).',
        );
      }
      if (!/^\d{9}$/.test(nif)) {
        throw new BadRequestException(
          'NIF inválido no perfil do parceiro. Deve conter 9 dígitos.',
        );
      }

      await this.prisma.sale.update({
        where: { id: sale.id },
        data: {
          wantsInvoice: true,
          invoiceName: name,
          invoiceNif: nif,
          invoiceAddress: address,
          invoicePostalCode: postalCode,
          invoiceRequestedAt: new Date(),
        },
      });
    } else {
      await this.prisma.sale.update({
        where: { id: sale.id },
        data: {
          wantsInvoice: false,
          invoiceName: null,
          invoiceNif: null,
          invoiceAddress: null,
          invoicePostalCode: null,
          invoiceRequestedAt: null,
        },
      });
    }

    const descriptionParts: string[] = [];
    const serviceTitle = sale.service?.title ?? sale.serviceTitle;
    if (serviceTitle) descriptionParts.push(serviceTitle);
    descriptionParts.push(
      `Ref. ${sale.month.toString().padStart(2, '0')}/${sale.year}`,
    );
    const description = descriptionParts.join(' – ');

    const amountCents = Math.round(amountEuro * 100);

    const partnerEmail = sale.partner.user.email;

    return this.stripeService.createMbWayCommissionCheckoutSession({
      partnerUserId: userId,
      partnerEmail,
      saleId: sale.id,
      amountCents,
      description,
      successUrl,
      cancelUrl,
    });
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

    const updated = await this.prisma.sale.update({
      where: { id: sale.id },
      data: {
        status: params.status,
        // Depois de aprovada, não precisamos mais manter o comprovativo em disco
        ...(params.status === 'APPROVED' && sale.paymentProofUrl
          ? { paymentProofUrl: null }
          : {}),
      },
    });

    if (params.status === 'APPROVED' && sale.paymentProofUrl) {
      await this.deleteUploadFileIfLocal(sale.paymentProofUrl);
    }

    return updated;
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
            cashbackEuro: true,
          },
        },
        // Campos de fatura ficam no root do Sale, já retornados por padrão
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

  async addPaymentProofForUser(params: {
    userId: string;
    saleId: string;
    paymentProofUrl: string;
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

    const oldUrl = sale.paymentProofUrl;

    const updated = await this.prisma.sale.update({
      where: { id: sale.id },
      data: {
        status: 'PENDING_PARTNER',
        paymentProofUrl: params.paymentProofUrl,
      },
    });

    if (oldUrl && oldUrl !== params.paymentProofUrl) {
      await this.deleteUploadFileIfLocal(oldUrl);
    }

    return updated;
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
            cashbackEuro: true,
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

  async uploadAndSendInvoiceAdmin(params: { saleId: string; file: any }) {
    const { saleId, file } = params;
    if (!file) {
      throw new BadRequestException('Arquivo PDF é obrigatório.');
    }
    const mimetype = (file.mimetype as string | undefined) ?? '';
    const originalname = (file.originalname as string | undefined) ?? '';
    const isPdf =
      mimetype === 'application/pdf' ||
      originalname.toLowerCase().endsWith('.pdf') ||
      (file.filename as string | undefined)?.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      throw new BadRequestException('A fatura deve ser um arquivo PDF.');
    }

    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        partner: {
          include: {
            user: true,
          },
        },
      },
    });
    if (!sale) {
      throw new NotFoundException('Compra não encontrada.');
    }
    if (!sale.wantsInvoice) {
      throw new BadRequestException(
        'Esta compra não está marcada como "quero fatura".',
      );
    }
    if (sale.commissionPaymentStatus !== 'PAID') {
      throw new BadRequestException(
        'Só é possível enviar fatura após o pagamento da comissão.',
      );
    }

    const url = `/uploads/${file.filename}`;
    const absoluteFilePath = join(process.cwd(), 'uploads', file.filename);
    const partnerEmail = sale.partner?.user?.email;
    if (!partnerEmail) {
      throw new BadRequestException('Email do parceiro não encontrado.');
    }

    const amount = sale.commissionPaidEuro ?? null;
    const amountLabel = amount != null ? `${amount.toFixed(2)} €` : '—';

    await sendEmailWithPdfAttachment({
      to: partnerEmail,
      subject: 'Fatura da comissão – Comunidade RPM',
      text:
        `Olá,\n\n` +
        `Segue em anexo a fatura da comissão.\n\n` +
        `Valor da fatura: ${amountLabel}\n` +
        `Referência: ${sale.month.toString().padStart(2, '0')}/${sale.year}\n\n` +
        `Equipa Comunidade RPM`,
      html: `
        <div style="max-width:640px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
          <h1 style="font-size:18px;margin:0 0 12px;">Fatura da comissão</h1>
          <p style="margin:0 0 12px;">Segue em anexo a fatura da comissão.</p>
          <ul style="margin:0 0 12px;padding-left:20px;">
            <li><strong>Valor da fatura:</strong> ${amountLabel}</li>
            <li><strong>Referência:</strong> ${sale.month
              .toString()
              .padStart(2, '0')}/${sale.year}</li>
          </ul>
          <p style="margin:0;">Equipa Comunidade RPM</p>
        </div>
      `,
      filename: `fatura-comissao-${sale.id}.pdf`,
      absoluteFilePath,
    });

    const updated = await this.prisma.sale.update({
      where: { id: sale.id },
      data: {
        invoicePdfUrl: url,
        invoiceSentAt: new Date(),
      },
    });

    return {
      id: updated.id,
      invoicePdfUrl: updated.invoicePdfUrl,
      invoiceSentAt: updated.invoiceSentAt,
    };
  }
}

