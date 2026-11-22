import {
  Controller,
  forwardRef,
  Get,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { ChatbotRouterService } from '../chatbots/chatbot-router.service';
import { InstagramService } from './instagram.service';

@Controller('instagram')
export class InstagramController {
  private readonly logger = new Logger(InstagramController.name);

  constructor(
    private readonly instagram: InstagramService,
    @Inject(forwardRef(() => ChatbotRouterService))
    private readonly router: ChatbotRouterService,
  ) {}

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

    for (const msg of result.messages) {
      try {
        const pushName =
          msg.profileName?.trim() ||
          (msg.profileUsername ? `@${msg.profileUsername}` : undefined);
        if (msg.profileName || msg.profileUsername || msg.profilePicUrl) {
          await this.router.enrichInstagramSender({
            instagramUserId: msg.instagramUserId,
            profileName: msg.profileName ?? null,
            profileUsername: msg.profileUsername ?? null,
            profilePicUrl: msg.profilePicUrl ?? null,
          });
        }
        if (msg.audioUrl && !msg.text) {
          await this.router.acceptInstagramAudio({
            instagramUserId: msg.instagramUserId,
            externalMessageId: msg.externalMessageId,
            audioUrl: msg.audioUrl,
            pushName,
          });
        } else {
          await this.router.bufferInbound({
            channel: 'instagram',
            instagramUserId: msg.instagramUserId,
            text: msg.text,
            externalMessageId: msg.externalMessageId,
            pushName,
          });
        }
      } catch (err: unknown) {
        this.logger.warn(
          `IG buffer ${msg.instagramUserId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return { received: true, count: result.messages.length };
  }
}
