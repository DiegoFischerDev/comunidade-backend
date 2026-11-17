import {
  JOANA_INTEREST_QUESTION,
  JOANA_INTRO,
  JOANA_NO_VISA_GUIDANCE,
  applyJoanaProposal,
  canonicalImmigration,
  composeJoanaReply,
  confirmationQuestion,
  emptyJoanaProfile,
  ensureJoanaIntro,
  parseDesiredRent,
  type JoanaProfile,
} from './joana-turn';

const filled: JoanaProfile = {
  name: 'Ana',
  immigration: '2026-12-18',
  cities: 'Porto',
  typology: 'T1',
  desiredRent: 800,
  hasVisa: true,
  hasPet: false,
};

describe('parseDesiredRent', () => {
  it('lê euros inteiros e ignora o que não é aluguel válido', () => {
    expect(parseDesiredRent(800)).toBe(800);
    expect(parseDesiredRent('€ 1.200')).toBe(1200);
    expect(parseDesiredRent('800 euros')).toBe(800);
    expect(parseDesiredRent('800,50')).toBe(800);
    expect(parseDesiredRent('')).toBe('');
    expect(parseDesiredRent(undefined)).toBeUndefined();
    expect(parseDesiredRent(150_000)).toBeUndefined();
  });
});

describe('canonicalImmigration', () => {
  it('aceita data brasileira e imediato', () => {
    expect(canonicalImmigration('18/12/2026')).toBe('2026-12-18');
    expect(canonicalImmigration('imediato')).toBe('IMEDIATO');
    expect(canonicalImmigration('')).toBe('');
    expect(canonicalImmigration('semana que vem')).toBeNull();
  });
});

