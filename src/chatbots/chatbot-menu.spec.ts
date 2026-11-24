import {
  buildChatbotMenuText,
  parseChatbotMenuChoice,
  parseChatbotMenuDigitChoice,
  parseMenuClassifyResponse,
} from './chatbot-menu';

const bots = [
  {
    slug: 'joana' as const,
    menuOrder: 1,
    menuLabel: 'Aluguel de imóveis, Visto e preparação para Portugal',
    name: 'Joana',
  },
  {
    slug: 'bruna' as const,
    menuOrder: 2,
    menuLabel: 'Financiamento ou compra de casa em Portugal',
    name: 'Bruna',
  },
  {
    slug: 'gabi' as const,
    menuOrder: 3,
    menuLabel: 'Publicidade e parcerias com a Rafa',
    name: 'Gabi',
  },
  {
    slug: 'outros' as const,
    menuOrder: 4,
    menuLabel: 'Falar diretamente com a Rafa sobre outros assuntos',
    name: 'Outros',
  },
];

describe('buildChatbotMenuText', () => {
  it('lista os bots pela ordem do menu', () => {
    const text = buildChatbotMenuText(bots);
    expect(text).toContain(
      '🏡 1. Aluguel de imóveis, Visto e preparação para Portugal',
    );
    expect(text).toContain('🔑 2. Financiamento ou compra de casa em Portugal');
    expect(text).toContain('💌 3. Publicidade e parcerias com a Rafa');
    expect(text).toContain(
      '💬 4. Falar diretamente com a Rafa sobre outros assuntos',
    );
    expect(text).not.toContain('Bianca');
    expect(text).not.toMatch(/🛂/);
  });
});

describe('parseChatbotMenuDigitChoice', () => {
  it('aceita 1 a 4', () => {
    expect(parseChatbotMenuDigitChoice('1', bots)).toBe('joana');
    expect(parseChatbotMenuDigitChoice('2)', bots)).toBe('bruna');
    expect(parseChatbotMenuDigitChoice('3 - publicidade', bots)).toBe('gabi');
    expect(parseChatbotMenuDigitChoice('4', bots)).toBe('outros');
  });

  it('não classifica texto livre', () => {
    expect(parseChatbotMenuDigitChoice('publicidade', bots)).toBeNull();
    expect(parseChatbotMenuDigitChoice('quero alugar', bots)).toBeNull();
  });
});

describe('parseChatbotMenuChoice (fallback)', () => {
  it('aceita sinónimos simples', () => {
    expect(parseChatbotMenuChoice('quero relocation', bots)).toBe('joana');
    expect(parseChatbotMenuChoice('crédito imobiliário', bots)).toBe('bruna');
    expect(parseChatbotMenuChoice('preciso de visto', bots)).toBe('joana');
    expect(parseChatbotMenuChoice('preparação para Portugal', bots)).toBe(
      'joana',
    );
    expect(parseChatbotMenuChoice('publicidade', bots)).toBe('gabi');
    expect(parseChatbotMenuChoice('falar com a Rafa', bots)).toBe('outros');
  });

  it('rejeita texto inválido', () => {
    expect(parseChatbotMenuChoice('oi', bots)).toBeNull();
  });
});

describe('parseMenuClassifyResponse', () => {
  it('lê o slug do JSON da OpenAI', () => {
    expect(parseMenuClassifyResponse('{"slug":"gabi"}', bots)).toBe('gabi');
    expect(parseMenuClassifyResponse('{"slug":"joana"}', bots)).toBe('joana');
    expect(parseMenuClassifyResponse('{"slug":"bianca"}', bots)).toBeNull();
    expect(parseMenuClassifyResponse('{"slug":null}', bots)).toBeNull();
    expect(parseMenuClassifyResponse('lixo {"slug":"bruna"} fim', bots)).toBe(
      'bruna',
    );
  });
});
