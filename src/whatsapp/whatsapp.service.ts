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
  private get instance(): string {
    return process.env.EVOLUTION_INSTANCE || 'comunidade';
  }

  private normalizeRecipient(value: string): string {
    const raw = (value ?? '').toString().trim();
    if (!raw) return '';
    // Para grupos, a Evolution aceita JID (ex.: 1203630...@g.us)
    if (raw.includes('@')) return raw;
    return raw.replace(/\D/g, '');
  }

  async sendText(toDigits: string, text: string): Promise<void> {
    const base = this.base;
    const key = this.key;
    if (!base || !key) {
      this.logger.warn(
        'EVOLUTION_API_URL ou EVOLUTION_API_KEY ausentes; WhatsApp não enviado.',
      );
      return;
    }
    const number = this.normalizeRecipient(toDigits);
    if (!number) return;
    const res = await fetch(`${base}/message/sendText/${this.instance}`, {
      method: 'POST',
      headers: { apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify({ number, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.warn(`Evolution sendText falhou: ${res.status} ${body}`);
    }
  }

  async sendMedia(params: {
    to: string;
    caption: string;
    base64: string;
    mimeType: string;
    fileName: string;
    mediaType?: 'image' | 'video' | 'document';
  }): Promise<void> {
    const base = this.base;
    const key = this.key;
    if (!base || !key) {
      this.logger.warn(
        'EVOLUTION_API_URL ou EVOLUTION_API_KEY ausentes; WhatsApp não enviado.',
      );
      return;
    }

    const number = this.normalizeRecipient(params.to);
    if (!number) return;

    const res = await fetch(`${base}/message/sendMedia/${this.instance}`, {
      method: 'POST',
      headers: { apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify({
        number,
        mediatype: (params.mediaType ?? 'image').toUpperCase(),
        mimetype: params.mimeType,
        caption: params.caption ?? '',
        media: params.base64,
        fileName: params.fileName,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.warn(`Evolution sendMedia falhou: ${res.status} ${body}`);
    }
  }
}

