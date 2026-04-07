import { Injectable, BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import {
  SubscriptionStatus,
  UserTier,
} from '@prisma/client';
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

  /** Valor em cêntimos para pagamentos em EUR (cartão, MB WAY). Ex.: 2300 = 23,00 € */
  private get eurAmountCents(): number {
    const raw = process.env.STRIPE_AMOUNT_EUR_CENTS;
    const n = raw ? parseInt(raw, 10) : 2300;
    if (!Number.isFinite(n) || n < 1) return 2300;
    return n;
  }

  /** Valor em centavos para Pix (BRL). Ex.: 2300 = R$ 23,00 */
  private get pixAmountCentavos(): number {
    const raw = process.env.STRIPE_PIX_AMOUNT_BRL;
    const n = raw ? parseInt(raw, 10) : 2300;
    if (!Number.isFinite(n) || n < 1) return 2300;
    return n;
  }

  /** Taxa para novo agendamento Cal.com após consumir a chamada (EUR). */
  private get rafaCallEurCents(): number {
    const raw = process.env.STRIPE_RAFA_CALL_EUR_CENTS;
    const n = raw ? parseInt(raw, 10) : 2000;
    if (!Number.isFinite(n) || n < 1) return 2000;
    return n;
  }

  /** Taxa de reagendamento (Pix BRL). */
  private get rafaCallPixCentavos(): number {
    const raw = process.env.STRIPE_RAFA_CALL_PIX_BRL;
    const n = raw ? parseInt(raw, 10) : 2000;
    if (!Number.isFinite(n) || n < 1) return 2000;
    return n;
  }

  getRafaCallAmounts(): { eurCents: number; pixCentavos: number } {
    return {
      eurCents: this.rafaCallEurCents,
      pixCentavos: this.rafaCallPixCentavos,
    };
  }

  private async createAffiliateCommissionIfEligible(
    referredUserId: string,
  ): Promise<void> {
    const referredUser = await this.prisma.user.findUnique({
      where: { id: referredUserId },
      select: {
        id: true,
        referredByAffiliateId: true,
      },
    });
    const affiliateId = referredUser?.referredByAffiliateId;
    if (!affiliateId) return;

    const affiliate = await this.prisma.affiliateProfile.findUnique({
      where: { id: affiliateId },
      include: {
        user: {
          select: { role: true },
        },
      },
    });
    if (!affiliate || !affiliate.isActive) return;
    // Regra de negócio: admin pode ser afiliado, mas não recebe comissão.
    if (affiliate.user.role === 'ADMIN') return;

    const amount =
      affiliate.payoutMethod === 'PIX' ? 60 : 10;
    const currency = affiliate.payoutMethod === 'PIX' ? 'BRL' : 'EUR';

    try {
      await this.prisma.affiliateCommission.create({
        data: {
          affiliateId,
          referredUserId,
          amount,
          currency,
          status: 'PENDING',
        },
      });
    } catch (error: any) {
      // idempotência: se já existe comissão para esse indicado, ignorar
      if (error?.code === 'P2002') return;
      throw error;
    }
  }

  /** Valores atuais da anuidade (para exibir no frontend). */
  getMembershipAmounts(): { eurCents: number; pixCentavos: number } {
    return {
      eurCents: this.eurAmountCents,
      pixCentavos: this.pixAmountCentavos,
    };
  }

  private stripeCustomerEmail(
    userId: string,
    email: string | null | undefined,
  ): string {
    const t = email?.trim();
    if (t) return t;
    return `rafacall-${userId}@guest.rpm.invalid`;
  }

  async assertUserCanPayRafaUnlock(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tier: true, rafaCallSchedulingUnlocked: true },
    });
    if (!user) {
      throw new BadRequestException('Utilizador não encontrado.');
    }
    if (user.tier !== UserTier.MEMBER) {
      throw new BadRequestException(
        'Apenas membros VIP podem pagar a taxa de novo agendamento.',
      );
    }
    if (user.rafaCallSchedulingUnlocked) {
      throw new BadRequestException(
        'Já tem o agendamento disponível — use o Cal.com para marcar.',
      );
    }
  }

  async createRafaCallUnlockCheckoutSession(
    userId: string,
    userEmail: string | null | undefined,
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ url: string }> {
    await this.assertUserCanPayRafaUnlock(userId);
    const stripe = this.getClient();
    const amount = this.rafaCallEurCents;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: this.stripeCustomerEmail(userId, userEmail),
      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: amount,
            product_data: {
              name: 'Taxa de agendamento — chamada com a Rafa',
              description:
                'Novo acesso para marcar 30 minutos de vídeo (após chamada anterior)',
            },
          },
          quantity: 1,
        },
      ],
      payment_method_types: ['card'],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: userId,
      metadata: { userId, checkoutType: 'rafa_call_unlock' },
    });
    if (!session.url) {
      throw new BadRequestException('Não foi possível criar a sessão de pagamento.');
    }
    return { url: session.url };
  }

  async createRafaCallUnlockMbWayCheckoutSession(
    userId: string,
    userEmail: string | null | undefined,
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ url: string }> {
    await this.assertUserCanPayRafaUnlock(userId);
    const stripe = this.getClient();
    const amount = this.rafaCallEurCents;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: this.stripeCustomerEmail(userId, userEmail),
      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: amount,
            product_data: {
              name: 'Taxa de agendamento — chamada com a Rafa',
              description: 'Novo acesso para marcar chamada (MB WAY)',
            },
          },
          quantity: 1,
        },
      ],
      payment_method_types: ['mb_way'],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: userId,
      metadata: { userId, checkoutType: 'rafa_call_unlock' },
    });
    if (!session.url) {
      throw new BadRequestException('Não foi possível criar a sessão MB WAY.');
    }
    return { url: session.url };
  }

  async createRafaCallUnlockPixCheckoutSession(
    userId: string,
    userEmail: string | null | undefined,
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ url: string }> {
    await this.assertUserCanPayRafaUnlock(userId);
    const stripe = this.getClient();
    const amount = this.rafaCallPixCentavos;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: this.stripeCustomerEmail(userId, userEmail),
      line_items: [
        {
          price_data: {
            currency: 'brl',
            unit_amount: amount,
            product_data: {
              name: 'Taxa de agendamento — chamada com a Rafa',
              description: 'Novo acesso para marcar chamada (Pix)',
            },
          },
          quantity: 1,
        },
      ],
      payment_method_types: ['pix'],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: userId,
      metadata: { userId, checkoutType: 'rafa_call_unlock' },
      payment_method_options: {
        pix: { expires_after_seconds: 30 * 60 },
      },
    });
    if (!session.url) {
      throw new BadRequestException('Não foi possível criar a sessão Pix.');
    }
    return { url: session.url };
  }

  /**
   * Cria uma sessão de Checkout para pagamento único com cartão (EUR).
   * A anuidade de 1 ano é aplicada no backend quando o webhook confirma o pagamento.
   */
  async createCheckoutSession(userId: string, userEmail: string, successUrl: string, cancelUrl: string): Promise<{ url: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new BadRequestException('Utilizador não encontrado.');
    }

    const stripe = this.getClient();
    const amount = this.eurAmountCents;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: userEmail,
      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: amount,
            product_data: {
              name: 'Anuidade Comunidade RPM',
              description: 'Acesso à comunidade por 1 ano (pagamento único)',
            },
          },
          quantity: 1,
        },
      ],
      payment_method_types: ['card'],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: userId,
      metadata: { userId },
      allow_promotion_codes: true,
    });

    if (!session.url) {
      throw new BadRequestException('Não foi possível criar a sessão de pagamento.');
    }

    return { url: session.url };
  }

  /**
   * Cria uma sessão de Checkout apenas para MB WAY (pagamento único em EUR).
   */
  async createMbWayCheckoutSession(
    userId: string,
    userEmail: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ url: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new BadRequestException('Utilizador não encontrado.');
    }

    const stripe = this.getClient();
    const amount = this.eurAmountCents;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: userEmail,
      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: amount,
            product_data: {
              name: 'Anuidade Comunidade RPM',
              description: 'Acesso à comunidade por 1 ano (pagamento único)',
            },
          },
          quantity: 1,
        },
      ],
      payment_method_types: ['mb_way'],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: userId,
      metadata: { userId },
    });

    if (!session.url) {
      throw new BadRequestException('Não foi possível criar a sessão de pagamento MB WAY.');
    }

    return { url: session.url };
  }

  /**
   * Cria uma sessão de Checkout apenas para Pix (pagamento único em BRL).
   * O cliente é redirecionado para o Stripe, escolhe Pix e vê o QR code na página da Stripe.
   */
  async createPixCheckoutSession(
    userId: string,
    userEmail: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ url: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new BadRequestException('Utilizador não encontrado.');
    }

    const stripe = this.getClient();
    const amount = this.pixAmountCentavos;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: userEmail,
      line_items: [
        {
          price_data: {
            currency: 'brl',
            unit_amount: amount,
            product_data: {
              name: 'Anuidade Comunidade RPM',
              description: 'Acesso à comunidade por 1 ano (pagamento único)',
            },
          },
          quantity: 1,
        },
      ],
      payment_method_types: ['pix'],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: userId,
      metadata: { userId },
      payment_method_options: {
        pix: {
          expires_after_seconds: 30 * 60, // 30 minutos
        },
      },
    });

    if (!session.url) {
      throw new BadRequestException('Não foi possível criar a sessão de pagamento Pix.');
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
      case 'checkout.session.async_payment_succeeded': {
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
    if (sess.payment_status !== 'paid') return;

    const subIdFromSession = resolveSubscriptionId(session.subscription);
    const userId =
      (sess.client_reference_id as string) ||
      (sess.metadata?.userId as string) ||
      (subIdFromSession ? await this.getUserIdFromSubscription(subIdFromSession) : null);
    if (!userId) return;

    const checkoutType = sess.metadata?.checkoutType as string | undefined;
    if (checkoutType === 'rafa_call_unlock') {
      await this.prisma.user.update({
        where: { id: userId },
        data: { rafaCallSchedulingUnlocked: true },
      });
      return;
    }

    const prev = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tier: true },
    });

    const customerId = typeof sess.customer === 'string' ? sess.customer : sess.customer?.id;
    const subscriptionId = resolveSubscriptionId(session.subscription);
    const validUntil = addYears(new Date(), MEMBERSHIP_DURATION_YEARS);
    const grantRafaUnlock = prev?.tier !== UserTier.MEMBER;

    await this.prisma.$transaction([
      this.prisma.subscription.upsert({
        where: { userId },
        create: {
          userId,
          stripeCustomerId: customerId ?? null,
          stripeSubscriptionId: subscriptionId ?? null,
          status: SubscriptionStatus.ACTIVE,
          validUntil,
        },
        update: {
          ...(customerId && { stripeCustomerId: customerId }),
          ...(subscriptionId && { stripeSubscriptionId: subscriptionId }),
          status: SubscriptionStatus.ACTIVE,
          validUntil,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          tier: UserTier.MEMBER,
          membershipExpiresAt: validUntil,
          ...(grantRafaUnlock ? { rafaCallSchedulingUnlocked: true } : {}),
        },
      }),
    ]);
    await this.recordMembershipPaymentFromCheckoutSession(userId, session);
    await this.createAffiliateCommissionIfEligible(userId);

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
        ...(!isActive
          ? {
              rafaCallSchedulingUnlocked: false,
              rafaCallSlotStartsAt: null,
              rafaCallSlotEndsAt: null,
            }
          : {}),
      },
    });
    if (isActive) {
      await this.createAffiliateCommissionIfEligible(userId);
    }
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

    if (
      inv.billing_reason === 'subscription_cycle' &&
      typeof inv.amount_paid === 'number' &&
      inv.amount_paid > 0
    ) {
      await this.recordMembershipPaymentFromInvoice(userId, invoice);
    }

    await this.createAffiliateCommissionIfEligible(userId);
  }

  /**
   * EUR/MB: usa o valor pago na sessão (amount_total). BRL: contabiliza o preço EUR em vigor
   * (mesma regra de negócio que o painel admin).
   */
  private creditedEurFromCheckoutSession(session: Stripe.Checkout.Session): number {
    const cur =
      ((session as any).currency as string | undefined)?.toLowerCase() ?? 'eur';
    if (cur === 'brl') {
      return Math.round(this.eurAmountCents) / 100;
    }
    const total = (session as any).amount_total as number | null | undefined;
    if (total != null && Number.isFinite(total) && total >= 0) {
      return Math.round(total) / 100;
    }
    return Math.round(this.eurAmountCents) / 100;
  }

  private creditedEurFromInvoice(invoice: Stripe.Invoice): number {
    const inv = invoice as any;
    const cur = (inv.currency as string | undefined)?.toLowerCase() ?? 'eur';
    const paid = inv.amount_paid as number | undefined;
    if (paid != null && paid <= 0) return 0;
    if (cur === 'brl') {
      return Math.round(this.eurAmountCents) / 100;
    }
    if (paid != null && Number.isFinite(paid)) {
      return Math.round(paid) / 100;
    }
    return 0;
  }

  private async recordMembershipPaymentFromCheckoutSession(
    userId: string,
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const sessionId = session.id;
    if (!sessionId) return;
    const amountCreditedEur = this.creditedEurFromCheckoutSession(session);
    try {
      await this.prisma.membershipPayment.create({
        data: {
          userId,
          stripeCheckoutSessionId: sessionId,
          amountCreditedEur,
          stripeCurrency: (session as any).currency ?? null,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') return;
      throw err;
    }
  }

  private async recordMembershipPaymentFromInvoice(
    userId: string,
    invoice: Stripe.Invoice,
  ): Promise<void> {
    const inv = invoice as any;
    const invoiceId = inv.id as string | undefined;
    if (!invoiceId) return;
    const amountCreditedEur = this.creditedEurFromInvoice(invoice);
    try {
      await this.prisma.membershipPayment.create({
        data: {
          userId,
          stripeInvoiceId: invoiceId,
          amountCreditedEur,
          stripeCurrency: inv.currency ?? null,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') return;
      throw err;
    }
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
