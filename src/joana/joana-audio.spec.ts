import { decodeWhatsappAudio, whatsappAudioFileName } from './joana-audio';

describe('decodeWhatsappAudio', () => {
  it('lê o base64 mesmo com prefixo data-url', () => {
    const raw = Buffer.from('oi').toString('base64');
    const decoded = decodeWhatsappAudio(`data:audio/ogg; codecs=opus;base64,${raw}`);
    expect(decoded).toEqual({ ok: true, bytes: Buffer.from('oi') });
  });

  it('recusa áudio vazio e áudio acima do limite', () => {
    expect(decodeWhatsappAudio('   ')).toEqual({ ok: false, reason: 'empty' });
    const raw = Buffer.from('hello world').toString('base64');
    expect(decodeWhatsappAudio(raw, 4)).toEqual({ ok: false, reason: 'too_large' });
  });
});

describe('whatsappAudioFileName', () => {
  it('usa ogg na nota de voz e tira o codec do mime', () => {
    expect(whatsappAudioFileName('audio/ogg; codecs=opus')).toEqual({
      name: 'nota.ogg',
      mime: 'audio/ogg',
    });
  });

  it('troca .oga por ogg, porque a OpenAI não aceita oga', () => {
    expect(whatsappAudioFileName('audio/ogg; codecs=opus', '3EB0.oga')).toEqual({
      name: 'nota.ogg',
      mime: 'audio/ogg',
    });
  });

  it('mantém um nome que já tem extensão', () => {
    expect(whatsappAudioFileName('audio/mpeg', 'fala.mp3')).toEqual({
      name: 'fala.mp3',
      mime: 'audio/mpeg',
    });
  });
});
