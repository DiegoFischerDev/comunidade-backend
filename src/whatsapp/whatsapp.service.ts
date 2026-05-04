import { Injectable, Logger } from '@nestjs/common';
import { isBase64, isURL } from 'class-validator';

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

  /**
   * Timeout do fetch (backend → Evolution).
   * Texto/imagem: `EVOLUTION_REQUEST_TIMEOUT_MS` (omissão 180s).
   * Vídeo: `EVOLUTION_VIDEO_REQUEST_TIMEOUT_MS` (omissão 600s) — vídeos longos (~3 min) e proxy lento.
   */
  private evolutionRequestSignal(kind: 'default' | 'video' = 'default'): AbortSignal | undefined {
    const rawDefault = process.env.EVOLUTION_REQUEST_TIMEOUT_MS?.trim();
    const rawVideo = process.env.EVOLUTION_VIDEO_REQUEST_TIMEOUT_MS?.trim();
    const defaultMs =
      kind === 'video'
        ? rawVideo && /^\d+$/.test(rawVideo)
          ? parseInt(rawVideo, 10)
          : 600000
        : rawDefault && /^\d+$/.test(rawDefault)
          ? parseInt(rawDefault, 10)
          : 180000;
    const ms = defaultMs;
    if (!ms || ms <= 0) return undefined;
    try {
      return AbortSignal.timeout(ms);
    } catch {
      return undefined;
    }
  }

  /**
   * Evolution 2.3.x (`sendMessage.controller.ts`) só aceita `media` se `isURL(media)` ou `isBase64(media)`.
   * O `isURL` do class-validator rejeita, entre outros, `http://localhost/...` e `http://servico-docker:porta/...`.
   * Nesses casos obtemos o ficheiro no backend e enviamos base64 (imagens/documentos; vídeos grandes exigem URL público válido).
   */
  private maxBytesForUrlFetchBase64Fallback(): number {
    const raw = process.env.EVOLUTION_SEND_MEDIA_URL_FETCH_MAX_BYTES?.trim();
    if (raw && /^\d+$/.test(raw)) {
      return parseInt(raw, 10);
    }
    return 12 * 1024 * 1024;
  }

  private async evolutionMediaField(params: {
    mediaUrl?: string;
    base64?: string;
    mediaType?: 'image' | 'video' | 'document';
  }): Promise<string> {
    const urlTrim = params.mediaUrl?.trim();
    let mediaPayload =
      urlTrim && (urlTrim.startsWith('https://') || urlTrim.startsWith('http://'))
        ? urlTrim
        : (params.base64 ?? '').trim();
    if (!mediaPayload.length) {
      return '';
    }
    if (isBase64(mediaPayload)) {
      return mediaPayload;
    }
    const isHttp =
      mediaPayload.startsWith('https://') || mediaPayload.startsWith('http://');
    if (!isHttp) {
      return mediaPayload;
    }
    if (isURL(mediaPayload)) {
      return mediaPayload;
    }

    const isVideo = params.mediaType === 'video';
    if (isVideo) {
      throw new Error(
        'sendMedia (vídeo): a URL não passa na validação isURL da Evolution (ex.: localhost ou hostname só interno). ' +
          'Define PUBLIC_API_BASE_URL com o HTTPS público da API, acessível em GET pela Evolution.',
      );
    }

    const maxBytes = this.maxBytesForUrlFetchBase64Fallback();
    const fetchSignal = this.evolutionRequestSignal('default');
    const res = await fetch(mediaPayload, {
      redirect: 'follow',
      ...(fetchSignal ? { signal: fetchSignal } : {}),
    });
    if (!res.ok) {
      throw new Error(
        `sendMedia: falha ao obter a mídia (${res.status}) em ${mediaPayload.slice(0, 160)}`,
      );
    }
    const lenHeader = res.headers.get('content-length');
    if (lenHeader && /^\d+$/.test(lenHeader)) {
      const n = parseInt(lenHeader, 10);
      if (n > maxBytes) {
        throw new Error(
          `sendMedia: ficheiro demasiado grande (${n} bytes, máx. ${maxBytes}). Ajusta EVOLUTION_SEND_MEDIA_URL_FETCH_MAX_BYTES ou usa URL pública.`,
        );
      }
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      throw new Error(
        `sendMedia: ficheiro demasiado grande (${buf.length} bytes, máx. ${maxBytes}).`,
      );
    }
    this.logger.warn(
      `sendMedia: URL não aceite por isURL na Evolution; a enviar como base64 (${buf.length} bytes).`,
    );
    return buf.toString('base64');
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

    let mediaPayload: string;
    try {
      mediaPayload = await this.evolutionMediaField({
        mediaUrl: params.mediaUrl,
        base64: params.base64,
        mediaType: params.mediaType,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'sendMedia: erro ao preparar mídia.';
      this.logger.warn(msg);
      if (requireDelivery) throw new Error(msg);
      return;
    }
    if (!mediaPayload?.length) {
      const msg = 'sendMedia: falta mediaUrl ou base64.';
      this.logger.warn(msg);
      if (requireDelivery) throw new Error(msg);
      return;
    }

    const mediaKind = params.mediaType === 'video' ? 'video' : 'default';
    const mediaSignal = this.evolutionRequestSignal(mediaKind);
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

