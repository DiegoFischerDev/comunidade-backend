import {
  normalizeJoanaWelcomeSteps,
  parseStoredWelcomeSteps,
  welcomeStepsHistorySummary,
} from './joana-welcome';

describe('normalizeJoanaWelcomeSteps', () => {
  it('aceita texto, áudio, imagem e PDF', () => {
    const steps = normalizeJoanaWelcomeSteps([
      { type: 'TEXT', textContent: 'Oi, eu sou a Joana.', delayMsAfter: 1000 },
      {
        type: 'AUDIO',
        mediaUrl: '/uploads/hello.ogg',
        mediaMimeType: 'audio/ogg',
        mediaFileName: 'hello.ogg',
      },
      {
        type: 'IMAGE',
        mediaUrl: '/uploads/foto.jpg',
        caption: 'A Rafa',
      },
      {
        type: 'DOCUMENT',
        mediaUrl: '/uploads/apresentacao.pdf',
        mediaMimeType: 'application/pdf',
        mediaFileName: 'apresentacao.pdf',
        caption: 'Apresentação',
      },
    ]);
    expect(steps).toHaveLength(4);
    expect(steps[0]).toMatchObject({
      type: 'TEXT',
      textContent: 'Oi, eu sou a Joana.',
      delayMsAfter: 1000,
    });
    expect(steps[1]?.type).toBe('AUDIO');
    expect(steps[2]).toMatchObject({
      type: 'IMAGE',
      textContent: 'A Rafa',
      mediaUrl: '/uploads/foto.jpg',
    });
    expect(steps[3]).toMatchObject({
      type: 'DOCUMENT',
      textContent: 'Apresentação',
      mediaUrl: '/uploads/apresentacao.pdf',
      mediaMimeType: 'application/pdf',
    });
  });

  it('permite lista vazia (volta à intro por omissão)', () => {
    expect(normalizeJoanaWelcomeSteps([])).toEqual([]);
  });

  it('recusa texto vazio', () => {
    expect(() =>
      normalizeJoanaWelcomeSteps([{ type: 'TEXT', textContent: '  ' }]),
    ).toThrow(/texto em falta/i);
  });

  it('recusa documento que não é PDF', () => {
    expect(() =>
      normalizeJoanaWelcomeSteps([
        {
          type: 'DOCUMENT',
          mediaUrl: '/uploads/nota.docx',
          mediaMimeType: 'application/msword',
          mediaFileName: 'nota.docx',
        },
      ]),
    ).toThrow(/pdf/i);
  });
});

describe('parseStoredWelcomeSteps', () => {
  it('ignora JSON inválido guardado', () => {
    expect(parseStoredWelcomeSteps({ bad: true })).toEqual([]);
  });
});

describe('welcomeStepsHistorySummary', () => {
  it('junta só os textos', () => {
    expect(
      welcomeStepsHistorySummary([
        {
          type: 'TEXT',
          textContent: 'Oi',
          delayMsAfter: 650,
        },
        {
          type: 'AUDIO',
          mediaUrl: '/uploads/a.ogg',
          delayMsAfter: 650,
        },
        {
          type: 'TEXT',
          textContent: 'Tem interesse?',
          delayMsAfter: 650,
        },
      ]),
    ).toBe('Oi\n\nTem interesse?');
  });
});
