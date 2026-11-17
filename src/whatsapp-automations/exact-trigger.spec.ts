import { findExactTrigger, scriptedStepText } from './whatsapp-automations.service';

describe('findExactTrigger', () => {
  const items = [
    { name: 'Boas Vindas', triggerPhrase: 'Quero fazer o relocation com o Rafa' },
    { name: 'Outra', triggerPhrase: 'Pode me explicar o serviço de relocation' },
  ];

  it('aceita a mesma frase com maiúsculas e espaços diferentes', () => {
    const found = findExactTrigger(
      items,
      '  quero   fazer o relocation com o rafa  ',
    );
    expect(found?.name).toBe('Boas Vindas');
  });

  it('deixa passar uma mensagem que só contém o gatilho', () => {
    const found = findExactTrigger(
      items,
      'quero fazer o relocation com o rafa e saber o preço',
    );
    expect(found).toBeNull();
  });
});

describe('scriptedStepText', () => {
  it('junta os textos pela ordem e ignora passos sem texto', () => {
    const text = scriptedStepText([
      { sortOrder: 2, textContent: 'Qual a tipologia?' },
      { sortOrder: 0, textContent: 'Qual a cidade?' },
      { sortOrder: 1, textContent: '   ' },
    ]);
    expect(text).toBe('Qual a cidade?\n\nQual a tipologia?');
  });
});
