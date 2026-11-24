import {
  hasVisaFromLead,
  immigrationFromLead,
  joanaDateInstruction,
  lisbonCivilDate,
} from './joana-openai.service';

describe('joanaDateInstruction', () => {
  it('em 17/11/2026, final de fevereiro é 2027', () => {
    const now = new Date('2026-11-17T12:00:00.000Z');
    expect(lisbonCivilDate(now).label).toBe('17/11/2026');
    const text = joanaDateInstruction(now);
    expect(text).toContain('Data de hoje em Lisboa: 17/11/2026.');
    expect(text).toContain('2027-02-28');
    expect(text).not.toContain('2024');
  });

  it('em janeiro, final de fevereiro ainda é deste ano', () => {
    const now = new Date('2027-01-10T12:00:00.000Z');
    expect(joanaDateInstruction(now)).toContain('2027-02-28');
  });
});

describe('immigrationFromLead', () => {
  const now = new Date('2026-11-17T12:00:00.000Z');

  it('final de março sem ano é 31/03/2027, mesmo que o modelo diga 2024', () => {
    expect(immigrationFromLead('Quero ir no final de março', '2024-03-31', now)).toBe('2027-03-31');
  });

  it('em março sem dia é 15/03/2027', () => {
    expect(immigrationFromLead('Quero ir para Portugal em março', '2024-03-31', now)).toBe(
      '2027-03-15',
    );
  });

  it('uma data completa da pessoa substitui o ano do modelo', () => {
    expect(immigrationFromLead('31/03/2027', '2024-03-31', now)).toBe('2027-03-31');
  });
});

describe('hasVisaFromLead', () => {
  it('«dando entrada no visto» força true mesmo se o modelo disser false', () => {
    expect(
      hasVisaFromLead('Estamos dando entrada no visto e tudo mais', false),
    ).toBe(true);
  });

  it('processo / a iniciar o visto conta como true', () => {
    expect(hasVisaFromLead('Já iniciámos o processo de visto', undefined)).toBe(true);
    expect(hasVisaFromLead('Vamos dar entrada no visto na próxima semana', false)).toBe(
      true,
    );
  });

  it('não força true quando a pessoa nega ter iniciado o processo', () => {
    expect(
      hasVisaFromLead('Ainda não iniciei o processo de visto', false),
    ).toBe(false);
  });

  it('sem sinal na mensagem, mantém o valor do modelo', () => {
    expect(hasVisaFromLead('Vamos morar em Aveiro, sem pets', false)).toBe(false);
    expect(hasVisaFromLead('Vamos morar em Aveiro, sem pets', undefined)).toBeUndefined();
  });
});
