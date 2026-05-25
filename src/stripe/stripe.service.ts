import { Injectable, BadRequestException, Logger, Inject, forwardRef } from '@nestjs/common';
import Stripe from 'stripe';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import {
  PartnerSaleCommissionPaymentStatus,
  RegistrationChannel,
  Role,
  SubscriptionStatus,
  UserTier,
} from '@prisma/client';
import { sendEmailBase } from '../email/resend.client';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { getFrontendBaseUrl } from '../config/frontend-base-url';
import { AuthService } from '../auth/auth.service';
import { isMembershipActive } from '../membership/membership-access.util';
import { CreateGuestMembershipCheckoutDto } from './dto/create-guest-membership-checkout.dto';
import { CreateGuestRafacallCheckoutDto } from './dto/create-guest-rafacall-checkout.dto';
import { CreateGuestRafacallSessionDto } from './dto/create-guest-rafacall-session.dto';
import { PartnerAdvertisingService } from '../partner/partner-advertising.service';
import {
  ADVERTISING_TOPUP_MAX_EUR_CENTS,
  ADVERTISING_TOPUP_MIN_EUR_CENTS,
} from '../partner/house-publication.constants';

const MEMBERSHIP_DURATION_YEARS = 1;
const GUEST_SIGNUP_SALT_ROUNDS = 10;
const GUEST_SIGNUP_TTL_HOURS = 24;

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private stripe: Stripe | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    private readonly authService: AuthService,
    @Inject(forwardRef(() => PartnerAdvertisingService))
    private readonly partnerAdvertising: PartnerAdvertisingService,
  ) {}

  private formatMoney(amountMinor: number, currency: string): string {
    const cur = (currency || '').toLowerCase() || 'eur';
    const isBrl = cur === 'brl';
    const value = amountMinor / 100;
    return new Intl.NumberFormat(isBrl ? 'pt-BR' : 'pt-PT', {
      style: 'currency',
      currency: isBrl ? 'BRL' : 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  private formatPaymentMethodFromSession(session: Stripe.Checkout.Session): string {
    const types = ((session as any).payment_method_types as string[] | undefined) ?? [];
    if (types.includes('mb_way')) return 'MB WAY';
    if (types.includes('pix')) return 'Pix';
    return 'Cartão';
  }

  private async sendPaymentConfirmationWhatsApp(input: {
    userId: string;
    reason: string;
    amountLabel?: string;
    paidAt?: Date;
    methodLabel?: string;
  }): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { name: true, whatsapp: true },
    });
    const to = user?.whatsapp?.trim();
    if (!to) return;

    const when = (input.paidAt ?? new Date()).toLocaleString('pt-PT');
    const lines = [
      `Pagamento confirmado ✅`,
      '',
      `Motivo: ${input.reason}`,
      ...(input.amountLabel ? [`Valor: ${input.amountLabel}`] : []),
      ...(input.methodLabel ? [`Forma de pagamento: ${input.methodLabel}`] : []),
      `Data/hora: ${when}`,
      '',
      `Obrigado!`,
    ];
    await this.whatsapp.sendText(to, lines.join('\n'));
  }

  private async notifyAdminsNewPayment(input: {
    payerUserId: string | null;
    reason: string;
    amountLabel?: string;
    paidAt?: Date;
    methodLabel?: string;
  }): Promise<void> {
    const [payer, admins] = await Promise.all([
      input.payerUserId
        ? this.prisma.user.findUnique({
            where: { id: input.payerUserId },
            select: { name: true, whatsapp: true, email: true },
          })
        : Promise.resolve(null),
      this.prisma.user.findMany({
        where: { role: 'ADMIN', whatsapp: { not: '' } },
        select: { whatsapp: true },
      }),
    ]);

    const toAdmins = admins
      .map((a) => a.whatsapp?.trim() ?? '')
      .filter((x) => Boolean(x));
    if (toAdmins.length === 0) return;

    const when = (input.paidAt ?? new Date()).toLocaleString('pt-PT');
    const payerLabel =
      payer?.name?.trim() ||
      payer?.whatsapp?.trim() ||
      payer?.email?.trim() ||
      input.payerUserId ||
      'Guest';

    const lines = [
      `Novo pagamento recebido ✅`,
      '',
      `De: ${payerLabel}`,
      `Motivo: ${input.reason}`,
      ...(input.amountLabel ? [`Valor: ${input.amountLabel}`] : []),
      ...(input.methodLabel ? [`Forma de pagamento: ${input.methodLabel}`] : []),
      `Data/hora: ${when}`,
    ];

    await Promise.all(toAdmins.map((to) => this.whatsapp.sendText(to, lines.join('\n'))));
  }

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

  private eurCentsToPixCentavos(eurCents: number): number {
    const eurBase = this.eurAmountCents;
    const pixBase = this.pixAmountCentavos;
    const scaled = Math.round((eurCents / eurBase) * pixBase);
    return Math.max(100, scaled);
  }

  private assertAdvertisingTopupAmount(amountEurCents: number): void {
    if (
      !Number.isInteger(amountEurCents) ||
      amountEurCents < ADVERTISING_TOPUP_MIN_EUR_CENTS ||
      amountEurCents > ADVERTISING_TOPUP_MAX_EUR_CENTS
    ) {
      throw new BadRequestException(
        `Valor inválido. Escolhe entre ${(ADVERTISING_TOPUP_MIN_EUR_CENTS / 100).toFixed(2)} € e ${(ADVERTISING_TOPUP_MAX_EUR_CENTS / 100).toFixed(2)} €.`,
      );
    }
  }

  async createPartnerAdvertisingTopupCheckout(input: {
    partnerUserId: string;
    partnerId: string;
    partnerEmail: string | null | undefined;
    amountEurCents: number;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string; sessionId: string }> {
    this.assertAdvertisingTopupAmount(input.amountEurCents);

    const partner = await this.prisma.partner.findFirst({
      where: { id: input.partnerId, userId: input.partnerUserId },
      select: { id: true },
    });
    if (!partner) {
      throw new BadRequestException('Parceiro não encontrado.');
    }

    return this.createPartnerAdvertisingTopupMbWaySession(input);
  }

  private async createPartnerAdvertisingTopupMbWaySession(input: {
    partnerUserId: string;
    partnerId: string;
    partnerEmail: string | null | undefined;
    amountEurCents: number;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string; sessionId: string }> {
    const stripe = this.getClient();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: this.stripeCustomerEmail(input.partnerUserId, input.partnerEmail),
      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: input.amountEurCents,
            product_data: {
              name: 'Saldo de publicidade (MB WAY)',
              description: 'Recarga para publicar imóveis na comunidade',
            },
          },
          quantity: 1,
        },
      ],
      payment_method_types: ['mb_way'],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.partnerUserId,
      metadata: {
        userId: input.partnerUserId,
        partnerId: input.partnerId,
        checkoutType: 'partner_advertising_topup',
        amountEurCents: String(input.amountEurCents),
      },
    });
    if (!session.url || !session.id) {
      throw new BadRequestException('Não foi possível criar a sessão MB WAY.');
    }
    return { url: session.url, sessionId: session.id };
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
      select: { rafaCallSchedulingUnlocked: true },
    });
    if (!user) {
      throw new BadRequestException('Utilizador não encontrado.');
    }
    if (user.rafaCallSchedulingUnlocked) {
      throw new BadRequestException(
        'Já tens um agendamento disponível. Vai ao dashboard para escolher data e hora.',
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
      metadata: {
        userId,
        checkoutType: 'rafa_call_unlock',
        rafacallFeeEurCents: String(this.rafaCallEurCents),
      },
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
      metadata: {
        userId,
        checkoutType: 'rafa_call_unlock',
        rafacallFeeEurCents: String(this.rafaCallEurCents),
      },
    });
    if (!session.url) {
      throw new BadRequestException('Não foi possível criar a sessão MB WAY.');
    }
    return { url: session.url };
  }

  async createPartnerSaleCommissionCheckoutSession(input: {
    saleId: string;
    partnerUserId: string;
    partnerEmail: string | null | undefined;
    commissionEurCents: number;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string; sessionId: string }> {
    const stripe = this.getClient();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: this.stripeCustomerEmail(input.partnerUserId, input.partnerEmail),
      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: input.commissionEurCents,
            product_data: {
              name: 'Comissão RPM',
              description: 'Pagamento de comissão referente a uma venda registrada pelo parceiro',
            },
          },
          quantity: 1,
        },
      ],
      payment_method_types: ['card'],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.partnerUserId,
      metadata: {
        userId: input.partnerUserId,
        checkoutType: 'partner_sale_commission',
        saleId: input.saleId,
      },
    });
    if (!session.url || !session.id) {
      throw new BadRequestException('Não foi possível criar a sessão de pagamento.');
    }
    return { url: session.url, sessionId: session.id };
  }

  async createPartnerSaleCommissionMbWayCheckoutSession(input: {
    saleId: string;
    partnerUserId: string;
    partnerEmail: string | null | undefined;
    commissionEurCents: number;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string; sessionId: string }> {
    const stripe = this.getClient();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: this.stripeCustomerEmail(input.partnerUserId, input.partnerEmail),
      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: input.commissionEurCents,
            product_data: {
              name: 'Comissão RPM (MB WAY)',
              description: 'Pagamento de comissão referente a uma venda registrada pelo parceiro',
            },
          },
          quantity: 1,
        },
      ],
      payment_method_types: ['mb_way'],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.partnerUserId,
      metadata: {
        userId: input.partnerUserId,
        checkoutType: 'partner_sale_commission',
        saleId: input.saleId,
      },
    });
    if (!session.url || !session.id) {
      throw new BadRequestException('Não foi possível criar a sessão MB WAY.');
    }
    return { url: session.url, sessionId: session.id };
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
      metadata: {
        userId,
        checkoutType: 'rafa_call_unlock',
        rafacallFeeEurCents: String(this.rafaCallEurCents),
      },
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
  async createCheckoutSession(
    userId: string,
    userEmail: string | null | undefined,
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
    const email = userEmail?.trim() || null;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ...(email ? { customer_email: email } : {}),
      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: amount,
            product_data: {
              name: 'Anuidade Comunidade Rafa Portugal',
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
      metadata: {
        userId,
        membershipEurCents: String(this.eurAmountCents),
      },
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
    userEmail: string | null | undefined,
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
    const email = userEmail?.trim() || null;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ...(email ? { customer_email: email } : {}),
      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: amount,
            product_data: {
              name: 'Anuidade Comunidade Rafa Portugal',
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
      metadata: {
        userId,
        membershipEurCents: String(this.eurAmountCents),
      },
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
    userEmail: string | null | undefined,
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
    const email = userEmail?.trim() || null;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ...(email ? { customer_email: email } : {}),
      line_items: [
        {
          price_data: {
            currency: 'brl',
            unit_amount: amount,
            product_data: {
              name: 'Anuidade Comunidade Rafa Portugal',
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
      metadata: {
        userId,
        membershipEurCents: String(this.eurAmountCents),
      },
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

  private appendStripeSessionIdPlaceholder(url: string): string {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}session_id={CHECKOUT_SESSION_ID}`;
  }

  private normalizeSignupWhatsapp(raw: string): string {
    return raw.replace(/\D/g, '');
  }

  private getGuestSignupExpiry(): Date {
    const d = new Date();
    d.setHours(d.getHours() + GUEST_SIGNUP_TTL_HOURS);
    return d;
  }

  async createGuestMembershipCheckout(
    dto: CreateGuestMembershipCheckoutDto,
  ): Promise<{ url: string }> {
    if (dto.password !== dto.passwordConfirm) {
      throw new BadRequestException('As senhas não coincidem.');
    }

    const whatsapp = this.normalizeSignupWhatsapp(dto.whatsapp);
    if (whatsapp.length < 8) {
      throw new BadRequestException('WhatsApp inválido.');
    }

    const email = dto.email.trim().toLowerCase();
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Nome é obrigatório.');
    }

    const existingByWhatsapp = await this.prisma.user.findUnique({
      where: { whatsapp },
      select: { id: true, tier: true, membershipExpiresAt: true, role: true },
    });
    if (
      existingByWhatsapp &&
      isMembershipActive(
        existingByWhatsapp.tier,
        existingByWhatsapp.membershipExpiresAt,
      )
    ) {
      throw new BadRequestException(
        'Já existe uma conta ativa com este WhatsApp. Faça login.',
      );
    }

    const existingByEmail = await this.prisma.user.findFirst({
      where: { email },
      select: { id: true, tier: true, membershipExpiresAt: true },
    });
    if (
      existingByEmail &&
      existingByEmail.id !== existingByWhatsapp?.id &&
      isMembershipActive(existingByEmail.tier, existingByEmail.membershipExpiresAt)
    ) {
      throw new BadRequestException(
        'Já existe uma conta ativa com este e-mail. Faça login.',
      );
    }

    const rawAffiliateCode = (dto.affiliateCode ?? '').trim().toLowerCase();
    let referredByAffiliateId: string | null = null;
    let referredByCodeSnapshot: string | null = null;
    if (rawAffiliateCode && rawAffiliateCode !== 'nenhum') {
      const affiliate = await this.prisma.affiliateProfile.findUnique({
        where: { affiliateCode: rawAffiliateCode },
        select: { id: true, isActive: true },
      });
      if (affiliate?.isActive) {
        referredByAffiliateId = affiliate.id;
        referredByCodeSnapshot = rawAffiliateCode;
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, GUEST_SIGNUP_SALT_ROUNDS);
    const pending = await this.prisma.pendingMembershipSignup.create({
      data: {
        name,
        email,
        whatsapp,
        passwordHash,
        affiliateCodeSnapshot: referredByCodeSnapshot,
        indicadoPor: referredByCodeSnapshot,
        referredByAffiliateId,
        existingUserId: existingByWhatsapp?.id ?? existingByEmail?.id ?? null,
        expiresAt: this.getGuestSignupExpiry(),
      },
    });

    const successUrl = this.appendStripeSessionIdPlaceholder(dto.successUrl);
    const cancelUrl = dto.cancelUrl;

    const stripe = this.getClient();
    const metadata = {
      checkoutType: 'membership_guest',
      pendingSignupId: pending.id,
      membershipEurCents: String(this.eurAmountCents),
    };

    let session: Stripe.Checkout.Session;

    if (dto.paymentMethod === 'pix') {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: [
          {
            price_data: {
              currency: 'brl',
              unit_amount: this.pixAmountCentavos,
              product_data: {
                name: 'Anuidade Comunidade Rafa Portugal',
                description: 'Acesso à comunidade por 1 ano (pagamento único)',
              },
            },
            quantity: 1,
          },
        ],
        payment_method_types: ['pix'],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: pending.id,
        metadata,
        payment_method_options: {
          pix: { expires_after_seconds: 30 * 60 },
        },
      });
    } else if (dto.paymentMethod === 'mbway') {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: [
          {
            price_data: {
              currency: 'eur',
              unit_amount: this.eurAmountCents,
              product_data: {
                name: 'Anuidade Comunidade Rafa Portugal',
                description: 'Acesso à comunidade por 1 ano (pagamento único)',
              },
            },
            quantity: 1,
          },
        ],
        payment_method_types: ['mb_way'],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: pending.id,
        metadata,
      });
    } else {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: [
          {
            price_data: {
              currency: 'eur',
              unit_amount: this.eurAmountCents,
              product_data: {
                name: 'Anuidade Comunidade Rafa Portugal',
                description: 'Acesso à comunidade por 1 ano (pagamento único)',
              },
            },
            quantity: 1,
          },
        ],
        payment_method_types: ['card'],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: pending.id,
        metadata,
        allow_promotion_codes: true,
      });
    }

    if (!session.url) {
      throw new BadRequestException('Não foi possível criar a sessão de pagamento.');
    }

    await this.prisma.pendingMembershipSignup.update({
      where: { id: pending.id },
      data: { stripeSessionId: session.id },
    });

    return { url: session.url };
  }

  private async resolveGuestRafacallExistingUserId(
    email: string,
    whatsapp: string,
  ): Promise<string | null> {
    const existingByWhatsapp = await this.prisma.user.findUnique({
      where: { whatsapp },
      select: { id: true, rafaCallSchedulingUnlocked: true },
    });
    if (existingByWhatsapp?.rafaCallSchedulingUnlocked) {
      throw new BadRequestException(
        'Já tens acesso para agendar. Faça login e escolhe data e hora.',
      );
    }

    const existingByEmail = await this.prisma.user.findFirst({
      where: { email },
      select: { id: true, rafaCallSchedulingUnlocked: true },
    });
    if (
      existingByEmail &&
      existingByEmail.id !== existingByWhatsapp?.id &&
      existingByEmail.rafaCallSchedulingUnlocked
    ) {
      throw new BadRequestException(
        'Já tens acesso para agendar. Faça login e escolhe data e hora.',
      );
    }

    return existingByWhatsapp?.id ?? existingByEmail?.id ?? null;
  }

  /**
   * Fluxo guest do RafaCall (novo): só Nome + WhatsApp.
   * Não cria conta de utilizador — guarda um `RafaCallGuestUnlock` que é consumido ao agendar.
   * Após o pagamento, o success URL recebe `?session_id=...` e o frontend troca-o por um unlockId.
   */
  async createGuestRafacallSession(
    dto: CreateGuestRafacallSessionDto,
  ): Promise<{ url: string }> {
    const whatsapp = this.normalizeSignupWhatsapp(dto.whatsapp);
    if (whatsapp.length < 8) {
      throw new BadRequestException('WhatsApp inválido.');
    }
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Nome é obrigatório.');
    }

    // Bloqueia novo agendamento se já existir um agendamento ativo (futuro) para este WhatsApp.
    const activeBooking = await this.prisma.rafaCallBooking.findFirst({
      where: {
        status: 'SCHEDULED',
        endsAt: { gt: new Date() },
        OR: [{ guestWhatsapp: whatsapp }, { user: { whatsapp } }],
      },
      select: { id: true },
    });
    if (activeBooking) {
      throw new BadRequestException(
        'Este número de WhatsApp já tem um agendamento ativo. Use o link enviado para gerir o seu agendamento.',
      );
    }

    const unlock = await this.prisma.rafaCallGuestUnlock.create({
      data: {
        name,
        whatsapp,
        expiresAt: this.getGuestSignupExpiry(),
      },
    });

    const successUrl = this.appendStripeSessionIdPlaceholder(dto.successUrl);
    const cancelUrl = dto.cancelUrl;
    const stripe = this.getClient();
    const productName = 'Chamada de vídeo com a Rafa (30 min)';
    const productDescription =
      'Taxa de agendamento — após o pagamento escolhes data e hora';

    const metadata = {
      checkoutType: 'rafacall_guest_v2',
      rafacallGuestUnlockId: unlock.id,
      rafacallFeeEurCents: String(this.rafaCallEurCents),
    };

    let session: Stripe.Checkout.Session;
    if (dto.paymentMethod === 'pix') {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'brl',
              unit_amount: this.rafaCallPixCentavos,
              product_data: { name: productName, description: productDescription },
            },
            quantity: 1,
          },
        ],
        payment_method_types: ['pix'],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: unlock.id,
        metadata,
        payment_method_options: {
          pix: { expires_after_seconds: 30 * 60 },
        },
      });
    } else if (dto.paymentMethod === 'mbway') {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'eur',
              unit_amount: this.rafaCallEurCents,
              product_data: { name: productName, description: productDescription },
            },
            quantity: 1,
          },
        ],
        payment_method_types: ['mb_way'],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: unlock.id,
        metadata,
      });
    } else {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'eur',
              unit_amount: this.rafaCallEurCents,
              product_data: { name: productName, description: productDescription },
            },
            quantity: 1,
          },
        ],
        payment_method_types: ['card'],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: unlock.id,
        metadata,
      });
    }

    if (!session.url) {
      throw new BadRequestException('Não foi possível criar a sessão de pagamento.');
    }

    await this.prisma.rafaCallGuestUnlock.update({
      where: { id: unlock.id },
      data: { stripeCheckoutSessionId: session.id },
    });

    return { url: session.url };
  }

  /** Confirma o pagamento do unlock guest (chamado pelo webhook). */
  private async handleGuestRafacallSessionCompleted(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const sess = session as any;
    const unlockId =
      (sess.metadata?.rafacallGuestUnlockId as string | undefined) ||
      (sess.client_reference_id as string | undefined);
    if (!unlockId) return;

    const unlock = await this.prisma.rafaCallGuestUnlock.findUnique({
      where: { id: unlockId },
    });
    if (!unlock) return;
    if (unlock.paidAt) return; // idempotente
    if (unlock.expiresAt < new Date()) return;

    await this.prisma.rafaCallGuestUnlock.update({
      where: { id: unlock.id },
      data: { paidAt: new Date(), stripeCheckoutSessionId: session.id },
    });

    const amountTotal = (sess.amount_total as number | null | undefined) ?? null;
    const currency = ((sess.currency as string | undefined) ?? 'eur').toLowerCase();
    const paidAt = new Date();
    const methodLabel = this.formatPaymentMethodFromSession(session);
    const amountLabel =
      amountTotal != null && Number.isFinite(amountTotal)
        ? this.formatMoney(amountTotal, currency)
        : undefined;
    await this.notifyAdminsNewPayment({
      payerUserId: null,
      reason: `Taxa de agendamento (guest) — ${unlock.name} / ${unlock.whatsapp}`,
      amountLabel,
      paidAt,
      methodLabel,
    });
  }

  /**
   * Endpoint chamado pela página de sucesso: troca o sessionId do Stripe pelo unlockId
   * + dados do guest. Se o webhook ainda não correu, força a confirmação.
   */
  async claimGuestRafacallSession(sessionId: string): Promise<
    | { status: 'ready'; unlockId: string; name: string; whatsapp: string }
    | { status: 'pending' | 'consumed' | 'expired' | 'invalid' }
  > {
    const trimmed = sessionId.trim();
    if (!trimmed) return { status: 'invalid' };

    let unlock = await this.prisma.rafaCallGuestUnlock.findUnique({
      where: { stripeCheckoutSessionId: trimmed },
    });

    if (!unlock) {
      // Pode acontecer se o webhook ainda não actualizou; tentar localizar pelo client_reference_id.
      const stripe = this.getClient();
      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.retrieve(trimmed);
      } catch {
        return { status: 'invalid' };
      }
      if (!this.isCheckoutSessionSuccessfullyPaid(session)) {
        return { status: 'pending' };
      }
      if (session.metadata?.checkoutType !== 'rafacall_guest_v2') {
        return { status: 'invalid' };
      }
      await this.handleGuestRafacallSessionCompleted(session);
      unlock = await this.prisma.rafaCallGuestUnlock.findUnique({
        where: { stripeCheckoutSessionId: trimmed },
      });
      if (!unlock) return { status: 'invalid' };
    }

    if (unlock.consumedAt) return { status: 'consumed' };
    if (unlock.expiresAt < new Date()) return { status: 'expired' };
    if (!unlock.paidAt) return { status: 'pending' };
    return {
      status: 'ready',
      unlockId: unlock.id,
      name: unlock.name,
      whatsapp: unlock.whatsapp,
    };
  }

  // ===== Antigo fluxo guest (mantido para histórico/compatibilidade) =====
  async createGuestRafacallCheckout(
    dto: CreateGuestRafacallCheckoutDto,
  ): Promise<{ url: string }> {
    if (dto.password !== dto.passwordConfirm) {
      throw new BadRequestException('As senhas não coincidem.');
    }

    const whatsapp = this.normalizeSignupWhatsapp(dto.whatsapp);
    if (whatsapp.length < 8) {
      throw new BadRequestException('WhatsApp inválido.');
    }

    const email = dto.email.trim().toLowerCase();
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Nome é obrigatório.');
    }

    const existingUserId = await this.resolveGuestRafacallExistingUserId(email, whatsapp);
    const passwordHash = await bcrypt.hash(dto.password, GUEST_SIGNUP_SALT_ROUNDS);
    const pending = await this.prisma.pendingRafacallSignup.create({
      data: {
        name,
        email,
        whatsapp,
        passwordHash,
        existingUserId,
        expiresAt: this.getGuestSignupExpiry(),
      },
    });

    const successUrl = this.appendStripeSessionIdPlaceholder(dto.successUrl);
    const cancelUrl = dto.cancelUrl;
    const stripe = this.getClient();
    const productName = 'Chamada de vídeo com a Rafa (30 min)';
    const productDescription =
      'Taxa de agendamento — após o pagamento escolhes data e hora no dashboard';

    const metadata = {
      checkoutType: 'rafacall_guest',
      pendingRafacallSignupId: pending.id,
      rafacallFeeEurCents: String(this.rafaCallEurCents),
    };

    let session: Stripe.Checkout.Session;

    if (dto.paymentMethod === 'pix') {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: [
          {
            price_data: {
              currency: 'brl',
              unit_amount: this.rafaCallPixCentavos,
              product_data: { name: productName, description: productDescription },
            },
            quantity: 1,
          },
        ],
        payment_method_types: ['pix'],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: pending.id,
        metadata,
        payment_method_options: {
          pix: { expires_after_seconds: 30 * 60 },
        },
      });
    } else if (dto.paymentMethod === 'mbway') {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: [
          {
            price_data: {
              currency: 'eur',
              unit_amount: this.rafaCallEurCents,
              product_data: { name: productName, description: productDescription },
            },
            quantity: 1,
          },
        ],
        payment_method_types: ['mb_way'],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: pending.id,
        metadata,
      });
    } else {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: [
          {
            price_data: {
              currency: 'eur',
              unit_amount: this.rafaCallEurCents,
              product_data: { name: productName, description: productDescription },
            },
            quantity: 1,
          },
        ],
        payment_method_types: ['card'],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: pending.id,
        metadata,
      });
    }

    if (!session.url) {
      throw new BadRequestException('Não foi possível criar a sessão de pagamento.');
    }

    await this.prisma.pendingRafacallSignup.update({
      where: { id: pending.id },
      data: { stripeSessionId: session.id },
    });

    return { url: session.url };
  }

  private async handleGuestRafacallCheckoutCompleted(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const sess = session as any;
    const pendingSignupId =
      (sess.metadata?.pendingRafacallSignupId as string | undefined) ||
      (sess.client_reference_id as string | undefined);
    if (!pendingSignupId) return;

    const pending = await this.prisma.pendingRafacallSignup.findUnique({
      where: { id: pendingSignupId },
    });
    if (!pending || pending.consumedAt) return;
    if (pending.expiresAt < new Date()) return;

    let userId = pending.existingUserId ?? pending.createdUserId ?? null;

    if (!userId) {
      const created = await this.prisma.user.create({
        data: {
          email: pending.email,
          name: pending.name,
          whatsapp: pending.whatsapp,
          passwordHash: pending.passwordHash,
          role: Role.USER,
          tier: UserTier.MEMBER,
          membershipExpiresAt: null,
          emailVerifiedAt: new Date(),
          registrationChannel: RegistrationChannel.EMAIL,
          rafaCallSchedulingUnlocked: true,
          rafaCallUnlockOrigin: 'USER_PAID',
        } as any,
      });
      userId = created.id;
    } else {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          name: pending.name,
          email: pending.email,
          passwordHash: pending.passwordHash,
          emailVerifiedAt: new Date(),
          rafaCallSchedulingUnlocked: true,
          rafaCallUnlockOrigin: 'USER_PAID',
        } as any,
      });
    }

    await this.prisma.pendingRafacallSignup.update({
      where: { id: pending.id },
      data: {
        consumedAt: new Date(),
        createdUserId: userId,
      },
    });

    await this.recordRafaCallUnlockPaymentFromCheckoutSession(userId, session);

    const handoffExpires = new Date();
    handoffExpires.setHours(handoffExpires.getHours() + 2);

    await this.prisma.membershipCheckoutHandoff.upsert({
      where: { stripeSessionId: sess.id as string },
      create: {
        stripeSessionId: sess.id as string,
        userId,
        expiresAt: handoffExpires,
      },
      update: {
        userId,
        expiresAt: handoffExpires,
        consumedAt: null,
      },
    });

    const amountTotal = (sess.amount_total as number | null | undefined) ?? null;
    const currency = ((sess.currency as string | undefined) ?? 'eur').toLowerCase();
    const paidAt = new Date();
    const methodLabel = this.formatPaymentMethodFromSession(session);
    const amountLabel =
      amountTotal != null && Number.isFinite(amountTotal)
        ? this.formatMoney(amountTotal, currency)
        : undefined;
    await this.notifyAdminsNewPayment({
      payerUserId: userId,
      reason: 'Taxa de agendamento — chamada com a Rafa',
      amountLabel,
      paidAt,
      methodLabel,
    });
  }

  async claimGuestRafacallCheckout(sessionId: string) {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      throw new BadRequestException('Sessão de pagamento em falta.');
    }

    const handoff = await this.prisma.membershipCheckoutHandoff.findUnique({
      where: { stripeSessionId: trimmed },
    });

    if (handoff) {
      if (handoff.consumedAt) {
        return { status: 'consumed' as const };
      }
      if (handoff.expiresAt < new Date()) {
        return { status: 'expired' as const };
      }
      const auth = await this.authService.issueAuthTokenForUserId(handoff.userId);
      if (!auth) {
        return { status: 'invalid' as const };
      }
      await this.prisma.membershipCheckoutHandoff.update({
        where: { id: handoff.id },
        data: { consumedAt: new Date() },
      });
      return {
        status: 'ready' as const,
        token: auth.token,
        user: auth.user,
      };
    }

    const stripe = this.getClient();
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(trimmed);
    } catch {
      return { status: 'invalid' as const };
    }

    if (!this.isCheckoutSessionSuccessfullyPaid(session)) {
      return { status: 'pending' as const };
    }

    const checkoutType = session.metadata?.checkoutType;
    if (checkoutType !== 'rafacall_guest') {
      return { status: 'invalid' as const };
    }

    await this.handleGuestRafacallCheckoutCompleted(session);

    const retryHandoff = await this.prisma.membershipCheckoutHandoff.findUnique({
      where: { stripeSessionId: trimmed },
    });
    if (!retryHandoff || retryHandoff.consumedAt) {
      return retryHandoff?.consumedAt
        ? { status: 'consumed' as const }
        : { status: 'pending' as const };
    }

    const auth = await this.authService.issueAuthTokenForUserId(retryHandoff.userId);
    if (!auth) return { status: 'invalid' as const };

    await this.prisma.membershipCheckoutHandoff.update({
      where: { id: retryHandoff.id },
      data: { consumedAt: new Date() },
    });

    return {
      status: 'ready' as const,
      token: auth.token,
      user: auth.user,
    };
  }

  async claimGuestMembershipCheckout(sessionId: string) {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      throw new BadRequestException('Sessão de pagamento em falta.');
    }

    const handoff = await this.prisma.membershipCheckoutHandoff.findUnique({
      where: { stripeSessionId: trimmed },
    });

    if (handoff) {
      if (handoff.consumedAt) {
        return { status: 'consumed' as const };
      }
      if (handoff.expiresAt < new Date()) {
        return { status: 'expired' as const };
      }
      const auth = await this.authService.issueAuthTokenForUserId(handoff.userId);
      if (!auth) {
        return { status: 'invalid' as const };
      }
      await this.prisma.membershipCheckoutHandoff.update({
        where: { id: handoff.id },
        data: { consumedAt: new Date() },
      });
      return {
        status: 'ready' as const,
        token: auth.token,
        user: auth.user,
      };
    }

    const stripe = this.getClient();
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(trimmed);
    } catch {
      return { status: 'invalid' as const };
    }

    if (!this.isCheckoutSessionSuccessfullyPaid(session)) {
      return { status: 'pending' as const };
    }

    const checkoutType = session.metadata?.checkoutType;
    if (checkoutType !== 'membership_guest') {
      return { status: 'invalid' as const };
    }

    await this.handleGuestMembershipCheckoutCompleted(session);

    const retryHandoff = await this.prisma.membershipCheckoutHandoff.findUnique({
      where: { stripeSessionId: trimmed },
    });
    if (!retryHandoff || retryHandoff.consumedAt) {
      return retryHandoff?.consumedAt
        ? { status: 'consumed' as const }
        : { status: 'pending' as const };
    }

    const auth = await this.authService.issueAuthTokenForUserId(retryHandoff.userId);
    if (!auth) return { status: 'invalid' as const };

    await this.prisma.membershipCheckoutHandoff.update({
      where: { id: retryHandoff.id },
      data: { consumedAt: new Date() },
    });

    return {
      status: 'ready' as const,
      token: auth.token,
      user: auth.user,
    };
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

  /**
   * Checkout pode ficar `no_payment_required` quando o total é 0€ (ex.: cupão 100%).
   * Nesse caso o webhook deixa de ser `paid` e o handler antigo ignorava a sessão — tier ficava VISITOR.
   */
  private isCheckoutSessionSuccessfullyPaid(session: Stripe.Checkout.Session): boolean {
    const sess = session as any;
    const ps = sess.payment_status as string | undefined;
    if (ps === 'paid') return true;
    if (ps !== 'no_payment_required') return false;
    const meta = (sess.metadata ?? {}) as Record<string, string | undefined>;
    const checkoutType = meta.checkoutType;
    return (
      meta.membershipEurCents != null ||
      meta.rafacallFeeEurCents != null ||
      checkoutType === 'rafa_call_unlock' ||
      checkoutType === 'partner_sale_commission' ||
      checkoutType === 'partner_advertising_topup' ||
      checkoutType === 'membership_guest' ||
      checkoutType === 'rafacall_guest' ||
      checkoutType === 'rafacall_guest_v2'
    );
  }

  private async handleGuestMembershipCheckoutCompleted(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const sess = session as any;
    const pendingSignupId =
      (sess.metadata?.pendingSignupId as string | undefined) ||
      (sess.client_reference_id as string | undefined);
    if (!pendingSignupId) return;

    const pending = await this.prisma.pendingMembershipSignup.findUnique({
      where: { id: pendingSignupId },
    });
    if (!pending || pending.consumedAt) return;
    if (pending.expiresAt < new Date()) return;

    const validUntil = addYears(new Date(), MEMBERSHIP_DURATION_YEARS);
    let userId = pending.existingUserId ?? pending.createdUserId ?? null;

    if (!userId) {
      const created = await this.prisma.user.create({
        data: {
          email: pending.email,
          name: pending.name,
          whatsapp: pending.whatsapp,
          passwordHash: pending.passwordHash,
          role: Role.USER,
          tier: UserTier.MEMBER,
          membershipExpiresAt: validUntil,
          emailVerifiedAt: new Date(),
          registrationChannel: RegistrationChannel.EMAIL,
          indicadoPor: pending.indicadoPor,
          referredByAffiliateId: pending.referredByAffiliateId,
          referredByCodeSnapshot: pending.affiliateCodeSnapshot,
          referredAt: pending.referredByAffiliateId ? new Date() : null,
        },
      });
      userId = created.id;
    } else {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          name: pending.name,
          email: pending.email,
          passwordHash: pending.passwordHash,
          tier: UserTier.MEMBER,
          membershipExpiresAt: validUntil,
          emailVerifiedAt: new Date(),
        },
      });
    }

    const customerId =
      typeof sess.customer === 'string' ? sess.customer : sess.customer?.id;

    await this.prisma.$transaction([
      this.prisma.subscription.upsert({
        where: { userId },
        create: {
          userId,
          stripeCustomerId: customerId ?? null,
          status: SubscriptionStatus.ACTIVE,
          validUntil,
        },
        update: {
          ...(customerId && { stripeCustomerId: customerId }),
          status: SubscriptionStatus.ACTIVE,
          validUntil,
        },
      }),
      this.prisma.pendingMembershipSignup.update({
        where: { id: pending.id },
        data: {
          consumedAt: new Date(),
          createdUserId: userId,
        },
      }),
    ]);

    await this.recordMembershipPaymentFromCheckoutSession(userId, session);
    await this.createAffiliateCommissionIfEligible(userId);

    const handoffExpires = new Date();
    handoffExpires.setHours(handoffExpires.getHours() + 2);

    await this.prisma.membershipCheckoutHandoff.upsert({
      where: { stripeSessionId: sess.id as string },
      create: {
        stripeSessionId: sess.id as string,
        userId,
        expiresAt: handoffExpires,
      },
      update: {
        userId,
        expiresAt: handoffExpires,
        consumedAt: null,
      },
    });

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      });
      if (user?.email) {
        const frontendBase = getFrontendBaseUrl();
        const heroUrl = `${frontendBase}/comunidade_bg.svg`;
        await sendEmailBase({
          to: user.email,
          subject: 'Bem-vindo à Comunidade Rafa Portugal – já és membro',
          text: `Olá ${user.name},\n\nObrigado por te juntares à Comunidade Rafa Portugal. O teu pagamento foi confirmado e agora tens acesso a todos os benefícios durante um ano.\n\nAté já!\nA equipa Comunidade Rafa Portugal`,
          html: `
            <div style="max-width:640px;margin:0 auto;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
              <div style="width:100%;height:180px;overflow:hidden;">
                <img src="${heroUrl}" alt="Comunidade Rafa Portugal" style="width:100%;height:100%;object-fit:cover;display:block;" />
              </div>
              <div style="padding:24px 20px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
                <p style="font-size:16px;margin:0 0 12px;">Olá <strong>${user.name}</strong>,</p>
                <p style="margin:0 0 12px;">Obrigado por te juntares à <strong>Comunidade Rafa Portugal</strong>. O teu pagamento foi confirmado e agora tens acesso a todos os benefícios durante um ano.</p>
                <p style="margin:16px 0 0;">Até já!</p>
                <p style="margin:4px 0 0;">A equipa Comunidade Rafa Portugal</p>
              </div>
            </div>
          `,
        });
      }
    } catch {
      // ignore email errors
    }

    const amountTotal = (sess.amount_total as number | null | undefined) ?? null;
    const currency = ((sess.currency as string | undefined) ?? 'eur').toLowerCase();
    const paidAt = new Date();
    const methodLabel = this.formatPaymentMethodFromSession(session);
    const amountLabel =
      amountTotal != null && Number.isFinite(amountTotal)
        ? this.formatMoney(amountTotal, currency)
        : undefined;
    await this.notifyAdminsNewPayment({
      payerUserId: userId,
      reason: 'Anuidade Comunidade Rafa Portugal (1 ano) — nova conta',
      amountLabel,
      paidAt,
      methodLabel,
    });
  }

  private async handlePartnerAdvertisingTopupCompleted(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const sess = session as any;
    const partnerId = sess.metadata?.partnerId as string | undefined;
    const amountRaw = sess.metadata?.amountEurCents as string | undefined;
    const userId = (sess.metadata?.userId as string | undefined) || sess.client_reference_id;
    if (!partnerId || !amountRaw || !userId) return;

    const amountEurCents = parseInt(amountRaw, 10);
    if (!Number.isFinite(amountEurCents) || amountEurCents < 1) return;

    const { balanceEurCents } = await this.partnerAdvertising.credit(
      partnerId,
      amountEurCents,
      'STRIPE_TOP_UP',
      { stripeCheckoutSessionId: sess.id as string },
    );

    const amountLabel = this.formatMoney(amountEurCents, 'eur');
    const balanceLabel = this.formatMoney(balanceEurCents, 'eur');
    const methodLabel = this.formatPaymentMethodFromSession(session);
    const paidAt = new Date();

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      });
      if (user?.email) {
        await sendEmailBase({
          to: user.email,
          subject: 'Saldo de publicidade adicionado — Comunidade Rafa Portugal',
          text: `Olá ${user.name},\n\nConfirmámos o pagamento de ${amountLabel} (${methodLabel}). O teu saldo de publicidade atual é ${balanceLabel}.\n\nObrigado!\nA equipa Comunidade Rafa Portugal`,
          html: `
            <motion-div style="max-width:640px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;padding:24px;">
              <p>Olá <strong>${user.name}</strong>,</p>
              <p>Confirmámos o pagamento de <strong>${amountLabel}</strong> (${methodLabel}).</p>
              <p>O teu <strong>saldo de publicidade</strong> atual é <strong>${balanceLabel}</strong>.</p>
              <p style="margin-top:24px;">Obrigado!<br/>A equipa Comunidade Rafa Portugal</p>
            </motion-div>
          `.replaceAll('motion-div', 'div'),
        });
      }
    } catch {
      // ignore email errors
    }

    await this.sendPaymentConfirmationWhatsApp({
      userId,
      reason: 'Recarga de saldo de publicidade',
      amountLabel,
      paidAt,
      methodLabel,
    });
    await this.notifyAdminsNewPayment({
      payerUserId: userId,
      reason: 'Recarga de saldo de publicidade',
      amountLabel,
      paidAt,
      methodLabel,
    });
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const sess = session as any;
    if (!this.isCheckoutSessionSuccessfullyPaid(session)) {
      const ps = sess.payment_status as string | undefined;
      // `unpaid` é esperado em métodos assíncronos até vir async_payment_succeeded — não spammar logs.
      if (ps !== 'unpaid') {
        this.logger.warn(
          `Stripe checkout não atualizou conta (session=${sess.id}, payment_status=${ps ?? 'undefined'})`,
        );
      }
      return;
    }

    const checkoutTypeEarly = sess.metadata?.checkoutType as string | undefined;
    if (checkoutTypeEarly === 'membership_guest') {
      await this.handleGuestMembershipCheckoutCompleted(session);
      return;
    }
    if (checkoutTypeEarly === 'rafacall_guest') {
      await this.handleGuestRafacallCheckoutCompleted(session);
      return;
    }
    if (checkoutTypeEarly === 'rafacall_guest_v2') {
      await this.handleGuestRafacallSessionCompleted(session);
      return;
    }

    const subIdFromSession = resolveSubscriptionId(session.subscription);
    const userId =
      (sess.client_reference_id as string) ||
      (sess.metadata?.userId as string) ||
      (subIdFromSession ? await this.getUserIdFromSubscription(subIdFromSession) : null);
    if (!userId) return;

    const checkoutType = sess.metadata?.checkoutType as string | undefined;
    if (checkoutType === 'partner_advertising_topup') {
      await this.handlePartnerAdvertisingTopupCompleted(session);
      return;
    }

    if (checkoutType === 'partner_sale_commission') {
      const saleId = sess.metadata?.saleId as string | undefined;
      if (!saleId) return;
      const paymentIntentId =
        typeof sess.payment_intent === 'string'
          ? sess.payment_intent
          : sess.payment_intent?.id;

      const updated = await this.prisma.partnerSale.updateMany({
        where: {
          id: saleId,
          commissionPaymentStatus: PartnerSaleCommissionPaymentStatus.PENDING,
        },
        data: {
          commissionPaymentStatus: PartnerSaleCommissionPaymentStatus.PAID,
          stripeCheckoutSessionId: sess.id,
          stripePaymentIntentId: paymentIntentId ?? null,
          paidAt: new Date(),
        },
      });
      if (updated.count > 0) {
        const amountTotal = (sess.amount_total as number | null | undefined) ?? null;
        const currency = ((sess.currency as string | undefined) ?? 'eur').toLowerCase();
        const paidAt = new Date();
        const methodLabel = this.formatPaymentMethodFromSession(session);
        const amountLabel =
          amountTotal != null && Number.isFinite(amountTotal)
            ? this.formatMoney(amountTotal, currency)
            : undefined;
        await this.sendPaymentConfirmationWhatsApp({
          userId,
          reason: 'Pagamento de comissão RPM',
          amountLabel,
          paidAt,
          methodLabel,
        });
        await this.notifyAdminsNewPayment({
          payerUserId: userId,
          reason: 'Pagamento de comissão RPM',
          amountLabel,
          paidAt,
          methodLabel,
        });
      }
      return;
    }

    if (checkoutType === 'rafa_call_unlock') {
      const updated = await this.prisma.user.updateMany({
        where: { id: userId, rafaCallSchedulingUnlocked: false },
        // Cast para evitar cache de tipos do Prisma em alguns ambientes de build/lint.
        data: { rafaCallSchedulingUnlocked: true, rafaCallUnlockOrigin: 'USER_PAID' } as any,
      });
      await this.recordRafaCallUnlockPaymentFromCheckoutSession(userId, session);

      if (updated.count > 0) {
        const amountTotal = (sess.amount_total as number | null | undefined) ?? null;
        const currency = ((sess.currency as string | undefined) ?? 'eur').toLowerCase();
        const paidAt = new Date();
        const methodLabel = this.formatPaymentMethodFromSession(session);
        const amountLabel =
          amountTotal != null && Number.isFinite(amountTotal)
            ? this.formatMoney(amountTotal, currency)
            : undefined;
        await this.sendPaymentConfirmationWhatsApp({
          userId,
          reason: 'Taxa de agendamento — chamada com a Rafa',
          amountLabel,
          paidAt,
          methodLabel,
        });
        await this.notifyAdminsNewPayment({
          payerUserId: userId,
          reason: 'Taxa de agendamento — chamada com a Rafa',
          amountLabel,
          paidAt,
          methodLabel,
        });
      }
      return;
    }

    const prev = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tier: true },
    });

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
        data: {
          tier: UserTier.MEMBER,
          membershipExpiresAt: validUntil,
        },
      }),
    ]);
    const membershipPaymentCreated = await this.recordMembershipPaymentFromCheckoutSession(
      userId,
      session,
    );
    await this.createAffiliateCommissionIfEligible(userId);

    if (membershipPaymentCreated) {
      const amountTotal = (sess.amount_total as number | null | undefined) ?? null;
      const currency = ((sess.currency as string | undefined) ?? 'eur').toLowerCase();
      const paidAt = new Date();
      const methodLabel = this.formatPaymentMethodFromSession(session);
      const amountLabel =
        amountTotal != null && Number.isFinite(amountTotal)
          ? this.formatMoney(amountTotal, currency)
          : undefined;
      // Mensagem WhatsApp para membros VIP desativada a pedido.
      await this.notifyAdminsNewPayment({
        payerUserId: userId,
        reason: 'Anuidade Comunidade Rafa Portugal (1 ano)',
        amountLabel,
        paidAt,
        methodLabel,
      });
    }

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      });
      if (user?.email) {
        const frontendBase = getFrontendBaseUrl();
        const heroUrl = `${frontendBase}/comunidade_bg.svg`;
        await sendEmailBase({
          to: user.email,
          subject: 'Bem-vindo à Comunidade Rafa Portugal – já és membro',
          text: `Olá ${user.name},\n\nObrigado por te juntares à Comunidade Rafa Portugal. O teu pagamento foi confirmado e agora tens acesso a todos os benefícios durante um ano.\n\nAté já!\nA equipa Comunidade Rafa Portugal`,
          html: `
            <div style="max-width:640px;margin:0 auto;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
              <div style="width:100%;height:180px;overflow:hidden;">
                <img src="${heroUrl}" alt="Comunidade Rafa Portugal" style="width:100%;height:100%;object-fit:cover;display:block;" />
              </div>
              <div style="padding:24px 20px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
                <p style="font-size:16px;margin:0 0 12px;">Olá <strong>${user.name}</strong>,</p>
                <p style="margin:0 0 12px;">Obrigado por te juntares à <strong>Comunidade Rafa Portugal</strong>. O teu pagamento foi confirmado e agora tens acesso a todos os benefícios durante um ano.</p>
                <p style="margin:0 0 8px;">Sempre que precisares de ajuda, é só entrar no teu dashboard e falar connosco.</p>
                <p style="margin:16px 0 0;">Até já!</p>
                <p style="margin:4px 0 0;">A equipa Comunidade Rafa Portugal</p>
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
        tier: UserTier.MEMBER,
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
      data: {
        tier: UserTier.MEMBER,
        membershipExpiresAt: validUntil,
      },
    });

    if (
      inv.billing_reason === 'subscription_cycle' &&
      typeof inv.amount_paid === 'number' &&
      inv.amount_paid > 0
    ) {
      const created = await this.recordMembershipPaymentFromInvoice(userId, invoice);
      if (created) {
        const amountPaid = inv.amount_paid as number;
        const currency = (inv.currency as string | undefined) ?? 'eur';
        const paidAt = new Date();
        const amountLabel = this.formatMoney(amountPaid, currency);
        // Mensagem WhatsApp para membros VIP desativada a pedido.
        await this.notifyAdminsNewPayment({
          payerUserId: userId,
          reason: 'Renovação — Anuidade Comunidade Rafa Portugal',
          amountLabel,
          paidAt,
          methodLabel: 'Stripe',
        });
      }
    }

    await this.createAffiliateCommissionIfEligible(userId);
  }

  /**
   * EUR/MB: usa o valor pago na sessão (amount_total). BRL: contabiliza o preço EUR em vigor
   * (mesma regra de negócio que o painel admin).
   */
  /** EUR/MB: valor da sessão. BRL (Pix): EUR em metadata à data do pagamento (como na anuidade). */
  private creditedEurFromRafaCheckoutSession(session: Stripe.Checkout.Session): number {
    const cur =
      ((session as any).currency as string | undefined)?.toLowerCase() ?? 'eur';
    if (cur === 'brl') {
      const fromMeta = Number.parseInt(
        String((session as any).metadata?.rafacallFeeEurCents ?? ''),
        10,
      );
      if (Number.isFinite(fromMeta) && fromMeta > 0) {
        return Math.round(fromMeta) / 100;
      }
      return Math.round(this.rafaCallEurCents) / 100;
    }
    const total = (session as any).amount_total as number | null | undefined;
    if (total != null && Number.isFinite(total) && total >= 0) {
      return Math.round(total) / 100;
    }
    return Math.round(this.rafaCallEurCents) / 100;
  }

  private creditedEurFromCheckoutSession(session: Stripe.Checkout.Session): number {
    const cur =
      ((session as any).currency as string | undefined)?.toLowerCase() ?? 'eur';
    if (cur === 'brl') {
      const fromMeta = Number.parseInt(
        String((session as any).metadata?.membershipEurCents ?? ''),
        10,
      );
      if (Number.isFinite(fromMeta) && fromMeta > 0) {
        return Math.round(fromMeta) / 100;
      }
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

  private async recordRafaCallUnlockPaymentFromCheckoutSession(
    userId: string,
    session: Stripe.Checkout.Session,
  ): Promise<boolean> {
    const sessionId = session.id;
    if (!sessionId) return false;
    const amountCreditedEur = this.creditedEurFromRafaCheckoutSession(session);
    try {
      await this.prisma.rafaCallUnlockPayment.create({
        data: {
          userId,
          stripeCheckoutSessionId: sessionId,
          amountCreditedEur,
          stripeCurrency: (session as any).currency ?? null,
        },
      });
      return true;
    } catch (err: any) {
      if (err?.code === 'P2002') return false;
      throw err;
    }
  }

  private async recordMembershipPaymentFromCheckoutSession(
    userId: string,
    session: Stripe.Checkout.Session,
  ): Promise<boolean> {
    const sessionId = session.id;
    if (!sessionId) return false;
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
      return true;
    } catch (err: any) {
      if (err?.code === 'P2002') return false;
      throw err;
    }
  }

  private async recordMembershipPaymentFromInvoice(
    userId: string,
    invoice: Stripe.Invoice,
  ): Promise<boolean> {
    const inv = invoice as any;
    const invoiceId = inv.id as string | undefined;
    if (!invoiceId) return false;
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
      return true;
    } catch (err: any) {
      if (err?.code === 'P2002') return false;
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
