import {
  OUTBOUND_CIRCUIT_MAX_SENDS,
  OutboundGuard,
  instagramPeer,
  whatsappPeer,
} from './outbound-guard';

describe('OutboundGuard', () => {
  const now = 1_700_000_000_000;

  it('trata eco de texto WhatsApp e Instagram', () => {
    const guard = new OutboundGuard();
    const wa = whatsappPeer('351912345678');
    const ig = instagramPeer('ig-user-1');

    guard.rememberText(wa, 'Olá da Joana', now);
    guard.rememberText(ig, 'Olá do IG', now);

    expect(
      guard.isAutomatedEcho({
        peer: wa,
        text: 'Olá da Joana',
        now: now + 100,
      }),
    ).toBe(true);
    expect(
      guard.isAutomatedEcho({
        peer: ig,
        text: 'Olá do IG',
        now: now + 100,
      }),
    ).toBe(true);
    expect(
      guard.isAutomatedEcho({
        peer: wa,
        text: 'mensagem nova',
        now: now + 100,
      }),
    ).toBe(false);
  });

  it('reconhece eco pelo messageId', () => {
    const guard = new OutboundGuard();
    const wa = whatsappPeer('351900000000');
    guard.rememberMessageId('MID-1', now);

    expect(
      guard.isAutomatedEcho({
        peer: wa,
        messageId: 'MID-1',
        text: 'qualquer',
        now: now + 10,
      }),
    ).toBe(true);
  });

  it('abre o circuit-breaker após demasiados envios', () => {
    const guard = new OutboundGuard();
    const peer = whatsappPeer('351911111111');

    for (let i = 0; i < OUTBOUND_CIRCUIT_MAX_SENDS; i++) {
      const result = guard.recordSuccessfulSend(peer, now + i * 1000);
      expect(result.tripped).toBe(false);
      expect(guard.allowSend(peer, now + i * 1000)).toBe(true);
    }

    const trip = guard.recordSuccessfulSend(
      peer,
      now + OUTBOUND_CIRCUIT_MAX_SENDS * 1000,
    );
    expect(trip.tripped).toBe(true);
    expect(trip.count).toBe(OUTBOUND_CIRCUIT_MAX_SENDS + 1);
    expect(
      guard.allowSend(peer, now + OUTBOUND_CIRCUIT_MAX_SENDS * 1000 + 1),
    ).toBe(false);
  });

  it('clearCircuit volta a permitir envios', () => {
    const guard = new OutboundGuard();
    const peer = instagramPeer('loop-user');
    for (let i = 0; i <= OUTBOUND_CIRCUIT_MAX_SENDS; i++) {
      guard.recordSuccessfulSend(peer, now + i);
    }
    expect(guard.allowSend(peer, now + 100)).toBe(false);
    guard.clearCircuit(peer);
    expect(guard.allowSend(peer, now + 100)).toBe(true);
  });

  it('dedupe de messageId inbound: segunda entrega é rejeitada', () => {
    const guard = new OutboundGuard();
    expect(guard.claimInboundMessageId('msg-abc', now)).toBe(true);
    expect(guard.claimInboundMessageId('msg-abc', now + 10)).toBe(false);
    expect(guard.claimInboundMessageId('msg-xyz', now + 20)).toBe(true);
  });

  it('ids locais não entram no dedupe', () => {
    const guard = new OutboundGuard();
    expect(guard.claimInboundMessageId('local-123', now)).toBe(true);
    expect(guard.claimInboundMessageId('local-123', now + 1)).toBe(true);
    expect(guard.claimInboundMessageId(null, now)).toBe(true);
  });
});
