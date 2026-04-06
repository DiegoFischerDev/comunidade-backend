import {
  BadRequestException,
  Controller,
  Headers,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';
import { Public } from '../auth/public.decorator';
import { RafacallService } from './rafacall.service';

function safeEqual(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function parseCalendlySignatureHeader(
  header: string,
): { t: string | null; sig: string | null } {
  // Variações encontradas: "t=...,v1=..." ou "t=...,sig=..."
  const parts = header
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  let t: string | null = null;
  let sig: string | null = null;
  for (const p of parts) {
    const [k, ...rest] = p.split('=');
    const v = rest.join('=');
    const key = (k || '').trim().toLowerCase();
    if (!key) continue;
    if (key === 't') t = v;
    if (key === 'v1' || key === 'sig' || key === 'signature') sig = v;
  }
  return { t, sig };
}

function computeHmacHex(secret: string, data: string): string {
  return crypto.createHmac('sha256', secret).update(data, 'utf8').digest('hex');
}

@Controller('webhooks')
export class CalendlyWebhookController {
  private readonly logger = new Logger(CalendlyWebhookController.name);

  constructor(private readonly rafacallService: RafacallService) {}

  /**
   * Webhook Calendly.
   * Assinatura: header `Calendly-Webhook-Signature` (timestamp + assinatura HMAC).
   */
  @Public()
  @Post('calendly')
  async calendly(
    @Req() req: Request & { body: Buffer },
    @Headers('calendly-webhook-signature') signatureHeader: string | undefined,
  ) {
    const raw = req.body;
    if (!raw || !Buffer.isBuffer(raw)) {
      throw new BadRequestException('Body raw em falta');
    }

    const secret = process.env.CALENDLY_WEBHOOK_SIGNING_KEY?.trim();
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('CALENDLY_WEBHOOK_SIGNING_KEY em falta — webhook rejeitado');
        throw new BadRequestException('Webhook não configurado');
      }
      // dev permissivo: aceita sem verificação
      const parsed = JSON.parse(raw.toString('utf8'));
      await this.rafacallService.handleCalendlyWebhookPayload(parsed);
      return { ok: true, verified: false };
    }

    if (!signatureHeader) {
      throw new BadRequestException('Assinatura em falta');
    }
    const { t, sig } = parseCalendlySignatureHeader(signatureHeader);
    if (!t || !sig) {
      throw new BadRequestException('Assinatura inválida');
    }

    const bodyUtf8 = raw.toString('utf8');
    // Tentamos formatos comuns (documentação varia por versão)
    const candidates = [
      `${t}.${bodyUtf8}`,
      `${t}.${raw.toString()}`,
      `${t}${bodyUtf8}`,
    ];
    const expected = candidates.map((data) => computeHmacHex(secret, data));
    const ok = expected.some((h) => safeEqual(h, sig));
    if (!ok) {
      this.logger.warn('Calendly: assinatura inválida');
      throw new BadRequestException('Assinatura inválida');
    }

    const parsed = JSON.parse(bodyUtf8);
    await this.rafacallService.handleCalendlyWebhookPayload(parsed);
    return { ok: true, verified: true };
  }
}

