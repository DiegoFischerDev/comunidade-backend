import { buildChatbotMenuText, parseChatbotMenuChoice } from './chatbot-menu';

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
    const text = buildChatbotMenuText(bots);
    expect(text).toContain('1 — Relocation / aluguel');
    expect(text).toContain('2 — Crédito imobiliário / compra de casa');
    expect(text).toContain('3 — Publicidade com a Rafa');
  });
});

describe('parseChatbotMenuChoice', () => {
  it('aceita 1, 2 e 3', () => {
    expect(parseChatbotMenuChoice('1', bots)).toBe('joana');
    expect(parseChatbotMenuChoice('2)', bots)).toBe('bruna');
    expect(parseChatbotMenuChoice('3 - publicidade', bots)).toBe('gabi');
  });

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
