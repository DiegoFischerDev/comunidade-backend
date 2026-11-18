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
    menuLabel: 'Relocation / aluguel',
    name: 'Joana',
  },
  {
    slug: 'bruna' as const,
    menuOrder: 2,
    menuLabel: 'Crédito imobiliário / compra de casa',
    name: 'Bruna',
  },
  {
    slug: 'gabi' as const,
    menuOrder: 3,
    menuLabel: 'Publicidade com a Rafa',
    name: 'Gabi',
  },
];

describe('buildChatbotMenuText', () => {
  it('lista os bots pela ordem do menu', () => {
    const text = buildChatbotMenuText([
      ...bots,
      {
        slug: 'outros' as const,
        menuOrder: 4,
        menuLabel: 'Falar diretamente com a Rafa sobre outros assuntos',
        name: 'Outros',
      },
    ]);
    expect(text).toContain('🏡 1. Relocation / aluguel');
    expect(text).toContain('🔑 2. Crédito imobiliário / compra de casa');
    expect(text).toContain('💌 3. Publicidade com a Rafa');
    expect(text).toContain(
      '💬 4. Falar diretamente com a Rafa sobre outros assuntos',
    );
  });
});

describe('parseChatbotMenuDigitChoice', () => {
  const botsWithOutros = [
    ...bots,
    {
      slug: 'outros' as const,
      menuOrder: 4,
      menuLabel: 'Falar diretamente com a Rafa sobre outros assuntos',
      name: 'Outros',
    },
  ];

  it('aceita 1, 2, 3 e 4', () => {
    expect(parseChatbotMenuDigitChoice('1', botsWithOutros)).toBe('joana');
    expect(parseChatbotMenuDigitChoice('2)', botsWithOutros)).toBe('bruna');
    expect(parseChatbotMenuDigitChoice('3 - publicidade', botsWithOutros)).toBe(
      'gabi',
    );
    expect(parseChatbotMenuDigitChoice('4', botsWithOutros)).toBe('outros');
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
    expect(parseChatbotMenuChoice('publicidade', bots)).toBe('gabi');
  });

  it('rejeita texto inválido', () => {
    expect(parseChatbotMenuChoice('oi', bots)).toBeNull();
    expect(parseChatbotMenuChoice('4', bots)).toBeNull();
  });
});

describe('parseMenuClassifyResponse', () => {
  it('lê o slug do JSON da OpenAI', () => {
    expect(parseMenuClassifyResponse('{"slug":"gabi"}', bots)).toBe('gabi');
    expect(parseMenuClassifyResponse('{"slug":null}', bots)).toBeNull();
    expect(parseMenuClassifyResponse('lixo {"slug":"bruna"} fim', bots)).toBe(
      'bruna',
    );
  });
});
