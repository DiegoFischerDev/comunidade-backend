import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { RafaCallBookingStatus } from '@prisma/client';

type DayAvailability = {
  date: string; // YYYY-MM-DD no tz do utilizador
  slots: { startsAt: string; endsAt: string }[]; // ISO em UTC
};

function parseYmd(value: string): { y: number; m: number; d: number } | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mm = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mm) || !Number.isFinite(d)) return null;
  if (mm < 1 || mm > 12 || d < 1 || d > 31) return null;
  return { y, m: mm, d };
}

function hmToMinutes(hm: string): number | null {
  const m = hm.trim().match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

// Obtém offset (min) do timezone para um instante, usando Intl.
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

// Converte YYYY-MM-DD + minutos no dia (no tz) → Date UTC.
function tzLocalToUtc(timeZone: string, y: number, m: number, d: number, minutes: number): Date {
  const h = Math.floor(minutes / 60);
  const mm = minutes % 60;
  // Primeiro “chute” em UTC com os mesmos componentes.
  const guess = new Date(Date.UTC(y, m - 1, d, h, mm, 0));
  // Ajusta pelo offset real no timezone naquele instante.
  const offset = tzOffsetMinutes(timeZone, guess);
  return new Date(guess.getTime() - offset * 60000);
}

type WorkingHoursConfig = Record<
  'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun',
  Array<[string, string]>
>;

const DEFAULT_WORKING_HOURS: WorkingHoursConfig = {
  mon: [['10:00', '18:00']],
  tue: [['10:00', '18:00']],
  wed: [['10:00', '18:00']],
  thu: [['10:00', '18:00']],
  fri: [['10:00', '18:00']],
  sat: [],
  sun: [],
};

function weekdayKeyForDateInTz(timeZone: string, y: number, m: number, d: number): keyof WorkingHoursConfig {
  const utcMidday = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(utcMidday).toLowerCase();
  if (wd.startsWith('mon')) return 'mon';
  if (wd.startsWith('tue')) return 'tue';
  if (wd.startsWith('wed')) return 'wed';
  if (wd.startsWith('thu')) return 'thu';
  if (wd.startsWith('fri')) return 'fri';
  if (wd.startsWith('sat')) return 'sat';
  return 'sun';
}

function ymdInTz(timeZone: string, at: Date): string {
  // YYYY-MM-DD no timezone informado
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);
}

@Injectable()
export class RafacallBookingService {
  private readonly logger = new Logger(RafacallBookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wa: WhatsAppService,
  ) {}

  private get durationMinutes(): number {
    const v = Number(process.env.RAFA_CALL_DURATION_MINUTES ?? 30);
    return Number.isFinite(v) && v > 0 ? v : 30;
  }
  private get bufferMinutes(): number {
    const v = Number(process.env.RAFA_CALL_BUFFER_MINUTES ?? 10);
    return Number.isFinite(v) && v >= 0 ? v : 10;
  }

  private get workingHours(): WorkingHoursConfig {
    const raw = process.env.RAFA_CALL_WORKING_HOURS_JSON?.trim();
    if (!raw) return DEFAULT_WORKING_HOURS;
    try {
      const parsed = JSON.parse(raw) as Partial<WorkingHoursConfig>;
      return { ...DEFAULT_WORKING_HOURS, ...parsed } as WorkingHoursConfig;
    } catch {
      return DEFAULT_WORKING_HOURS;
    }
  }

  async getCurrentBooking(userId: string) {
    const now = new Date();
    return this.prisma.rafaCallBooking.findFirst({
      where: { userId, status: RafaCallBookingStatus.SCHEDULED, endsAt: { gt: now } },
      orderBy: { startsAt: 'asc' },
    });
  }

