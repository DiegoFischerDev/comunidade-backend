import { BadRequestException } from '@nestjs/common';
import {
  ensureNameTagPreserved,
  MESSAGE_NAME_TAG,
  personalizeMessageText,
} from '../common/message-personalize';
import {
  normalizeJoanaWelcomeSteps,
  type JoanaWelcomeStep,
} from '../joana/joana-welcome';

const ALLOWED = new Set(['TEXT', 'IMAGE', 'DOCUMENT']);

/** @deprecated Prefer `MESSAGE_NAME_TAG` — mantido para o UI/admin do disparo. */
export const MASS_DISPATCH_NAME_TAG = MESSAGE_NAME_TAG;

export { ensureNameTagPreserved };

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

/**
 * Personaliza `{{nome}}` nos passos (fallback; o outbound também personaliza).
 * Útil para garantir o nome do recipient do disparo mesmo se a conversa não tiver displayName.
 */
export function applyLeadPersonalization(
  steps: JoanaWelcomeStep[],
  displayName: string | null | undefined,
): JoanaWelcomeStep[] {
  return steps.map((step) => {
    const body = (step.textContent || '').trim();
    if (!body) return step;
    const next = personalizeMessageText(body, displayName);
    if (next === body) return step;
    return { ...step, textContent: next };
  });
}
