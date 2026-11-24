import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { JoanaWelcomeStep } from '../joana/joana-welcome';
import {
  ensureNameTagPreserved,
  MESSAGE_NAME_TAG,
} from '../common/message-personalize';
import { massDispatchTextStepIndexes } from './mass-dispatch-steps';

const VARIATIONS_PER_STEP = 10;

@Injectable()
export class MassDispatchVariationsService {
  private readonly logger = new Logger(MassDispatchVariationsService.name);

  private get apiKey(): string {
    return (process.env.OPENAI_API_KEY || '').trim();
  }

  private get model(): string {
    return (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Gera variações OpenAI para cada passo TEXT.
   * Devolve mapa `stepIndex → string[]` (inclui o original como 1.ª variação).
   */
  async generateForSteps(
    steps: JoanaWelcomeStep[],
  ): Promise<Record<string, string[]>> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY não está configurada — não é possível gerar variações.',
      );
    }

    const indexes = massDispatchTextStepIndexes(steps);
    const out: Record<string, string[]> = {};

    for (const index of indexes) {
      const original = (steps[index]!.textContent || '').trim();
      const variations = await this.generateVariations(original);
      out[String(index)] = variations;
    }

    return out;
  }

  private async generateVariations(original: string): Promise<string[]> {
    const controller = new AbortController();
    const timeoutMs = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS || 45_000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.85,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: [
                'És um redactor para mensagens de WhatsApp/Instagram Direct de uma equipa de relocation em Portugal.',
                'Recebes uma mensagem original e devolves variações com o MESMO sentido e tom.',
                'Não inventes ofertas, preços, links nem factos novos.',
                'Mantém português natural (Brasil/Portugal), curto e humano.',
                `Se a mensagem tiver a tag exacta ${MESSAGE_NAME_TAG}, mantém-na tal e qual em todas as variações (não a substituas por um nome real).`,
                `Devolve só JSON: { "variations": string[] } com exactamente ${VARIATIONS_PER_STEP - 1} strings diferentes da original.`,
              ].join(' '),
            },
            {
              role: 'user',
              content: `Mensagem original:\n${original}`,
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`OpenAI ${res.status}: ${body.slice(0, 400)}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content ?? '';
      const parsed = this.parseVariationsJson(content);
      const cleaned = parsed
        .map((v) => ensureNameTagPreserved(original, v.trim()))
        .filter((v) => v && v !== original);

      const unique = [...new Set(cleaned)].slice(0, VARIATIONS_PER_STEP - 1);
      if (unique.length < 3) {
        throw new Error('OpenAI devolveu poucas variações úteis.');
      }

      return [original, ...unique];
    } catch (err) {
      this.logger.warn(
        `Falha a gerar variações: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException(
        'Não foi possível gerar variações da mensagem. Tenta de novo.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseVariationsJson(content: string): string[] {
    try {
      const json = JSON.parse(content) as { variations?: unknown };
      if (!Array.isArray(json.variations)) return [];
      return json.variations.filter((v): v is string => typeof v === 'string');
    } catch {
      return [];
    }
  }
}
