import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RafaCallBookingStatus, RafaCallCrmStatus } from '@prisma/client';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { RafacallCrmService } from './rafacall-crm.service';

function tzOffsetMinutes(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const asUtc = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(get('hour')),
    Number(get('minute')),
    Number(get('second')),
  );
  return Math.round((asUtc - at.getTime()) / 60000);
}

function tzLocalToUtc(
  timeZone: string,
  y: number,
  m: number,
  d: number,
  minutes: number,
): Date {
  const h = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const guess = new Date(Date.UTC(y, m - 1, d, h, mm, 0));
  const offset = tzOffsetMinutes(timeZone, guess);
  return new Date(guess.getTime() - offset * 60000);
}

function ymdInTz(date: Date, timeZone: string): { y: number; m: number; d: number } {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone }).format(date); // YYYY-MM-DD
  const [y, m, d] = ymd.split('-').map((x) => Number(x));
  return { y, m, d };
}

function waDigits(value: string): string {
  return value.replace(/\D/g, '');
}

@Injectable()
export class RafacallAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wa: WhatsAppService,
    private readonly crm: RafacallCrmService,
  ) {}

  private ymdForUtcInstant(utc: Date, tz: string): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(utc);
  }

  /** Agenda do admin: agrupamento por dia civil sempre em Lisboa (independente de query `tz`). */
  async getSchedule(_params?: { tz?: string }) {
    const tz = 'Europe/Lisbon';
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const items = await this.prisma.rafaCallBooking.findMany({
      where: {
        // Inclui agendamentos futuros e mantém histórico por 7 dias após a data.
        startsAt: { gte: weekAgo },
        status: { in: [RafaCallBookingStatus.SCHEDULED, RafaCallBookingStatus.COMPLETED] },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        status: true,
        startsAt: true,
        endsAt: true,
        timezone: true,
        origin: true,
        guestName: true,
        guestWhatsapp: true,
        user: {
          select: {
            id: true,
            name: true,
            whatsapp: true,
          },
        },
      },
    });

    const groups = new Map<string, typeof items>();
    for (const b of items) {
      const key = this.ymdForUtcInstant(b.startsAt, tz);
      const arr = groups.get(key) ?? [];
      arr.push(b);
      groups.set(key, arr);
    }

    const days = Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, bookings]) => ({
        date,
        items: bookings.map((b) => ({
          id: b.id,
          status: b.status,
          startsAt: b.startsAt.toISOString(),
          endsAt: b.endsAt.toISOString(),
          userId: b.user?.id ?? null,
          userName: b.user?.name ?? b.guestName ?? null,
          whatsappDigits: waDigits(b.user?.whatsapp ?? b.guestWhatsapp ?? ''),
          bookingTimezone: b.timezone,
          bookingOrigin: b.origin,
        })),
      }));

    return { tz, days };
  }

  async listBlocks(params: { fromUtcIso: string; toUtcIso: string }) {
    const from = new Date(params.fromUtcIso);
    const to = new Date(params.toUtcIso);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('from/to inválidos (use ISO UTC).');
    }
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException('to deve ser maior que from.');
    }

    const items = await this.prisma.rafaCallBlockedSlot.findMany({
      where: {
        startsAt: { lt: to },
        endsAt: { gt: from },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        reason: true,
        createdAt: true,
        createdByUserId: true,
      },
    });

    return {
      blocks: items.map((b) => ({
        id: b.id,
        startsAt: b.startsAt.toISOString(),
        endsAt: b.endsAt.toISOString(),
        reason: b.reason,
        createdAt: b.createdAt.toISOString(),
        createdByUserId: b.createdByUserId,
      })),
    };
  }

  async createBlock(params: { adminUserId: string; startsAtUtcIso: string; endsAtUtcIso: string; reason?: string | null }) {
    const startsAt = new Date(params.startsAtUtcIso);
    const endsAt = new Date(params.endsAtUtcIso);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('startsAt/endsAt inválidos (use ISO UTC).');
    }
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new BadRequestException('endsAt deve ser maior que startsAt.');
    }

    const created = await this.prisma.rafaCallBlockedSlot.create({
      data: {
        startsAt,
        endsAt,
        reason: params.reason?.trim() || null,
        createdByUserId: params.adminUserId,
      },
      select: { id: true, startsAt: true, endsAt: true, reason: true },
    });

    return {
      id: created.id,
      startsAt: created.startsAt.toISOString(),
      endsAt: created.endsAt.toISOString(),
      reason: created.reason,
    };
  }

  async deleteBlock(params: { id: string }) {
    await this.prisma.rafaCallBlockedSlot.delete({ where: { id: params.id } });
    return { ok: true };
  }

  private async sendAdminCancelMessage(params: { userId: string; booking: { startsAt: Date; endsAt: Date; timezone: string } }) {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: { name: true, whatsapp: true },
    });
    if (!user) return;
    const startLocal = params.booking.startsAt.toLocaleString('pt-PT', {
      timeZone: params.booking.timezone,
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
    const endLocal = params.booking.endsAt.toLocaleTimeString('pt-PT', {
      timeZone: params.booking.timezone,
      hour: '2-digit',
      minute: '2-digit',
    });
    const who = user.name?.trim() || 'Olá';
    const msg = `🗑️ ${who}, a tua chamada com a Move Casa foi cancelada.\n\nEstava marcada para: ${startLocal} (até ${endLocal})\nHorário de Lisboa`;
    await this.wa.sendText(user.whatsapp, msg);
  }

  async cancelBooking(params: { bookingId: string; adminUserId: string; reason?: string | null }) {
    const booking = await this.prisma.rafaCallBooking.findFirst({
      where: { id: params.bookingId, status: RafaCallBookingStatus.SCHEDULED },
      select: {
        id: true,
        userId: true,
        guestName: true,
        guestWhatsapp: true,
        startsAt: true,
        endsAt: true,
        timezone: true,
      },
    });

    if (!booking) {
      const existing = await this.prisma.rafaCallBooking.findUnique({
        where: { id: params.bookingId },
        select: { status: true },
      });
      if (!existing) {
        // Idempotente: já foi apagado (ex.: reagendamento ou cancelamento prévio).
        return { ok: true as const, alreadyRemoved: true as const };
      }
      if (existing.status === RafaCallBookingStatus.COMPLETED) {
        throw new BadRequestException(
          'Este agendamento já foi marcado como realizado e não pode ser cancelado.',
        );
      }
      throw new BadRequestException('Agendamento não encontrado.');
    }

    const cancelAction = await this.crm.handleScheduledBookingCanceled(booking.id);
    if (cancelAction === 'delete') {
      await this.prisma.rafaCallBooking.delete({ where: { id: booking.id } });
    }

    if (booking.userId) {
      await this.prisma.user.update({
        where: { id: booking.userId },
        data: { rafaCallSlotStartsAt: null, rafaCallSlotEndsAt: null },
      });
      void this.sendAdminCancelMessage({
        userId: booking.userId,
        booking: { startsAt: booking.startsAt, endsAt: booking.endsAt, timezone: booking.timezone },
      });
    } else if (booking.guestWhatsapp) {
      void this.sendAdminCancelGuestMessage({
        name: booking.guestName,
        whatsapp: booking.guestWhatsapp,
        booking: { startsAt: booking.startsAt, endsAt: booking.endsAt, timezone: booking.timezone },
      });
    }

    return { ok: true as const };
  }

  async completeBooking(params: { bookingId: string; adminUserId: string }) {
    const booking = await this.prisma.rafaCallBooking.findFirst({
      where: { id: params.bookingId, status: RafaCallBookingStatus.SCHEDULED },
      select: { id: true, userId: true },
    });
    if (!booking) {
      const existing = await this.prisma.rafaCallBooking.findUnique({
        where: { id: params.bookingId },
        select: { status: true },
      });
      if (existing?.status === RafaCallBookingStatus.COMPLETED) {
        return { id: params.bookingId, status: RafaCallBookingStatus.COMPLETED };
      }
      throw new BadRequestException('Agendamento não encontrado.');
    }

    const updated = await this.prisma.rafaCallBooking.update({
      where: { id: booking.id },
      data: {
        status: RafaCallBookingStatus.COMPLETED,
      },
      select: { id: true, status: true },
    });

    await this.crm.recordStatusChange({
      bookingId: booking.id,
      crmStatus: RafaCallCrmStatus.REALIZOU_VIDEO_CHAMADA,
    });

    if (booking.userId) {
      await this.prisma.user.update({
        where: { id: booking.userId },
        data: {
          rafaCallSchedulingUnlocked: false,
          rafaCallSlotStartsAt: null,
          rafaCallSlotEndsAt: null,
        },
      });
    }

    return updated;
  }

  async deleteBooking(params: { bookingId: string }) {
    const booking = await this.prisma.rafaCallBooking.findFirst({
      where: {
        id: params.bookingId,
        status: RafaCallBookingStatus.COMPLETED,
      },
      select: { id: true },
    });

    if (!booking) {
      const existing = await this.prisma.rafaCallBooking.findUnique({
        where: { id: params.bookingId },
        select: { status: true },
      });
      if (!existing) {
        return { ok: true as const, alreadyRemoved: true as const };
      }
      if (existing.status === RafaCallBookingStatus.SCHEDULED) {
        throw new BadRequestException(
          'Este agendamento ainda está marcado. Usa cancelar em vez de excluir.',
        );
      }
      throw new BadRequestException('Agendamento não encontrado.');
    }

    await this.crm.ensureCrmLeadAfterBookingRemoval(booking.id);
    await this.prisma.rafaCallBooking.delete({ where: { id: booking.id } });

    return { ok: true as const };
  }

  private async sendAdminCancelGuestMessage(params: {
    name: string | null;
    whatsapp: string;
    booking: { startsAt: Date; endsAt: Date; timezone: string };
  }) {
    const wa = (params.whatsapp ?? '').replace(/\D/g, '');
    if (!wa) return;
    const startLocal = params.booking.startsAt.toLocaleString('pt-PT', {
      timeZone: params.booking.timezone,
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
    const endLocal = params.booking.endsAt.toLocaleTimeString('pt-PT', {
      timeZone: params.booking.timezone,
      hour: '2-digit',
      minute: '2-digit',
    });
    const who = params.name?.trim() || 'Olá';
    const msg = `🗑️ ${who}, a tua chamada com a Move Casa foi cancelada.\n\nEstava marcada para: ${startLocal} (até ${endLocal})`;
    await this.wa.sendText(wa, msg);
  }
}

