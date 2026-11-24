import { BadRequestException } from '@nestjs/common';
import {
  normalizeJoanaWelcomeSteps,
  type JoanaWelcomeStep,
} from '../joana/joana-welcome';

const ALLOWED = new Set(['TEXT', 'IMAGE', 'DOCUMENT']);

/** Tag dinâmica substituída pelo primeiro nome do lead no envio. */
export const MASS_DISPATCH_NAME_TAG = '{{nome}}';

const NAME_TAG_RE = /\{\{\s*nome\s*\}\}/gi;
const NAME_TAG_TEST_RE = /\{\{\s*nome\s*\}\}/i;

/** Normaliza passos do disparo: TEXT / IMAGE / DOCUMENT (sem AUDIO). */
export function normalizeMassDispatchSteps(raw: unknown): JoanaWelcomeStep[] {
  const steps = normalizeJoanaWelcomeSteps(raw);
  if (steps.length === 0) {
    throw new BadRequestException('A sequência precisa de pelo menos um passo.');
  }
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (!ALLOWED.has(step.type)) {
      throw new BadRequestException(
        `Passo ${i + 1}: o disparo só aceita TEXT, IMAGE ou DOCUMENT.`,
      );
    }
  }
  return steps;
}

export function massDispatchTextStepIndexes(
  steps: JoanaWelcomeStep[],
): number[] {
  return steps
    .map((step, index) =>
      step.type === 'TEXT' && (step.textContent || '').trim() ? index : -1,
    )
    .filter((index) => index >= 0);
}

export function applyTextVariations(
  steps: JoanaWelcomeStep[],
  textVariations: Record<string, string[]>,
  variationIndex: number,
): JoanaWelcomeStep[] {
  return steps.map((step, index) => {
    if (step.type !== 'TEXT') return step;
    const list = textVariations[String(index)];
    if (!list || list.length === 0) return step;
    const picked = list[variationIndex % list.length]!.trim();
    if (!picked) return step;
    return { ...step, textContent: picked };
  });
}

/** Primeiro nome para personalização (ex.: «Maria Silva» → «Maria»). */
export function massDispatchLeadFirstName(
  displayName: string | null | undefined,
): string {
  const raw = (displayName || '').trim();
  if (!raw) return '';
  return raw.split(/\s+/)[0] || '';
}

/**
 * Substitui `{{nome}}` pelo primeiro nome do lead e limpa espaços sobrantes.
 */
export function personalizeMassDispatchText(
  text: string,
  displayName: string | null | undefined,
): string {
  const name = massDispatchLeadFirstName(displayName);
  let out = text.replace(NAME_TAG_RE, name);
  out = out.replace(/\s{2,}/g, ' ');
  out = out.replace(/\s+([,.;!?])/g, '$1');
  return out.trim();
}

export function applyLeadPersonalization(
  steps: JoanaWelcomeStep[],
  displayName: string | null | undefined,
): JoanaWelcomeStep[] {
  return steps.map((step) => {
    const body = (step.textContent || '').trim();
    if (!body || !NAME_TAG_TEST_RE.test(body)) return step;
    return {
      ...step,
      textContent: personalizeMassDispatchText(body, displayName),
    };
  });
}

/** Garante que variações OpenAI mantêm a tag se a original a tinha. */
export function ensureNameTagPreserved(
  original: string,
  variation: string,
): string {
  if (!NAME_TAG_TEST_RE.test(original)) return variation;
  if (NAME_TAG_TEST_RE.test(variation)) {
    return variation.replace(NAME_TAG_RE, MASS_DISPATCH_NAME_TAG);
  }
  // Se a IA removeu a tag, anexa no início de forma natural.
  return `${MASS_DISPATCH_NAME_TAG}, ${variation}`.trim();
}
