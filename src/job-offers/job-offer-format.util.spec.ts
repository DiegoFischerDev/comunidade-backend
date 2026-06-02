import { formatJobOfferWhatsappText } from './job-offer-format.util';

describe('formatJobOfferWhatsappText', () => {
  it('formata mensagem padronizada com empresa e contactos', () => {
    const text = formatJobOfferWhatsappText({
      jobFunction: 'Gestor de Amostras',
      city: 'Braga',
      company: 'BECRI GROUP',
      summary:
        'Perfil Pretendido\nFormação em TEF, Licenciatura em Desporto ou área similar;\nMínimo de 1 ano de experiência',
      advertiserContacts: [
        { type: 'email', value: 'rh@becrigroup.pt' },
        { type: 'phone', value: '351666555888' },
      ],
    });
    expect(text).toContain('💼 *Gestor de Amostras* — Braga');
    expect(text).toContain('🏢 BECRI GROUP');
    expect(text).toContain('*Candidaturas:*');
    expect(text).toContain('rh@becrigroup.pt');
    expect(text).toContain('351666555888');
    expect(text).toContain('Perfil Pretendido');
  });
});
