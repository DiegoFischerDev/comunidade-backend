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
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Role, UserTier } from '@prisma/client';
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

  private generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
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

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (existing) {
      throw new ConflictException('Este e-mail já está em uso.');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const verificationCode = this.generateVerificationCode();
    const verificationExpiresAt = this.getVerificationExpiryDate();

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase().trim(),
        name: dto.name,
        whatsapp: this.normalizeWhatsapp(dto.whatsapp),
        passwordHash,
        role: Role.USER,
        emailVerificationCode: verificationCode,
        emailVerificationExpiresAt: verificationExpiresAt,
      },
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        whatsapp: true,
        createdAt: true,
      },
    });

    try {
      const subject = 'Confirme o seu e-mail na Comunidade RPM';
      const text = `Olá ${user.name},

Obrigado por se registar na Comunidade RPM.

Para confirmar o seu e-mail, utilize o seguinte código:

${verificationCode}

Este código é válido por 15 minutos.

Se não foi você que iniciou este registo, pode ignorar esta mensagem.`;

      const html = `<p>Olá ${user.name},</p>
<p>Obrigado por se registar na <strong>Comunidade RPM</strong>.</p>
<p>Para confirmar o seu e-mail, utilize o seguinte código:</p>
<p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${verificationCode}</p>
<p>Este código é válido por 15 minutos.</p>
<p>Se não foi você que iniciou este registo, pode ignorar esta mensagem.</p>`;

      await sendEmailBase({
        to: user.email,
        subject,
        text,
        html,
      });
    } catch (error) {
      await this.prisma.user
        .delete({ where: { id: user.id } })
        .catch(() => undefined);

      throw new ServiceUnavailableException(
        'Não foi possível enviar o e-mail de confirmação. Tente novamente mais tarde.',
      );
    }

    return {
      user,
      requiresEmailVerification: true,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (!user) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    if (user.emailVerificationCode && !user.emailVerifiedAt) {
      throw new ForbiddenException(
        'É necessário confirmar o seu e-mail antes de entrar. Verifique a sua caixa de entrada e também a pasta de spam/lixo eletrónico. Se precisar, peça o reenvio do código.',
      );
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }
    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
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

  async requestPasswordReset(email: string) {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      // Não expomos que o utilizador não existe
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

    try {
      const subject = 'Pedido de redefinição de senha – Comunidade RPM';
      const text = `Olá ${user.name},

Recebemos um pedido para redefinir a sua senha na Comunidade RPM.

Utilize o código abaixo para criar uma nova senha:

${resetCode}

Este código é válido por 30 minutos.

Se não foi você que fez este pedido, pode ignorar esta mensagem.`;

      const html = `<p>Olá ${user.name},</p>
<p>Recebemos um pedido para redefinir a sua senha na <strong>Comunidade RPM</strong>.</p>
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
      throw new ServiceUnavailableException(
        'Não foi possível enviar o e-mail de recuperação de senha. Tente novamente mais tarde.',
      );
    }

    return { success: true };
  }

  async resetPassword(
    email: string,
    code: string,
    newPassword: string,
  ) {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
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
      const subject = 'Novo código de confirmação da Comunidade RPM';
      const text = `Olá ${user.name},

Recebemos um pedido para reenviar o seu código de confirmação da Comunidade RPM.

Utilize o seguinte código para confirmar o seu e-mail:

${verificationCode}

Este código é válido por 15 minutos.

Se não foi você que iniciou este pedido, pode ignorar esta mensagem.`;

      const html = `<p>Olá ${user.name},</p>
<p>Recebemos um pedido para reenviar o seu código de confirmação da <strong>Comunidade RPM</strong>.</p>
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
        data: { tier: UserTier.VISITOR, membershipExpiresAt: null },
      });
      user = { ...user, tier: UserTier.VISITOR, membershipExpiresAt: null };
    }
    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: { email?: string } = {};

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

    if (!Object.keys(data).length) {
      return this.validateUserById(userId);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data,
    });

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
