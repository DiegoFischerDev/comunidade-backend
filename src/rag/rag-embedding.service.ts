import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class RagEmbeddingService {
  private readonly logger = new Logger(RagEmbeddingService.name);

  private get apiKey(): string {
    return (process.env.OPENAI_API_KEY || '').trim();
  }

  get model(): string {
    return (process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small').trim();
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Gera embedding OpenAI. Devolve null se a API falhar (fail-open no retrieve).
   * Em create/update admin preferimos lançar erro — usar `embedOrThrow`.
   */
  async embed(text: string): Promise<number[] | null> {
    try {
      return await this.embedOrThrow(text);
    } catch (err: unknown) {
      this.logger.warn(
        `Embedding falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async embedOrThrow(text: string): Promise<number[]> {
    if (!this.isConfigured()) {
      throw new Error('OPENAI_API_KEY não está configurada.');
    }
    const input = text.trim().slice(0, 8000);
    if (!input) {
      throw new Error('Texto vazio para embedding.');
    }

    const controller = new AbortController();
    const configured = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS || 45000);
    const timeoutMs = Math.max(
      Number.isFinite(configured) ? configured : 45_000,
      15_000,
    );
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          input,
        }),
        signal: controller.signal,
      });
      const raw = await res.text();
      if (!res.ok) {
        throw new Error(`OpenAI embeddings ${res.status}: ${raw.slice(0, 400)}`);
      }
      const parsed = JSON.parse(raw) as {
        data?: Array<{ embedding?: number[] }>;
      };
      const embedding = parsed.data?.[0]?.embedding;
      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error('OpenAI embeddings: resposta sem vector.');
      }
      if (!embedding.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        throw new Error('OpenAI embeddings: vector inválido.');
      }
      return embedding;
    } finally {
      clearTimeout(timeout);
    }
  }
}
