import { Injectable, Logger } from '@nestjs/common';
import { UserTier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** E-mail sintético para Cal.com quando o utilizador não tem e-mail (match no webhook). */
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
  private readonly logger = new Logger(RafacallService.name);

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
        email: true,
        name: true,
        rafaCallSchedulingUnlocked: true,
        rafaCallSlotEndsAt: true,
      },
    });
    if (!user) {
      return null;
    }
    const isMember = user.tier === UserTier.MEMBER;
    const guestEmail = rafacallGuestEmailForUser({
      id: userId,
      email: user.email,
    });
    return {
      isMember,
      schedulingUnlocked: user.rafaCallSchedulingUnlocked,
      slotEndsAt: user.rafaCallSlotEndsAt?.toISOString() ?? null,
      canOpenCalEmbed:
        isMember &&
        user.rafaCallSchedulingUnlocked,
      calGuestEmail: guestEmail,
      calGuestName: user.name?.trim() || 'Membro',
    };
  }

  private async findUserIdByAttendeeEmail(
    attendeeEmail: string | undefined,
  ): Promise<string | null> {
    if (!attendeeEmail) return null;
    const normalized = attendeeEmail.trim().toLowerCase();
    const fromSynthetic = parseUserIdFromRafacallGuestEmail(normalized);
    if (fromSynthetic) {
      const u = await this.prisma.user.findUnique({
        where: { id: fromSynthetic },
        select: { id: true },
      });
      return u?.id ?? null;
    }
    const u = await this.prisma.user.findFirst({
      where: { email: normalized },
      select: { id: true },
    });
    return u?.id ?? null;
  }

  async handleCalWebhookPayload(body: unknown): Promise<void> {
    const root = body as Record<string, unknown>;
    const triggerEvent = String(root.triggerEvent ?? root.type ?? '');
    const payload = (root.payload ?? root) as Record<string, unknown>;

    const attendees = payload.attendees as
      | { email?: string }[]
      | undefined;
    const attendeeEmail = attendees?.[0]?.email;

    const startRaw =
      (payload.startTime as string) ||
      (payload.start as string) ||
      (payload.start_time as string);
    const endRaw =
      (payload.endTime as string) ||
      (payload.end as string) ||
      (payload.end_time as string);

    const userId = await this.findUserIdByAttendeeEmail(attendeeEmail);
    if (!userId) {
      this.logger.warn(
        `Cal.com webhook: utilizador não encontrado para e-mail ${attendeeEmail}`,
      );
      return;
    }

    const te = triggerEvent.toUpperCase();
    if (te.includes('CANCELLED') || te === 'BOOKING_CANCELLED') {
      await this.prisma.user.update({
        where: { id: userId },
        data: { rafaCallSlotEndsAt: null },
      });
      this.logger.log(`Cal.com: marcação cancelada, user ${userId}`);
      return;
    }

    if (
      te.includes('CREATED') ||
      te.includes('RESCHEDULED') ||
      te === 'BOOKING_CREATED' ||
      te === 'BOOKING_RESCHEDULED'
    ) {
      if (endRaw) {
        const end = new Date(endRaw);
        if (!Number.isNaN(end.getTime())) {
          await this.prisma.user.update({
            where: { id: userId },
            data: { rafaCallSlotEndsAt: end },
          });
          this.logger.log(
            `Cal.com: slot atualizado user ${userId} até ${end.toISOString()}`,
          );
          return;
        }
      }
      if (startRaw) {
        const start = new Date(startRaw);
        if (!Number.isNaN(start.getTime())) {
          const end = new Date(start.getTime() + 30 * 60 * 1000);
          await this.prisma.user.update({
            where: { id: userId },
            data: { rafaCallSlotEndsAt: end },
          });
        }
      }
    }
  }
}
