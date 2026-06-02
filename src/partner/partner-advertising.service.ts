import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PartnerAdvertisingLedgerType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { buildAdvertisingBalanceZeroWhatsAppText } from './partner-advertising-balance-zero.notify';
import { HOUSE_PUBLICATION_COST_EUR_CENTS } from './house-publication.constants';

@Injectable()
export class PartnerAdvertisingService {
  private readonly logger = new Logger(PartnerAdvertisingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  /** Avisa o parceiro por WhatsApp quando o saldo passa de >0 para 0. */
  private notifyBalanceReachedZeroIfNeeded(
    partnerId: string,
    balanceBefore: number,
    balanceAfter: number,
  ): void {
    if (balanceAfter !== 0 || balanceBefore <= 0) return;
    void this.sendBalanceZeroWhatsApp(partnerId);
  }

  private async sendBalanceZeroWhatsApp(partnerId: string): Promise<void> {
    try {
      const partner = await this.prisma.partner.findUnique({
        where: { id: partnerId },
        select: { name: true, whatsapp: true },
      });
      const to = (partner?.whatsapp ?? '').trim();
      if (!to) {
        this.logger.warn(
          `Saldo 0: parceiro ${partnerId} sem WhatsApp — notificação não enviada.`,
        );
        return;
      }
      const text = buildAdvertisingBalanceZeroWhatsAppText(partner?.name);
      await this.whatsapp.sendText(to, text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `Falha ao enviar WhatsApp de saldo 0 ao parceiro ${partnerId}: ${msg}`,
      );
    }
  }

  async getBalance(partnerId: string): Promise<{ balanceEurCents: number }> {
    const partner = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      select: { advertisingBalanceEurCents: true },
    });
    if (!partner) throw new NotFoundException('Parceiro não encontrado.');
    return { balanceEurCents: partner.advertisingBalanceEurCents };
  }

  async getBalanceByUserId(userId: string): Promise<{ balanceEurCents: number }> {
    const partner = await this.prisma.partner.findUnique({
      where: { userId },
      select: { id: true, advertisingBalanceEurCents: true },
    });
    if (!partner) throw new NotFoundException('Parceiro não encontrado.');
    return { balanceEurCents: partner.advertisingBalanceEurCents };
  }

  async credit(
    partnerId: string,
    amountEurCents: number,
    type: PartnerAdvertisingLedgerType,
    meta?: {
      stripeCheckoutSessionId?: string;
      adminUserId?: string;
      note?: string;
      partnerHouseId?: string;
    },
  ): Promise<{ balanceEurCents: number }> {
    if (!Number.isInteger(amountEurCents) || amountEurCents <= 0) {
      throw new BadRequestException('Valor de crédito inválido.');
    }

    if (meta?.stripeCheckoutSessionId) {
      const existing = await this.prisma.partnerAdvertisingLedgerEntry.findUnique({
        where: { stripeCheckoutSessionId: meta.stripeCheckoutSessionId },
      });
      if (existing) {
        const p = await this.prisma.partner.findUnique({
          where: { id: partnerId },
          select: { advertisingBalanceEurCents: true },
        });
        return { balanceEurCents: p?.advertisingBalanceEurCents ?? 0 };
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const partner = await tx.partner.update({
        where: { id: partnerId },
        data: {
          advertisingBalanceEurCents: { increment: amountEurCents },
        },
        select: { advertisingBalanceEurCents: true },
      });

      await tx.partnerAdvertisingLedgerEntry.create({
        data: {
          partnerId,
          type,
          amountEurCents,
          balanceAfterEurCents: partner.advertisingBalanceEurCents,
          stripeCheckoutSessionId: meta?.stripeCheckoutSessionId ?? null,
          adminUserId: meta?.adminUserId ?? null,
          note: meta?.note ?? null,
          partnerHouseId: meta?.partnerHouseId ?? null,
        },
      });

      return { balanceEurCents: partner.advertisingBalanceEurCents };
    });
  }

  /** Admin: define o saldo absoluto (ajuste no ledger com o delta). */
  async setBalance(
    partnerId: string,
    balanceEurCents: number,
    meta?: { adminUserId?: string; note?: string },
  ): Promise<{ balanceEurCents: number }> {
    if (!Number.isInteger(balanceEurCents) || balanceEurCents < 0) {
      throw new BadRequestException('Saldo inválido.');
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.partner.findUnique({
        where: { id: partnerId },
        select: { advertisingBalanceEurCents: true },
      });
      if (!current) throw new NotFoundException('Parceiro não encontrado.');

      const delta = balanceEurCents - current.advertisingBalanceEurCents;
      if (delta === 0) {
        return {
          balanceEurCents: current.advertisingBalanceEurCents,
          balanceBefore: current.advertisingBalanceEurCents,
        };
      }

      const balanceBefore = current.advertisingBalanceEurCents;
      const partner = await tx.partner.update({
        where: { id: partnerId },
        data: { advertisingBalanceEurCents: balanceEurCents },
        select: { advertisingBalanceEurCents: true },
      });

      await tx.partnerAdvertisingLedgerEntry.create({
        data: {
          partnerId,
          type: PartnerAdvertisingLedgerType.ADMIN_CREDIT,
          amountEurCents: delta,
          balanceAfterEurCents: partner.advertisingBalanceEurCents,
          adminUserId: meta?.adminUserId ?? null,
          note: meta?.note ?? 'Ajuste manual de saldo pelo admin',
        },
      });

      return {
        balanceEurCents: partner.advertisingBalanceEurCents,
        balanceBefore,
      };
    }).then((result) => {
      this.notifyBalanceReachedZeroIfNeeded(
        partnerId,
        result.balanceBefore,
        result.balanceEurCents,
      );
      return { balanceEurCents: result.balanceEurCents };
    });
  }

  async debitForPublication(
    partnerId: string,
    houseId: string,
    amountEurCents: number = HOUSE_PUBLICATION_COST_EUR_CENTS,
  ): Promise<{ balanceEurCents: number }> {
    if (!Number.isInteger(amountEurCents) || amountEurCents <= 0) {
      throw new BadRequestException('Valor de débito inválido.');
    }

    const existingDebit =
      await this.prisma.partnerAdvertisingLedgerEntry.findFirst({
        where: {
          partnerId,
          partnerHouseId: houseId,
          type: PartnerAdvertisingLedgerType.PUBLICATION_DEBIT,
        },
        select: { balanceAfterEurCents: true },
      });
    if (existingDebit) {
      const partner = await this.prisma.partner.findUnique({
        where: { id: partnerId },
        select: { advertisingBalanceEurCents: true },
      });
      if (!partner) throw new NotFoundException('Parceiro não encontrado.');
      return { balanceEurCents: partner.advertisingBalanceEurCents };
    }

    return this.prisma
      .$transaction(async (tx) => {
        const partner = await tx.partner.findUnique({
          where: { id: partnerId },
          select: { advertisingBalanceEurCents: true },
        });
        if (!partner) throw new NotFoundException('Parceiro não encontrado.');
        if (partner.advertisingBalanceEurCents < amountEurCents) {
          throw new BadRequestException(
            'Saldo de publicidade insuficiente. Adiciona saldo para publicar este imóvel.',
          );
        }

        const balanceBefore = partner.advertisingBalanceEurCents;
        const updated = await tx.partner.update({
          where: { id: partnerId },
          data: {
            advertisingBalanceEurCents: { decrement: amountEurCents },
          },
          select: { advertisingBalanceEurCents: true },
        });

        await tx.partnerAdvertisingLedgerEntry.create({
          data: {
            partnerId,
            type: PartnerAdvertisingLedgerType.PUBLICATION_DEBIT,
            amountEurCents: -amountEurCents,
            balanceAfterEurCents: updated.advertisingBalanceEurCents,
            partnerHouseId: houseId,
          },
        });

        return {
          balanceEurCents: updated.advertisingBalanceEurCents,
          balanceBefore,
        };
      })
      .then((result) => {
        this.notifyBalanceReachedZeroIfNeeded(
          partnerId,
          result.balanceBefore,
          result.balanceEurCents,
        );
        return { balanceEurCents: result.balanceEurCents };
      });
  }

  async refundPublicationDebit(
    partnerId: string,
    houseId: string,
    amountEurCents: number = HOUSE_PUBLICATION_COST_EUR_CENTS,
  ): Promise<void> {
    const debited = await this.prisma.partnerAdvertisingLedgerEntry.findFirst({
      where: {
        partnerId,
        partnerHouseId: houseId,
        type: PartnerAdvertisingLedgerType.PUBLICATION_DEBIT,
      },
      select: { id: true },
    });
    if (!debited) return;

    const alreadyRefunded =
      await this.prisma.partnerAdvertisingLedgerEntry.findFirst({
        where: {
          partnerId,
          partnerHouseId: houseId,
          type: PartnerAdvertisingLedgerType.ADMIN_CREDIT,
          note: 'Reembolso automático — falha total no envio WhatsApp',
        },
        select: { id: true },
      });
    if (alreadyRefunded) return;

    await this.prisma.$transaction(async (tx) => {
      const partner = await tx.partner.update({
        where: { id: partnerId },
        data: { advertisingBalanceEurCents: { increment: amountEurCents } },
        select: { advertisingBalanceEurCents: true },
      });
      await tx.partnerAdvertisingLedgerEntry.create({
        data: {
          partnerId,
          type: PartnerAdvertisingLedgerType.ADMIN_CREDIT,
          amountEurCents,
          balanceAfterEurCents: partner.advertisingBalanceEurCents,
          partnerHouseId: houseId,
          note: 'Reembolso automático — falha total no envio WhatsApp',
        },
      });
    });
  }
}
