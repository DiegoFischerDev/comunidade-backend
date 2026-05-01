import { Prisma, PrismaClient } from '@prisma/client';

/** Últimos N atendimentos usados na média de tempo até primeiro contacto. */
export const PARTNER_RESPONSE_AVG_SAMPLE_LIMIT = 10;

/** Janela de horário comercial (Portugal continental). */
const BUSINESS_TIMEZONE = 'Europe/Lisbon';
const BUSINESS_START_HOUR = 10;
const BUSINESS_END_HOUR = 18;

type DbLike = Pick<PrismaClient, 'lead'> | Prisma.TransactionClient;

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const zonedPartsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function getZonedParts(date: Date): ZonedParts {
  const parts = zonedPartsFmt.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
  };
}

function toPseudoUtcMinutes(parts: ZonedParts): number {
  return Math.floor(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) / 60000,
  );
}

/**
 * Converte data/hora local de Portugal para UTC sem libs externas.
 * Itera até alinhar as partes locais ao alvo (suporta horário de verão).
 */
function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  let guessMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const wanted = toPseudoUtcMinutes({ year, month, day, hour, minute });
  for (let i = 0; i < 5; i += 1) {
    const got = getZonedParts(new Date(guessMs));
    const gotPseudo = toPseudoUtcMinutes(got);
    const diffMinutes = wanted - gotPseudo;
    if (diffMinutes === 0) break;
    guessMs += diffMinutes * 60000;
  }
  return new Date(guessMs);
}

function nextDay(parts: Pick<ZonedParts, 'year' | 'month' | 'day'>) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  d.setUTCDate(d.getUTCDate() + 1);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function isWeekdayPortugal(
  parts: Pick<ZonedParts, 'year' | 'month' | 'day'>,
): boolean {
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return weekday >= 1 && weekday <= 5; // segunda..sexta
}

function compareLocalDate(
  a: Pick<ZonedParts, 'year' | 'month' | 'day'>,
  b: Pick<ZonedParts, 'year' | 'month' | 'day'>,
): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

/** Minutos úteis entre dois instantes UTC, considerando seg-sex, 10h-18h (Portugal). */
export function computeBusinessMinutesBetween(startUtc: Date, endUtc: Date): number {
  if (!(startUtc instanceof Date) || !(endUtc instanceof Date)) return 0;
  if (Number.isNaN(startUtc.getTime()) || Number.isNaN(endUtc.getTime())) return 0;
  if (endUtc <= startUtc) return 0;

  const startLocal = getZonedParts(startUtc);
  const endLocal = getZonedParts(endUtc);
  let cursor = { year: startLocal.year, month: startLocal.month, day: startLocal.day };
  const last = { year: endLocal.year, month: endLocal.month, day: endLocal.day };

  let sumMinutes = 0;

  while (compareLocalDate(cursor, last) <= 0) {
    if (isWeekdayPortugal(cursor)) {
      const winStart = zonedDateTimeToUtc(
        cursor.year,
        cursor.month,
        cursor.day,
        BUSINESS_START_HOUR,
        0,
      );
      const winEnd = zonedDateTimeToUtc(
        cursor.year,
        cursor.month,
        cursor.day,
        BUSINESS_END_HOUR,
        0,
      );

      const overlapStart = Math.max(startUtc.getTime(), winStart.getTime());
      const overlapEnd = Math.min(endUtc.getTime(), winEnd.getTime());
      if (overlapEnd > overlapStart) {
        sumMinutes += (overlapEnd - overlapStart) / 60000;
      }
    }
    cursor = nextDay(cursor);
  }

  return Math.max(0, sumMinutes);
}

/**
 * Média dos minutos úteis (seg-sex, 10h-18h PT) entre `createdAt` e `attendedAt`
 * nos últimos N leads já contactados (por data de `attendedAt`, mais recentes primeiro).
 */
export async function computePartnerAverageResponseMinutes(
  partnerId: string,
  db: DbLike,
): Promise<{ averageMinutes: number | null; sampleCount: number }> {
  const rows = await db.lead.findMany({
    where: { partnerId, attendedAt: { not: null } },
    orderBy: { attendedAt: 'desc' },
    take: PARTNER_RESPONSE_AVG_SAMPLE_LIMIT,
    select: { createdAt: true, attendedAt: true },
  });
  if (rows.length === 0) {
    return { averageMinutes: null, sampleCount: 0 };
  }

  let sum = 0;
  for (const r of rows) {
    const attendedAt = r.attendedAt!;
    sum += computeBusinessMinutesBetween(r.createdAt, attendedAt);
  }
  return {
    averageMinutes: sum / rows.length,
    sampleCount: rows.length,
  };
}
