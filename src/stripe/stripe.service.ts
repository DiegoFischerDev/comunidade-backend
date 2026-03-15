import { Injectable, BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionStatus } from '@prisma/client';
import { UserTier } from '@prisma/client';

const MEMBERSHIP_DURATION_YEARS = 1;

@Injectable()
export class StripeService {
  private stripe: Stripe | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private getClient(): Stripe {
    if (!this.stripe) {
      const secret = process.env.STRIPE_SECRET_KEY;
      if (!secret) {
        throw new BadRequestException('Pagamentos não configurados (STRIPE_SECRET_KEY).');
      }
      this.stripe = new Stripe(secret);
    }
    return this.stripe;
  }

  /** ID do preço da anuidade (criado no Stripe Dashboard) */
  private get priceId(): string {
    const id = process.env.STRIPE_PRICE_ID_ANNUAL;
    if (!id) {
      throw new BadRequestException('Configuração de preço da anuidade não definida.');
    }
    return id;
  }

  /**
   * Cria uma sessão de Checkout para assinatura anual.
   * Se o utilizador já tiver stripeCustomerId, reutiliza; senão, o Stripe cria o cliente no checkout.
   */
  async createCheckoutSession(userId: string, userEmail: string, successUrl: string, cancelUrl: string): Promise<{ url: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });
    if (!user) {
      throw new BadRequestException('Utilizador não encontrado.');
    }

    const customerId = user.subscription?.stripeCustomerId ?? undefined;
    const stripe = this.getClient();

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: customerId ? undefined : userEmail,
      customer: customerId || undefined,
      line_items: [
        {
          price: this.priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: userId,
      subscription_data: {
        metadata: { userId },
      },
      allow_promotion_codes: true,
    });

    if (!session.url) {
      throw new BadRequestException('Não foi possível criar a sessão de pagamento.');
    }

    return { url: session.url };
  }

  /**
   * Processa eventos do webhook Stripe e atualiza Subscription + User.
   */
  async handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<void> {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is required');
    }
    if (!signature) {
      throw new BadRequestException('Missing Stripe-Signature');
    }

    const stripe = this.getClient();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new BadRequestException(`Webhook signature verification failed: ${message}`);
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await this.handleCheckoutCompleted(session);
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionUpdatedOrDeleted(subscription);
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        await this.handleInvoicePaid(invoice);
        break;
      }
      default:
        // Ignorar outros eventos
        break;
    }
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const userId =
      (session.client_reference_id as string) ||
      (session.subscription ? await this.getUserIdFromSubscription(session.subscription as string) : null) ||
      (session.metadata?.userId as string);
    if (!userId) return;

    const customerId = session.customer as string;
    const subscriptionId = session.subscription as string;

    const subResponse = await this.getClient().subscriptions.retrieve(subscriptionId);
    const sub = subResponse as unknown as Stripe.Subscription;
    const validUntil = sub.current_period_end != null
      ? new Date(sub.current_period_end * 1000)
      : addYears(new Date(), MEMBERSHIP_DURATION_YEARS);

    await this.prisma.$transaction([
      this.prisma.subscription.upsert({
        where: { userId },
        create: {
          userId,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          status: SubscriptionStatus.ACTIVE,
          validUntil,
        },
        update: {
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          status: SubscriptionStatus.ACTIVE,
          validUntil,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { tier: UserTier.MEMBER, membershipExpiresAt: validUntil },
      }),
    ]);
  }

  private async getUserIdFromSubscription(subscriptionId: string): Promise<string | null> {
    const subResponse = await this.getClient().subscriptions.retrieve(subscriptionId);
    const sub = subResponse as unknown as Stripe.Subscription;
    return (sub.metadata?.userId as string) ?? null;
  }

  private async handleSubscriptionUpdatedOrDeleted(stripeSubscription: Stripe.Subscription): Promise<void> {
    const sub = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: stripeSubscription.id },
    });
    const userId = sub?.userId ?? (stripeSubscription.metadata?.userId as string | undefined);
    if (!userId) return;

    const status =
      stripeSubscription.status === 'active' ? SubscriptionStatus.ACTIVE
      : stripeSubscription.status === 'canceled' || stripeSubscription.status === 'unpaid'
        ? SubscriptionStatus.CANCELLED
        : SubscriptionStatus.EXPIRED;

    const validUntil =
      stripeSubscription.current_period_end != null
        ? new Date(stripeSubscription.current_period_end * 1000)
        : new Date(0);

    await this.prisma.subscription.updateMany({
      where: { stripeSubscriptionId: stripeSubscription.id },
      data: { status, validUntil },
    });

    const isActive = status === SubscriptionStatus.ACTIVE && validUntil > new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        tier: isActive ? UserTier.MEMBER : UserTier.VISITOR,
        membershipExpiresAt: isActive ? validUntil : null,
      },
    });
  }

  private async handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
    if (!subscriptionId) return;

    const userId = await this.getUserIdFromSubscription(subscriptionId);
    if (!userId) return;

    const subResponse = await this.getClient().subscriptions.retrieve(subscriptionId);
    const sub = subResponse as unknown as Stripe.Subscription;
    const validUntil =
      sub.current_period_end != null
        ? new Date(sub.current_period_end * 1000)
        : addYears(new Date(), MEMBERSHIP_DURATION_YEARS);

    await this.prisma.subscription.updateMany({
      where: { stripeSubscriptionId: subscriptionId },
      data: { status: SubscriptionStatus.ACTIVE, validUntil },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { tier: UserTier.MEMBER, membershipExpiresAt: validUntil },
    });
  }
}

function addYears(date: Date, years: number): Date {
  const out = new Date(date);
  out.setFullYear(out.getFullYear() + years);
  return out;
}
