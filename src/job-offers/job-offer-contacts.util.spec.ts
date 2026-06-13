import {
  filterAdvertiserContactsForWhatsappShare,
  stripUrlsForWhatsappJobShare,
} from './job-offer-contacts.util';

describe('filterAdvertiserContactsForWhatsappShare', () => {
  it('mantém email e telefone', () => {
    const out = filterAdvertiserContactsForWhatsappShare([
      { type: 'email', value: 'a@b.pt' },
      { type: 'phone', value: '912345678' },
      { type: 'url', value: 'https://example.com' },
    ]);
    expect(out).toEqual([
      { type: 'email', value: 'a@b.pt' },
      { type: 'phone', value: '912345678' },
    ]);
  });
});

describe('stripUrlsForWhatsappJobShare', () => {
  it('remove URLs externas e links de grupo/canal WhatsApp', () => {
    const out = stripUrlsForWhatsappJobShare(
      'Info: https://empresa.pt/vaga\nGrupo: chat.whatsapp.com/xyz\nCanal: https://whatsapp.com/channel/abc',
    );
    expect(out).not.toContain('https://');
    expect(out).not.toContain('chat.whatsapp.com');
    expect(out).not.toContain('whatsapp.com/channel');
    expect(out).toContain('Info:');
  });
});
