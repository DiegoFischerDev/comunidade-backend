export const RAFA_CALL_WORKING_HOURS_ID = 'default';

export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export type WorkingHoursRange = { start: string; end: string };

export type WorkingHoursDays = Record<WeekdayKey, WorkingHoursRange[]>;

const WEEKDAY_LABEL: Record<WeekdayKey, string> = {
  mon: 'segunda',
  tue: 'terça',
  wed: 'quarta',
  thu: 'quinta',
  fri: 'sexta',
  sat: 'sábado',
  sun: 'domingo',
};

export const DEFAULT_WORKING_HOURS: WorkingHoursDays = {
  mon: [{ start: '10:00', end: '18:00' }],
  tue: [{ start: '10:00', end: '18:00' }],
  wed: [{ start: '10:00', end: '18:00' }],
  thu: [{ start: '10:00', end: '18:00' }],
  fri: [{ start: '10:00', end: '18:00' }],
  sat: [],
  sun: [],
};

const MAX_RANGES_PER_DAY = 4;
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function hmToMinutes(hm: string): number | null {
  const match = hm.trim().match(HM_RE);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function weekdayLabel(key: WeekdayKey): string {
  return WEEKDAY_LABEL[key];
}

function emptyDays(): WorkingHoursDays {
  return {
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  };
}

function parseRange(value: unknown): WorkingHoursRange | null {
  if (Array.isArray(value) && value.length === 2) {
    const start = String(value[0] ?? '').trim();
    const end = String(value[1] ?? '').trim();
    if (hmToMinutes(start) == null || hmToMinutes(end) == null) return null;
    return { start, end };
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const start = String(record.start ?? '').trim();
  const end = String(record.end ?? '').trim();
  if (hmToMinutes(start) == null || hmToMinutes(end) == null) return null;
  return { start, end };
}

function parseDayRanges(value: unknown): WorkingHoursRange[] | { error: string } {
  if (!Array.isArray(value)) return { error: 'Cada dia precisa de uma lista de intervalos.' };
  if (value.length > MAX_RANGES_PER_DAY) {
    return { error: `Cada dia pode ter no máximo ${MAX_RANGES_PER_DAY} intervalos.` };
  }
  const ranges: WorkingHoursRange[] = [];
  for (const item of value) {
    const range = parseRange(item);
    if (!range) return { error: 'Usa horas no formato HH:mm.' };
    ranges.push(range);
  }
  return ranges;
}

/** Aceita o JSON do `.env` (tuplos) ou o formato da UI (`{ start, end }`). */
export function parseWorkingHoursDays(
  input: unknown,
): { days: WorkingHoursDays } | { error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'A grelha de horários é inválida.' };
  }
  const record = input as Record<string, unknown>;
  const days = emptyDays();
  for (const key of WEEKDAY_KEYS) {
    if (!(key in record)) {
      return { error: `Falta o horário de ${WEEKDAY_LABEL[key]}.` };
    }
    const parsed = parseDayRanges(record[key]);
    if ('error' in parsed) return parsed;
    days[key] = parsed;
  }
  return { days };
}

export function validateWorkingHoursDays(
  days: WorkingHoursDays,
  options: { durationMinutes: number; bufferMinutes: number },
): string | null {
  const duration = options.durationMinutes;
  const buffer = options.bufferMinutes;
  for (const key of WEEKDAY_KEYS) {
    const label = WEEKDAY_LABEL[key];
    const parsed = days[key]
      .map((range) => ({
        startLabel: range.start,
        endLabel: range.end,
        start: hmToMinutes(range.start),
        end: hmToMinutes(range.end),
      }))
      .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

    for (const range of parsed) {
      if (range.start == null || range.end == null) return 'Usa horas no formato HH:mm.';
      if (range.end <= range.start) {
        return `Em ${label}, a hora de fim tem de ser depois da hora de início.`;
      }
      if (range.end - range.start < duration) {
        return `Em ${label}, ${range.startLabel}–${range.endLabel} é curto para uma chamada de ${duration} min.`;
      }
    }

    for (let index = 1; index < parsed.length; index += 1) {
      const previous = parsed[index - 1];
      const current = parsed[index];
      if (previous.end == null || current.start == null) continue;
      if (current.start < previous.end + buffer) {
        return buffer > 0
          ? `Em ${label}, deixa pelo menos ${buffer} min entre intervalos.`
          : `Em ${label}, os intervalos não podem sobrepor-se.`;
      }
    }
  }
  return null;
}

export function sortWorkingHoursDays(days: WorkingHoursDays): WorkingHoursDays {
  const sorted = emptyDays();
  for (const key of WEEKDAY_KEYS) {
    sorted[key] = [...days[key]].sort(
      (a, b) => (hmToMinutes(a.start) ?? 0) - (hmToMinutes(b.start) ?? 0),
    );
  }
  return sorted;
}

function readEnvTimezone(): string {
  const zone = process.env.RAFA_CALL_WORKING_HOURS_TIMEZONE?.trim();
  if (!zone) return 'Europe/Lisbon';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return 'Europe/Lisbon';
  }
}

function readEnvMinutes(name: string, fallback: number, allowZero: boolean): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  if (allowZero) return value >= 0 ? value : fallback;
  return value > 0 ? value : fallback;
}

function cloneWorkingHoursDays(days: WorkingHoursDays): WorkingHoursDays {
  const copy = emptyDays();
  for (const key of WEEKDAY_KEYS) {
    copy[key] = days[key].map((range) => ({ ...range }));
  }
  return copy;
}

/**
 * Primeiro registo na BD: copia `RAFA_CALL_WORKING_HOURS_JSON`.
 * Dias omitidos no JSON ficam com o horário por omissão. Depois disso, a UI é a fonte.
 */
export function workingHoursSeedFromEnv(): { timezone: string; days: WorkingHoursDays } {
  const timezone = readEnvTimezone();
  const fallback = cloneWorkingHoursDays(DEFAULT_WORKING_HOURS);
  const raw = process.env.RAFA_CALL_WORKING_HOURS_JSON?.trim();
  if (!raw) return { timezone, days: fallback };
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { timezone, days: fallback };
    }
    const record = value as Record<string, unknown>;
    const days = cloneWorkingHoursDays(DEFAULT_WORKING_HOURS);
    for (const key of WEEKDAY_KEYS) {
      if (!(key in record)) continue;
      const parsed = parseDayRanges(record[key]);
      if ('error' in parsed) return { timezone, days: fallback };
      days[key] = parsed;
    }
    const invalid = validateWorkingHoursDays(days, {
      durationMinutes: readEnvMinutes('RAFA_CALL_DURATION_MINUTES', 15, false),
      bufferMinutes: readEnvMinutes('RAFA_CALL_BUFFER_MINUTES', 10, true),
    });
    if (invalid) return { timezone, days: fallback };
    return { timezone, days: sortWorkingHoursDays(days) };
  } catch {
    return { timezone, days: fallback };
  }
}

export function readStoredWorkingHours(value: unknown): WorkingHoursDays {
  const parsed = parseWorkingHoursDays(value);
  if ('error' in parsed) return DEFAULT_WORKING_HOURS;
  return sortWorkingHoursDays(parsed.days);
}
