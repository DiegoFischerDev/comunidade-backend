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

  async sendText(toDigits: string, text: string): Promise<void> {
    const base = this.base;
    const key = this.key;
    if (!base || !key) {
      this.logger.warn(
        'EVOLUTION_API_URL ou EVOLUTION_API_KEY ausentes; WhatsApp não enviado.',
      );
      return;
    }
    const number = toDigits.replace(/\D/g, '');
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
}

