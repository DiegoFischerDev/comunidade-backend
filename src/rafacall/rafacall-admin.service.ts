import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RafaCallBookingStatus } from '@prisma/client';

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
  constructor(private readonly prisma: PrismaService) {}

  async getToday(params?: { tz?: string }) {
    const tz = params?.tz || 'Europe/Lisbon';
    const now = new Date();
    const { y, m, d } = ymdInTz(now, tz);
    const startUtc = tzLocalToUtc(tz, y, m, d, 0);
    const endUtc = tzLocalToUtc(tz, y, m, d, 24 * 60);

    const items = await this.prisma.rafaCallBooking.findMany({
      where: {
        status: RafaCallBookingStatus.SCHEDULED,
        startsAt: { gte: startUtc, lt: endUtc },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        timezone: true,
        user: { select: { id: true, name: true, whatsapp: true } },
      },
    });

    return {
      tz,
      startUtc: startUtc.toISOString(),
      endUtc: endUtc.toISOString(),
      items: items.map((b) => ({
        id: b.id,
        startsAt: b.startsAt.toISOString(),
        endsAt: b.endsAt.toISOString(),
        userId: b.user.id,
        userName: b.user.name,
        whatsappDigits: waDigits(b.user.whatsapp),
        bookingTimezone: b.timezone,
      })),
    };
  }
}

