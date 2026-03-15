import { Injectable, BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionStatus } from '@prisma/client';
import { UserTier } from '@prisma/client';
import { sendEmailBase } from '../email/resend.client';

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
    const sess = session as any;
    const subIdFromSession = resolveSubscriptionId(session.subscription);
    const userId =
      (sess.client_reference_id as string) ||
      (sess.metadata?.userId as string) ||
      (subIdFromSession ? await this.getUserIdFromSubscription(subIdFromSession) : null);
    if (!userId) return;

    const customerId = typeof sess.customer === 'string' ? sess.customer : sess.customer?.id;
    const subscriptionId = resolveSubscriptionId(session.subscription);
    if (!customerId || !subscriptionId) return;

    const sub = await this.getClient().subscriptions.retrieve(subscriptionId);
    const currentPeriodEnd = (sub as any).current_period_end as number | undefined;
    const validUntil = currentPeriodEnd != null
      ? new Date(currentPeriodEnd * 1000)
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

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      });
      if (user?.email) {
        const frontendBase =
          process.env.FRONTEND_URL?.replace(/\/$/, '') ||
          'https://comunidade.rafaapelomundo.com';
        const heroUrl = `${frontendBase}/comunidade_bg.svg`;
        await sendEmailBase({
          to: user.email,
          subject: 'Bem-vindo à Comunidade RPM – já és membro',
          text: `Olá ${user.name},\n\nObrigado por te juntares à Comunidade RPM. O teu pagamento foi confirmado e agora tens acesso a todos os benefícios durante um ano.\n\nAté já!\nA equipa Comunidade RPM`,
          html: `
            <div style="max-width:640px;margin:0 auto;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
              <div style="width:100%;height:180px;overflow:hidden;">
                <img src="${heroUrl}" alt="Comunidade RPM" style="width:100%;height:100%;object-fit:cover;display:block;" />
              </div>
              <div style="padding:24px 20px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
                <p style="font-size:16px;margin:0 0 12px;">Olá <strong>${user.name}</strong>,</p>
                <p style="margin:0 0 12px;">Obrigado por te juntares à <strong>Comunidade RPM</strong>. O teu pagamento foi confirmado e agora tens acesso a todos os benefícios durante um ano.</p>
                <p style="margin:0 0 8px;">Sempre que precisares de ajuda, é só entrar no teu dashboard e falar connosco.</p>
                <p style="margin:16px 0 0;">Até já!</p>
                <p style="margin:4px 0 0;">A equipa Comunidade RPM</p>
              </div>
            </div>
          `,
        });
      }
    } catch {
      // Não falhar o webhook se o email falhar
    }
  }

  private async getUserIdFromSubscription(subscriptionId: string): Promise<string | null> {
    const sub = await this.getClient().subscriptions.retrieve(subscriptionId);
    const metadata = (sub as any).metadata as Stripe.Metadata | undefined;
    return (metadata?.userId as string) ?? null;
  }

  private async handleSubscriptionUpdatedOrDeleted(stripeSubscription: Stripe.Subscription): Promise<void> {
    const sub = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: stripeSubscription.id },
    });
    const userId = sub?.userId ?? (stripeSubscription.metadata?.userId as string | undefined);
    if (!userId) return;

    const statusRaw = (stripeSubscription as any).status as string | undefined;
    const status =
      statusRaw === 'active' ? SubscriptionStatus.ACTIVE
      : statusRaw === 'canceled' || statusRaw === 'unpaid'
        ? SubscriptionStatus.CANCELLED
        : SubscriptionStatus.EXPIRED;

    const currentPeriodEnd = (stripeSubscription as any).current_period_end as number | undefined;
    const validUntil =
      currentPeriodEnd != null ? new Date(currentPeriodEnd * 1000) : new Date(0);

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
    const inv: any = invoice as any;
    const subscriptionId =
      typeof inv.subscription === 'string'
        ? (inv.subscription as string)
        : (inv.subscription?.id as string | undefined);
    if (!subscriptionId) return;

    const userId = await this.getUserIdFromSubscription(subscriptionId);
    if (!userId) return;

    const sub = await this.getClient().subscriptions.retrieve(subscriptionId);
    const currentPeriodEnd = (sub as any).current_period_end as number | undefined;
    const validUntil =
      currentPeriodEnd != null
        ? new Date(currentPeriodEnd * 1000)
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

function resolveSubscriptionId(sub: string | Stripe.Subscription | null | undefined): string | null {
  if (!sub) return null;
  if (typeof sub === 'string') return sub;
  return (sub as any)?.id ?? null;
}

function addYears(date: Date, years: number): Date {
  const out = new Date(date);
  out.setFullYear(out.getFullYear() + years);
  return out;
}
