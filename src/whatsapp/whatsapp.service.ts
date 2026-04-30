import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  private get base(): string {
    return (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
  }
  private get key(): string {
    return process.env.EVOLUTION_API_KEY || '';
  }

  private getAllowedInstances(): string[] {
    const primary = (process.env.EVOLUTION_INSTANCE || 'comunidade').trim();
    const secondary = (process.env.EVOLUTION_INSTANCE_SECONDARY || '').trim();
    const active = (process.env.EVOLUTION_ACTIVE_INSTANCE || '').trim();

    const base = [primary, secondary].filter(
      (v, i, arr) => !!v && arr.indexOf(v) === i,
    );
    if (!base.length) return ['comunidade'];
    if (!active || !base.includes(active)) return base;
    return [active, ...base.filter((v) => v !== active)];
  }

  private get instancesOrdered(): string[] {
    return this.getAllowedInstances();
  }

  private resolveSendInstances(preferredInstance?: string): string[] {
    const allowed = this.getAllowedInstances();
    const failoverRaw = (process.env.EVOLUTION_FAILOVER_ENABLED || '1').trim().toLowerCase();
    const failoverEnabled = !['0', 'false', 'off', 'no'].includes(failoverRaw);
    const p = (preferredInstance || '').trim();
    if (p && allowed.includes(p)) {
      const ordered = [p, ...allowed.filter((v) => v !== p)];
      return failoverEnabled ? ordered : ordered.slice(0, 1);
    }
    return failoverEnabled ? allowed : allowed.slice(0, 1);
  }

  private get failoverEnabled(): boolean {
    const raw = (process.env.EVOLUTION_FAILOVER_ENABLED || '1').trim().toLowerCase();
    return !['0', 'false', 'off', 'no'].includes(raw);
  }

  /** Timeout do fetch (backend → Evolution). Vídeos grandes podem demorar a processar no servidor da API. */
  private evolutionRequestSignal(): AbortSignal | undefined {
    const raw = process.env.EVOLUTION_REQUEST_TIMEOUT_MS?.trim();
    const ms =
      raw && /^\d+$/.test(raw)
        ? parseInt(raw, 10)
        : 180000;
    if (!ms || ms <= 0) return undefined;
    try {
      return AbortSignal.timeout(ms);
    } catch {
      return undefined;
    }
  }

  private normalizeRecipient(value: string): string {
    const raw = (value ?? '').toString().trim();
    if (!raw) return '';
    // Para grupos, a Evolution aceita JID (ex.: 1203630...@g.us)
    if (raw.includes('@')) return raw;
    return raw.replace(/\D/g, '');
  }

  async sendText(
    toDigits: string,
    text: string,
    opts?: { requireDelivery?: boolean; preferredInstance?: string },
  ): Promise<void> {
    const requireDelivery = opts?.requireDelivery === true;
    const base = this.base;
    const key = this.key;
    if (!base || !key) {
      const msg =
        'EVOLUTION_API_URL ou EVOLUTION_API_KEY ausentes; WhatsApp não enviado.';
      this.logger.warn(msg);
      if (requireDelivery) throw new Error(msg);
      return;
    }
    const number = this.normalizeRecipient(toDigits);
    if (!number) {
      if (requireDelivery) throw new Error('Destino WhatsApp vazio (number).');
      return;
    }

    const attempts = this.resolveSendInstances(opts?.preferredInstance);
    let lastError = '';

    const reqSignal = this.evolutionRequestSignal();
    for (let i = 0; i < attempts.length; i++) {
      const instance = attempts[i];
      try {
        const res = await fetch(`${base}/message/sendText/${instance}`, {
          method: 'POST',
          headers: { apikey: key, 'content-type': 'application/json' },
          body: JSON.stringify({ number, text }),
          ...(reqSignal ? { signal: reqSignal } : {}),
        });
        if (res.ok) {
          if (i > 0) {
            this.logger.warn(
              `sendText entregue via instância de reserva: ${instance}`,
            );
          }
          return;
        }
        const body = await res.text().catch(() => '');
        lastError = `${res.status} ${body}`.trim();
      } catch (err: any) {
        lastError = err?.message ? String(err.message) : 'erro de rede';
      }
    }
    this.logger.warn(`Evolution sendText falhou em todas as instâncias: ${lastError}`);
    if (requireDelivery) {
      throw new Error(lastError || 'Evolution sendText falhou.');
    }
  }

  async sendMedia(params: {
    to: string;
    caption: string;
    /** Obrigatório se `mediaUrl` não for uma URL http(s) válida. */
    base64?: string;
    /**
     * URL pública https (ou http) do ficheiro — Evolution usa isto no JSON em vez de base64
     * (evita 413 no proxy / limite de body da própria API).
     */
    mediaUrl?: string;
    mimeType: string;
    fileName: string;
    mediaType?: 'image' | 'video' | 'document';
    /** Se true, lança erro quando Evolution falhar (ex. grupo de casas). */
    requireDelivery?: boolean;
  }): Promise<void> {
    const requireDelivery = params.requireDelivery === true;
    const base = this.base;
    const key = this.key;
    if (!base || !key) {
      const msg =
        'EVOLUTION_API_URL ou EVOLUTION_API_KEY ausentes; WhatsApp não enviado.';
      this.logger.warn(msg);
      if (requireDelivery) throw new Error(msg);
      return;
    }

    const number = this.normalizeRecipient(params.to);
    if (!number) {
      if (requireDelivery) throw new Error('Destino WhatsApp vazio (number).');
      return;
    }

    const instances = this.instancesOrdered;
    const attempts = this.failoverEnabled ? instances : instances.slice(0, 1);
    let lastError = '';

    const urlTrim = params.mediaUrl?.trim();
    const mediaPayload =
      urlTrim && (urlTrim.startsWith('https://') || urlTrim.startsWith('http://'))
        ? urlTrim
        : (params.base64 ?? '');
    if (!mediaPayload?.length) {
      const msg = 'sendMedia: falta mediaUrl ou base64.';
      this.logger.warn(msg);
      if (requireDelivery) throw new Error(msg);
      return;
    }

    const mediaSignal = this.evolutionRequestSignal();
    for (let i = 0; i < attempts.length; i++) {
      const instance = attempts[i];
      try {
        const res = await fetch(`${base}/message/sendMedia/${instance}`, {
          method: 'POST',
          headers: { apikey: key, 'content-type': 'application/json' },
          body: JSON.stringify({
            number,
            // Evolution v2.x valida enum em minúsculas: image | document | video | audio
            mediatype:
              params.mediaType === 'video'
                ? 'video'
                : params.mediaType === 'document'
                  ? 'document'
                  : 'image',
            mimetype: params.mimeType,
            caption: params.caption ?? '',
            media: mediaPayload,
            fileName: params.fileName,
          }),
          ...(mediaSignal ? { signal: mediaSignal } : {}),
        });
        if (res.ok) {
          if (i > 0) {
            this.logger.warn(
              `sendMedia entregue via instância de reserva: ${instance}`,
            );
          }
          return;
        }
        const body = await res.text().catch(() => '');
        lastError = `${res.status} ${body}`.trim();
      } catch (err: any) {
        lastError = err?.message ? String(err.message) : 'erro de rede';
      }
    }
    this.logger.warn(`Evolution sendMedia falhou em todas as instâncias: ${lastError}`);
    if (requireDelivery) {
      throw new Error(lastError || 'Evolution sendMedia falhou.');
    }
  }
}

