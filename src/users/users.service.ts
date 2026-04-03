import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role, UserTier } from '@prisma/client';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserTierDto } from './dto/update-user-tier.dto';
import { UpdateUserRafacallDto } from './dto/update-user-rafacall.dto';

const adminUserSelect = {
  id: true,
  name: true,
  email: true,
  whatsapp: true,
  instagram: true,
  profileImageUrl: true,
  role: true,
  tier: true,
  membershipExpiresAt: true,
  rafaCallSchedulingUnlocked: true,
  rafaCallSlotEndsAt: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Métricas para o painel admin. Total de inscrições = soma de `MembershipPayment.amountCreditedEur`
   * (histórico à data de cada pagamento; mudar `STRIPE_AMOUNT_EUR_CENTS` no env não altera o passado).
   * `membershipPriceEurUsed` é só o preço anual EUR atual (referência na UI).
   */
  async getAdminStats() {
    const eurCentsRaw = process.env.STRIPE_AMOUNT_EUR_CENTS;
    const eurCents = eurCentsRaw ? parseInt(eurCentsRaw, 10) : 2300;
    const membershipPriceEurUsed =
      Number.isFinite(eurCents) && eurCents > 0 ? eurCents / 100 : 23;

    const [
      totalUsers,
      partners,
      visitors,
      members,
      subscriptionsCount,
      paySum,
      membershipPaymentsCount,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: Role.PARTNER } }),
      this.prisma.user.count({ where: { tier: UserTier.VISITOR } }),
      this.prisma.user.count({ where: { tier: UserTier.MEMBER } }),
      this.prisma.subscription.count(),
      this.prisma.membershipPayment.aggregate({
        _sum: { amountCreditedEur: true },
      }),
      this.prisma.membershipPayment.count(),
    ]);

    const rawSum = paySum._sum.amountCreditedEur;
    const totalMembershipRevenueEur =
      rawSum != null
        ? Math.round(Number(rawSum) * 100) / 100
        : 0;

    return {
      totalUsers,
      partners,
      visitors,
      members,
      totalMembershipRevenueEur,
      subscriptionsCount,
      membershipPaymentsCount,
      membershipPriceEurUsed,
    };
  }

  findAll() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: adminUserSelect,
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
      select: adminUserSelect,
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
      select: adminUserSelect,
    });
  }

  async updateRafacall(id: string, dto: UpdateUserRafacallDto) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Usuário não encontrado.');
    }
    const data: {
      rafaCallSchedulingUnlocked?: boolean;
      rafaCallSlotEndsAt?: Date | null;
    } = {};
    if (dto.rafaCallSchedulingUnlocked !== undefined) {
      data.rafaCallSchedulingUnlocked = dto.rafaCallSchedulingUnlocked;
    }
    if (dto.rafaCallSlotEndsAt !== undefined) {
      data.rafaCallSlotEndsAt =
        dto.rafaCallSlotEndsAt === null
          ? null
          : new Date(dto.rafaCallSlotEndsAt);
    }
    if (Object.keys(data).length === 0) {
      return this.prisma.user.findUniqueOrThrow({
        where: { id },
        select: adminUserSelect,
      });
    }
    return this.prisma.user.update({
      where: { id },
      data,
      select: adminUserSelect,
    });
  }

  async updateRole(id: string, role: Role) {
    return this.prisma.user.update({
      where: { id },
      data: { role },
      select: adminUserSelect,
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

