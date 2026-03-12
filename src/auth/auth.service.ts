import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Role } from '@prisma/client';

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

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (existing) {
      throw new ConflictException('Este e-mail já está em uso.');
    }
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase().trim(),
        name: dto.name,
        whatsapp: this.normalizeWhatsapp(dto.whatsapp),
        passwordHash,
        role: Role.USER,
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
    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    return { user, token };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (!user) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
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

  async validateUserById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        whatsapp: true,
      },
    });
    return user ?? null;
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
