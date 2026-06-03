import {
  citiesMatchForDuplicate,
  companiesMatchForDuplicate,
  isNearDuplicateJobOffer,
  normalizeJobOfferCompany,
  wordJaccardSimilarity,
} from './job-offer-duplicate.util';

const base = {
  title: 'Recrutamos empregado de mesa — Restaurante Sol',
  jobFunction: 'Empregado de mesa',
  city: 'Porto',
  company: 'Restaurante Sol Lda',
  summary: 'Vaga em restaurante no centro do Porto. Horário partido.',
  description:
    'Procuramos empregado de mesa com experiência. Enviar CV para rh@sol.pt ou WhatsApp 912345678.',
};

describe('normalizeJobOfferCompany', () => {
  it('remove sufixos legais', () => {
    expect(normalizeJobOfferCompany('Restaurante Sol, Lda.')).toBe('restaurante sol');
  });
});

describe('isNearDuplicateJobOffer', () => {
  it('deteta republicação na mesma empresa e função', () => {
    const repost = {
      ...base,
      title: 'Empregado de mesa — Restaurante Sol (Porto)',
      description:
        'Precisamos de empregado de mesa. Contacto rh@sol.pt ou 912 345 678.',
    };
    expect(isNearDuplicateJobOffer(repost, base)).toBe(true);
  });

  it('não confunde vagas diferentes na mesma empresa', () => {
    const other = {
      ...base,
      jobFunction: 'Chef de cozinha',
      title: 'Chef de cozinha — Restaurante Sol',
      description: 'Procuramos chef com experiência em cozinha italiana.',
    };
    expect(isNearDuplicateJobOffer(other, base)).toBe(false);
  });

  it('não confunde empresas diferentes na mesma cidade', () => {
    const other = {
      ...base,
      company: 'Hotel Mar Azul SA',
      title: 'Empregado de mesa — Hotel Mar',
    };
    expect(isNearDuplicateJobOffer(other, base)).toBe(false);
  });

  it('exige cidade compatível', () => {
    const lisboa = { ...base, city: 'Lisboa' };
    expect(isNearDuplicateJobOffer(lisboa, base)).toBe(false);
  });
});

describe('wordJaccardSimilarity', () => {
  it('é 1 para textos equivalentes', () => {
    expect(wordJaccardSimilarity('empregado de mesa', 'Empregado de Mesa')).toBe(1);
  });
});

describe('companiesMatchForDuplicate', () => {
  it('aceita variações do mesmo nome', () => {
    expect(
      companiesMatchForDuplicate('Continente', 'Continente Modelo'),
    ).toBe(true);
  });
});

describe('citiesMatchForDuplicate', () => {
  it('aceita mesma cidade com grafia próxima', () => {
    expect(citiesMatchForDuplicate('Vila Nova de Gaia', 'Gaia')).toBe(true);
  });
});