  async getAvailability(params: { userId: string; from: string; to: string; tz: string }): Promise<{ tz: string; days: DayAvailability[] }> {
    const { userId, from, to, tz } = params;
    const fromYmd = parseYmd(from);
    const toYmd = parseYmd(to);
    if (!fromYmd || !toYmd) throw new BadRequestException('from/to inválidos (use YYYY-MM-DD).');
    const todayYmd = ymdInTz(tz, new Date());

    // Para reagendamento, precisamos devolver availability mesmo com booking ativo.
    // Importante: excluir o booking atual do cálculo de conflitos, senão o buffer “come” slots adjacentes.
    const existing = await this.getCurrentBooking(userId);
    const excludeBookingId = existing?.id;

    const duration = this.durationMinutes;
    const buffer = this.bufferMinutes;

    // Buscar bookings que podem conflitar na janela (com folga de buffer).
    const minUtc = tzLocalToUtc(tz, fromYmd.y, fromYmd.m, fromYmd.d, 0);
    const maxUtc = tzLocalToUtc(tz, toYmd.y, toYmd.m, toYmd.d, 24 * 60);
    const busy = await this.prisma.rafaCallBooking.findMany({
      where: {
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
        status: RafaCallBookingStatus.SCHEDULED,
        startsAt: { lt: new Date(maxUtc.getTime() + buffer * 60000) },
        endsAt: { gt: new Date(minUtc.getTime() - buffer * 60000) },
      },
      select: { startsAt: true, endsAt: true },
    });

    // Buscar bloqueios admin na janela (também em UTC), com folga de buffer.
    const blocks = await this.prisma.rafaCallBlockedSlot.findMany({
      where: {
        startsAt: { lt: new Date(maxUtc.getTime() + buffer * 60000) },
        endsAt: { gt: new Date(minUtc.getTime() - buffer * 60000) },
      },
      select: { startsAt: true, endsAt: true },
    });

    // Buffer aqui é interpretado como "gap após a chamada" (não antes+depois).
    // Como os slots já são espaçados por (duração + buffer), não devemos "comer" slots adjacentes.
    const isConflict = (s: Date, e: Date): boolean => {
      const eGap = new Date(e.getTime() + buffer * 60000);
      return (
        busy.some((b) => {
          const beGap = new Date(b.endsAt.getTime() + buffer * 60000);
          return s < beGap && eGap > b.startsAt;
        }) ||
        blocks.some((b) => {
          // Bloqueio admin é exato (sem buffer).
          return s < b.endsAt && e > b.startsAt;
        })
      );
    };

    const days: DayAvailability[] = [];
    const cursor = new Date(Date.UTC(fromYmd.y, fromYmd.m - 1, fromYmd.d, 12, 0, 0));
    const end = new Date(Date.UTC(toYmd.y, toYmd.m - 1, toYmd.d, 12, 0, 0));

    for (let i = 0; i < 366; i++) {
      if (cursor.getTime() > end.getTime()) break;
      const y = Number(cursor.toISOString().slice(0, 4));
      const m = Number(cursor.toISOString().slice(5, 7));
      const d = Number(cursor.toISOString().slice(8, 10));
      const dayKey = weekdayKeyForDateInTz(tz, y, m, d);
      const ranges = this.workingHours[dayKey] ?? [];
      const slots: { startsAt: string; endsAt: string }[] = [];

      const dateYmd = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(
        tzLocalToUtc(tz, y, m, d, 12 * 60),
      );
      // Trava: não permite agendar para o mesmo dia (apenas a partir do dia seguinte).
      if (dateYmd === todayYmd) {
        days.push({ date: dateYmd, slots: [] });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        continue;
      }

      for (const [startHm, endHm] of ranges) {
        const startMin = hmToMinutes(startHm);
        const endMin = hmToMinutes(endHm);
        if (startMin == null || endMin == null || endMin <= startMin) continue;
        // Espaça os horários em (duração + buffer) para evitar "back-to-back" no UI.
        const step = duration + buffer;
        for (let t = startMin; t + duration <= endMin; t += step) {
          const sUtc = tzLocalToUtc(tz, y, m, d, t);
          const eUtc = new Date(sUtc.getTime() + duration * 60000);
          if (eUtc.getTime() <= Date.now()) continue;
          if (!isConflict(sUtc, eUtc)) {
            slots.push({ startsAt: sUtc.toISOString(), endsAt: eUtc.toISOString() });
          }
        }
      }

      days.push({ date: dateYmd, slots });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return { tz, days };
  }

  private async sendBookingMessage(userId: string, kind: 'booked' | 'rescheduled' | 'cancelled', booking: { startsAt: Date; endsAt: Date; timezone: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, whatsapp: true },
    });
    if (!user) return;
    const startLocal = booking.startsAt.toLocaleString('pt-PT', {
      timeZone: booking.timezone,
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
    const endLocal = booking.endsAt.toLocaleTimeString('pt-PT', {
      timeZone: booking.timezone,
      hour: '2-digit',
      minute: '2-digit',
    });
    const who = user.name?.trim() || 'Olá';
    const base =
      kind === 'booked'
        ? `✅ ${who}, a tua chamada com a Rafa foi agendada!`
        : kind === 'rescheduled'
          ? `🔁 ${who}, a tua chamada com a Rafa foi reagendada!`
          : `🗑️ ${who}, a tua chamada com a Rafa foi cancelada.`;
    const followup =
      kind === 'cancelled'
        ? ''
        : `\n\nNo dia e hora agendada, a Rafa vai te ligar aqui por chamada de vídeo do WhatsApp, ok?\n\nSe precisar reagendar, acesse www.comunidade.rafaapelomundo.com`;
    const when =
      kind === 'cancelled'
        ? `\n\nEstava marcada para: ${startLocal} (até ${endLocal})\nHorário de Lisboa`
        : `\n\nData e hora: ${startLocal} (até ${endLocal})\nHorário de Lisboa`;
    await this.wa.sendText(user.whatsapp, `${base}${when}${followup}`);
  }

  async book(userId: string, input: { startsAtUtcIso: string; tz: string }) {
    const startsAt = new Date(input.startsAtUtcIso);
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException('startsAt inválido.');
    const tz = input.tz.trim();
    if (!tz) throw new BadRequestException('tz é obrigatório.');
    // Trava: não permite agendar para o mesmo dia (no timezone do utilizador).
    if (ymdInTz(tz, startsAt) === ymdInTz(tz, new Date())) {
      throw new BadRequestException('Só é possível agendar a partir do dia seguinte.');
    }

    const duration = this.durationMinutes;
    const endsAt = new Date(startsAt.getTime() + duration * 60000);

    // MVP: 1 booking ativo por utilizador
    const existing = await this.getCurrentBooking(userId);
    if (existing) throw new BadRequestException('Já existe um agendamento ativo.');

    // Conflitos globais (gap após a chamada).
    const buffer = this.bufferMinutes;

    const candidates = await this.prisma.rafaCallBooking.findMany({
      where: {
        status: RafaCallBookingStatus.SCHEDULED,
        startsAt: { lt: new Date(endsAt.getTime() + buffer * 60000) },
        endsAt: { gt: new Date(startsAt.getTime() - duration * 60000) },
      },
      select: { id: true, startsAt: true, endsAt: true },
      take: 20,
    });
    const newEndGap = new Date(endsAt.getTime() + buffer * 60000);
    const hasConflict = candidates.some((b) => {
      const bEndGap = new Date(b.endsAt.getTime() + buffer * 60000);
      return startsAt < bEndGap && newEndGap > b.startsAt;
    });
    if (hasConflict) throw new BadRequestException('Este horário já não está disponível.');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { rafaCallUnlockOrigin: true },
    });

