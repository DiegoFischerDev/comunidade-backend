import { Controller, Post, Body, Req, Headers, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { StripeService } from './stripe.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';

@Controller('stripe')
export class StripeController {
  constructor(private readonly stripeService: StripeService) {}

  @Post('create-checkout-session')
  @UseGuards(JwtAuthGuard)
  async createCheckoutSession(
    @CurrentUser() user: { id: string; email: string },
    @Body() dto: CreateCheckoutSessionDto,
  ) {
    return this.stripeService.createCheckoutSession(
      user.id,
      user.email,
      dto.successUrl,
      dto.cancelUrl,
    );
  }

  /**
   * Webhook Stripe — não usar JSON body parser; o corpo deve ser raw para verificação da assinatura.
   * O main.ts configura express.raw() para esta rota.
   */
  @Public()
  @Post('webhook')
  async webhook(
    @Req() req: Request & { body: Buffer },
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    const rawBody = req.body;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      throw new Error('Webhook requires raw body');
    }
    await this.stripeService.handleWebhook(rawBody, signature);
    return { received: true };
  }
}
