import { messageHasAdvertiserContact } from './job-offer-contacts.util';

describe('messageHasAdvertiserContact', () => {
  it('aceita e-mail', () => {
    expect(
      messageHasAdvertiserContact(
        'Procuro cozinheiro. Contacto: jobs@empresa.pt',
      ),
    ).toBe(true);
  });

  it('aceita telemóvel PT formatado', () => {
    expect(
      messageHasAdvertiserContact('Vaga em Lisboa. Tel: 912 345 678'),
    ).toBe(true);
    expect(messageHasAdvertiserContact('+351 923456789')).toBe(true);
  });

  it('aceita wa.me', () => {
    expect(
      messageHasAdvertiserContact('Detalhes: https://wa.me/351912345678'),
    ).toBe(true);
  });

  it('rejeita oferta sem contacto', () => {
    expect(
      messageHasAdvertiserContact(
        'Precisamos de empregada de limpeza em Braga. Horário manhã.',
      ),
    ).toBe(false);
  });
});
