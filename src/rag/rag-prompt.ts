export type RagQaSnippet = {
  question: string;
  answer: string;
  score: number;
};

/**
 * Formata o bloco de Q&A a injectar no system prompt dos chatbots.
 * Devolve string vazia se não houver snippets.
 */
export function formatRagPromptBlock(snippets: RagQaSnippet[]): string {
  if (snippets.length === 0) return '';
  const lines = [
    'Perguntas e respostas de referência (usa só se forem relevantes para a mensagem actual do lead; não inventes factos fora disto; não contradigas as regras de qualificação/JSON deste bot; se nada for relevante, ignora este bloco):',
    '',
  ];
  for (const [index, item] of snippets.entries()) {
    lines.push(`Q${index + 1}: ${item.question.trim()}`);
    lines.push(`A${index + 1}: ${item.answer.trim()}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

/** Junta partes do system prompt e um bloco RAG opcional após o contexto de negócio. */
export function buildSystemWithRag(
  parts: string[],
  ragBlock: string | null | undefined,
): string {
  const block = ragBlock?.trim() || '';
  if (!block) return parts.join('\n');
  const out: string[] = [];
  let injected = false;
  for (const part of parts) {
    out.push(part);
    if (!injected && part.trim()) {
      out.push('');
      out.push(block);
      injected = true;
    }
  }
  if (!injected) {
    out.unshift(block);
  }
  return out.join('\n');
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function parseEmbeddingJson(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const nums: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isFinite(item)) return null;
    nums.push(item);
  }
  return nums.length > 0 ? nums : null;
}

export function buildEmbeddingInput(question: string, answer: string): string {
  return `Pergunta: ${question.trim()}\nResposta: ${answer.trim()}`;
}
