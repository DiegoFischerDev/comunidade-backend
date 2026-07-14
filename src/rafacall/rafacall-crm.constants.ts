import { RafaCallCrmStatus } from '@prisma/client';

export const RAFA_CALL_CRM_STATUS_ORDER: RafaCallCrmStatus[] = [
  RafaCallCrmStatus.ENVIOU_MENSAGEM,
  RafaCallCrmStatus.IMIGRACAO_LONGE,
  RafaCallCrmStatus.IMIGRACAO_PERTO,
  RafaCallCrmStatus.VIDEO_CHAMADA_AGENDADA,
  RafaCallCrmStatus.REALIZOU_VIDEO_CHAMADA,
  RafaCallCrmStatus.AGUARDANDO_ASSINATURA,
  RafaCallCrmStatus.CONTRATO_ASSINADO,
];

export const RAFA_CALL_CRM_STATUS_LABELS: Record<RafaCallCrmStatus, string> = {
  [RafaCallCrmStatus.ENVIOU_MENSAGEM]: 'Sem data para imigar',
  [RafaCallCrmStatus.IMIGRACAO_LONGE]: 'Data para imigrar longe',
  [RafaCallCrmStatus.IMIGRACAO_PERTO]: 'Data para imigrar perto',
  [RafaCallCrmStatus.VIDEO_CHAMADA_AGENDADA]: 'Vídeo chamada agendada',
  [RafaCallCrmStatus.REALIZOU_VIDEO_CHAMADA]: 'Realizou vídeo chamada',
  [RafaCallCrmStatus.AGUARDANDO_ASSINATURA]: 'Contrato enviado',
  [RafaCallCrmStatus.CONTRATO_ASSINADO]: 'Contrato assinado',
};

const CRM_HISTORY_TZ = 'Europe/Lisbon';
export const CRM_IMMIGRATION_TZ = CRM_HISTORY_TZ;
export const CRM_IMMIGRATION_IMMEDIATE_VALUE = 'IMEDIATO';
export const CRM_IMMIGRATION_NEAR_THRESHOLD_DAYS = 90;

export type CrmStatusHistoryContext = {
  at?: Date;
  bookingStartsAt?: Date | null;
  bookingTimezone?: string | null;
  expectedImmigrationAt?: Date | null;
  immigrationImmediate?: boolean;
};

function formatCrmHistoryDayKey(at: Date): string {
  return at.toLocaleDateString('pt-PT', {
    timeZone: CRM_HISTORY_TZ,
    day: '2-digit',
    month: '2-digit',
  });
}

function formatAppointmentForHistory(startsAt: Date, timeZone: string): string {
  const day = startsAt.toLocaleDateString('pt-PT', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
  });
  const time = startsAt.toLocaleTimeString('pt-PT', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const [hourRaw, minuteRaw] = time.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const hourLabel =
    minute === 0 ? `${hour}hr` : `${hour}h${String(minute).padStart(2, '0')}`;
  return `${day} as ${hourLabel}`;
}

export function formatImmigrationMonthYearForHistory(
  date: Date | null | undefined,
): string | null {
  if (!date) return null;
  const monthShort = date
    .toLocaleDateString('pt-PT', { month: 'short', timeZone: 'UTC' })
    .replace(/\.$/, '')
    .toLowerCase();
  return `${monthShort}/${date.getUTCFullYear()}`;
}

export function buildCrmStatusHistoryLine(
  status: RafaCallCrmStatus,
  context: CrmStatusHistoryContext = {},
): string {
  const at = context.at ?? new Date();
  const changeDay = formatCrmHistoryDayKey(at);
  const label = RAFA_CALL_CRM_STATUS_LABELS[status];

  let suffix = '';
  if (
    status === RafaCallCrmStatus.VIDEO_CHAMADA_AGENDADA &&
    context.bookingStartsAt &&
    context.bookingTimezone
  ) {
    suffix = ` para ${formatAppointmentForHistory(
      context.bookingStartsAt,
      context.bookingTimezone,
    )}`;
  } else if (
    status === RafaCallCrmStatus.IMIGRACAO_LONGE ||
    status === RafaCallCrmStatus.IMIGRACAO_PERTO
  ) {
    if (context.immigrationImmediate) {
      suffix = ', imediato';
    } else {
      const immigrationLabel = formatImmigrationMonthYearForHistory(
        context.expectedImmigrationAt,
      );
      if (immigrationLabel) {
        suffix = `, ${immigrationLabel}`;
      }
    }
  }

  return `${changeDay} - ${label}${suffix}`;
}

export function appendCrmComment(existing: string | null | undefined, line: string): string {
  const prev = (existing ?? '').trim();
  return prev ? `${prev}\n${line}` : line;
}

export function isCrmImmigrationImmediateValue(
  value: string | null | undefined,
): boolean {
  return value?.trim().toUpperCase() === CRM_IMMIGRATION_IMMEDIATE_VALUE;
}

export function parseCrmImmigrationInput(value: string | null | undefined): {
  date: Date | null;
  immediate: boolean;
} {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return { date: null, immediate: false };
  }
  if (isCrmImmigrationImmediateValue(trimmed)) {
    return { date: null, immediate: true };
  }
  return {
    date: parseCrmImmigrationDateInput(trimmed),
    immediate: false,
  };
}

