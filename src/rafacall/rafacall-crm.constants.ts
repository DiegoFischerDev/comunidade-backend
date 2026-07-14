import { RafaCallCrmStatus } from '@prisma/client';

export const RAFA_CALL_CRM_STATUS_ORDER: RafaCallCrmStatus[] = [
  RafaCallCrmStatus.ENVIOU_MENSAGEM,
  RafaCallCrmStatus.IMIGRACAO_MUITO_LONGE,
  RafaCallCrmStatus.VIDEO_CHAMADA_AGENDADA,
  RafaCallCrmStatus.REALIZOU_VIDEO_CHAMADA,
  RafaCallCrmStatus.AGUARDANDO_ASSINATURA,
  RafaCallCrmStatus.CONTRATO_ASSINADO,
];

export const RAFA_CALL_CRM_STATUS_LABELS: Record<RafaCallCrmStatus, string> = {
  [RafaCallCrmStatus.ENVIOU_MENSAGEM]: 'Enviou mensagem',
  [RafaCallCrmStatus.VIDEO_CHAMADA_AGENDADA]: 'Vídeo chamada agendada',
  [RafaCallCrmStatus.REALIZOU_VIDEO_CHAMADA]: 'Realizou vídeo chamada',
  [RafaCallCrmStatus.IMIGRACAO_MUITO_LONGE]: 'Data para imigrar muito longe ainda',
  [RafaCallCrmStatus.AGUARDANDO_ASSINATURA]: 'Aguardando assinatura do contrato',
  [RafaCallCrmStatus.CONTRATO_ASSINADO]: 'Contrato assinado',
};

const CRM_HISTORY_TZ = 'Europe/Lisbon';

export type CrmStatusHistoryContext = {
  at?: Date;
  bookingStartsAt?: Date | null;
  bookingTimezone?: string | null;
  expectedImmigrationAt?: Date | null;
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
  } else if (status === RafaCallCrmStatus.IMIGRACAO_MUITO_LONGE) {
    const immigrationLabel = formatImmigrationMonthYearForHistory(
      context.expectedImmigrationAt,
    );
    if (immigrationLabel) {
      suffix = `, ${immigrationLabel}`;
    }
  }

  return `${changeDay} - ${label}${suffix}`;
}

export function appendCrmComment(existing: string | null | undefined, line: string): string {
  const prev = (existing ?? '').trim();
  return prev ? `${prev}\n${line}` : line;
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
  T extends { crmExpectedImmigrationAt: Date | null },
>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    compareCrmImmigrationDates(
      left.crmExpectedImmigrationAt,
      right.crmExpectedImmigrationAt,
    ),
  );
}
