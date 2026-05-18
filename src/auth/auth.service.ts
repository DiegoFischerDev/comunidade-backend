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
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { $Enums, Role, UserTier } from '@prisma/client';
import { sendEmailBase } from '../email/resend.client';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { isMembershipActive } from '../membership/membership-access.util';

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

  private getResetPasswordExpiryDate(): Date {
    const expires = new Date();
    expires.setMinutes(expires.getMinutes() + 30);
    return expires;
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

  async issueAuthTokenForUserId(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, whatsapp: true },
    });
    if (!user) return null;
    const token = this.signAuthJwt({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        whatsapp: user.whatsapp,
      },
    };
  }

  async login(dto: LoginDto) {
    const email = dto.email?.trim().toLowerCase() ?? '';
    const normalizedWhatsapp = dto.whatsapp?.replace(/\D/g, '') ?? '';

    if ((!email && !normalizedWhatsapp) || (email && normalizedWhatsapp)) {
      throw new BadRequestException(
        'Informe WhatsApp ou e-mail (apenas um) para entrar.',
      );
    }

    const invalidCredentials = email
      ? 'E-mail ou senha inválidos.'
      : 'WhatsApp ou senha inválidos.';

    const user = email
      ? await this.prisma.user.findUnique({ where: { email } })
      : await this.prisma.user.findUnique({
          where: { whatsapp: normalizedWhatsapp },
        });

    if (!user) {
      throw new UnauthorizedException(invalidCredentials);
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException(invalidCredentials);
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

  async requestPasswordReset(emailRaw: string) {
    const email = emailRaw.trim().toLowerCase();

    if (!email) {
      return { success: true };
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
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

    try {
      await sendEmailBase({
        to: email,
        subject,
        text,
        html,
      });
    } catch {
      throw new ServiceUnavailableException(
        'Não foi possível enviar o e-mail de recuperação. Tente novamente em instantes.',
      );
    }

    return { success: true };
  }

  async resetPassword(
    emailRaw: string,
    code: string,
    newPassword: string,
  ) {
    const email = emailRaw.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email },
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
      isMembershipActive(user.tier, user.membershipExpiresAt) === false &&
      user.membershipExpiresAt &&
      user.membershipExpiresAt < new Date()
    ) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          membershipExpiresAt: null,
          rafaCallSchedulingUnlocked: false,
          rafaCallSlotStartsAt: null,
          rafaCallSlotEndsAt: null,
        },
      });
      user = { ...user, membershipExpiresAt: null };
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
