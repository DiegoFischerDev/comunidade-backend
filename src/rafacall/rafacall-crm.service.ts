import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  RafaCallBookingStatus,
  RafaCallCrmStatus,
} from '@prisma/client';
import {
  RAFA_CALL_CRM_STATUS_LABELS,
  RAFA_CALL_CRM_STATUS_ORDER,
  appendCrmComment,
  buildCrmStatusHistoryLine,
} from './rafacall-crm.constants';

function waDigits(value: string): string {
  return value.replace(/\D/g, '');
}

const BOOKING_CRM_SELECT = {
  id: true,
  status: true,
  crmStatus: true,
  crmComments: true,
  startsAt: true,
  endsAt: true,
  timezone: true,
  origin: true,
  guestName: true,
  guestWhatsapp: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      name: true,
      whatsapp: true,
    },
  },
} as const;

type BookingCrmRow = {
  id: string;
  status: RafaCallBookingStatus;
  crmStatus: RafaCallCrmStatus;
  crmComments: string | null;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  origin: string;
  guestName: string | null;
  guestWhatsapp: string | null;
  updatedAt: Date;
  user: { id: string; name: string | null; whatsapp: string | null } | null;
};

@Injectable()
export class RafacallCrmService {
  constructor(private readonly prisma: PrismaService) {}

  async listCrmBoard() {
    const items = await this.prisma.rafaCallBooking.findMany({
      where: {
        status: {
          in: [RafaCallBookingStatus.SCHEDULED, RafaCallBookingStatus.COMPLETED],
        },
      },
      orderBy: { startsAt: 'desc' },
      select: BOOKING_CRM_SELECT,
    });

    const uniqueItems = this.buildUniqueCrmItems(items);

    const columns = RAFA_CALL_CRM_STATUS_ORDER.map((status) => ({
      status,
      label: RAFA_CALL_CRM_STATUS_LABELS[status],
      items: uniqueItems
        .filter((item) => item.crmStatus === status)
        .map((item) => this.serializeCrmItem(item)),
    }));

    return { columns };
  }

  async updateCrm(params: {
    bookingId: string;
    crmStatus?: RafaCallCrmStatus;
    crmComments?: string;
  }) {
    const booking = await this.prisma.rafaCallBooking.findFirst({
      where: {
        id: params.bookingId,
        status: {
          in: [RafaCallBookingStatus.SCHEDULED, RafaCallBookingStatus.COMPLETED],
        },
      },
      select: BOOKING_CRM_SELECT,
    });

    if (!booking) {
      throw new BadRequestException('Cliente não encontrado no CRM.');
    }

    const whatsapp = this.extractWhatsappDigits(booking);
    if (!whatsapp) {
      throw new BadRequestException('Cliente sem WhatsApp válido no CRM.');
    }

    const siblings = await this.findActiveBookingsByWhatsapp(whatsapp);
    const crmSource = this.pickCrmSource(siblings);
    const displayBooking = this.pickDisplayBooking(siblings);

    const hasStatusChange =
      params.crmStatus !== undefined && params.crmStatus !== crmSource.crmStatus;
    const hasCommentsUpdate = params.crmComments !== undefined;
    const normalizedComments = hasCommentsUpdate
      ? params.crmComments?.trim() || null
      : crmSource.crmComments?.trim() || null;
    const currentComments = crmSource.crmComments?.trim() || null;

    if (!hasStatusChange && !hasCommentsUpdate) {
      throw new BadRequestException('Indique um novo estado ou comentários.');
    }

    if (hasCommentsUpdate && !hasStatusChange && normalizedComments === currentComments) {
      throw new BadRequestException('Nenhuma alteração para guardar.');
    }

    let nextComments = hasCommentsUpdate ? normalizedComments : crmSource.crmComments;
    const now = new Date();
    let nextStatus = crmSource.crmStatus;

    if (hasStatusChange && params.crmStatus) {
      nextStatus = params.crmStatus;
      nextComments = appendCrmComment(
        nextComments,
        buildCrmStatusHistoryLine(params.crmStatus, now),
      );
    }

    await this.syncCrmToWhatsappGroup(whatsapp, {
      crmStatus: nextStatus,
      crmComments: nextComments,
    });

    const merged = this.mergeDisplayAndCrm(displayBooking, {
      ...crmSource,
      crmStatus: nextStatus,
      crmComments: nextComments,
    });

    return this.serializeCrmItem(merged);
  }

  async recordStatusChange(params: {
    bookingId: string;
    crmStatus: RafaCallCrmStatus;
    at?: Date;
  }) {
    const booking = await this.prisma.rafaCallBooking.findUnique({
      where: { id: params.bookingId },
      select: BOOKING_CRM_SELECT,
    });
    if (!booking) return;

    const whatsapp = this.extractWhatsappDigits(booking);
    if (!whatsapp) return;

    const siblings = await this.findActiveBookingsByWhatsapp(whatsapp);
    const crmSource = this.pickCrmSource(siblings);
    if (crmSource.crmStatus === params.crmStatus) return;

    const at = params.at ?? new Date();
    const nextComments = appendCrmComment(
      crmSource.crmComments,
      buildCrmStatusHistoryLine(params.crmStatus, at),
    );

    await this.syncCrmToWhatsappGroup(whatsapp, {
      crmStatus: params.crmStatus,
      crmComments: nextComments,
    });
  }

