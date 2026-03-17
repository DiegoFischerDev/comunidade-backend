import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role, UserTier } from '@prisma/client';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserTierDto } from './dto/update-user-tier.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        whatsapp: true,
        instagram: true,
        profileImageUrl: true,
        role: true,
        tier: true,
        membershipExpiresAt: true,
        createdAt: true,
      },
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Usuário não encontrado.');
    }
    if (dto.email !== undefined) {
      const normalized = dto.email.toLowerCase().trim();
      const other = await this.prisma.user.findFirst({
        where: {
          email: normalized,
          id: { not: id },
        },
      });
      if (other) {
        throw new ConflictException('Este e-mail já está em uso por outro usuário.');
      }
    }
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.email !== undefined && {
          email: dto.email.toLowerCase().trim(),
        }),
        ...(dto.whatsapp !== undefined && { whatsapp: dto.whatsapp }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        whatsapp: true,
        instagram: true,
        profileImageUrl: true,
        role: true,
        tier: true,
        membershipExpiresAt: true,
        createdAt: true,
      },
    });
  }

  async updateTier(id: string, dto: UpdateUserTierDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
    return this.prisma.user.update({
      where: { id },
      data: {
        tier: dto.tier as UserTier,
        membershipExpiresAt:
          dto.tier === 'MEMBER' ? oneYearFromNow : null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        whatsapp: true,
        instagram: true,
        profileImageUrl: true,
        role: true,
        tier: true,
        membershipExpiresAt: true,
        createdAt: true,
      },
    });
  }

  async updateRole(id: string, role: Role) {
    return this.prisma.user.update({
      where: { id },
      data: { role },
      select: {
        id: true,
        name: true,
        email: true,
        whatsapp: true,
        instagram: true,
        profileImageUrl: true,
        role: true,
        tier: true,
        membershipExpiresAt: true,
        createdAt: true,
      },
    });
  }

  async remove(id: string) {
    try {
      await this.prisma.user.delete({
        where: { id },
      });
    } catch (error) {
      throw new NotFoundException('Usuário não encontrado.');
    }
  }
}

