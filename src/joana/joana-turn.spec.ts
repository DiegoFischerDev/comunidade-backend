import {
  JOANA_DECLINE_HANDOFF,
  JOANA_INTEREST_QUESTION,
  JOANA_INTRO,
  JOANA_NAME_QUESTION,
  JOANA_NO_VISA_GUIDANCE,
  applyJoanaProposal,
  canonicalImmigration,
  composeJoanaReply,
  confirmationQuestion,
  emptyJoanaProfile,
  ensureJoanaIntro,
  immigrationConfirmationQuestion,
  inferNameCorrectionFromMessage,
  inferPersonNameFromMessage,
  isPlaceholderLeadName,
  parseDesiredRent,
  shouldOfferSchedulingLink,
  withInferredConfirmation,
  withInferredName,
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

describe('inferPersonNameFromMessage', () => {
  it('aceita um nome curto numa única linha', () => {
    expect(inferPersonNameFromMessage('Bruna')).toBe('Bruna');
    expect(inferPersonNameFromMessage('  Ana Clara  ')).toBe('Ana Clara');
    expect(inferPersonNameFromMessage('José')).toBe('José');
  });

  it('rejeita respostas que não são nome', () => {
    expect(inferPersonNameFromMessage('Sim')).toBeNull();
    expect(inferPersonNameFromMessage('não')).toBeNull();
    expect(inferPersonNameFromMessage('oi')).toBeNull();
    expect(inferPersonNameFromMessage('T2')).toBeNull();
    expect(inferPersonNameFromMessage('800')).toBeNull();
    expect(inferPersonNameFromMessage('18/12/2026')).toBeNull();
    expect(inferPersonNameFromMessage('imediato')).toBeNull();
    expect(inferPersonNameFromMessage('Lead 4821')).toBeNull();
    expect(inferPersonNameFromMessage('Bruna\nClara')).toBeNull();
  });
});

describe('withInferredName', () => {
  const awaitingName: JoanaProfile = {
    ...filled,
    name: null,
  };

  it('preenche o nome quando é o próximo campo e o modelo omitiu', () => {
    const proposal = withInferredName({
      profile: awaitingName,
      proposal: { interested: null, confirmation: null },
      message: 'Bruna',
    });
    expect(proposal.name).toBe('Bruna');

    const saved = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: awaitingName,
      pending: null,
      proposal,
    });
    expect(saved.nameToSave).toBe('Bruna');
    expect(saved.append).toEqual([]);
  });

  it('não inventa nome se ainda falta outro dado', () => {
    const proposal = withInferredName({
      profile: { ...filled, name: null, cities: null },
      proposal: { interested: null, confirmation: null },
      message: 'Bruna',
    });
    expect(proposal.name).toBeUndefined();
  });

  it('trata Lead XXX como nome em falta', () => {
    expect(isPlaceholderLeadName('Lead 4821')).toBe(true);
    const proposal = withInferredName({
      profile: { ...filled, name: 'Lead 4821' },
      proposal: { interested: null, confirmation: null },
      message: 'Bruna',
    });
    expect(proposal.name).toBe('Bruna');
  });

  it('corrige o nome já gravado com «me chamo Paulo»', () => {
    expect(inferNameCorrectionFromMessage('Me chamo Paulo')).toBe('Paulo');
    expect(inferNameCorrectionFromMessage('Na verdade meu nome é Ana Clara')).toBe(
      'Ana Clara',
    );

    const proposal = withInferredName({
      profile: { ...filled, name: 'Diego' },
      proposal: { interested: null, confirmation: null },
      message: 'Me chamo Paulo',
    });
    expect(proposal.name).toBe('Paulo');

    const saved = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: { ...filled, name: 'Diego' },
      pending: null,
      proposal,
    });
    expect(saved.nameToSave).toBe('Paulo');
  });

  it('um nome solto não sobrescreve se o próximo campo não é o nome', () => {
    const proposal = withInferredName({
      profile: { ...filled, name: 'Diego' },
      proposal: { interested: null, confirmation: null },
      message: 'Paulo',
    });
    expect(proposal.name).toBeUndefined();
  });
});

