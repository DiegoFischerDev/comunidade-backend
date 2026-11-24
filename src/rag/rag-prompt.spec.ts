import {
  buildSystemWithRag,
  cosineSimilarity,
  formatRagPromptBlock,
  parseEmbeddingJson,
} from './rag-prompt';

describe('rag-prompt', () => {
  it('cosineSimilarity devolve 1 para vectors iguais', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it('cosineSimilarity devolve 0 para ortogonais', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('formatRagPromptBlock devolve vazio sem snippets', () => {
    expect(formatRagPromptBlock([])).toBe('');
  });

  it('formatRagPromptBlock inclui Q/A', () => {
    const block = formatRagPromptBlock([
      {
        id: 'test-id',
        code: 'Rag01',
        question: 'Preço?',
        answer: 'Depende do pacote.',
        score: 0.9,
      },
    ]);
    expect(block).toContain('Q1: Preço?');
    expect(block).toContain('A1: Depende do pacote.');
  });

  it('buildSystemWithRag injecta após o contexto', () => {
    const system = buildSystemWithRag(
      ['Contexto do bot', '', 'Regras'],
      'Bloco RAG',
    );
    expect(system.indexOf('Contexto do bot')).toBeLessThan(system.indexOf('Bloco RAG'));
    expect(system.indexOf('Bloco RAG')).toBeLessThan(system.indexOf('Regras'));
  });

  it('parseEmbeddingJson rejeita valores inválidos', () => {
    expect(parseEmbeddingJson([1, 2, 3])).toEqual([1, 2, 3]);
    expect(parseEmbeddingJson([1, 'x'])).toBeNull();
    expect(parseEmbeddingJson(null)).toBeNull();
  });
});
