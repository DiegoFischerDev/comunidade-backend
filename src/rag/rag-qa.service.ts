import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RagEmbeddingService } from './rag-embedding.service';
import {
  buildEmbeddingInput,
  cosineSimilarity,
  formatRagPromptBlock,
  parseEmbeddingJson,
  type RagQaSnippet,
} from './rag-prompt';

export type RagQaPublic = {
  id: string;
  question: string;
  answer: string;
  isActive: boolean;
  showInFaq: boolean;
  embeddingModel: string;
  createdAt: string;
  updatedAt: string;
};

export type RagFaqPublicItem = {
  id: string;
  question: string;
  answer: string;
};

type CachedPair = {
  id: string;
  question: string;
  answer: string;
  embedding: number[];
};

@Injectable()
export class RagQaService {
  private readonly logger = new Logger(RagQaService.name);
  private cache: CachedPair[] | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: RagEmbeddingService,
  ) {}

  private get topK(): number {
    const n = Number(process.env.RAG_TOP_K || 4);
    if (!Number.isFinite(n) || n < 1) return 4;
    return Math.min(Math.floor(n), 12);
  }

  private get minScore(): number {
    const n = Number(process.env.RAG_MIN_SCORE || 0.35);
    if (!Number.isFinite(n)) return 0.35;
    return Math.min(Math.max(n, 0), 1);
  }

  invalidateCache(): void {
    this.cache = null;
  }

  async list(): Promise<RagQaPublic[]> {
    const rows = await this.prisma.ragQaPair.findMany({
      orderBy: [{ updatedAt: 'desc' }],
    });
    return rows.map((row) => this.toPublic(row));
  }

  /** FAQ público do site (pares com showInFaq). */
  async listFaq(): Promise<RagFaqPublicItem[]> {
    const rows = await this.prisma.ragQaPair.findMany({
      where: { showInFaq: true },
      orderBy: [{ createdAt: 'asc' }],
      select: { id: true, question: true, answer: true },
    });
    return rows.map((row) => ({
      id: row.id,
      question: row.question,
      answer: row.answer,
    }));
  }

  async create(input: {
    question: string;
    answer: string;
    isActive?: boolean;
    showInFaq?: boolean;
  }): Promise<RagQaPublic> {
    const question = input.question.trim();
    const answer = input.answer.trim();
    if (!question || !answer) {
      throw new BadRequestException('Pergunta e resposta são obrigatórias.');
    }
    const embedding = await this.embeddings.embedOrThrow(
      buildEmbeddingInput(question, answer),
    );
    const row = await this.prisma.ragQaPair.create({
      data: {
        question,
        answer,
        embedding: embedding as unknown as Prisma.InputJsonValue,
        embeddingModel: this.embeddings.model,
        isActive: input.isActive !== false,
        showInFaq: input.showInFaq === true,
      },
    });
    this.invalidateCache();
    return this.toPublic(row);
  }

  async update(
    id: string,
    input: {
      question?: string;
      answer?: string;
      isActive?: boolean;
      showInFaq?: boolean;
    },
  ): Promise<RagQaPublic> {
    const existing = await this.prisma.ragQaPair.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Par Q&A não encontrado.');
    }
    const question =
      input.question !== undefined ? input.question.trim() : existing.question;
    const answer =
      input.answer !== undefined ? input.answer.trim() : existing.answer;
    if (!question || !answer) {
      throw new BadRequestException('Pergunta e resposta são obrigatórias.');
    }

    const textChanged =
      question !== existing.question || answer !== existing.answer;
    const willBeActive =
      input.isActive !== undefined ? input.isActive : existing.isActive;
    const existingEmbedding = parseEmbeddingJson(existing.embedding);
    const needsEmbedding =
      textChanged || (willBeActive && !existingEmbedding);

    let embeddingJson: Prisma.InputJsonValue | undefined;
    let embeddingModel: string | undefined;
    if (needsEmbedding) {
      const embedding = await this.embeddings.embedOrThrow(
        buildEmbeddingInput(question, answer),
      );
      embeddingJson = embedding as unknown as Prisma.InputJsonValue;
      embeddingModel = this.embeddings.model;
    }

    const row = await this.prisma.ragQaPair.update({
      where: { id },
      data: {
        question,
        answer,
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.showInFaq !== undefined
          ? { showInFaq: input.showInFaq }
          : {}),
        ...(embeddingJson !== undefined
          ? { embedding: embeddingJson, embeddingModel }
          : {}),
      },
    });
    this.invalidateCache();
    return this.toPublic(row);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.ragQaPair.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Par Q&A não encontrado.');
    }
    await this.prisma.ragQaPair.delete({ where: { id } });
    this.invalidateCache();
    return { ok: true };
  }

  /**
   * Top-k Q&A relevantes para a mensagem do lead.
   * Fail-open: lista vazia se embeddings falharem ou não houver pares.
   */
  async retrieveRelevant(userText: string): Promise<RagQaSnippet[]> {
    const text = userText.trim();
    if (!text) return [];

    const pairs = await this.loadActiveCache();
    if (pairs.length === 0) return [];

    const queryEmbedding = await this.embeddings.embed(text);
    if (!queryEmbedding) return [];

    const scored: RagQaSnippet[] = [];
    for (const pair of pairs) {
      if (pair.embedding.length !== queryEmbedding.length) continue;
      const score = cosineSimilarity(queryEmbedding, pair.embedding);
      if (score < this.minScore) continue;
      scored.push({
        question: pair.question,
        answer: pair.answer,
        score,
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, this.topK);
  }

  /** Bloco pronto para o system prompt, ou null se nada relevante. */
  async retrievePromptBlock(userText: string): Promise<string | null> {
    try {
      const snippets = await this.retrieveRelevant(userText);
      const block = formatRagPromptBlock(snippets);
      return block || null;
    } catch (err: unknown) {
      this.logger.warn(
        `RAG retrieve falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async loadActiveCache(): Promise<CachedPair[]> {
    if (this.cache) return this.cache;
    const rows = await this.prisma.ragQaPair.findMany({
      where: { isActive: true },
      select: {
        id: true,
        question: true,
        answer: true,
        embedding: true,
      },
    });
    const cache: CachedPair[] = [];
    for (const row of rows) {
      const embedding = parseEmbeddingJson(row.embedding);
      if (!embedding) continue;
      cache.push({
        id: row.id,
        question: row.question,
        answer: row.answer,
        embedding,
      });
    }
    this.cache = cache;
    return cache;
  }

  private toPublic(row: {
    id: string;
    question: string;
    answer: string;
    isActive: boolean;
    showInFaq: boolean;
    embeddingModel: string;
    createdAt: Date;
    updatedAt: Date;
  }): RagQaPublic {
    return {
      id: row.id,
      question: row.question,
      answer: row.answer,
      isActive: row.isActive,
      showInFaq: row.showInFaq,
      embeddingModel: row.embeddingModel,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