    const origin = user?.rafaCallUnlockOrigin ?? 'USER_PAID';

    const created = await this.prisma.rafaCallBooking.create({
      data: {
        userId,
        status: RafaCallBookingStatus.SCHEDULED,
        origin,
        startsAt,
        endsAt,
        timezone: tz,
      },
    });

    // Mantemos os campos legacy em User por agora (para UI existente/consumo).
    await this.prisma.user.update({
      where: { id: userId },
      data: { rafaCallSlotStartsAt: startsAt, rafaCallSlotEndsAt: endsAt },
    });

    void this.sendBookingMessage(userId, 'booked', { startsAt, endsAt, timezone: tz });
    return created;
  }

  async reschedule(userId: string, input: { bookingId: string; newStartsAtUtcIso: string; tz: string }) {
    const current = await this.prisma.rafaCallBooking.findFirst({
      where: { id: input.bookingId, userId, status: RafaCallBookingStatus.SCHEDULED },
    });
    if (!current) throw new BadRequestException('Agendamento não encontrado.');

    const startsAt = new Date(input.newStartsAtUtcIso);
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException('newStartsAt inválido.');
    const tz = input.tz.trim();
    if (!tz) throw new BadRequestException('tz é obrigatório.');
    // Trava: não permite reagendar para o mesmo dia (no timezone do utilizador).
    if (ymdInTz(tz, startsAt) === ymdInTz(tz, new Date())) {
      throw new BadRequestException('Só é possível reagendar a partir do dia seguinte.');
    }

    const duration = this.durationMinutes;
    const endsAt = new Date(startsAt.getTime() + duration * 60000);

    // Conflito (exclui o próprio booking atual) usando gap após a chamada.
    const buffer = this.bufferMinutes;
    const candidates = await this.prisma.rafaCallBooking.findMany({
      where: {
        id: { not: current.id },
        status: RafaCallBookingStatus.SCHEDULED,
        startsAt: { lt: new Date(endsAt.getTime() + buffer * 60000) },
        endsAt: { gt: new Date(startsAt.getTime() - duration * 60000) },
      },
      select: { id: true, startsAt: true, endsAt: true },
      take: 20,
    });
    const newEndGap = new Date(endsAt.getTime() + buffer * 60000);
    const hasConflict = candidates.some((b) => {
      const bEndGap = new Date(b.endsAt.getTime() + buffer * 60000);
      return startsAt < bEndGap && newEndGap > b.startsAt;
    });
    if (hasConflict) throw new BadRequestException('Este horário já não está disponível.');

    // Estratégia: cancela o atual e cria novo ligado por rescheduledFromBookingId.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { rafaCallUnlockOrigin: true },
    });
    const origin = user?.rafaCallUnlockOrigin ?? 'USER_PAID';

    const [cancelled, created] = await this.prisma.$transaction([
      this.prisma.rafaCallBooking.update({
        where: { id: current.id },
        data: { status: RafaCallBookingStatus.CANCELLED, cancelledAt: new Date(), cancelReason: 'reschedule' },
      }),
      this.prisma.rafaCallBooking.create({
        data: {
          userId,
          status: RafaCallBookingStatus.SCHEDULED,
          origin,
          startsAt,
          endsAt,
          timezone: tz,
          rescheduledFromBookingId: current.id,
        },
      }),
    ]);

    await this.prisma.user.update({
      where: { id: userId },
      data: { rafaCallSlotStartsAt: startsAt, rafaCallSlotEndsAt: endsAt },
    });

    void this.sendBookingMessage(userId, 'rescheduled', { startsAt, endsAt, timezone: tz });
    this.logger.log(`RafaCall reagendado ${cancelled.id} -> ${created.id}`);
    return created;
  }

  async cancel(userId: string, input: { bookingId: string; reason?: string | null }) {
    const current = await this.prisma.rafaCallBooking.findFirst({
      where: { id: input.bookingId, userId, status: RafaCallBookingStatus.SCHEDULED },
    });
    if (!current) throw new BadRequestException('Agendamento não encontrado.');

    const updated = await this.prisma.rafaCallBooking.update({
      where: { id: current.id },
      data: {
        status: RafaCallBookingStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: input.reason?.trim() || 'user_cancel',
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { rafaCallSlotStartsAt: null, rafaCallSlotEndsAt: null },
    });

    void this.sendBookingMessage(userId, 'cancelled', {
      startsAt: current.startsAt,
      endsAt: current.endsAt,
      timezone: current.timezone,
    });
    return updated;
  }
}