describe('applyJoanaProposal', () => {
  it('um oi sem dados não cria ficha', () => {
    const result = applyJoanaProposal({
      hasLead: false,
      excluded: false,
      profile: emptyJoanaProfile(),
      pending: null,
      proposal: { interested: null, confirmation: null },
    });
    expect(result.createLead).toBe(false);
    expect(result.crmPatch).toBeNull();
    expect(result.pending).toBeNull();
    expect(result.append).toEqual([JOANA_INTEREST_QUESTION]);
  });

  it('um dado concreto sem interesse não cria ficha nem grava', () => {
    const result = applyJoanaProposal({
      hasLead: false,
      excluded: false,
      profile: emptyJoanaProfile(),
      pending: null,
      proposal: {
        interested: null,
        confirmation: null,
        cities: 'Viseu',
        immigration: '2027-03-01',
      },
    });
    expect(result.createLead).toBe(false);
    expect(result.crmPatch).toBeNull();
    expect(result.nameToSave).toBeNull();
    expect(result.append).toEqual([JOANA_INTEREST_QUESTION]);
  });

  it('recusa não cria ficha nem volta a perguntar o interesse', () => {
    const result = applyJoanaProposal({
      hasLead: false,
      excluded: false,
      profile: emptyJoanaProfile(),
      pending: null,
      proposal: { interested: false, confirmation: null, cities: 'Porto' },
    });
    expect(result.createLead).toBe(false);
    expect(result.crmPatch).toBeNull();
    expect(result.append).toEqual([]);
  });

  it('interesse cria ficha, grava o que veio junto e pergunta a data', () => {
    const result = applyJoanaProposal({
      hasLead: false,
      excluded: false,
      profile: emptyJoanaProfile(),
      pending: null,
      proposal: {
        interested: true,
        confirmation: null,
        cities: 'Viseu, Aveiro e São Pedro do Sul',
      },
    });
    expect(result.createLead).toBe(true);
    expect(result.crmPatch?.cities).toBe('Viseu, Aveiro e São Pedro do Sul');
    expect(result.append.some((line) => line.includes('Para quando'))).toBe(true);
  });

  it('campo já preenchido grava o valor novo sem pedir confirmação', () => {
    const result = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: filled,
      pending: null,
      proposal: {
        interested: null,
        confirmation: null,
        immigration: '2027-03-01',
      },
    });
    expect(result.crmPatch?.immigration).toBe('2027-03-01');
    expect(result.pending).toBeNull();
    expect(result.append).toEqual([]);
  });

  it('sim grava a confirmação pendente', () => {
    const pending = {
      field: 'typology' as const,
      value: 'T2',
      question: confirmationQuestion('typology', 'T2'),
    };
    const result = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: filled,
      pending,
      proposal: { interested: null, confirmation: 'yes' },
    });
    expect(result.crmPatch?.typology).toBe('T2');
    expect(result.pending).toBeNull();
    expect(result.append).toEqual([]);
  });

  it('não mantém o valor anterior', () => {
    const result = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: filled,
      pending: {
        field: 'cities',
        value: 'Braga',
        question: confirmationQuestion('cities', 'Braga'),
      },
      proposal: { interested: null, confirmation: 'no' },
    });
    expect(result.crmPatch).toBeNull();
    expect(result.pending).toBeNull();
    expect(result.append).toEqual([]);
  });

  it('um dado novo grava e descarta a confirmação antiga', () => {
    const result = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: filled,
      pending: {
        field: 'cities',
        value: 'Braga',
        question: confirmationQuestion('cities', 'Braga'),
      },
      proposal: { interested: null, confirmation: null, hasPet: true },
    });
    expect(result.pending).toBeNull();
    expect(result.crmPatch?.hasPet).toBe(true);
    expect(result.append).toEqual([]);
  });

  it('grava que não tem visto, indica a Clara e não segue a qualificação', () => {
    const result = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: { ...filled, hasVisa: null, cities: null },
      pending: null,
      proposal: { interested: null, confirmation: null, hasVisa: false },
    });
    expect(result.crmPatch?.hasVisa).toBe(false);
    expect(result.append).toEqual([JOANA_NO_VISA_GUIDANCE]);
    expect(result.append.some((line) => line.includes('cidades'))).toBe(false);
  });

  it('com visto, segue para as cidades', () => {
    const result = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: { ...filled, hasVisa: null, cities: null },
      pending: null,
      proposal: { interested: null, confirmation: null, hasVisa: true },
    });
    expect(result.crmPatch?.hasVisa).toBe(true);
    expect(result.append.some((line) => line.includes('cidades'))).toBe(true);
  });

  it('sem visto já anotado, não pede o próximo dado', () => {
    const result = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: { ...filled, hasVisa: false, cities: null },
      pending: null,
      proposal: { interested: null, confirmation: null },
    });
    expect(result.crmPatch).toBeNull();
    expect(result.append).toEqual([]);
  });

  it('pede o visto quando a data já está e o visto ainda não', () => {
    const result = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: { ...filled, hasVisa: null },
      pending: null,
      proposal: { interested: null, confirmation: null },
    });
    expect(result.crmPatch).toBeNull();
    expect(result.append[0]).toBe('Você já tem visto para Portugal?');
  });

  it('grava o aluguel pretendido e segue para o pet', () => {
    const result = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: { ...filled, desiredRent: null, hasPet: null },
      pending: null,
      proposal: { interested: null, confirmation: null, desiredRent: 900 },
    });
    expect(result.crmPatch?.desiredRent).toBe(900);
    expect(result.append.some((line) => line.includes('animal de estimação'))).toBe(true);
  });

  it('pede o aluguel quando a tipologia já está e o valor ainda não', () => {
    const result = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: { ...filled, desiredRent: null },
      pending: null,
      proposal: { interested: null, confirmation: null },
    });
    expect(result.crmPatch).toBeNull();
    expect(result.append[0]).toContain('valor do aluguel pretendido');
  });

  it('não grava quem foi excluído do kanban', () => {
    const result = applyJoanaProposal({
      hasLead: false,
      excluded: true,
      profile: emptyJoanaProfile(),
      pending: null,
      proposal: { interested: true, confirmation: null, cities: 'Porto' },
    });
    expect(result.createLead).toBe(false);
    expect(result.crmPatch).toBeNull();
  });
});

