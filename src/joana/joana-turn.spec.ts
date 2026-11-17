import {
  applyJoanaProposal,
  canonicalImmigration,
  composeJoanaReply,
  confirmationQuestion,
  emptyJoanaProfile,
  type JoanaProfile,
} from './joana-turn';

const filled: JoanaProfile = {
  name: 'Ana',
  immigration: '2026-12-18',
  cities: 'Porto',
  typology: 'T1',
  hasPet: false,
};

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
  });

  it('interesse ou um dado concreto cria ficha e grava o campo vazio', () => {
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
    expect(result.append.some((line) => line.startsWith('Anotei as cidades'))).toBe(true);
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
    expect(result.append).toEqual(['Anotei a data para 01/03/2027.']);
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
    expect(result.append[0]).toContain('dois quartos');
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
    expect(result.append).toContain('Deixei como estava.');
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
    expect(result.append[0]).toBe('Anotei que você tem pet.');
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
  it('tira a pergunta do modelo quando o sistema já pergunta', () => {
    const text = composeJoanaReply(
      'O Rafa pode ajudar na busca por um T3 em São Pedro do Sul e Aveiro. Você tem animal de estimação?',
      ['Quer atualizar as cidades pretendidas para São Pedro do Sul e Aveiro?'],
      'fallback',
    );
    expect(text).toBe(
      'O Rafa pode ajudar na busca por um T3 em São Pedro do Sul e Aveiro.\n\nQuer atualizar as cidades pretendidas para São Pedro do Sul e Aveiro?',
    );
    expect(text.match(/\?/g)).toHaveLength(1);
  });

  it('deixa só a primeira pergunta quando o sistema não pergunta', () => {
    const text = composeJoanaReply('Oi. Qual a cidade? Você tem pet?', [], 'fallback');
    expect(text).toBe('Oi. Qual a cidade?');
  });

  it('quando anotou um dado, avisa e fica com a pergunta da OpenAI', () => {
    const text = composeJoanaReply(
      'Oi! O Rafa pode ajudar na busca por um T2 em Viseu. Para quando você pretende vir?',
      [
        'Anotei que você tem pet.',
        'Anotei seu nome, Bruno.',
        'Para quando você pretende vir para Portugal? Pode ser uma data, por exemplo 18/12/2026, ou dizer que é imediato.',
      ],
      'fallback',
    );
    expect(text).toBe(
      'Anotei que você tem pet.\n\nAnotei seu nome, Bruno.\n\nPara quando você pretende vir?',
    );
  });

  it('se a OpenAI não perguntar, usa a pergunta do sistema depois do aviso', () => {
    const text = composeJoanaReply(
      'Oi! O Rafa pode ajudar na busca por um T2 em Viseu.',
      ['Anotei que você tem pet.', 'Como posso te chamar?'],
      'fallback',
    );
    expect(text).toBe('Anotei que você tem pet.\n\nComo posso te chamar?');
  });

  it('tira um Anotei inventado pelo modelo e mantém a pergunta do sistema', () => {
    const text = composeJoanaReply(
      'O Rafa pode ajudar na busca. Anotei a data para 31/03/2024.',
      ['Para quando você pretende vir para Portugal?'],
      'fallback',
    );
    expect(text).toBe(
      'O Rafa pode ajudar na busca.\n\nPara quando você pretende vir para Portugal?',
    );
    expect(text).not.toContain('Anotei');
  });
});
