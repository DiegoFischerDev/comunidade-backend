import {
  AutomatedOutboundRegistry,
  normalizeOutboundText,
} from '../whatsapp/automated-outbound';

export type OutboundPeer =
  | { channel: 'whatsapp'; digits: string }
  | { channel: 'instagram'; igsid: string };

/** Limite: 20 envios / 10 min por peer → circuit aberto. */
export const OUTBOUND_CIRCUIT_MAX_SENDS = 20;
export const OUTBOUND_CIRCUIT_WINDOW_MS = 10 * 60 * 1000;
/** Circuit fica aberto 1h (ou até clearCircuit / admin reactivar). */
export const OUTBOUND_CIRCUIT_COOLDOWN_MS = 60 * 60 * 1000;
/** Dedupe de webhooks reentregues. */
export const INBOUND_MESSAGE_ID_TTL_MS = 60 * 60 * 1000;

export function outboundPeerKey(peer: OutboundPeer): string {
  if (peer.channel === 'whatsapp') {
    const digits = peer.digits.replace(/\D/g, '');
    return digits ? `wa:${digits}` : '';
  }
  const ig = peer.igsid.trim();
  return ig ? `ig:${ig}` : '';
}

export function whatsappPeer(digits: string): OutboundPeer {
  return { channel: 'whatsapp', digits: digits.replace(/\D/g, '') };
}

export function instagramPeer(igsid: string): OutboundPeer {
  return { channel: 'instagram', igsid: igsid.trim() };
}

/**
 * Guarda anti-loop partilhada (WA + IG):
 * - fingerprint das mensagens que este processo enviou (eco)
 * - circuit-breaker por peer
 * - dedupe de messageId inbound
 */
export class OutboundGuard {
  private readonly echo = new AutomatedOutboundRegistry();
  private readonly sendAt = new Map<string, number[]>();
  private readonly circuitUntil = new Map<string, number>();
  private readonly seenInboundIds = new Map<string, number>();

  constructor(
    private readonly maxSends = OUTBOUND_CIRCUIT_MAX_SENDS,
    private readonly windowMs = OUTBOUND_CIRCUIT_WINDOW_MS,
    private readonly cooldownMs = OUTBOUND_CIRCUIT_COOLDOWN_MS,
    private readonly inboundIdTtlMs = INBOUND_MESSAGE_ID_TTL_MS,
  ) {}

  rememberText(peer: OutboundPeer, text: string, now = Date.now()): void {
    const key = outboundPeerKey(peer);
    if (!key) return;
    this.echo.rememberText(key, text, now);
  }

  rememberMedia(peer: OutboundPeer, now = Date.now()): void {
    const key = outboundPeerKey(peer);
    if (!key) return;
    this.echo.rememberMedia(key, now);
  }

  rememberMessageId(id: string, now = Date.now()): void {
    this.echo.rememberMessageId(id, now);
  }

  forgetText(peer: OutboundPeer, text: string, now = Date.now()): void {
    const key = outboundPeerKey(peer);
    if (!key) return;
    this.echo.forgetText(key, text, now);
  }

  forgetMedia(peer: OutboundPeer, now = Date.now()): void {
    const key = outboundPeerKey(peer);
    if (!key) return;
    this.echo.forgetMedia(key, now);
  }

  isAutomatedEcho(input: {
    peer: OutboundPeer;
    messageId?: string | null;
    text?: string | null;
    hasMedia?: boolean;
    now?: number;
  }): boolean {
    const key = outboundPeerKey(input.peer);
    if (!key) return false;
    return this.echo.isAutomatedEcho({
      digits: key,
      messageId: input.messageId,
      text: input.text,
      hasMedia: input.hasMedia,
      now: input.now,
    });
  }

  isCircuitOpen(peer: OutboundPeer, now = Date.now()): boolean {
    const key = outboundPeerKey(peer);
    if (!key) return false;
    this.pruneCircuits(now);
    const until = this.circuitUntil.get(key);
    return Boolean(until && until > now);
  }

  /** false = não enviar (circuit aberto). */
  allowSend(peer: OutboundPeer, now = Date.now()): boolean {
    return !this.isCircuitOpen(peer, now);
  }

  openCircuit(peer: OutboundPeer, now = Date.now()): void {
    const key = outboundPeerKey(peer);
    if (!key) return;
    this.circuitUntil.set(key, now + this.cooldownMs);
  }

  clearCircuit(peer: OutboundPeer): void {
    const key = outboundPeerKey(peer);
    if (!key) return;
    this.circuitUntil.delete(key);
    this.sendAt.delete(key);
  }

  /**
   * Regista um envio com sucesso.
   * `tripped: true` na primeira vez que ultrapassa o limite nesta janela.
   */
  recordSuccessfulSend(
    peer: OutboundPeer,
    now = Date.now(),
  ): { tripped: boolean; count: number } {
    const key = outboundPeerKey(peer);
    if (!key) return { tripped: false, count: 0 };

    this.pruneCircuits(now);
    const windowStart = now - this.windowMs;
    const recent = (this.sendAt.get(key) ?? []).filter((t) => t > windowStart);
    recent.push(now);
    this.sendAt.set(key, recent);

    const alreadyOpen = this.isCircuitOpen(peer, now);
    if (recent.length > this.maxSends && !alreadyOpen) {
      this.openCircuit(peer, now);
      return { tripped: true, count: recent.length };
    }
    return { tripped: false, count: recent.length };
  }

  /**
   * Reserva um messageId inbound. `false` = já visto (reentrega).
   * IDs vazios / locais (`local-…`) não entram no dedupe.
   */
  claimInboundMessageId(messageId: string | null | undefined, now = Date.now()): boolean {
    const id = (messageId || '').trim();
    if (!id || id.startsWith('local-')) return true;
    this.pruneInboundIds(now);
    if (this.seenInboundIds.has(id)) return false;
    this.seenInboundIds.set(id, now + this.inboundIdTtlMs);
    return true;
  }

  normalizeText(text: string): string {
    return normalizeOutboundText(text);
  }

  private pruneCircuits(now: number): void {
    for (const [key, until] of this.circuitUntil) {
      if (until <= now) this.circuitUntil.delete(key);
    }
    const windowStart = now - this.windowMs;
    for (const [key, stamps] of this.sendAt) {
      const live = stamps.filter((t) => t > windowStart);
      if (live.length === 0) this.sendAt.delete(key);
      else if (live.length !== stamps.length) this.sendAt.set(key, live);
    }
  }

  private pruneInboundIds(now: number): void {
    for (const [id, expires] of this.seenInboundIds) {
      if (expires <= now) this.seenInboundIds.delete(id);
    }
  }
}

/** Instância partilhada no processo (WA + IG + router). */
export const sharedOutboundGuard = new OutboundGuard();
