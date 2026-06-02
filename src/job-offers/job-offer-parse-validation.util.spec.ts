import {
  isMeaningfulJobOfferCity,
  validateParsedJobOffer,
} from './job-offer-parse-validation.util';

describe('isMeaningfulJobOfferCity', () => {
  it('aceita cidades e remoto', () => {
    expect(isMeaningfulJobOfferCity('Porto')).toBe(true);
    expect(isMeaningfulJobOfferCity('Remoto')).toBe(true);
  });

  it('rejeita placeholders', () => {
    expect(isMeaningfulJobOfferCity('')).toBe(false);
    expect(isMeaningfulJobOfferCity('—')).toBe(false);
    expect(isMeaningfulJobOfferCity('Não especificado')).toBe(false);
  });
});

describe('validateParsedJobOffer', () => {
  const baseOffer = {
    title: 'Vaga',
    jobFunction: 'Empregado de mesa',
    city: 'Porto',
    company: 'Restaurante X',
    summary: 'Resumo',
    description: 'Descrição com contacto 912345678',
    publishedAt: '2026-05-30',
    advertiserContacts: [] as { type: 'phone'; value: string }[],
  };

  it('exige cidade e contacto', () => {
    expect(
      validateParsedJobOffer(
        { isJobOffer: true, offer: { ...baseOffer, city: '' } },
        '912345678',
      ).ok,
    ).toBe(false);

    const ok = validateParsedJobOffer(
      { isJobOffer: true, offer: baseOffer },
      '912345678',
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.city).toBe('Porto');
      expect(ok.advertiserContacts.length).toBeGreaterThan(0);
    }
  });
});
