import { BadRequestException } from '@nestjs/common';

export type JoanaWelcomeStepType = 'TEXT' | 'AUDIO' | 'IMAGE';

export type JoanaWelcomeStep = {
  type: JoanaWelcomeStepType;
  textContent?: string | null;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  mediaFileName?: string | null;
  delayMsAfter: number;
};

const MAX_STEPS = 20;

/** Normaliza e valida passos de boas-vindas (mesmo contrato das automações). */
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
  return '[Boas-vindas da Joana enviadas com áudio/imagem]';
}

function normalizeOneStep(raw: unknown, index: number): JoanaWelcomeStep {
  if (!raw || typeof raw !== 'object') {
    throw new BadRequestException(`Passo ${index + 1}: inválido.`);
  }
  const row = raw as Record<string, unknown>;
  const type = row.type;
  if (type !== 'TEXT' && type !== 'AUDIO' && type !== 'IMAGE') {
    throw new BadRequestException(
      `Passo ${index + 1}: tipo inválido (usa TEXT, AUDIO ou IMAGE).`,
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
  const caption =
    type === 'IMAGE'
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
      typeof row.mediaMimeType === 'string' && row.mediaMimeType.trim()
        ? row.mediaMimeType.trim()
        : null,
    mediaFileName:
      typeof row.mediaFileName === 'string' && row.mediaFileName.trim()
        ? row.mediaFileName.trim()
        : null,
    delayMsAfter,
  };
}
