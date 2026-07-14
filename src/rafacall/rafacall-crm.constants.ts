import { RafaCallCrmStatus } from '@prisma/client';

export const RAFA_CALL_CRM_STATUS_ORDER: RafaCallCrmStatus[] = [
  RafaCallCrmStatus.ENVIOU_MENSAGEM,
  RafaCallCrmStatus.VIDEO_CHAMADA_AGENDADA,
  RafaCallCrmStatus.REALIZOU_VIDEO_CHAMADA,
  RafaCallCrmStatus.NAO_TEM_INTERESSE,
  RafaCallCrmStatus.INTERESSE_FUTURO,
  RafaCallCrmStatus.AGUARDANDO_ASSINATURA,
  RafaCallCrmStatus.CONTRATO_ASSINADO,
];

export const RAFA_CALL_CRM_STATUS_LABELS: Record<RafaCallCrmStatus, string> = {
  [RafaCallCrmStatus.ENVIOU_MENSAGEM]: 'Enviou mensagem',
  [RafaCallCrmStatus.VIDEO_CHAMADA_AGENDADA]: 'Vídeo chamada agendada',
  [RafaCallCrmStatus.REALIZOU_VIDEO_CHAMADA]: 'Realizou vídeo chamada',
  [RafaCallCrmStatus.NAO_TEM_INTERESSE]: 'Não tem interesse de avançar',
  [RafaCallCrmStatus.INTERESSE_FUTURO]: 'Tem interesse de avançar futuramente',
  [RafaCallCrmStatus.AGUARDANDO_ASSINATURA]: 'Aguardando assinatura do contrato',
  [RafaCallCrmStatus.CONTRATO_ASSINADO]: 'Contrato assinado',
};

const CRM_HISTORY_TZ = 'Europe/Lisbon';

export function formatCrmHistoryTimestamp(at: Date = new Date()): string {
  const date = at.toLocaleDateString('pt-PT', {
    timeZone: CRM_HISTORY_TZ,
    day: '2-digit',
    month: '2-digit',
  });
  const hour = at.toLocaleTimeString('pt-PT', {
    timeZone: CRM_HISTORY_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const h = hour.replace(':', 'h').replace(/^0/, '');
  return `${date} às ${h}`;
}

export function buildCrmStatusHistoryLine(status: RafaCallCrmStatus, at: Date = new Date()): string {
  const label = RAFA_CALL_CRM_STATUS_LABELS[status];
  return `${label} em ${formatCrmHistoryTimestamp(at)}`;
}

export function appendCrmComment(existing: string | null | undefined, line: string): string {
  const prev = (existing ?? '').trim();
  return prev ? `${prev}\n${line}` : line;
}
