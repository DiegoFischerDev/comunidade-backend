import { Injectable, Logger } from '@nestjs/common';
import { UserTier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** E-mail sintético para Stripe/metadata quando o utilizador não tem e-mail (webhook Calendly usa telefone). */
export function rafacallGuestEmailForUser(user: {
  id: string;
  email: string | null;
}): string {
  const e = user.email?.trim().toLowerCase();
  if (e) return e;
  return `rafacall-${user.id}@guest.rpm.invalid`;
}

/** WhatsApp da BD → formato E.164 para prefill no Calendly (+351…). */
function formatWhatsappForCalendlyPrefill(whatsapp: string): string {
  const w = whatsapp.trim();
  if (!w) return '';
  const digits = w.replace(/\D/g, '');
  if (!digits) return '';
  if (w.startsWith('+')) return `+${digits}`;
  return `+${digits}`;
}

function normalizePhoneDigits(input: string | undefined | null): string {
  if (!input) return '';
  return String(input).replace(/\D/g, '');
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
        whatsapp: true,
        rafaCallSchedulingUnlocked: true,
        rafaCallSlotEndsAt: true,
      },
    });
    if (!user) {
      return null;
    }
    const isMember = user.tier === UserTier.MEMBER;
    const emailTrim = user.email?.trim() || null;
    return {
      isMember,
      schedulingUnlocked: user.rafaCallSchedulingUnlocked,
      slotEndsAt: user.rafaCallSlotEndsAt?.toISOString() ?? null,
      canOpenCalEmbed:
        isMember &&
        user.rafaCallSchedulingUnlocked,
      /** Só e-mail “real” para o Calendly; se null, o campo fica vazio no popup. */
      calPrefillEmail: emailTrim,
      calPrefillPhone: formatWhatsappForCalendlyPrefill(user.whatsapp),
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

  private async findUserIdByPhoneDigits(digits: string): Promise<string | null> {
    if (!digits) return null;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "User"
      WHERE regexp_replace(whatsapp, '[^0-9]', '', 'g') = ${digits}
      LIMIT 1
    `;
    return rows[0]?.id ?? null;
  }

  private extractInviteePhone(
    invitee: Record<string, unknown> | undefined,
  ): string | undefined {
    if (!invitee) return undefined;
    const tr = invitee.text_reminder_number;
    if (typeof tr === 'string' && tr.trim()) return tr.trim();
    const pn = invitee.phone_number;
    if (typeof pn === 'string' && pn.trim()) return pn.trim();
    const qa = invitee.questions_and_answers as
      | { question?: string; answer?: string }[]
      | undefined;
    if (Array.isArray(qa)) {
      for (const item of qa) {
        const q = String(item?.question ?? '').toLowerCase();
        if (
          q.includes('phone') ||
          q.includes('telefone') ||
          q.includes('telemóvel') ||
          q.includes('mobile')
        ) {
          const a = item?.answer?.trim();
          if (a) return a;
        }
      }
    }
    return undefined;
  }

  private async findUserIdByInvitee(
    inviteeEmail: string | undefined,
    inviteePhone: string | undefined,
  ): Promise<string | null> {
    const byEmail = await this.findUserIdByAttendeeEmail(inviteeEmail);
    if (byEmail) return byEmail;
    const digits = normalizePhoneDigits(inviteePhone);
    if (digits) {
      return this.findUserIdByPhoneDigits(digits);
    }
    return null;
  }

  async handleCalendlyWebhookPayload(body: unknown): Promise<void> {
    const root = body as Record<string, unknown>;
    const event = String(root.event ?? root.type ?? root.triggerEvent ?? '').toLowerCase();
    const payload = (root.payload ?? root) as Record<string, unknown>;

    // Calendly (v2 webhooks) costuma vir como payload.invitee / payload.event
    const invitee = (payload.invitee ?? payload.invitees ?? payload['invitee']) as
      | Record<string, unknown>
      | undefined;
    const inviteeEmail =
      (invitee?.email as string | undefined) ||
      (payload.email as string | undefined);
    const inviteePhone = this.extractInviteePhone(invitee);

    const eventObj = (payload.event ?? payload['scheduled_event']) as
      | Record<string, unknown>
      | undefined;
    const startRaw =
      (eventObj?.start_time as string | undefined) ||
      (eventObj?.startTime as string | undefined) ||
      (payload.start_time as string | undefined) ||
      (payload.startTime as string | undefined);
    const endRaw =
      (eventObj?.end_time as string | undefined) ||
      (eventObj?.endTime as string | undefined) ||
      (payload.end_time as string | undefined) ||
      (payload.endTime as string | undefined);

    const userId = await this.findUserIdByInvitee(inviteeEmail, inviteePhone);
    if (!userId) {
      this.logger.warn(
        `Calendly webhook: utilizador não encontrado (email=${inviteeEmail ?? '—'}, phone=${inviteePhone ?? '—'})`,
      );
      return;
    }

    // Cancelamento
    if (event.includes('canceled') || event.includes('cancelled')) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { rafaCallSlotEndsAt: null },
      });
      this.logger.log(`Calendly: marcação cancelada, user ${userId}`);
      return;
    }

    // Criação / reagendamento
    if (event.includes('created') || event.includes('rescheduled')) {
      if (endRaw) {
        const end = new Date(endRaw);
        if (!Number.isNaN(end.getTime())) {
          await this.prisma.user.update({
            where: { id: userId },
            data: { rafaCallSlotEndsAt: end },
          });
          this.logger.log(
            `Calendly: slot atualizado user ${userId} até ${end.toISOString()}`,
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
