import { Injectable } from '@nestjs/common';
import { UserTier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** E-mail sintético para Stripe/metadata quando o utilizador não tem e-mail. */
export function rafacallGuestEmailForUser(user: {
  id: string;
  email: string | null;
}): string {
  const e = user.email?.trim().toLowerCase();
  if (e) return e;
  return `rafacall-${user.id}@guest.rpm.invalid`;
}

export function parseUserIdFromRafacallGuestEmail(
  email: string | undefined | null,
): string | null {
  if (!email) return null;
    const m = String(email)
    .trim()
    .toLowerCase()
    .match(/^rafacall-(.+)@guest\.rpm\.invalid$/i);
  return m?.[1] ?? null;
}

@Injectable()
export class RafacallService {
  constructor(private readonly prisma: PrismaService) {}

  async refreshConsumptionIfNeeded(userId: string): Promise<void> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        rafaCallSchedulingUnlocked: true,
        rafaCallSlotEndsAt: true,
      },
    });
    if (
      !u?.rafaCallSchedulingUnlocked ||
      !u.rafaCallSlotEndsAt ||
      !(new Date() > new Date(u.rafaCallSlotEndsAt))
    ) {
      return;
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        rafaCallSchedulingUnlocked: false,
        rafaCallSlotStartsAt: null,
        rafaCallSlotEndsAt: null,
      },
    });
  }

  async getStatus(userId: string) {
    await this.refreshConsumptionIfNeeded(userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        tier: true,
        rafaCallSchedulingUnlocked: true,
        rafaCallSlotStartsAt: true,
        rafaCallSlotEndsAt: true,
      },
    });
    if (!user) {
      return null;
    }
    const isMember = user.tier === UserTier.MEMBER;
    return {
      isMember,
      schedulingUnlocked: user.rafaCallSchedulingUnlocked,
      slotStartsAt: user.rafaCallSlotStartsAt?.toISOString() ?? null,
      slotEndsAt: user.rafaCallSlotEndsAt?.toISOString() ?? null,
      canOpenCalEmbed:
        isMember &&
        user.rafaCallSchedulingUnlocked,
    };
  }
}
