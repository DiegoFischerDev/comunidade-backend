import { AutomatedOutboundRegistry } from './automated-outbound';

describe('AutomatedOutboundRegistry', () => {
  const now = 1_700_000_000_000;

  it('trata o eco do texto enviado pela API como automático', () => {
    const registry = new AutomatedOutboundRegistry();
    registry.rememberText('351912345678', 'Anotei a data.', now);

    expect(
      registry.isAutomatedEcho({
        digits: '351912345678',
        text: 'Anotei a data.',
        now: now + 1000,
      }),
    ).toBe(true);
    expect(
      registry.isAutomatedEcho({
        digits: '351912345678',
        text: 'Anotei a data.',
        now: now + 1000,
      }),
    ).toBe(false);
  });

  it('reconhece o eco pelo id mesmo que o texto já tenha sido gasto', () => {
    const registry = new AutomatedOutboundRegistry();
    registry.rememberText('351912345678', 'Olá', now);
    registry.rememberMessageId('MSG1', now);
    registry.isAutomatedEcho({
      digits: '351912345678',
      text: 'Olá',
      now: now + 10,
    });

    expect(
      registry.isAutomatedEcho({
        digits: '351912345678',
        messageId: 'MSG1',
        text: 'Olá',
        now: now + 20,
      }),
    ).toBe(true);
  });

  it('não confunde uma mensagem nova do admin com o envio automático', () => {
    const registry = new AutomatedOutboundRegistry();
    registry.rememberText('351912345678', 'Link da agenda', now);

    expect(
      registry.isAutomatedEcho({
        digits: '351912345678',
        text: 'Olá, sou a Rafa',
        now: now + 10,
      }),
    ).toBe(false);
  });

  it('gasta a mídia automática uma vez', () => {
    const registry = new AutomatedOutboundRegistry();
    registry.rememberMedia('351912345678', now);

    expect(
      registry.isAutomatedEcho({
        digits: '351912345678',
        hasMedia: true,
        now: now + 10,
      }),
    ).toBe(true);
    expect(
      registry.isAutomatedEcho({
        digits: '351912345678',
        hasMedia: true,
        now: now + 20,
      }),
    ).toBe(false);
  });
});