  /** Herda CRM de agendamentos anteriores do mesmo WhatsApp (cliente recorrente). */
  async resolveCrmFieldsForWhatsapp(whatsappDigits: string): Promise<{
    crmStatus: RafaCallCrmStatus;
    crmComments: string | null;
  }> {
    const digits = waDigits(whatsappDigits);
    if (!digits) {
      return {
        crmStatus: RafaCallCrmStatus.VIDEO_CHAMADA_AGENDADA,
        crmComments: null,
      };
    }

    const siblings = await this.findActiveBookingsByWhatsapp(digits);
    if (siblings.length === 0) {
      return {
        crmStatus: RafaCallCrmStatus.VIDEO_CHAMADA_AGENDADA,
        crmComments: null,
      };
    }

    const crmSource = this.pickCrmSource(siblings);
    return {
      crmStatus: crmSource.crmStatus,
      crmComments: crmSource.crmComments,
    };
  }

  crmFieldsFromBooking(booking: {
    crmStatus: RafaCallCrmStatus;
    crmComments: string | null;
  }) {
    return {
      crmStatus: booking.crmStatus,
      crmComments: booking.crmComments,
    };
  }

  private async findActiveBookingsByWhatsapp(
    whatsappDigits: string,
  ): Promise<BookingCrmRow[]> {
    if (!whatsappDigits) return [];

    return this.prisma.rafaCallBooking.findMany({
      where: {
        status: {
          in: [RafaCallBookingStatus.SCHEDULED, RafaCallBookingStatus.COMPLETED],
        },
        OR: [
          { guestWhatsapp: whatsappDigits },
          { user: { whatsapp: whatsappDigits } },
        ],
      },
      select: BOOKING_CRM_SELECT,
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async syncCrmToWhatsappGroup(
    whatsappDigits: string,
    data: { crmStatus: RafaCallCrmStatus; crmComments: string | null },
  ) {
    await this.prisma.rafaCallBooking.updateMany({
      where: {
        status: {
          in: [RafaCallBookingStatus.SCHEDULED, RafaCallBookingStatus.COMPLETED],
        },
        OR: [
          { guestWhatsapp: whatsappDigits },
          { user: { whatsapp: whatsappDigits } },
        ],
      },
      data: {
        crmStatus: data.crmStatus,
        crmComments: data.crmComments,
      },
    });
  }

  private buildUniqueCrmItems(items: BookingCrmRow[]): BookingCrmRow[] {
    const groups = new Map<string, BookingCrmRow[]>();

    for (const item of items) {
      const digits = this.extractWhatsappDigits(item);
      if (!digits) continue;
      const group = groups.get(digits) ?? [];
      group.push(item);
      groups.set(digits, group);
    }

    return Array.from(groups.values()).map((group) => {
      const displayBooking = this.pickDisplayBooking(group);
      const crmSource = this.pickCrmSource(group);
      return this.mergeDisplayAndCrm(displayBooking, crmSource);
    });
  }

  private pickDisplayBooking(group: BookingCrmRow[]): BookingCrmRow {
    const scheduled = group.filter(
      (item) => item.status === RafaCallBookingStatus.SCHEDULED,
    );
    const pool = scheduled.length > 0 ? scheduled : group;
    return [...pool].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
  }

  private pickCrmSource(group: BookingCrmRow[]): BookingCrmRow {
    return [...group].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  }

  private mergeDisplayAndCrm(
    displayBooking: BookingCrmRow,
    crmSource: Pick<BookingCrmRow, 'crmStatus' | 'crmComments'>,
  ): BookingCrmRow {
    return {
      ...displayBooking,
      crmStatus: crmSource.crmStatus,
      crmComments: crmSource.crmComments,
    };
  }

  private extractWhatsappDigits(item: {
    guestWhatsapp: string | null;
    user: { whatsapp: string | null } | null;
  }): string {
    return waDigits(item.user?.whatsapp ?? item.guestWhatsapp ?? '');
  }

  private serializeCrmItem(item: {
    id: string;
    status: RafaCallBookingStatus;
    crmStatus: RafaCallCrmStatus;
    crmComments: string | null;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    origin: string;
    guestName: string | null;
    guestWhatsapp: string | null;
    user: { id: string; name: string | null; whatsapp: string | null } | null;
  }) {
    const whatsappDigits = this.extractWhatsappDigits(item);
    return {
      id: item.id,
      bookingStatus: item.status,
      crmStatus: item.crmStatus,
      crmComments: item.crmComments,
      startsAt: item.startsAt.toISOString(),
      endsAt: item.endsAt.toISOString(),
      bookingTimezone: item.timezone,
      bookingOrigin: item.origin,
      userId: item.user?.id ?? null,
      userName: item.user?.name ?? item.guestName ?? null,
      whatsappDigits,
    };
  }
}
