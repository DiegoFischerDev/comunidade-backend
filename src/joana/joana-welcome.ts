import { BadRequestException } from '@nestjs/common';
import { toAbsoluteMediaUrl } from '../common/public-media-url';
import { getFrontendBaseUrl } from '../config/frontend-base-url';

export type JoanaWelcomeStepType = 'TEXT' | 'AUDIO' | 'IMAGE' | 'DOCUMENT';

export type JoanaWelcomeStep = {
  type: JoanaWelcomeStepType;
  textContent?: string | null;
  /** URL canónica / fallback (legado). */
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  mediaFileName?: string | null;
  /** Variante optimizada para WhatsApp (ex.: Ogg Opus PTT). */
  mediaUrlWhatsapp?: string | null;
  mediaMimeTypeWhatsapp?: string | null;
  /** Variante optimizada para Instagram (ex.: M4A/AAC). */
  mediaUrlInstagram?: string | null;
  mediaMimeTypeInstagram?: string | null;
  delayMsAfter: number;
};

export type WelcomeChannel = 'whatsapp' | 'instagram';

export type WelcomeChannelMedia = {
  mediaUrl: string;
  mediaMimeType: string | null;
  mediaFileName: string | null;
};

/**
 * Escolhe a URL/mime do canal. WhatsApp prefere Ogg; Instagram prefere M4A.
 * Fallback para `mediaUrl` legado.
 */
export function pickWelcomeMediaForChannel(
  step: JoanaWelcomeStep,
  channel: WelcomeChannel,
): WelcomeChannelMedia | null {
  if (step.type === 'TEXT') return null;
  if (channel === 'instagram') {
    const mediaUrl = (
      step.mediaUrlInstagram ||
      step.mediaUrl ||
      step.mediaUrlWhatsapp ||
      ''
    ).trim();
    if (!mediaUrl) return null;
    return {
      mediaUrl,
      mediaMimeType:
        step.mediaMimeTypeInstagram?.trim() ||
        step.mediaMimeType?.trim() ||
        null,
      mediaFileName: step.mediaFileName?.trim() || null,
    };
  }
  const mediaUrl = (
    step.mediaUrlWhatsapp ||
    step.mediaUrl ||
    step.mediaUrlInstagram ||
    ''
  ).trim();
  if (!mediaUrl) return null;
  return {
    mediaUrl,
    mediaMimeType:
      step.mediaMimeTypeWhatsapp?.trim() ||
      step.mediaMimeType?.trim() ||
      null,
    mediaFileName: step.mediaFileName?.trim() || null,
  };
}

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

/** Texto para histórico / LLM: passos de texto (media sai no canal). */
export function welcomeStepsHistorySummary(steps: JoanaWelcomeStep[]): string {
  const texts = steps
    .filter((step) => step.type === 'TEXT')
    .map((step) => (step.textContent || '').trim())
    .filter(Boolean);
  if (texts.length > 0) return texts.join('\n\n');
  if (steps.length === 0) return '';
  return '[Boas-vindas enviadas com áudio/imagem/documento]';
}

/** URL absoluta para Evolution / Meta (descarregam o ficheiro). */
export function resolveWelcomeMediaUrl(stored: string): string {
  const u = stored.trim();
  if (!u) return '';
  if (u.startsWith('https://') || u.startsWith('http://')) return u;
  if (u.startsWith('/brand/')) {
    const front = getFrontendBaseUrl().replace(/\/$/, '');
    return `${front}${u}`;
  }
  return toAbsoluteMediaUrl(u);
}

export function guessWelcomeImageMime(nameOrUrl: string): string {
  const lower = nameOrUrl.split('?')[0]!.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
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

  const optionalUrl = (key: string): string | null => {
    const v = row[key];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const optionalMime = (key: string): string | null => {
    const v = row[key];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };

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
      mediaUrlWhatsapp: null,
      mediaMimeTypeWhatsapp: null,
      mediaUrlInstagram: null,
      mediaMimeTypeInstagram: null,
      delayMsAfter,
    };
  }

  const mediaUrlWhatsapp = optionalUrl('mediaUrlWhatsapp');
  const mediaUrlInstagram = optionalUrl('mediaUrlInstagram');
  const mediaUrlRaw =
    typeof row.mediaUrl === 'string' ? row.mediaUrl.trim() : '';
  const mediaUrl =
    mediaUrlRaw || mediaUrlWhatsapp || mediaUrlInstagram || '';
  if (!mediaUrl) {
    throw new BadRequestException(`Passo ${index + 1}: ficheiro/URL em falta.`);
  }
  const mediaMimeType =
    typeof row.mediaMimeType === 'string' && row.mediaMimeType.trim()
      ? row.mediaMimeType.trim()
      : null;
  const mediaMimeTypeWhatsapp = optionalMime('mediaMimeTypeWhatsapp');
  const mediaMimeTypeInstagram = optionalMime('mediaMimeTypeInstagram');
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
    mediaUrlWhatsapp: mediaUrlWhatsapp || mediaUrl,
    mediaMimeTypeWhatsapp:
      type === 'DOCUMENT'
        ? mediaMimeTypeWhatsapp || mediaMimeType || 'application/pdf'
        : mediaMimeTypeWhatsapp || mediaMimeType,
    mediaUrlInstagram: mediaUrlInstagram || mediaUrl,
    mediaMimeTypeInstagram:
      type === 'DOCUMENT'
        ? mediaMimeTypeInstagram || mediaMimeType || 'application/pdf'
        : mediaMimeTypeInstagram || mediaMimeType,
    delayMsAfter,
  };
}
