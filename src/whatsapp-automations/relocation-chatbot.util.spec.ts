import {
  fallbackLeadName,
  parseRelocationReply,
  relocationDayKey,
} from './relocation-chatbot.util';

describe('relocationDayKey', () => {
  it('usa o dia civil de Lisboa, inclusive na virada de verão', () => {
    expect(relocationDayKey(new Date('2026-07-15T22:30:00.000Z'))).toBe(
      '2026-07-15',
    );
    expect(relocationDayKey(new Date('2026-07-15T23:30:00.000Z'))).toBe(
      '2026-07-16',
    );
  });
});

describe('parseRelocationReply', () => {
  it('aceita a opção 1', () => {
    expect(parseRelocationReply('1')).toBe('SIM');
    expect(parseRelocationReply('1 - Sim')).toBe('SIM');
    expect(parseRelocationReply('1.sim')).toBe('SIM');
  });

  it('aceita a opção 2', () => {
    expect(parseRelocationReply('2')).toBe('NAO');
    expect(parseRelocationReply('2 - Não')).toBe('NAO');
  });

  it('ignora texto que não é a escolha', () => {
    expect(parseRelocationReply('olá')).toBeNull();
    expect(parseRelocationReply('10')).toBeNull();
    expect(parseRelocationReply('sim')).toBeNull();
  });
});

describe('fallbackLeadName', () => {
  it('usa os últimos dígitos', () => {
    expect(fallbackLeadName('351912345678')).toBe('Lead 5678');
  });
});
