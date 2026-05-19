import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PartnerAdvertisingLedgerType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HOUSE_PUBLICATION_COST_EUR_CENTS } from './house-publication.constants';

@Injectable()
export class PartnerAdvertisingService {
  constructor(private readonly prisma: PrismaService) {}

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
        return { balanceEurCents: current.advertisingBalanceEurCents };
      }

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

      return { balanceEurCents: partner.advertisingBalanceEurCents };
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

    return this.prisma.$transaction(async (tx) => {
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

      return { balanceEurCents: updated.advertisingBalanceEurCents };
    });
  }

  async refundPublicationDebit(
    partnerId: string,
    houseId: string,
    amountEurCents: number = HOUSE_PUBLICATION_COST_EUR_CENTS,
  ): Promise<void> {
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
