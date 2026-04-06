import { Injectable, Logger } from '@nestjs/common';
import { RafacallService } from './rafacall.service';

type CalendlyCollection<T> = {
  collection: T[];
  pagination?: { next_page?: string | null };
};

type CalendlyScheduledEvent = {
  uri: string;
  name: string;
  status: string;
  start_time: string;
  end_time: string;
};

type CalendlyInvitee = Record<string, unknown>;

@Injectable()
export class CalendlyAdminScheduleService {
  private readonly logger = new Logger(CalendlyAdminScheduleService.name);

  constructor(private readonly rafacallService: RafacallService) {}

  private async calendlyGet<T>(url: string): Promise<T> {
    const token = process.env.CALENDLY_API_TOKEN?.trim();
    if (!token) {
      throw new Error('CALENDLY_API_TOKEN em falta');
    }
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`Calendly API ${res.status}: ${text.slice(0, 500)}`);
      throw new Error(`Calendly API: ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  private eventUuidFromUri(uri: string): string {
    try {
      const path = new URL(uri).pathname;
      const seg = path.split('/').filter(Boolean);
      return seg[seg.length - 1] ?? '';
    } catch {
      const seg = uri.split('/').filter(Boolean);
      return seg[seg.length - 1] ?? '';
    }
  }

  private isSameCalendarDayInZone(
    isoUtc: string,
    timeZone: string,
    ref: Date,
  ): boolean {
    const eventDay = new Date(isoUtc).toLocaleDateString('en-CA', {
      timeZone,
    });
    const refDay = ref.toLocaleDateString('en-CA', { timeZone });
    return eventDay === refDay;
  }

  private waDigits(whatsapp: string): string {
    return String(whatsapp).replace(/\D/g, '');
  }

  async getTodaySchedule(timeZone = process.env.CALENDLY_ADMIN_TZ?.trim() || 'Europe/Lisbon') {
    const org = process.env.CALENDLY_ORGANIZATION_URI?.trim();
    const usr = process.env.CALENDLY_USER_URI?.trim();
    const token = process.env.CALENDLY_API_TOKEN?.trim();
    if ((!org && !usr) || !token) {
      return {
        configured: false as const,
        timeZone,
        items: [] as CalendlyTodayItemDto[],
        message:
          'Defina CALENDLY_API_TOKEN e CALENDLY_ORGANIZATION_URI ou CALENDLY_USER_URI no backend (.env).',
      };
    }

    const now = new Date();
    const minStart = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();
    const maxStart = new Date(now.getTime() + 36 * 60 * 60 * 1000).toISOString();

    const baseParams = new URLSearchParams({
      min_start_time: minStart,
      max_start_time: maxStart,
      status: 'active',
      count: '100',
    });
    if (org) baseParams.set('organization', org);
    else if (usr) baseParams.set('user', usr);

    let nextPage: string | null =
      `https://api.calendly.com/scheduled_events?${baseParams.toString()}`;
    const events: CalendlyScheduledEvent[] = [];

    try {
      while (nextPage) {
        const data = await this.calendlyGet<CalendlyCollection<CalendlyScheduledEvent>>(
          nextPage,
        );
        events.push(...(data.collection ?? []));
        nextPage = data.pagination?.next_page ?? null;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro Calendly';
      return {
        configured: true as const,
        timeZone,
        items: [] as CalendlyTodayItemDto[],
        message: msg,
      };
    }

    const todayEvents = events.filter((ev) =>
      this.isSameCalendarDayInZone(ev.start_time, timeZone, now),
    );

    todayEvents.sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    );

    const items: CalendlyTodayItemDto[] = [];

    for (const ev of todayEvents) {
      const uuid = this.eventUuidFromUri(ev.uri);
      if (!uuid) continue;

      let inviteePage: string | null =
        `https://api.calendly.com/scheduled_events/${uuid}/invitees?count=20`;
      const invitees: CalendlyInvitee[] = [];
      try {
        while (inviteePage) {
          const inv = await this.calendlyGet<CalendlyCollection<CalendlyInvitee>>(
            inviteePage,
          );
          invitees.push(...(inv.collection ?? []));
          inviteePage = inv.pagination?.next_page ?? null;
        }
      } catch {
        continue;
      }

      const activeInvitees = invitees.filter(
        (i) => String(i.status ?? 'active').toLowerCase() !== 'canceled',
      );
      const primary = activeInvitees[0] ?? invitees[0];
      const inviteeName =
        typeof primary?.name === 'string'
          ? primary.name
          : typeof primary?.first_name === 'string'
            ? `${primary.first_name} ${String(primary.last_name ?? '')}`.trim()
            : '—';
      const inviteeEmail =
        typeof primary?.email === 'string' ? primary.email : null;

      const member = primary
        ? await this.rafacallService.resolveUserForCalendlyInvitee(primary)
        : null;

      const phoneFromCalendly =
        typeof primary?.text_reminder_number === 'string'
          ? primary.text_reminder_number
          : typeof primary?.phone_number === 'string'
            ? primary.phone_number
            : null;

      const whatsappDigits = member
        ? this.waDigits(member.whatsapp)
        : phoneFromCalendly
          ? this.waDigits(phoneFromCalendly)
          : null;

      items.push({
        eventUri: ev.uri,
        eventName: ev.name,
        startTime: ev.start_time,
        endTime: ev.end_time,
        inviteeName,
        inviteeEmail,
        matchedUserId: member?.id ?? null,
        matchedUserName: member?.name ?? null,
        whatsappDigits,
        whatsappSource: member ? ('database' as const) : ('calendly' as const),
      });
    }

    return {
      configured: true as const,
      timeZone,
      items,
      message: null as string | null,
    };
  }
}

export type CalendlyTodayItemDto = {
  eventUri: string;
  eventName: string;
  startTime: string;
  endTime: string;
  inviteeName: string;
  inviteeEmail: string | null;
  matchedUserId: string | null;
  matchedUserName: string | null;
  whatsappDigits: string | null;
  whatsappSource: 'database' | 'calendly';
};
