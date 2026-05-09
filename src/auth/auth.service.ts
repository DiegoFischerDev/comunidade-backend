import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  ServiceUnavailableException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { $Enums, Role, UserTier } from '@prisma/client';
import { sendEmailBase } from '../email/resend.client';
import { UpdateProfileDto } from './dto/update-profile.dto';

const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private normalizeWhatsapp(value: string): string {
    return value.replace(/\s+/g, '');
  }

  private async deleteUploadFileIfLocal(url?: string | null) {
    if (!url) return;

    let pathname = url;
    if (pathname.startsWith('http://') || pathname.startsWith('https://')) {
      try {
        pathname = new URL(pathname).pathname;
      } catch {
        return;
      }
    }

    if (!pathname.startsWith('/uploads/')) {
      return;
    }

    const filename = pathname.replace('/uploads/', '');
    if (!filename) return;

    const filePath = join(process.cwd(), 'uploads', filename);

    try {
      await unlink(filePath);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        // ignoramos outros erros para não quebrar o fluxo de negócio
      }
    }
  }

  private generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private generateBrowserSessionToken(): string {
    return randomBytes(32).toString('hex');
  }

  private signAuthJwt(user: {
    id: string;
    email: string | null;
    role: Role;
  }): string {
    return this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
  }

  private getVerificationExpiryDate(): Date {
    const expires = new Date();
    expires.setMinutes(expires.getMinutes() + 15);
    return expires;
  }

  private getResetPasswordExpiryDate(): Date {
    const expires = new Date();
    expires.setMinutes(expires.getMinutes() + 30);
    return expires;
  }

  private buildWhatsappRegistrationUrl(name: string, code: string): string {
    const num =
      this.getRegistrationNumbers()[0] || '351927398547';
    const text = `Olá, meu nome é ${name}, gostaria de confirmar meu acesso à Comunidade Rafa Portugal. meu codigo é ${code}`;
    return `https://wa.me/${num.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
  }

  private getRegistrationNumbers(): string[] {
    const primary = (process.env.WHATSAPP_REGISTRATION_NUMBER || '351927398547')
      .replace(/\D/g, '')
      .trim();
    const secondary = (process.env.WHATSAPP_REGISTRATION_NUMBER_SECONDARY || '')
      .replace(/\D/g, '')
      .trim();
    return [primary, secondary].filter((v, i, arr) => !!v && arr.indexOf(v) === i);
  }

  private getAllowedEvolutionInstances(): string[] {
    const primary = (process.env.EVOLUTION_INSTANCE || 'comunidade').trim();
    const secondary = (process.env.EVOLUTION_INSTANCE_SECONDARY || '').trim();
    const active = (process.env.EVOLUTION_ACTIVE_INSTANCE || '').trim();
    const base = [primary, secondary].filter((v, i, arr) => !!v && arr.indexOf(v) === i);
    if (!base.length) return ['comunidade'];
    if (!active || !base.includes(active)) return base;
    return [active, ...base.filter((v) => v !== active)];
  }

  private resolveEvolutionInstances(preferred?: string): string[] {
    const allowed = this.getAllowedEvolutionInstances();
    const failoverRaw = (process.env.EVOLUTION_FAILOVER_ENABLED || '1').trim().toLowerCase();
    const failoverEnabled = !['0', 'false', 'off', 'no'].includes(failoverRaw);
    const p = (preferred || '').trim();
    if (p && allowed.includes(p)) {
      const ordered = [p, ...allowed.filter((v) => v !== p)];
      return failoverEnabled ? ordered : ordered.slice(0, 1);
    }
    return failoverEnabled ? allowed : allowed.slice(0, 1);
  }

  private async sendEvolutionText(
    toDigits: string,
    text: string,
    preferredInstance?: string,
  ): Promise<void> {
    const base = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
    const key = process.env.EVOLUTION_API_KEY || '';
    const instances = this.resolveEvolutionInstances(preferredInstance);
    if (!base || !key) {
      console.warn(
        '[auth] EVOLUTION_API_URL ou EVOLUTION_API_KEY ausentes; SMS WhatsApp não enviado.',
      );
      return;
    }
    const number = toDigits.replace(/\D/g, '');
    let lastError = '';
    for (const instance of instances) {
      try {
        const res = await fetch(`${base}/message/sendText/${instance}`, {
          method: 'POST',
          headers: { apikey: key, 'content-type': 'application/json' },
          body: JSON.stringify({ number, text }),
        });
        if (res.ok) return;
        const body = await res.text().catch(() => '');
        lastError = `${res.status} ${body}`.trim();
      } catch (err: any) {
        lastError = err?.message ? String(err.message) : 'erro de rede';
      }
    }
    console.warn('[auth] Evolution sendText falhou em todas as instâncias:', lastError);
  }

  async register(dto: RegisterDto) {
    const rawAffiliateCode = (dto.affiliateCode ?? '').trim().toLowerCase();
    let referredByAffiliateId: string | null = null;
    let referredByCodeSnapshot: string | null = null;
    if (rawAffiliateCode && rawAffiliateCode !== 'nenhum') {
      const affiliate = await this.prisma.affiliateProfile.findUnique({
        where: { affiliateCode: rawAffiliateCode },
        select: { id: true, isActive: true },
      });
      // Não deve bloquear criação de conta: se inválido, ignora (considera null).
      if (affiliate && affiliate.isActive) {
        referredByAffiliateId = affiliate.id;
        referredByCodeSnapshot = rawAffiliateCode;
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const verificationCode = this.generateVerificationCode();
    const browserSessionToken = this.generateBrowserSessionToken();
    const verificationExpiresAt = this.getVerificationExpiryDate();
    // Em vez de criar o utilizador agora, criamos um "pedido de registo" e só
    // criamos o User quando o Evolution confirmar o WhatsApp com este código.
    await this.prisma.whatsappRegistrationRequest.create({
      data: {
        code: verificationCode,
        browserSessionToken,
        name: dto.name.trim(),
        passwordHash,
        affiliateCodeSnapshot: referredByCodeSnapshot,
        indicadoPor: referredByCodeSnapshot,
        referredByAffiliateId,
        expiresAt: verificationExpiresAt,
      },
    });

    const registrationNumbers = this.getRegistrationNumbers();
    const registrationDigits = registrationNumbers[0] || '351927398547';

    return {
      user: {
        // placeholder para o frontend (a conta só será criada após confirmação)
        id: 'pending',
        role: Role.USER,
        name: dto.name.trim(),
        whatsapp: '',
        createdAt: new Date().toISOString(),
      },
      requiresEmailVerification: false,
      requiresWhatsappVerification: true,
      whatsappVerificationCode: verificationCode,
      whatsappRegistrationNumber: registrationDigits,
      whatsappRegistrationNumberSecondary: registrationNumbers[1] || null,
      whatsappOpenUrl: this.buildWhatsappRegistrationUrl(
        dto.name.trim(),
        verificationCode,
      ),
      whatsappBrowserSessionToken: browserSessionToken,
    };
  }

  /**
   * Chamado pelo receiver do webhook (Evolution). Responde sempre com 200 no controller
   * quando o processamento termina; envia texto ao utilizador via Evolution em sucesso/erro.
   */
  async confirmWhatsappRegistration(
    code: string,
    fromWhatsapp: string,
    evolutionInstance?: string,
  ) {
    const normalizedFrom = fromWhatsapp.replace(/\D/g, '');
    const trimmedCode = code.trim();

    const invalidMsg =
      'Não encontrámos um registo com este código ou o código expirou (15 minutos). Volte ao site, crie de novo a conta e envie a mensagem outra vez.';

    const communityUrl =
      process.env.FRONTEND_URL?.replace(/\/$/, '') || 'http://localhost:3000';
    // NOTA: mensagens automáticas de boas-vindas/termos via WhatsApp desativadas a pedido.

    const req = await this.prisma.whatsappRegistrationRequest.findUnique({
      where: { code: trimmedCode },
    });

    if (!req) {
      await this.sendEvolutionText(normalizedFrom, invalidMsg, evolutionInstance);
      return { ok: true };
    }

    const now = new Date();
    if (req.expiresAt < now) {
      await this.sendEvolutionText(normalizedFrom, invalidMsg, evolutionInstance);
      return { ok: true };
    }

    const existingUser = await this.prisma.user.findFirst({
      where: {
        whatsapp: normalizedFrom,
      },
    });

    const handoffExpires = new Date();
    handoffExpires.setMinutes(handoffExpires.getMinutes() + 30);

    const passwordUpdatedMsg =
      `Confirmámos o seu número. A palavra-passe da sua conta foi atualizada para a que acabou de definir no site. Já pode entrar na comunidade com o mesmo WhatsApp e esta nova senha.\n\n${communityUrl}`;

    if (existingUser) {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: existingUser.id },
          data: { passwordHash: req.passwordHash },
        });

        await tx.whatsappRegistrationBrowserHandoff.create({
          data: {
            sessionToken: req.browserSessionToken,
            userId: existingUser.id,
            expiresAt: handoffExpires,
          },
        });

        await tx.whatsappRegistrationRequest.delete({
          where: { id: req.id },
        });
      });

      await this.sendEvolutionText(normalizedFrom, passwordUpdatedMsg, evolutionInstance);
      return { ok: true };
    }

    await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: null,
          name: req.name,
          whatsapp: normalizedFrom,
          passwordHash: req.passwordHash,
          role: Role.USER,
          registrationChannel: $Enums.RegistrationChannel.WHATSAPP,
          emailVerifiedAt: new Date(),
          indicadoPor: req.indicadoPor,
          referredByAffiliateId: req.referredByAffiliateId,
          referredByCodeSnapshot: req.affiliateCodeSnapshot,
          referredAt: req.referredByAffiliateId ? new Date() : null,
        },
      });

      await tx.whatsappRegistrationBrowserHandoff.create({
        data: {
          sessionToken: req.browserSessionToken,
          userId: created.id,
          expiresAt: handoffExpires,
        },
      });

      await tx.whatsappRegistrationRequest.delete({
        where: { id: req.id },
      });
    });

    // (sem mensagens automáticas de boas-vindas/termos)
    return { ok: true };
  }

  /**
   * O browser faz polling com o token opaco recebido em /auth/register até a conta
   * ser criada no WhatsApp; devolve JWT uma única vez.
   */
  async pollWhatsappRegistrationBrowser(rawToken: string) {
    const token = rawToken.trim();
    if (!token) {
      throw new BadRequestException('Token em falta.');
    }

    const handoff = await this.prisma.whatsappRegistrationBrowserHandoff.findUnique(
      {
        where: { sessionToken: token },
        include: {
          user: { select: { id: true, email: true, role: true, whatsapp: true } },
        },
      },
    );

    if (handoff) {
      if (handoff.consumedAt) {
        return { status: 'consumed' as const };
      }
      const now = new Date();
      if (handoff.expiresAt < now) {
        return { status: 'expired' as const };
      }
      await this.prisma.whatsappRegistrationBrowserHandoff.update({
        where: { id: handoff.id },
        data: { consumedAt: now },
      });
      const u = handoff.user;
      const jwt = this.signAuthJwt({
        id: u.id,
        email: u.email,
        role: u.role,
      });
      return {
        status: 'ready' as const,
        token: jwt,
        user: {
          id: u.id,
          email: u.email,
          role: u.role,
          whatsapp: u.whatsapp,
        },
      };
    }

    const pending = await this.prisma.whatsappRegistrationRequest.findUnique({
      where: { browserSessionToken: token },
      select: { id: true },
    });
    if (pending) {
      return { status: 'pending' as const };
    }

    return { status: 'invalid' as const };
  }

  async login(dto: LoginDto) {
    const normalizedWhatsapp = dto.whatsapp.replace(/\D/g, '');
    if (!normalizedWhatsapp) {
      throw new UnauthorizedException('WhatsApp ou senha inválidos.');
    }

    const user = await this.prisma.user.findUnique({
      where: { whatsapp: normalizedWhatsapp },
    });
    if (!user) {
      throw new UnauthorizedException('WhatsApp ou senha inválidos.');
    }

    if (!user.emailVerifiedAt) {
      if (
        user.registrationChannel === $Enums.RegistrationChannel.WHATSAPP &&
        user.whatsappVerificationCode
      ) {
        throw new ForbiddenException(
          'Confirme a sua conta pelo WhatsApp: abra o link que mostrámos após o registo e envie a mensagem com o código.',
        );
      }
      if (user.emailVerificationCode) {
        throw new ForbiddenException(
          'É necessário confirmar o seu e-mail antes de entrar. Verifique a sua caixa de entrada e também a pasta de spam/lixo eletrónico. Se precisar, peça o reenvio do código.',
        );
      }
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('WhatsApp ou senha inválidos.');
    }
    const token = this.signAuthJwt({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        whatsapp: user.whatsapp,
      },
      token,
    };
  }

  async verifyEmail(email: string, code: string) {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      throw new BadRequestException('Utilizador não encontrado.');
    }

    if (!user.emailVerificationCode || !user.emailVerificationExpiresAt) {
      if (user.emailVerifiedAt) {
        return { success: true };
      }
      throw new BadRequestException(
        'Não há um código de confirmação ativo para este e-mail.',
      );
    }

    const now = new Date();
    if (user.emailVerificationExpiresAt < now) {
      throw new ForbiddenException('O código de confirmação expirou.');
    }

    if (user.emailVerificationCode !== code.trim()) {
      throw new ForbiddenException('Código de confirmação inválido.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        emailVerificationCode: null,
        emailVerificationExpiresAt: null,
      },
    });

    return { success: true };
  }

  async requestPasswordReset(whatsappRaw: string) {
    const normalizedWhatsapp = whatsappRaw.replace(/\D/g, '');

    if (!normalizedWhatsapp) {
      return { success: true };
    }

    const user = await this.prisma.user.findUnique({
      where: { whatsapp: normalizedWhatsapp },
    });

    if (!user) {
      return { success: true };
    }

    const resetCode = this.generateVerificationCode();
    const resetExpiresAt = this.getResetPasswordExpiryDate();

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordCode: resetCode,
        resetPasswordExpiresAt: resetExpiresAt,
      },
    });

    const waText = `Olá ${user.name},

Recebemos um pedido para redefinir a sua palavra-passe na Comunidade Rafa Portugal.

Utilize este código no site (válido por 30 minutos): ${resetCode}

Se não foi você, ignore esta mensagem.`;

    await this.sendEvolutionText(normalizedWhatsapp, waText);

    if (user.email) {
      try {
        const subject = 'Pedido de redefinição de senha – Comunidade Rafa Portugal';
        const text = `Olá ${user.name},

Recebemos um pedido para redefinir a sua senha na Comunidade Rafa Portugal.

Utilize o código abaixo para criar uma nova senha:

${resetCode}

Este código é válido por 30 minutos.

Se não foi você que fez este pedido, pode ignorar esta mensagem.`;

        const html = `<p>Olá ${user.name},</p>
<p>Recebemos um pedido para redefinir a sua senha na <strong>Comunidade Rafa Portugal</strong>.</p>
<p>Utilize o código abaixo para criar uma nova senha:</p>
<p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${resetCode}</p>
<p>Este código é válido por 30 minutos.</p>
<p>Se não foi você que fez este pedido, pode ignorar esta mensagem.</p>`;

        await sendEmailBase({
          to: user.email,
          subject,
          text,
          html,
        });
      } catch {
        // WhatsApp já foi tentado; e-mail é opcional
      }
    }

    return { success: true };
  }

  async resetPassword(
    whatsappRaw: string,
    code: string,
    newPassword: string,
  ) {
    const normalizedWhatsapp = whatsappRaw.replace(/\D/g, '');

    const user = await this.prisma.user.findUnique({
      where: { whatsapp: normalizedWhatsapp },
    });

    if (
      !user ||
      !user.resetPasswordCode ||
      !user.resetPasswordExpiresAt
    ) {
      throw new BadRequestException(
        'Código de recuperação inválido ou expirado.',
      );
    }

    const now = new Date();
    if (user.resetPasswordExpiresAt < now) {
      throw new ForbiddenException('O código de recuperação expirou.');
    }

    if (user.resetPasswordCode !== code.trim()) {
      throw new ForbiddenException('Código de recuperação inválido.');
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetPasswordCode: null,
        resetPasswordExpiresAt: null,
      },
    });

    return { success: true };
  }

  async resendVerification(email: string) {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      throw new BadRequestException('Utilizador não encontrado.');
    }

    if (user.emailVerifiedAt) {
      return { success: true };
    }

    if (user.registrationChannel === $Enums.RegistrationChannel.WHATSAPP) {
      throw new BadRequestException(
        'Este registo deve ser confirmado pelo WhatsApp. Inicie o processo novamente no site se precisar de ajuda.',
      );
    }

    const verificationCode = this.generateVerificationCode();
    const verificationExpiresAt = this.getVerificationExpiryDate();

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationCode: verificationCode,
        emailVerificationExpiresAt: verificationExpiresAt,
      },
    });

    try {
      if (!user.email) {
        throw new ServiceUnavailableException(
          'E-mail do utilizador não está configurado.',
        );
      }
      const subject = 'Novo código de confirmação da Comunidade Rafa Portugal';
      const text = `Olá ${user.name},

Recebemos um pedido para reenviar o seu código de confirmação da Comunidade Rafa Portugal.

Utilize o seguinte código para confirmar o seu e-mail:

${verificationCode}

Este código é válido por 15 minutos.

Se não foi você que iniciou este pedido, pode ignorar esta mensagem.`;

      const html = `<p>Olá ${user.name},</p>
<p>Recebemos um pedido para reenviar o seu código de confirmação da <strong>Comunidade Rafa Portugal</strong>.</p>
<p>Utilize o seguinte código para confirmar o seu e-mail:</p>
<p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${verificationCode}</p>
<p>Este código é válido por 15 minutos.</p>
<p>Se não foi você que iniciou este pedido, pode ignorar esta mensagem.</p>`;

      await sendEmailBase({
        to: user.email,
        subject,
        text,
        html,
      });
    } catch {
      throw new ServiceUnavailableException(
        'Não foi possível reenviar o e-mail de confirmação. Tente novamente mais tarde.',
      );
    }

    return { success: true };
  }

  async validateUserById(userId: string) {
    let user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        whatsapp: true,
        instagram: true,
        profileImageUrl: true,
        tier: true,
        membershipExpiresAt: true,
      },
    });
    if (!user) return null;
    if (
      user.tier === 'MEMBER' &&
      user.membershipExpiresAt &&
      user.membershipExpiresAt < new Date()
    ) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          tier: UserTier.VISITOR,
          membershipExpiresAt: null,
          rafaCallSchedulingUnlocked: false,
          rafaCallSlotStartsAt: null,
          rafaCallSlotEndsAt: null,
        },
      });
      user = { ...user, tier: UserTier.VISITOR, membershipExpiresAt: null };
    }
    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        whatsapp: true,
        instagram: true,
        profileImageUrl: true,
      },
    });

    if (!existing) {
      throw new UnauthorizedException('Utilizador não encontrado.');
    }

    const data: {
      name?: string;
      email?: string;
      whatsapp?: string;
      instagram?: string;
      profileImageUrl?: string;
    } = {};

    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }

    if (dto.email !== undefined) {
      const email = dto.email.toLowerCase().trim();
      const existing = await this.prisma.user.findUnique({
        where: { email },
      });
      if (existing && existing.id !== userId) {
        throw new ConflictException('Este e-mail já está em uso.');
      }
      data.email = email;
    }

    if (dto.whatsapp !== undefined) {
      data.whatsapp = this.normalizeWhatsapp(dto.whatsapp);
    }

    if (dto.instagram !== undefined) {
      data.instagram = dto.instagram.trim();
    }

    if (dto.profileImageUrl !== undefined) {
      data.profileImageUrl = dto.profileImageUrl;
    }

    if (!Object.keys(data).length) {
      return this.validateUserById(userId);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
    });

    // Remove a imagem de perfil antiga se foi substituída
    if (
      dto.profileImageUrl &&
      dto.profileImageUrl !== existing.profileImageUrl
    ) {
      await this.deleteUploadFileIfLocal(existing.profileImageUrl);
    }

    return this.validateUserById(userId);
  }

  async impersonate(adminUserId: string, targetUserId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminUserId },
    });

    if (!admin) {
      throw new UnauthorizedException('Administrador não encontrado.');
    }

    if (admin.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Apenas administradores podem usar esta funcionalidade.',
      );
    }

    if (admin.id === targetUserId) {
      throw new ForbiddenException(
        'Você já está autenticado como este utilizador.',
      );
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!target) {
      throw new UnauthorizedException('Utilizador alvo não encontrado.');
    }

    const token = this.jwtService.sign({
      sub: target.id,
      email: target.email,
      role: target.role,
    });

    return {
      user: {
        id: target.id,
        email: target.email,
        role: target.role,
        name: target.name ?? undefined,
        whatsapp: target.whatsapp ?? undefined,
      },
      token,
    };
  }
}
