import {
  Controller,
  Post,
  Req,
  Headers,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { Webhook } from 'svix';
import { Public } from '../auth/public.decorator';
import { RafacallService } from './rafacall.service';

@Controller('webhooks')
export class CalcomWebhookController {
  private readonly logger = new Logger(CalcomWebhookController.name);

  constructor(private readonly rafacallService: RafacallService) {}

  /**
   * Webhook Cal.com (assinatura Svix).
   * Configure em Cal.com → Webhooks com o mesmo segredo que CALCOM_WEBHOOK_SECRET.
   */
  @Public()
  @Post('calcom')
  async calcom(
    @Req() req: Request & { body: Buffer },
    @Headers('svix-id') svixId: string | undefined,
    @Headers('svix-timestamp') svixTimestamp: string | undefined,
    @Headers('svix-signature') svixSignature: string | undefined,
  ) {
    const raw = req.body;
    if (!raw || !Buffer.isBuffer(raw)) {
      throw new BadRequestException('Body raw em falta');
    }

    const secret = process.env.CALCOM_WEBHOOK_SECRET?.trim();
    let parsed: unknown;

    if (secret && svixId && svixTimestamp && svixSignature) {
      try {
        const wh = new Webhook(secret);
        parsed = wh.verify(raw.toString('utf8'), {
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': svixSignature,
        }) as unknown;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'verify failed';
        this.logger.warn(`Cal.com assinatura inválida: ${msg}`);
        throw new BadRequestException('Assinatura inválida');
      }
    } else {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(
          'CALCOM_WEBHOOK_SECRET ou cabeçalhos Svix em falta — webhook rejeitado',
        );
        throw new BadRequestException('Webhook não configurado');
      }
      try {
        parsed = JSON.parse(raw.toString('utf8'));
      } catch {
        throw new BadRequestException('JSON inválido');
      }
      this.logger.warn('Cal.com webhook sem verificação Svix (apenas desenvolvimento)');
    }

    await this.rafacallService.handleCalWebhookPayload(parsed);
    return { ok: true };
  }
}
