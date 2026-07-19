import { formatJobOfferWhatsappText } from './job-offer-format.util';

describe('formatJobOfferWhatsappText', () => {
  it('formata mensagem padronizada com empresa e contactos', () => {
    const text = formatJobOfferWhatsappText({
      publicNumber: 12,
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
    expect(text).toContain('Mais detalhes:');
    expect(text).toContain('/ofertas-trabalho/12');
  });

  it('exclui URLs e links WhatsApp dos contactos na mensagem do grupo', () => {
    const text = formatJobOfferWhatsappText({
      publicNumber: 5,
      jobFunction: 'Barista',
      city: 'Lisboa',
      company: 'Café Central',
      summary:
        'Vaga em tempo integral. Candidaturas em https://empresa.pt/vaga ou chat.whatsapp.com/AbCdEf',
      advertiserContacts: [
        { type: 'email', value: 'rh@cafe.pt' },
        { type: 'phone', value: '912345678' },
        { type: 'url', value: 'https://empresa.pt/candidaturas' },
        { type: 'url', value: 'https://chat.whatsapp.com/invite123' },
        { type: 'url', value: 'https://whatsapp.com/channel/abc' },
      ],
    });
    expect(text).toContain('rh@cafe.pt');
    expect(text).toContain('351912345678');
    expect(text).not.toContain('empresa.pt/candidaturas');
    expect(text).not.toContain('chat.whatsapp.com');
    expect(text).not.toContain('whatsapp.com/channel');
    expect(text).not.toContain('🔗');
    expect(text).toContain('Vaga em tempo integral');
    expect(text).not.toContain('https://empresa.pt/vaga');
  });

  it('omite linha Candidaturas quando só há URLs', () => {
    const text = formatJobOfferWhatsappText({
      publicNumber: 1,
      jobFunction: 'Empregado',
      city: 'Porto',
      company: '',
      summary: 'Descrição da vaga.',
      advertiserContacts: [
        { type: 'url', value: 'https://site-externo.com/jobs' },
      ],
    });
    expect(text).not.toContain('*Candidaturas:*');
    expect(text).not.toContain('site-externo.com');
  });

  it('respeita maxLength para legenda de imagem', () => {
    const text = formatJobOfferWhatsappText(
      {
        publicNumber: 9,
        jobFunction: 'Cozinheiro',
        city: 'Faro',
        company: 'Restaurante Sol',
        summary: 'A'.repeat(2000),
        advertiserContacts: [{ type: 'phone', value: '912345678' }],
      },
      { maxLength: 1024 },
    );
    expect(text.length).toBeLessThanOrEqual(1024);
    expect(text).toContain('Mais detalhes:');
    expect(text).toContain('/ofertas-trabalho/9');
  });
});