describe('withInferredConfirmation', () => {
  const pendingDate = {
    field: 'immigration' as const,
    value: '2026-05-18',
    question: immigrationConfirmationQuestion('2026-05-18', true),
  };

  it('lê sim/não curtos na confirmação de data', () => {
    expect(
      withInferredConfirmation({
        pending: pendingDate,
        proposal: { interested: null, confirmation: null },
        message: 'Sim',
      }).confirmation,
    ).toBe('yes');
    expect(
      withInferredConfirmation({
        pending: pendingDate,
        proposal: { interested: null, confirmation: null },
        message: 'não',
      }).confirmation,
    ).toBe('no');
  });

  it('não inventa confirmação sem pendência de data', () => {
    expect(
      withInferredConfirmation({
        pending: null,
        proposal: { interested: null, confirmation: null },
        message: 'Sim',
      }).confirmation,
    ).toBeNull();
  });
});

describe('interesse só pergunta a data', () => {
  it('um sim sem outros dados cria ficha e pergunta a data, não o nome', () => {
    const result = applyJoanaProposal({
      hasLead: false,
      excluded: false,
      profile: emptyJoanaProfile(),
      pending: null,
      proposal: { interested: true, confirmation: null },
    });
    expect(result.createLead).toBe(true);
    expect(result.append[0]).toContain('Para quando');
    expect(result.append[0]).not.toBe(JOANA_NAME_QUESTION);
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

  it('recusa não cria ficha, faz handoff à Rafa e pede para desligar a Joana', () => {
    const result = applyJoanaProposal({
      hasLead: false,
      excluded: false,
      profile: emptyJoanaProfile(),
      pending: null,
      proposal: { interested: false, confirmation: null, cities: 'Porto' },
    });
    expect(result.createLead).toBe(false);
    expect(result.crmPatch).toBeNull();
    expect(result.append).toEqual([JOANA_DECLINE_HANDOFF]);
    expect(result.disableJoana).toBe(true);
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

  it('campo já preenchido (não-data) grava o valor novo sem pedir confirmação', () => {
    const result = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: filled,
      pending: null,
      proposal: {
        interested: null,
        confirmation: null,
        cities: 'Braga',
      },
    });
    expect(result.crmPatch?.cities).toBe('Braga');
    expect(result.pending).toBeNull();
    expect(result.append).toEqual([]);
  });

  it('data nova fica pendente de confirmação e não grava ainda', () => {
    const result = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: { ...filled, immigration: null, hasVisa: null },
      pending: null,
      proposal: {
        interested: null,
        confirmation: null,
        immigration: '2026-05-18',
      },
    });
    expect(result.crmPatch).toBeNull();
    expect(result.pending?.field).toBe('immigration');
    expect(result.pending?.value).toBe('2026-05-18');
    expect(result.append[0]).toBe(
      immigrationConfirmationQuestion('2026-05-18', false),
    );
  });

  it('última informação manda no nome; data nova pede confirmação', () => {
    const result = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: {
        ...filled,
        name: 'Diego',
        immigration: '2026-09-14',
      },
      pending: null,
      proposal: {
        interested: null,
        confirmation: null,
        name: 'Paulo',
        immigration: '2026-05-18',
      },
    });
    expect(result.nameToSave).toBe('Paulo');
    expect(result.crmPatch).toBeNull();
    expect(result.pending?.value).toBe('2026-05-18');
    expect(result.append[0]).toBe(
      immigrationConfirmationQuestion('2026-05-18', true),
    );
  });

  it('sim na confirmação de data grava a data pendente', () => {
    const pending = {
      field: 'immigration' as const,
      value: '2026-05-18',
      question: immigrationConfirmationQuestion('2026-05-18', true),
    };
    const result = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: { ...filled, name: 'Diego', immigration: '2026-09-14' },
      pending,
      proposal: { interested: null, confirmation: 'yes' },
    });
    expect(result.crmPatch?.immigration).toBe('2026-05-18');
    expect(result.pending).toBeNull();
  });

  it('não na confirmação de data mantém o valor anterior', () => {
    const result = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: { ...filled, immigration: '2026-09-14' },
      pending: {
        field: 'immigration',
        value: '2026-05-18',
        question: immigrationConfirmationQuestion('2026-05-18', true),
      },
      proposal: { interested: null, confirmation: 'no' },
    });
    expect(result.crmPatch).toBeNull();
    expect(result.pending).toBeNull();
  });

  it('confirmação pendente que não é de data é ignorada', () => {
    const result = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: filled,
      pending: {
        field: 'typology',
        value: 'T2',
        question: confirmationQuestion('typology', 'T2'),
      },
      proposal: { interested: null, confirmation: 'yes' },
    });
    expect(result.crmPatch).toBeNull();
    expect(result.pending).toBeNull();
  });

  it('outro dado pode gravar enquanto a confirmação de data fica pendente', () => {
    const result = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: { ...filled, immigration: '2026-09-14' },
      pending: {
        field: 'immigration',
        value: '2026-05-18',
        question: immigrationConfirmationQuestion('2026-05-18', true),
      },
      proposal: { interested: null, confirmation: null, cities: 'Braga' },
    });
    expect(result.crmPatch?.cities).toBe('Braga');
    expect(result.pending?.value).toBe('2026-05-18');
    expect(result.append[0]).toContain('data prevista de imigração');
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

  it('com ficha quase completa, não volta a perguntar tipologia nem visto', () => {
    const result = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: { ...filled, hasPet: null },
      pending: null,
      proposal: { interested: null, confirmation: null },
    });
    expect(result.append).toHaveLength(1);
    expect(result.append[0]).toContain('animal de estimação');
    expect(result.append[0]).not.toMatch(/tipologia|visto|data|cidades|aluguel/i);
  });

  it('com ficha completa, não acrescenta pergunta de qualificação', () => {
    const result = applyJoanaProposal({
      hasLead: true,
      excluded: false,
      profile: filled,
      pending: null,
      proposal: { interested: null, confirmation: null },
    });
    expect(result.append).toEqual([]);
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
  it('troca a pergunta do modelo pela próxima que falta na ficha', () => {
    const text = composeJoanaReply(
      'Março é um bom mês. Você já tem visto para Portugal?',
      ['Quais cidades você está considerando?'],
      'fallback',
      true,
    );
    expect(text).toBe(
      'Março é um bom mês.\n\nQuais cidades você está considerando?',
    );
    expect(text).not.toContain('visto');
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

  it('tira da fala a frase em que ela diz que gravou e fica com a pergunta certa', () => {
    const text = composeJoanaReply(
      'Registrei a data para 31/03/2027. Você já tem visto?',
      ['Para quando você pretende vir para Portugal?'],
      'fallback',
    );
    expect(text).toBe('Para quando você pretende vir para Portugal?');
  });

  it('não deixa repetir tipologia quando o sistema já pede o aluguel', () => {
    const text = composeJoanaReply(
      'Perfeito. Que tipologia você procura, T1 ou T2?',
      ['Qual o valor do aluguel pretendido por mês? Pode ser um valor aproximado, em euros.'],
      'fallback',
      true,
    );
    expect(text).toBe(
      'Perfeito.\n\nQual o valor do aluguel pretendido por mês? Pode ser um valor aproximado, em euros.',
    );
    expect(text).not.toContain('tipologia');
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

  it('na recusa do serviço, fica a reação curta e o handoff à Rafa', () => {
    const text = composeJoanaReply(
      'Tudo bem! Quer que eu te explique outra coisa?',
      [JOANA_DECLINE_HANDOFF],
      'fallback',
    );
    expect(text).toBe(`Tudo bem!\n\n${JOANA_DECLINE_HANDOFF}`);
    expect(text).toContain('Como posso te ajudar');
    expect(text).toContain('Rafa vai te responder');
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

describe('shouldOfferSchedulingLink', () => {
  const base = {
    crmStatus: 'IMIGRACAO_PERTO',
    hasVisa: true as boolean | null,
    hasScheduledVideoCall: false,
    linkAlreadyDelivered: false,
    schedulingLinkSent: false,
  };

  it('oferece o link em perto com visto e sem chamada marcada', () => {
    expect(shouldOfferSchedulingLink(base)).toBe(true);
  });

  it('não oferece se a videochamada já está agendada', () => {
    expect(
      shouldOfferSchedulingLink({ ...base, hasScheduledVideoCall: true }),
    ).toBe(false);
  });

  it('não oferece se o link já foi enviado nesta conversa', () => {
    expect(shouldOfferSchedulingLink({ ...base, schedulingLinkSent: true })).toBe(
      false,
    );
    expect(
      shouldOfferSchedulingLink({ ...base, linkAlreadyDelivered: true }),
    ).toBe(false);
  });

  it('não oferece fora de perto ou sem visto', () => {
    expect(
      shouldOfferSchedulingLink({ ...base, crmStatus: 'VIDEO_CHAMADA_AGENDADA' }),
    ).toBe(false);
    expect(shouldOfferSchedulingLink({ ...base, hasVisa: false })).toBe(false);
    expect(shouldOfferSchedulingLink({ ...base, hasVisa: null })).toBe(false);
  });
});
