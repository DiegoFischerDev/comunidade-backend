import {
  buildEvolutionReadMessages,
  uniqueEvolutionMessageIds,
} from './mark-as-read';

describe('mark-as-read helpers', () => {
  it('uniqueEvolutionMessageIds ignora local- e duplicados', () => {
    expect(
      uniqueEvolutionMessageIds([
        'ABC',
        'local-1',
        ' ABC ',
        '',
        'DEF',
        'local-xyz',
      ]),
    ).toEqual(['ABC', 'DEF']);
  });

  it('buildEvolutionReadMessages monta remoteJid e fromMe=false', () => {
    expect(buildEvolutionReadMessages('351 912 345 678', ['MSG1', 'local-2'])).toEqual([
      {
        id: 'MSG1',
        fromMe: false,
        remoteJid: '351912345678@s.whatsapp.net',
      },
    ]);
  });

  it('buildEvolutionReadMessages devolve vazio sem dígitos', () => {
    expect(buildEvolutionReadMessages('', ['MSG1'])).toEqual([]);
  });
});