describe('composeJoanaReply', () => {
  it('mantém a pergunta da Joana quando ela já continuou a conversa', () => {
    const text = composeJoanaReply(
      'Março é um bom mês. Você já tem visto para Portugal?',
      ['Quais cidades você está considerando?'],
      'fallback',
      true,
    );
    expect(text).toBe('Março é um bom mês. Você já tem visto para Portugal?');
  });

  it('deixa só a primeira pergunta quando o sistema não pergunta', () => {
    const text = composeJoanaReply('Oi. Qual a cidade? Você tem pet?', [], 'fallback');
    expect(text).toBe('Oi. Qual a cidade?');
  });

  it('se ela não perguntar, entra a próxima pergunta que falta', () => {
    const text = composeJoanaReply(
      'Março, perfeito.',
      ['Você já tem visto para Portugal?'],
      'fallback',
      true,
    );
    expect(text).toBe('Março, perfeito.\n\nVocê já tem visto para Portugal?');
  });

  it('tira da fala a frase em que ela diz que gravou e fica com a conversa', () => {
    const text = composeJoanaReply(
      'Registrei a data para 31/03/2027. Você já tem visto?',
      ['Para quando você pretende vir para Portugal?'],
      'fallback',
    );
    expect(text).toBe('Você já tem visto?');
  });

  it('mantém o link de agendar mesmo quando a resposta já tem uma pergunta', () => {
    const link =
      'Posso te passar o link para agendar a videochamada com a Rafa. São 20 a 30 minutos, então vale ter as dúvidas anotadas: https://movecasa.pt/agendar?whatsapp=351900000000';
    const text = composeJoanaReply(
      'Que bom que você já tem visto. Qual cidade você prefere?',
      [link],
      'fallback',
    );
    expect(text).toContain('https://movecasa.pt/agendar?whatsapp=351900000000');
    expect(text).toContain('Qual cidade você prefere?');
  });

  it('junta uma orientação sem pergunta depois da fala dela', () => {
    const text = composeJoanaReply(
      'Você já tem visto?',
      ['Prepare o passaporte e a passagem.'],
      'fallback',
    );
    expect(text).toBe('Você já tem visto?\n\nPrepare o passaporte e a passagem.');
  });

  it('sem visto, fica a reação curta e a indicação da Clara, sem a pergunta seguinte', () => {
    const text = composeJoanaReply(
      'Entendi. Quais cidades você está considerando?',
      ['Quais cidades você está considerando?', JOANA_NO_VISA_GUIDANCE],
      'fallback',
      true,
    );
    expect(text).toBe(`Entendi.\n\n${JOANA_NO_VISA_GUIDANCE}`);
    expect(text).toContain('https://movecasa.pt/whatsapp?t=clara-ac-viagens');
    expect(text).not.toContain('cidades');
  });

  it('não repete a indicação se o modelo já falou da Clara', () => {
    const text = composeJoanaReply(
      'A Clara faz a assessoria de vistos. Pode falar com ela por aqui: https://movecasa.pt/whatsapp?t=clara-ac-viagens',
      [JOANA_NO_VISA_GUIDANCE],
      'fallback',
    );
    expect(text).toBe(JOANA_NO_VISA_GUIDANCE);
  });
});

describe('ensureJoanaIntro', () => {
  it('apresenta a Joana quando a resposta ainda não a menciona', () => {
    expect(ensureJoanaIntro('O preço em Viseu é €650.', true)).toBe(
      `${JOANA_INTRO}\n\nO preço em Viseu é €650.`,
    );
  });

  it('não repete a apresentação se a resposta ou a conversa já a trouxeram', () => {
    expect(ensureJoanaIntro('Oi, eu sou a Joana. Você tem interesse?', true)).toBe(
      'Oi, eu sou a Joana. Você tem interesse?',
    );
    expect(ensureJoanaIntro('Para quando você pretende vir?', false)).toBe(
      'Para quando você pretende vir?',
    );
  });
});
