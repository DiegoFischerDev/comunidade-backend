import {
  applyJoanaProposal,
  canonicalImmigration,
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

  it('campo já preenchido pede confirmação e não grava', () => {
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
    expect(result.crmPatch).toBeNull();
    expect(result.pending?.field).toBe('immigration');
    expect(result.pending?.question).toBe(
      'Quer atualizar sua data prevista de imigração para 01/03/2027?',
    );
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

  it('uma proposta nova substitui a confirmação anterior', () => {
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
    expect(result.pending?.field).toBe('pet');
    expect(result.crmPatch).toBeNull();
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
