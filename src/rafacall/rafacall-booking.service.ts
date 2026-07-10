import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { RafaCallBookingOrigin, RafaCallBookingStatus } from '@prisma/client';
import { getFrontendBaseUrl } from '../config/frontend-base-url';

type DayAvailability = {
  date: string; // YYYY-MM-DD no tz do utilizador
  slots: { startsAt: string; endsAt: string }[]; // ISO em UTC — livres para marcar
  /** Mesma grelha de slots, mas ocupados pela equipa (visível no teu fuso). */
  adminBlockedSlots: { startsAt: string; endsAt: string }[];
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

/** y/m/d = dia civil no calendário do utilizador (YYYY-MM-DD desmembrado), não UTC. */
function weekdayKeyForDateInTz(timeZone: string, y: number, m: number, d: number): keyof WorkingHoursConfig {
  const noonLocalUtc = tzLocalToUtc(timeZone, y, m, d, 12 * 60);
  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(noonLocalUtc).toLowerCase();
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

function formatYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Avança um dia civil (Gregorian) para ranges YYYY-MM-DD sem ambiguidade de fuso. */
function incrementYmd(ymd: string): string | null {
  const p = parseYmd(ymd);
  if (!p) return null;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return formatYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Rótulo curto para mensagens (ex.: America/Sao_Paulo → Sao Paulo). IANA completo vai na mesma linha. */
function timezoneLabelPt(iana: string): string {
  const tz = iana.trim();
  if (!tz) return 'Lisboa';
  return tz.split('/').pop()?.replace(/_/g, ' ') || tz;
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

  /** Fuso onde os HH:mm de `RAFA_CALL_WORKING_HOURS_JSON` valem (ex.: Lisboa para a equipa). */
  private get workingHoursTimezone(): string {
    const z = process.env.RAFA_CALL_WORKING_HOURS_TIMEZONE?.trim();
    return z || 'Europe/Lisbon';
  }

  async getCurrentBooking(userId: string) {
    const now = new Date();
    return this.prisma.rafaCallBooking.findFirst({
      where: { userId, status: RafaCallBookingStatus.SCHEDULED, endsAt: { gt: now } },
      orderBy: { startsAt: 'asc' },
    });
  }

  /** Helper para normalizar WhatsApp (só dígitos com indicativo). */
  private normalizeWhatsapp(raw: string): string {
    return String(raw ?? '').replace(/\D/g, '');
  }

  private static readonly DEVICE_ID_UUID_V4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  /** Valida UUID v4 do browser (identificador opaco por dispositivo). */
  private validateClientDeviceId(raw: string): string {
    const id = String(raw ?? '').trim().toLowerCase();
    if (!id || !RafacallBookingService.DEVICE_ID_UUID_V4.test(id)) {
      throw new BadRequestException('Identificador de dispositivo inválido.');
    }
    return id;
  }

  private serializePublicBooking(booking: {
    id: string;
    status: RafaCallBookingStatus;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    guestName: string | null;
    guestWhatsapp: string | null;
    origin: RafaCallBookingOrigin;
  }) {
    return {
      id: booking.id,
      status: booking.status,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      timezone: booking.timezone,
      name: booking.guestName ?? null,
      whatsapp: booking.guestWhatsapp ?? null,
      origin: booking.origin,
    };
  }

  /** Procura booking ativo (futuro, SCHEDULED) pelo deviceId do browser. */
  async getCurrentBookingByDeviceId(deviceId: string) {
    const id = this.validateClientDeviceId(deviceId);
    const now = new Date();
    return this.prisma.rafaCallBooking.findFirst({
      where: {
        clientDeviceId: id,
        status: RafaCallBookingStatus.SCHEDULED,
        endsAt: { gt: now },
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  /** Estado público para `/agendar?whatsapp=` — prioriza booking do dispositivo. */
  async getPublicState(input: { whatsapp: string; deviceId?: string | null }) {
    const wa = this.normalizeWhatsapp(input.whatsapp);
    if (wa.length < 8) {
      throw new BadRequestException('WhatsApp inválido. Inclui o indicativo do país (ex.: 351…).');
    }

    const deviceId = input.deviceId?.trim()
      ? this.validateClientDeviceId(input.deviceId)
      : null;

    if (deviceId) {
      const deviceBooking = await this.getCurrentBookingByDeviceId(deviceId);
      if (deviceBooking) {
        return {
          mode: 'manage' as const,
          access: 'device' as const,
          booking: this.serializePublicBooking(deviceBooking),
        };
      }
    }

    const waBooking = await this.getCurrentBookingByWhatsapp(wa);
    if (waBooking) {
      return {
        mode: 'manage' as const,
        access: 'whatsapp' as const,
        booking: this.serializePublicBooking(waBooking),
      };
    }

    return {
      mode: 'book' as const,
      whatsapp: wa,
    };
  }

  /** Verifica se um deviceId pode gerir um booking (fluxo público sem confirmar WA). */
  async assertDeviceCanAccessBooking(bookingId: string, deviceId: string) {
    const id = this.validateClientDeviceId(deviceId);
    const booking = await this.prisma.rafaCallBooking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw new BadRequestException('Agendamento não encontrado.');
    if (!booking.clientDeviceId || booking.clientDeviceId !== id) {
      throw new BadRequestException(
        'Este dispositivo não tem permissão para gerir este agendamento.',
      );
    }
    return booking;
  }

  private resolveGuestBookingAccess(
    bookingId: string,
    input: { whatsapp?: string | null; deviceId?: string | null },
  ) {
    if (input.deviceId?.trim()) {
      return this.assertDeviceCanAccessBooking(bookingId, input.deviceId);
    }
    if (input.whatsapp?.trim()) {
      return this.assertWhatsappCanAccessBooking(bookingId, input.whatsapp);
    }
    throw new BadRequestException('WhatsApp ou identificador de dispositivo é obrigatório.');
  }

  private buildManageUrl(target: {
    bookingId: string;
    whatsapp: string;
    origin?: RafaCallBookingOrigin | null;
  }): string {
    const base = getFrontendBaseUrl().replace(/\/$/, '');
    if (target.origin === 'PUBLIC_FREE') {
      const wa = this.normalizeWhatsapp(target.whatsapp);
      return `${base}/agendar?whatsapp=${wa}`;
    }
    return `${base}/agendamento/${target.bookingId}`;
  }

  private async assertSlotAvailableForBooking(startsAt: Date, excludeBookingId?: string | null) {
    const duration = this.durationMinutes;
    const endsAt = new Date(startsAt.getTime() + duration * 60000);
    const buffer = this.bufferMinutes;

    const candidates = await this.prisma.rafaCallBooking.findMany({
      where: {
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
        status: RafaCallBookingStatus.SCHEDULED,
        startsAt: { lt: new Date(endsAt.getTime() + buffer * 60000) },
        endsAt: { gt: new Date(startsAt.getTime() - duration * 60000) },
      },
      select: { id: true, startsAt: true, endsAt: true },
      take: 20,
    });
    const newEndGap = new Date(endsAt.getTime() + buffer * 60000);
    if (
      candidates.some((b) => {
        const bEndGap = new Date(b.endsAt.getTime() + buffer * 60000);
        return startsAt < bEndGap && newEndGap > b.startsAt;
      })
    ) {
      throw new BadRequestException('Este horário já não está disponível.');
    }

    await this.assertNotBlockedByAdmin(startsAt, endsAt);
    return endsAt;
  }

  /** Procura booking guest ativo (futuro, SCHEDULED) pelo WhatsApp normalizado. */
  async getCurrentBookingByWhatsapp(whatsapp: string) {
    const wa = this.normalizeWhatsapp(whatsapp);
    if (wa.length < 8) return null;
    const now = new Date();
    return this.prisma.rafaCallBooking.findFirst({
      where: {
        status: RafaCallBookingStatus.SCHEDULED,
        endsAt: { gt: now },
        OR: [{ guestWhatsapp: wa }, { user: { whatsapp: wa } }],
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  /** Verifica se um WhatsApp tem permissão para mexer num booking (guest ou user). */
  async assertWhatsappCanAccessBooking(bookingId: string, whatsapp: string) {
    const wa = this.normalizeWhatsapp(whatsapp);
    if (wa.length < 8) {
      throw new BadRequestException('WhatsApp inválido para confirmação.');
    }
    const booking = await this.prisma.rafaCallBooking.findUnique({
      where: { id: bookingId },
      include: { user: { select: { whatsapp: true } } },
    });
    if (!booking) throw new BadRequestException('Agendamento não encontrado.');
    const bookingWa = booking.guestWhatsapp ?? booking.user?.whatsapp ?? '';
    if (this.normalizeWhatsapp(bookingWa) !== wa) {
      throw new BadRequestException(
        'O número de WhatsApp introduzido não corresponde ao registado para este agendamento. Verifica e tenta novamente.',
      );
    }
    return booking;
  }

  async getAvailability(params: {
    userId?: string | null;
    excludeBookingId?: string | null;
    from: string;
    to: string;
    tz: string;
  }): Promise<{ tz: string; days: DayAvailability[] }> {
    const { userId, from, to, tz } = params;
    const fromYmd = parseYmd(from);
    const toYmd = parseYmd(to);
    if (!fromYmd || !toYmd) throw new BadRequestException('from/to inválidos (use YYYY-MM-DD).');
    const todayYmd = ymdInTz(tz, new Date());

    // Para reagendamento, precisamos devolver availability mesmo com booking ativo.
    // Importante: excluir o booking atual do cálculo de conflitos, senão o buffer "come" slots adjacentes.
    let excludeBookingId: string | undefined = params.excludeBookingId ?? undefined;
    if (!excludeBookingId && userId) {
      const existing = await this.getCurrentBooking(userId);
      excludeBookingId = existing?.id;
    }

    const duration = this.durationMinutes;
    const buffer = this.bufferMinutes;
    const refTz = this.workingHoursTimezone;

    // Buscar bookings que podem conflitar na janela (com folga de buffer).
    const MS_DAY = 86400000;
    const userWindowStartUtc = tzLocalToUtc(tz, fromYmd.y, fromYmd.m, fromYmd.d, 0);
    const userWindowEndUtc = tzLocalToUtc(tz, toYmd.y, toYmd.m, toYmd.d, 24 * 60);
    // Folga: slots são gerados no refTz e podem mapear para dias vizinhos no tz do utilizador.
    const minUtc = new Date(userWindowStartUtc.getTime() - 2 * MS_DAY);
    const maxUtc = new Date(userWindowEndUtc.getTime() + 2 * MS_DAY);
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
    const hitsBooking = (s: Date, e: Date): boolean => {
      const eGap = new Date(e.getTime() + buffer * 60000);
      return busy.some((b) => {
        const beGap = new Date(b.endsAt.getTime() + buffer * 60000);
        return s < beGap && eGap > b.startsAt;
      });
    };
    const hitsAdminBlock = (s: Date, e: Date): boolean =>
      blocks.some((b) => s < b.endsAt && e > b.startsAt);

    const firstYmd = formatYmd(fromYmd.y, fromYmd.m, fromYmd.d);
    const lastYmd = formatYmd(toYmd.y, toYmd.m, toYmd.d);

    type Bucket = {
      slots: { startsAt: string; endsAt: string }[];
      adminBlockedSlots: { startsAt: string; endsAt: string }[];
    };
    const byUserDay = new Map<string, Bucket>();

    const padStartRef = new Date(userWindowStartUtc.getTime() - 3 * MS_DAY);
    const padEndRef = new Date(userWindowEndUtc.getTime() + 3 * MS_DAY);
    let refYmd = ymdInTz(refTz, padStartRef);
    const refEndYmd = ymdInTz(refTz, padEndRef);

    while (refYmd <= refEndYmd) {
      const refParts = parseYmd(refYmd);
      if (!refParts) break;
      const { y: ry, m: rm, d: rd } = refParts;
      const dayKey = weekdayKeyForDateInTz(refTz, ry, rm, rd);
      const ranges = this.workingHours[dayKey] ?? [];

      for (const [startHm, endHm] of ranges) {
        const startMin = hmToMinutes(startHm);
        const endMin = hmToMinutes(endHm);
        if (startMin == null || endMin == null || endMin <= startMin) continue;
        const step = duration + buffer;
        for (let t = startMin; t + duration <= endMin; t += step) {
          const sUtc = tzLocalToUtc(refTz, ry, rm, rd, t);
          const eUtc = new Date(sUtc.getTime() + duration * 60000);
          const userDayYmd = ymdInTz(tz, sUtc);
          if (userDayYmd < firstYmd || userDayYmd > lastYmd) continue;
          if (userDayYmd === todayYmd) continue;
          if (eUtc.getTime() <= Date.now()) continue;

          let bucket = byUserDay.get(userDayYmd);
          if (!bucket) {
            bucket = { slots: [], adminBlockedSlots: [] };
            byUserDay.set(userDayYmd, bucket);
          }

          if (hitsBooking(sUtc, eUtc)) continue;
          if (hitsAdminBlock(sUtc, eUtc)) {
            bucket.adminBlockedSlots.push({
              startsAt: sUtc.toISOString(),
              endsAt: eUtc.toISOString(),
            });
            continue;
          }
          bucket.slots.push({ startsAt: sUtc.toISOString(), endsAt: eUtc.toISOString() });
        }
      }

      const nextRef = incrementYmd(refYmd);
      if (!nextRef) break;
      refYmd = nextRef;
    }

    const sortIso = (a: { startsAt: string }, b: { startsAt: string }) =>
      a.startsAt.localeCompare(b.startsAt);

    const days: DayAvailability[] = [];
    let dateYmd: string | null = firstYmd;
    while (dateYmd && dateYmd <= lastYmd) {
      if (dateYmd === todayYmd) {
        days.push({ date: dateYmd, slots: [], adminBlockedSlots: [] });
      } else {
        const bucket = byUserDay.get(dateYmd) ?? { slots: [], adminBlockedSlots: [] };
        bucket.slots.sort(sortIso);
        bucket.adminBlockedSlots.sort(sortIso);
        days.push({
          date: dateYmd,
          slots: bucket.slots,
          adminBlockedSlots: bucket.adminBlockedSlots,
        });
      }
      dateYmd = incrementYmd(dateYmd);
    }

    return { tz, days };
  }

  /** Sobreposição com bloqueios admin (mesma regra que getAvailability: intervalo exato, sem buffer). */
  private async assertNotBlockedByAdmin(startsAt: Date, endsAt: Date) {
    const hit = await this.prisma.rafaCallBlockedSlot.findFirst({
      where: {
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      select: { id: true },
    });
    if (hit) {
      throw new BadRequestException('Este horário está indisponível (bloqueado).');
    }
  }

  private async sendBookingMessage(
    target: {
      name?: string | null;
      whatsapp: string;
      bookingId: string;
      origin?: RafaCallBookingOrigin | null;
    },
    kind: 'booked' | 'rescheduled' | 'cancelled',
    booking: { startsAt: Date; endsAt: Date; timezone: string },
  ) {
    const whatsapp = (target.whatsapp ?? '').replace(/\D/g, '');
    if (!whatsapp) return;
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
    const who = target.name?.trim() || 'Olá';
    const base =
      kind === 'booked'
        ? `✅ ${who}, a tua chamada com a Rafa foi agendada!`
        : kind === 'rescheduled'
          ? `🔁 ${who}, a tua chamada com a Rafa foi reagendada!`
          : `🗑️ ${who}, a tua chamada com a Rafa foi cancelada.`;
    const manageUrl = this.buildManageUrl({
      bookingId: target.bookingId,
      whatsapp,
      origin: target.origin,
    });
    const followup =
      kind === 'cancelled'
        ? target.origin === 'PUBLIC_FREE'
          ? `\n\nPara marcar uma nova chamada, acede: ${manageUrl}`
          : ''
        : `\n\nNo dia e hora agendada, a Rafa vai te ligar aqui por chamada de vídeo do WhatsApp, ok?\n\nPara reagendar ou cancelar, acede: ${manageUrl}`;
    const tzLine = `Fuso horário: ${timezoneLabelPt(booking.timezone)} (${booking.timezone})`;
    const when =
      kind === 'cancelled'
        ? `\n\nEstava marcada para: ${startLocal} (até ${endLocal})\n${tzLine}`
        : `\n\nData e hora: ${startLocal} (até ${endLocal})\n${tzLine}`;
    await this.wa.sendText(whatsapp, `${base}${when}${followup}`);
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

    await this.assertNotBlockedByAdmin(startsAt, endsAt);

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

    const userInfo = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, whatsapp: true },
    });
    if (userInfo?.whatsapp) {
      void this.sendBookingMessage(
        { name: userInfo.name, whatsapp: userInfo.whatsapp, bookingId: created.id },
        'booked',
        { startsAt, endsAt, timezone: tz },
      );
    }
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

    await this.assertNotBlockedByAdmin(startsAt, endsAt);

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

    const userInfo = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, whatsapp: true },
    });
    if (userInfo?.whatsapp) {
      void this.sendBookingMessage(
        { name: userInfo.name, whatsapp: userInfo.whatsapp, bookingId: created.id },
        'rescheduled',
        { startsAt, endsAt, timezone: tz },
      );
    }
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

    const userInfo = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, whatsapp: true },
    });
    if (userInfo?.whatsapp) {
      void this.sendBookingMessage(
        { name: userInfo.name, whatsapp: userInfo.whatsapp, bookingId: current.id },
        'cancelled',
        {
          startsAt: current.startsAt,
          endsAt: current.endsAt,
          timezone: current.timezone,
        },
      );
    }
    return updated;
  }

  // ===== FLUXO PÚBLICO GRATUITO =====

  /** Cria booking público gratuito (sem pagamento nem conta). */
  async bookPublic(input: {
    name: string;
    whatsapp: string;
    deviceId: string;
    startsAtUtcIso: string;
    tz: string;
  }) {
    const name = input.name.trim();
    if (!name || name.length < 2) {
      throw new BadRequestException('Indica o teu nome para continuar.');
    }
    const wa = this.normalizeWhatsapp(input.whatsapp);
    if (wa.length < 8) {
      throw new BadRequestException('WhatsApp inválido. Inclui o indicativo do país (ex.: 351…).');
    }
    const deviceId = this.validateClientDeviceId(input.deviceId);

    const startsAt = new Date(input.startsAtUtcIso);
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException('startsAt inválido.');
    const tz = input.tz.trim();
    if (!tz) throw new BadRequestException('tz é obrigatório.');
    if (ymdInTz(tz, startsAt) === ymdInTz(tz, new Date())) {
      throw new BadRequestException('Só é possível agendar a partir do dia seguinte.');
    }

    const existingDevice = await this.getCurrentBookingByDeviceId(deviceId);
    if (existingDevice) {
      throw new BadRequestException(
        'Este dispositivo já tem um agendamento ativo. Usa o link de gestão para alterar ou cancelar.',
      );
    }

    const existingWa = await this.getCurrentBookingByWhatsapp(wa);
    if (existingWa) {
      throw new BadRequestException(
        'Este número de WhatsApp já tem um agendamento ativo.',
      );
    }

    const endsAt = await this.assertSlotAvailableForBooking(startsAt);

    const created = await this.prisma.rafaCallBooking.create({
      data: {
        userId: null,
        guestName: name,
        guestWhatsapp: wa,
        clientDeviceId: deviceId,
        status: RafaCallBookingStatus.SCHEDULED,
        origin: RafaCallBookingOrigin.PUBLIC_FREE,
        startsAt,
        endsAt,
        timezone: tz,
      },
    });

    void this.sendBookingMessage(
      { name, whatsapp: wa, bookingId: created.id, origin: RafaCallBookingOrigin.PUBLIC_FREE },
      'booked',
      { startsAt, endsAt, timezone: tz },
    );

    return this.serializePublicBooking(created);
  }

  // ===== FLUXO GUEST =====

  /** Cria um booking guest a partir de um `RafaCallGuestUnlock` pago. */
  async bookGuest(input: { unlockId: string; startsAtUtcIso: string; tz: string }) {
    const startsAt = new Date(input.startsAtUtcIso);
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException('startsAt inválido.');
    const tz = input.tz.trim();
    if (!tz) throw new BadRequestException('tz é obrigatório.');
    if (ymdInTz(tz, startsAt) === ymdInTz(tz, new Date())) {
      throw new BadRequestException('Só é possível agendar a partir do dia seguinte.');
    }

    const unlock = await this.prisma.rafaCallGuestUnlock.findUnique({
      where: { id: input.unlockId },
    });
    if (!unlock) throw new BadRequestException('Pagamento não encontrado.');
    if (unlock.consumedAt) throw new BadRequestException('Este pagamento já foi usado num agendamento.');
    if (!unlock.paidAt) throw new BadRequestException('Pagamento ainda não confirmado. Tenta novamente em instantes.');
    if (unlock.expiresAt < new Date()) throw new BadRequestException('Este pagamento expirou.');

    // Bloqueia novo agendamento se já houver outro ativo para o mesmo WhatsApp.
    const existing = await this.getCurrentBookingByWhatsapp(unlock.whatsapp);
    if (existing) {
      throw new BadRequestException(
        'Este número de WhatsApp já tem um agendamento ativo. Use o link enviado para gerir o seu agendamento.',
      );
    }

    const duration = this.durationMinutes;
    const endsAt = new Date(startsAt.getTime() + duration * 60000);
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
    if (
      candidates.some((b) => {
        const bEndGap = new Date(b.endsAt.getTime() + buffer * 60000);
        return startsAt < bEndGap && newEndGap > b.startsAt;
      })
    ) {
      throw new BadRequestException('Este horário já não está disponível.');
    }

    await this.assertNotBlockedByAdmin(startsAt, endsAt);

    const created = await this.prisma.rafaCallBooking.create({
      data: {
        userId: null,
        guestName: unlock.name,
        guestWhatsapp: unlock.whatsapp,
        status: RafaCallBookingStatus.SCHEDULED,
        origin: 'USER_PAID',
        startsAt,
        endsAt,
        timezone: tz,
      },
    });

    await this.prisma.rafaCallGuestUnlock.update({
      where: { id: unlock.id },
      data: { consumedAt: new Date(), consumedBookingId: created.id },
    });

    void this.sendBookingMessage(
      { name: unlock.name, whatsapp: unlock.whatsapp, bookingId: created.id },
      'booked',
      { startsAt, endsAt, timezone: tz },
    );

    return created;
  }

  /** Devolve booking + dados visíveis (sem expor user_id) após confirmação por WhatsApp. */
  async getGuestBooking(bookingId: string, whatsapp: string) {
    const booking = await this.assertWhatsappCanAccessBooking(bookingId, whatsapp);
    return {
      id: booking.id,
      status: booking.status,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      timezone: booking.timezone,
      name: booking.guestName ?? null,
      whatsapp: booking.guestWhatsapp ?? null,
      origin: booking.origin,
    };
  }

  /** Reagenda um booking (guest) — exige confirmação por WhatsApp ou deviceId. */
  async rescheduleGuest(input: {
    bookingId: string;
    whatsapp?: string;
    deviceId?: string;
    newStartsAtUtcIso: string;
    tz: string;
  }) {
    const current = await this.resolveGuestBookingAccess(input.bookingId, input);
    if (current.status !== RafaCallBookingStatus.SCHEDULED) {
      throw new BadRequestException('Este agendamento já não está ativo.');
    }

    const startsAt = new Date(input.newStartsAtUtcIso);
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException('newStartsAt inválido.');
    const tz = input.tz.trim();
    if (!tz) throw new BadRequestException('tz é obrigatório.');
    if (ymdInTz(tz, startsAt) === ymdInTz(tz, new Date())) {
      throw new BadRequestException('Só é possível reagendar a partir do dia seguinte.');
    }

    const endsAt = await this.assertSlotAvailableForBooking(startsAt, current.id);

    const [, created] = await this.prisma.$transaction([
      this.prisma.rafaCallBooking.update({
        where: { id: current.id },
        data: {
          status: RafaCallBookingStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: 'reschedule',
        },
      }),
      this.prisma.rafaCallBooking.create({
        data: {
          userId: current.userId,
          guestName: current.guestName,
          guestWhatsapp: current.guestWhatsapp,
          clientDeviceId: current.clientDeviceId,
          status: RafaCallBookingStatus.SCHEDULED,
          origin: current.origin,
          startsAt,
          endsAt,
          timezone: tz,
          rescheduledFromBookingId: current.id,
        },
      }),
    ]);

    // Mantém o unlock associado ao booking ativo (fluxo pago).
    if (current.origin === RafaCallBookingOrigin.USER_PAID) {
      await this.prisma.rafaCallGuestUnlock.updateMany({
        where: { consumedBookingId: current.id },
        data: { consumedBookingId: created.id },
      });
    }

    const name = current.guestName ?? null;
    const wa = current.guestWhatsapp ?? '';
    if (wa) {
      void this.sendBookingMessage(
        { name, whatsapp: wa, bookingId: created.id, origin: current.origin },
        'rescheduled',
        { startsAt, endsAt, timezone: tz },
      );
    }
    this.logger.log(`RafaCall guest reagendado ${current.id} -> ${created.id}`);
    return {
      id: created.id,
      status: created.status,
      startsAt: created.startsAt.toISOString(),
      endsAt: created.endsAt.toISOString(),
      timezone: created.timezone,
      name,
      whatsapp: wa || null,
      origin: created.origin,
    };
  }

  /** Cancela um booking (guest) — exige confirmação por WhatsApp ou deviceId.
   * No fluxo pago, o unlock é restaurado para reutilização.
   */
  async cancelGuest(input: {
    bookingId: string;
    whatsapp?: string;
    deviceId?: string;
    reason?: string | null;
  }) {
    const current = await this.resolveGuestBookingAccess(input.bookingId, input);
    if (current.status !== RafaCallBookingStatus.SCHEDULED) {
      throw new BadRequestException('Este agendamento já não está ativo.');
    }
    const updated = await this.prisma.rafaCallBooking.update({
      where: { id: current.id },
      data: {
        status: RafaCallBookingStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: input.reason?.trim() || 'user_cancel',
      },
    });

    // Restaurar unlock apenas no fluxo pago.
    if (current.origin === RafaCallBookingOrigin.USER_PAID) {
      const newExpiry = new Date();
      newExpiry.setDate(newExpiry.getDate() + 90);
      let restoredUnlock = await this.prisma.rafaCallGuestUnlock.findFirst({
        where: { consumedBookingId: current.id, paidAt: { not: null } },
      });
      if (!restoredUnlock && current.guestWhatsapp) {
        restoredUnlock = await this.prisma.rafaCallGuestUnlock.findFirst({
          where: {
            whatsapp: current.guestWhatsapp,
            paidAt: { not: null },
            consumedAt: { not: null },
          },
          orderBy: { createdAt: 'desc' },
        });
      }
      if (restoredUnlock) {
        await this.prisma.rafaCallGuestUnlock.update({
          where: { id: restoredUnlock.id },
          data: {
            consumedAt: null,
            consumedBookingId: null,
            expiresAt: newExpiry,
          },
        });
      }
    }

    const wa = current.guestWhatsapp ?? '';
    if (wa) {
      void this.sendBookingMessage(
        { name: current.guestName, whatsapp: wa, bookingId: current.id, origin: current.origin },
        'cancelled',
        {
          startsAt: current.startsAt,
          endsAt: current.endsAt,
          timezone: current.timezone,
        },
      );
    }
    return { id: updated.id, status: updated.status };
  }
}

