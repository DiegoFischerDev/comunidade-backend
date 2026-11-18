import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { InstagramService } from './instagram.service';

@Controller('instagram')
export class InstagramController {
  constructor(private readonly instagram: InstagramService) {}

  /**
   * Verificação do webhook Meta (hub.challenge).
   * Callback URL: https://api.movecasa.pt/instagram/webhook
   */
  @Public()
  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') verifyToken: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ) {
    const ok = this.instagram.verifyWebhookSubscription(
      mode,
      verifyToken,
      challenge,
    );
    if (ok == null) {
      return res.status(403).send('Forbidden');
    }
    return res.status(200).type('text/plain').send(ok);
  }

  /**
   * Eventos Instagram (DMs, etc.). Body raw + X-Hub-Signature-256.
   */
  @Public()
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: Request & { body: Buffer },
    @Headers('x-hub-signature-256') signature: string | undefined,
  ) {
    const rawBody = req.body;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      throw new UnauthorizedException('Webhook requires raw body');
    }
    const result = await this.instagram.handleWebhookRaw(rawBody, signature);
    if (!result.ok) {
      throw new UnauthorizedException('Invalid Instagram webhook signature');
    }
    return { received: true, count: result.received };
  }
}
