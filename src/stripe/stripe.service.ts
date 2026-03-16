import { Injectable, BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import {
  CommissionPaymentStatus,
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

  /** Valores atuais da anuidade (para exibir no frontend). */
  getMembershipAmounts(): { eurCents: number; pixCentavos: number } {
    return {
      eurCents: this.eurAmountCents,
      pixCentavos: this.pixAmountCentavos,
    };
  }

  /**
   * Checkout de comissão (parceiro → RPM) via MB WAY em EUR.
   */
  async createMbWayCommissionCheckoutSession(params: {
    partnerUserId: string;
    partnerEmail: string;
    saleId: string;
    amountCents: number;
    description: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }> {
    const stripe = this.getClient();

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: params.partnerEmail,
      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: params.amountCents,
            product_data: {
              name: 'Pagamento de comissão Comunidade RPM',
              description: params.description,
            },
          },
          quantity: 1,
        },
      ],
      payment_method_types: ['mb_way'],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      client_reference_id: params.partnerUserId,
      metadata: {
        type: 'commission',
        saleId: params.saleId,
        partnerUserId: params.partnerUserId,
      },
    });

    if (!session.url) {
      throw new BadRequestException(
        'Não foi possível criar a sessão de pagamento de comissão.',
      );
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
        const meta = (session as any).metadata as Stripe.Metadata | undefined;
        if (meta?.type === 'commission') {
          await this.handleCommissionCheckoutCompleted(session);
        } else {
          await this.handleCheckoutCompleted(session);
        }
        break;
      }
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object as Stripe.Checkout.Session;
        const meta = (session as any).metadata as Stripe.Metadata | undefined;
        if (meta?.type === 'commission') {
          await this.handleCommissionCheckoutCompleted(session);
        } else {
          await this.handleCheckoutCompleted(session);
        }
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

  private async handleCommissionCheckoutCompleted(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const sess = session as any;
    if (sess.payment_status !== 'paid') return;

    const saleId = (sess.metadata?.saleId as string | undefined) || undefined;
    if (!saleId) return;

    const amountTotal = (sess.amount_total as number | undefined) ?? undefined;
    const amountEuro =
      typeof amountTotal === 'number' ? amountTotal / 100 : undefined;

    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        user: true,
        service: true,
        partner: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!sale) {
      return;
    }

    if (sale.commissionPaymentStatus === 'PAID') {
      return;
    }

    const updated = await this.prisma.sale.update({
      where: { id: sale.id },
      data: {
        commissionPaymentStatus: CommissionPaymentStatus.PAID,
        commissionPaidEuro:
          typeof amountEuro === 'number' ? amountEuro : sale.commissionEuro,
      },
      include: {
        user: true,
        service: true,
        partner: {
          include: {
            user: true,
          },
        },
      },
    });

    try {
      const partnerUser = updated.partner?.user;
      if (partnerUser?.email) {
        const methodLabel = 'MB WAY';
        const clientName = updated.user?.name ?? updated.user?.email ?? '—';
        const serviceTitle =
          updated.service?.title ?? updated.serviceTitle ?? '—';
        const mesAno = `${updated.month.toString().padStart(2, '0')}/${updated.year}`;
        const valorVenda = updated.amount.toFixed(2);
        const comissaoEsperada = updated.commissionEuro.toFixed(2);
        const comissaoPaga = (updated.commissionPaidEuro ?? 0).toFixed(2);

        await sendEmailBase({
          to: partnerUser.email,
          subject: 'Confirmação de pagamento de comissão – Comunidade RPM',
          text:
            `Olá ${partnerUser.name || ''},\n\n` +
            `Recebemos o teu pagamento de comissão.\n\n` +
            `Dados da venda:\n` +
            `- Cliente: ${clientName}\n` +
            `- Serviço: ${serviceTitle}\n` +
            `- Mês/ano: ${mesAno}\n` +
            `- Valor da venda: ${valorVenda} €\n` +
            `- Comissão prevista: ${comissaoEsperada} €\n\n` +
            `Pagamento efetuado:\n` +
            `- Comissão paga: ${comissaoPaga} €\n` +
            `- Método: ${methodLabel}\n\n` +
            `Obrigado pela parceria.\n` +
            `Equipa Comunidade RPM`,
          html: `
            <div style="max-width:640px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
              <h1 style="font-size:20px;margin-bottom:12px;">Pagamento de comissão confirmado</h1>
              <p style="margin:0 0 12px;">Olá <strong>${partnerUser.name || ''}</strong>,</p>
              <p style="margin:0 0 12px;">Recebemos o teu pagamento de comissão para a Comunidade RPM.</p>
              <h2 style="font-size:16px;margin:16px 0 8px;">Dados da venda</h2>
              <ul style="margin:0 0 12px;padding-left:20px;">
                <li>Cliente: <strong>${clientName}</strong></li>
                <li>Serviço: <strong>${serviceTitle}</strong></li>
                <li>Mês/ano: <strong>${mesAno}</strong></li>
                <li>Valor da venda: <strong>${valorVenda} €</strong></li>
                <li>Comissão prevista: <strong>${comissaoEsperada} €</strong></li>
              </ul>
              <h2 style="font-size:16px;margin:16px 0 8px;">Pagamento efetuado</h2>
              <ul style="margin:0 0 12px;padding-left:20px;">
                <li>Comissão paga: <strong>${comissaoPaga} €</strong></li>
                <li>Método de pagamento: <strong>${methodLabel}</strong></li>
              </ul>
              <p style="margin:16px 0 0;">Obrigado pela tua parceria.</p>
              <p style="margin:4px 0 0;">Equipa Comunidade RPM</p>
            </div>
          `,
        });
      }
    } catch {
      // Não falhar o webhook se o email falhar
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

    const customerId = typeof sess.customer === 'string' ? sess.customer : sess.customer?.id;
    const subscriptionId = resolveSubscriptionId(session.subscription);
    const validUntil = addYears(new Date(), MEMBERSHIP_DURATION_YEARS);

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
