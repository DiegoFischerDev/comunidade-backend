import { BadRequestException, Injectable } from '@nestjs/common';
import { FinanceEntryKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  formatCrmImmigrationDateKey,
  parseCrmImmigrationDateInput,
} from '../rafacall/rafacall-crm.constants';

function waDigits(value: string): string {
  return value.replace(/\D/g, '');
}

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async listEntries() {
    const rows = await this.prisma.rafaCallCrmPayment.findMany({
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
    });

    const whatsappList = [
      ...new Set(
        rows
          .map((row) => row.whatsappDigits)
          .filter((digits): digits is string => Boolean(digits)),
      ),
    ];
    const clientNames = await this.resolveClientNamesByWhatsapp(whatsappList);

    const incomes = rows
      .filter((row) => row.kind === FinanceEntryKind.INCOME)
      .map((row) => this.serializeEntry(row, clientNames));
    const expenses = rows
      .filter((row) => row.kind === FinanceEntryKind.EXPENSE)
      .map((row) => this.serializeEntry(row, clientNames));

    const incomesTotal = this.sumAmounts(incomes);
    const expensesTotal = this.sumAmounts(expenses);

    return {
      incomes,
      expenses,
      incomesTotal,
      expensesTotal,
      balance: Math.round((incomesTotal - expensesTotal) * 100) / 100,
    };
  }

  async createEntry(params: {
    kind: FinanceEntryKind;
    title: string;
    paidAt: string;
    amount: number;
    receiptImageUrl?: string | null;
    comment?: string | null;
    whatsapp?: string | null;
  }) {
    const title = this.parseTitle(params.title);
    const paidAt = this.parsePaidAt(params.paidAt);
    const amount = this.parseAmount(params.amount);
    const receiptImageUrl = params.receiptImageUrl?.trim() || null;
    const comment = params.comment?.trim() || null;
    const whatsappDigits = this.resolveWhatsappForKind(
      params.kind,
      params.whatsapp,
    );

    const created = await this.prisma.rafaCallCrmPayment.create({
      data: {
        kind: params.kind,
        title,
        whatsappDigits,
        paidAt,
        amount,
        receiptImageUrl,
        comment,
      },
    });

    const clientNames = whatsappDigits
      ? await this.resolveClientNamesByWhatsapp([whatsappDigits])
      : new Map<string, string>();

    return this.serializeEntry(created, clientNames);
  }

  async updateEntry(params: {
    id: string;
    kind?: FinanceEntryKind;
    title?: string;
    paidAt?: string;
    amount?: number;
    receiptImageUrl?: string | null;
    comment?: string | null;
    whatsapp?: string | null;
  }) {
    const existing = await this.prisma.rafaCallCrmPayment.findUnique({
      where: { id: params.id },
    });
    if (!existing) {
      throw new BadRequestException('Lançamento não encontrado.');
    }

    const nextKind = params.kind ?? existing.kind;
    const data: Prisma.RafaCallCrmPaymentUpdateInput = {};

    if (params.kind !== undefined) {
      data.kind = params.kind;
    }
    if (params.title !== undefined) {
      data.title = this.parseTitle(params.title);
    }
    if (params.paidAt !== undefined) {
      data.paidAt = this.parsePaidAt(params.paidAt);
    }
    if (params.amount !== undefined) {
      data.amount = this.parseAmount(params.amount);
    }
    if (params.receiptImageUrl !== undefined) {
      data.receiptImageUrl = params.receiptImageUrl?.trim() || null;
    }
    if (params.comment !== undefined) {
      data.comment = params.comment?.trim() || null;
    }

    if (params.whatsapp !== undefined || params.kind !== undefined) {
      const whatsappSource =
        params.whatsapp !== undefined
          ? params.whatsapp
          : existing.whatsappDigits;
      data.whatsappDigits = this.resolveWhatsappForKind(
        nextKind,
        whatsappSource,
      );
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nenhuma alteração para guardar.');
    }

    const updated = await this.prisma.rafaCallCrmPayment.update({
      where: { id: existing.id },
      data,
    });

    const clientNames = updated.whatsappDigits
      ? await this.resolveClientNamesByWhatsapp([updated.whatsappDigits])
      : new Map<string, string>();

    return this.serializeEntry(updated, clientNames);
  }

  async deleteEntry(id: string) {
    const existing = await this.prisma.rafaCallCrmPayment.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new BadRequestException('Lançamento não encontrado.');
    }

    await this.prisma.rafaCallCrmPayment.delete({ where: { id: existing.id } });
    return { ok: true as const };
  }

  private resolveWhatsappForKind(
    kind: FinanceEntryKind,
    whatsapp: string | null | undefined,
  ): string | null {
    if (kind === FinanceEntryKind.EXPENSE) return null;
    const digits = waDigits(whatsapp ?? '');
    if (!digits) return null;
    if (digits.length < 8) {
      throw new BadRequestException(
        'WhatsApp inválido — indica o número com indicativo (mín. 8 dígitos).',
      );
    }
    return digits;
  }

  private parseTitle(value: string): string {
    const title = value.trim();
    if (!title) {
      throw new BadRequestException('Indica um título.');
    }
    if (title.length > 120) {
      throw new BadRequestException('Título demasiado longo (máx. 120 caracteres).');
    }
    return title;
  }

  private parsePaidAt(value: string): Date {
    try {
      const date = parseCrmImmigrationDateInput(value.trim());
      if (!date) throw new Error('INVALID');
      return date;
    } catch {
      throw new BadRequestException('Data inválida.');
    }
  }

  private parseAmount(value: number): Prisma.Decimal {
    if (!Number.isFinite(value) || value < 0.01) {
      throw new BadRequestException('Valor inválido.');
    }
    return new Prisma.Decimal(value.toFixed(2));
  }

  private sumAmounts(entries: Array<{ amount: number }>): number {
    return (
      Math.round(entries.reduce((sum, entry) => sum + entry.amount, 0) * 100) /
      100
    );
  }

  private serializeEntry(
    row: {
      id: string;
      kind: FinanceEntryKind;
      title: string;
      whatsappDigits: string | null;
      paidAt: Date;
      amount: Prisma.Decimal;
      receiptImageUrl: string | null;
      comment: string | null;
    },
    clientNames: Map<string, string>,
  ) {
    const whatsappDigits = row.whatsappDigits?.trim() || null;
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      paidAt:
        formatCrmImmigrationDateKey(row.paidAt) ??
        row.paidAt.toISOString().slice(0, 10),
      amount: Number(row.amount),
      receiptImageUrl: row.receiptImageUrl,
      comment: row.comment,
      whatsappDigits,
      clientName: whatsappDigits
        ? (clientNames.get(whatsappDigits) ?? null)
        : null,
    };
  }

  private async resolveClientNamesByWhatsapp(
    whatsappDigitsList: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const wanted = new Set(whatsappDigitsList.map(waDigits).filter(Boolean));
    if (wanted.size === 0) return map;

    const bookings = await this.prisma.rafaCallBooking.findMany({
      where: { crmExcludedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: {
        guestName: true,
        guestWhatsapp: true,
        user: { select: { name: true, whatsapp: true } },
      },
    });

    for (const booking of bookings) {
      const digitsKey = waDigits(
        booking.user?.whatsapp ?? booking.guestWhatsapp ?? '',
      );
      if (!digitsKey || !wanted.has(digitsKey) || map.has(digitsKey)) continue;
      const name =
        booking.user?.name?.trim() || booking.guestName?.trim() || null;
      if (name) map.set(digitsKey, name);
    }

    return map;
  }
}
