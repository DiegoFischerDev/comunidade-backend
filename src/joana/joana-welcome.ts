import { BadRequestException } from '@nestjs/common';

export type JoanaWelcomeStepType = 'TEXT' | 'AUDIO' | 'IMAGE' | 'DOCUMENT';

export type JoanaWelcomeStep = {
  type: JoanaWelcomeStepType;
  textContent?: string | null;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  mediaFileName?: string | null;
  delayMsAfter: number;
};

const MAX_STEPS = 20;

/** Normaliza e valida passos de boas-vindas (TEXT/AUDIO/IMAGE/DOCUMENT). */
export function normalizeJoanaWelcomeSteps(raw: unknown): JoanaWelcomeStep[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new BadRequestException('Os passos de boas-vindas têm de ser uma lista.');
  }
  if (raw.length > MAX_STEPS) {
    throw new BadRequestException(`No máximo ${MAX_STEPS} passos de boas-vindas.`);
  }

  return raw.map((item, index) => normalizeOneStep(item, index));
}

export function parseStoredWelcomeSteps(raw: unknown): JoanaWelcomeStep[] {
  try {
    return normalizeJoanaWelcomeSteps(raw);
  } catch {
    return [];
  }
}

/** Texto para histórico / LLM: só os passos de texto (media fica só no WhatsApp). */
export function welcomeStepsHistorySummary(steps: JoanaWelcomeStep[]): string {
  const texts = steps
    .filter((step) => step.type === 'TEXT')
    .map((step) => (step.textContent || '').trim())
    .filter(Boolean);
  if (texts.length > 0) return texts.join('\n\n');
  if (steps.length === 0) return '';
  return '[Boas-vindas da Joana enviadas com áudio/imagem/documento]';
}

export function isWelcomePdfMedia(input: {
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  mediaFileName?: string | null;
}): boolean {
  const mime = (input.mediaMimeType || '').trim().toLowerCase();
  if (mime === 'application/pdf' || mime.includes('pdf')) return true;
  const name = `${input.mediaFileName || ''} ${input.mediaUrl || ''}`
    .trim()
    .toLowerCase()
    .split('?')[0]!;
  return name.endsWith('.pdf');
}

function normalizeOneStep(raw: unknown, index: number): JoanaWelcomeStep {
  if (!raw || typeof raw !== 'object') {
    throw new BadRequestException(`Passo ${index + 1}: inválido.`);
  }
  const row = raw as Record<string, unknown>;
  const type = row.type;
  if (
    type !== 'TEXT' &&
    type !== 'AUDIO' &&
    type !== 'IMAGE' &&
    type !== 'DOCUMENT'
  ) {
    throw new BadRequestException(
      `Passo ${index + 1}: tipo inválido (usa TEXT, AUDIO, IMAGE ou DOCUMENT).`,
    );
  }

  const delayMsAfter =
    typeof row.delayMsAfter === 'number' && Number.isFinite(row.delayMsAfter)
      ? Math.max(0, Math.min(30_000, Math.floor(row.delayMsAfter)))
      : 650;

  if (type === 'TEXT') {
    const textContent =
      typeof row.textContent === 'string' ? row.textContent.trim() : '';
    if (!textContent) {
      throw new BadRequestException(`Passo ${index + 1}: texto em falta.`);
    }
    return {
      type,
      textContent,
      mediaUrl: null,
      mediaMimeType: null,
      mediaFileName: null,
      delayMsAfter,
    };
  }

  const mediaUrl = typeof row.mediaUrl === 'string' ? row.mediaUrl.trim() : '';
  if (!mediaUrl) {
    throw new BadRequestException(`Passo ${index + 1}: ficheiro/URL em falta.`);
  }
  const mediaMimeType =
    typeof row.mediaMimeType === 'string' && row.mediaMimeType.trim()
      ? row.mediaMimeType.trim()
      : null;
  const mediaFileName =
    typeof row.mediaFileName === 'string' && row.mediaFileName.trim()
      ? row.mediaFileName.trim()
      : null;

  if (type === 'DOCUMENT') {
    if (
      !isWelcomePdfMedia({
        mediaUrl,
        mediaMimeType,
        mediaFileName,
      })
    ) {
      throw new BadRequestException(
        `Passo ${index + 1}: o documento tem de ser um PDF.`,
      );
    }
  }

  const caption =
    type === 'IMAGE' || type === 'DOCUMENT'
      ? typeof row.caption === 'string'
        ? row.caption.trim()
        : typeof row.textContent === 'string'
          ? row.textContent.trim()
          : ''
      : '';

  return {
    type,
    textContent: caption || null,
    mediaUrl,
    mediaMimeType:
      type === 'DOCUMENT' ? mediaMimeType || 'application/pdf' : mediaMimeType,
    mediaFileName:
      type === 'DOCUMENT'
        ? mediaFileName || mediaUrl.split('/').pop()?.split('?')[0] || 'documento.pdf'
        : mediaFileName,
    delayMsAfter,
  };
}