export function parseCrmImmigrationDateInput(value: string | null | undefined): Date | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error('INVALID_IMMIGRATION_DATE');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('INVALID_IMMIGRATION_DATE');
  }
  return date;
}

export function formatCrmImmigrationDateKey(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

export function formatCrmImmigrationForApi(
  date: Date | null | undefined,
  immediate: boolean,
): string | null {
  if (immediate) return CRM_IMMIGRATION_IMMEDIATE_VALUE;
  return formatCrmImmigrationDateKey(date);
}

function formatCivilDayKeyInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

export function daysUntilImmigrationDate(
  expectedImmigrationAt: Date,
  at: Date = new Date(),
): number {
  const todayKey = formatCivilDayKeyInTz(at, CRM_IMMIGRATION_TZ);
  const targetKey = formatCrmImmigrationDateKey(expectedImmigrationAt);
  if (!targetKey) return Number.POSITIVE_INFINITY;

  const [todayYear, todayMonth, todayDay] = todayKey.split('-').map(Number);
  const [targetYear, targetMonth, targetDay] = targetKey.split('-').map(Number);
  const todayUtc = Date.UTC(todayYear, todayMonth - 1, todayDay);
  const targetUtc = Date.UTC(targetYear, targetMonth - 1, targetDay);
  return Math.round((targetUtc - todayUtc) / (24 * 60 * 60 * 1000));
}

export function shouldPromoteImmigrationToNear(params: {
  status: RafaCallCrmStatus;
  expectedImmigrationAt: Date | null;
  immigrationImmediate: boolean;
  at?: Date;
}): boolean {
  if (params.status !== RafaCallCrmStatus.IMIGRACAO_LONGE) return false;
  const target = resolveImmigrationColumnFromDate({
    expectedImmigrationAt: params.expectedImmigrationAt,
    immigrationImmediate: params.immigrationImmediate,
    at: params.at,
  });
  return target === RafaCallCrmStatus.IMIGRACAO_PERTO;
}

export function resolveImmigrationColumnFromDate(params: {
  expectedImmigrationAt: Date | null;
  immigrationImmediate: boolean;
  at?: Date;
}): 'IMIGRACAO_LONGE' | 'IMIGRACAO_PERTO' | null {
  if (!params.immigrationImmediate && !params.expectedImmigrationAt) return null;
  if (params.immigrationImmediate) return RafaCallCrmStatus.IMIGRACAO_PERTO;
  const days = daysUntilImmigrationDate(
    params.expectedImmigrationAt!,
    params.at ?? new Date(),
  );
  if (days < CRM_IMMIGRATION_NEAR_THRESHOLD_DAYS) {
    return RafaCallCrmStatus.IMIGRACAO_PERTO;
  }
  return RafaCallCrmStatus.IMIGRACAO_LONGE;
}

const CRM_IMMIGRATION_FUNNEL_STATUSES: RafaCallCrmStatus[] = [
  RafaCallCrmStatus.ENVIOU_MENSAGEM,
  RafaCallCrmStatus.IMIGRACAO_LONGE,
  RafaCallCrmStatus.IMIGRACAO_PERTO,
];

export function resolveStatusAfterImmigrationUpdate(params: {
  currentStatus: RafaCallCrmStatus;
  expectedImmigrationAt: Date | null;
  immigrationImmediate: boolean;
  at?: Date;
}): RafaCallCrmStatus {
  const at = params.at ?? new Date();
  const hasImmigrationDate =
    params.immigrationImmediate || Boolean(params.expectedImmigrationAt);

  if (!hasImmigrationDate) {
    if (
      params.currentStatus === RafaCallCrmStatus.IMIGRACAO_LONGE ||
      params.currentStatus === RafaCallCrmStatus.IMIGRACAO_PERTO
    ) {
      return RafaCallCrmStatus.ENVIOU_MENSAGEM;
    }
    return params.currentStatus;
  }

  if (!CRM_IMMIGRATION_FUNNEL_STATUSES.includes(params.currentStatus)) {
    return params.currentStatus;
  }

  return (
    resolveImmigrationColumnFromDate({
      expectedImmigrationAt: params.expectedImmigrationAt,
      immigrationImmediate: params.immigrationImmediate,
      at,
    }) ?? params.currentStatus
  );
}

export function compareCrmImmigrationEntries(
  left: {
    crmExpectedImmigrationAt: Date | null;
    crmImmigrationImmediate?: boolean;
  },
  right: {
    crmExpectedImmigrationAt: Date | null;
    crmImmigrationImmediate?: boolean;
  },
): number {
  const leftImmediate = left.crmImmigrationImmediate ?? false;
  const rightImmediate = right.crmImmigrationImmediate ?? false;
  if (leftImmediate && rightImmediate) return 0;
  if (leftImmediate) return -1;
  if (rightImmediate) return 1;
  return compareCrmImmigrationDates(
    left.crmExpectedImmigrationAt,
    right.crmExpectedImmigrationAt,
  );
}

export function compareCrmImmigrationDates(
  left: Date | null | undefined,
  right: Date | null | undefined,
): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.getTime() - right.getTime();
}

export function sortCrmItemsByImmigrationDate<
  T extends {
    crmExpectedImmigrationAt: Date | null;
    crmImmigrationImmediate?: boolean;
  },
>(items: T[]): T[] {
  return [...items].sort((left, right) => compareCrmImmigrationEntries(left, right));
}
