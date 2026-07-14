import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RafaCallBookingStatus, RafaCallCrmStatus } from '@prisma/client';
import {
  RAFA_CALL_CRM_STATUS_LABELS,
  RAFA_CALL_CRM_STATUS_ORDER,
  appendCrmComment,
  buildCrmStatusHistoryLine,
  formatCrmHistoryTimestamp,
} from './rafacall-crm.constants';

function waDigits(value: string): string {
  return value.replace(/\D/g, '');
}

@Injectable()
export class RafacallCrmService {
  constructor(private readonly prisma: PrismaService) {}

  async listCrmBoard() {
    const items = await this.prisma.rafaCallBooking.findMany({
      where: {
        status: { in: [RafaCallBookingStatus.SCHEDULED, RafaCallBookingStatus.COMPLETED] },
      },
      orderBy: { startsAt: 'desc' },
      select: {
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
        user: {
          select: {
            id: true,
            name: true,
            whatsapp: true,
          },
        },
      },
    });

    const columns = RAFA_CALL_CRM_STATUS_ORDER.map((status) => ({
      status,
      label: RAFA_CALL_CRM_STATUS_LABELS[status],
      items: items
        .filter((item) => item.crmStatus === status)
        .map((item) => this.serializeCrmItem(item)),
    }));

    return { columns };
  }

  async updateCrm(params: {
    bookingId: string;
    crmStatus?: RafaCallCrmStatus;
    comment?: string;
  }) {
    const booking = await this.prisma.rafaCallBooking.findFirst({
      where: {
        id: params.bookingId,
        status: { in: [RafaCallBookingStatus.SCHEDULED, RafaCallBookingStatus.COMPLETED] },
      },
      select: {
        id: true,
        crmStatus: true,
        crmComments: true,
        status: true,
        startsAt: true,
        endsAt: true,
        timezone: true,
        origin: true,
        guestName: true,
        guestWhatsapp: true,
        user: {
          select: {
            id: true,
            name: true,
            whatsapp: true,
          },
        },
      },
    });

    if (!booking) {
      throw new BadRequestException('Cliente não encontrado no CRM.');
    }

    const hasStatusChange =
      params.crmStatus !== undefined && params.crmStatus !== booking.crmStatus;
    const manualComment = params.comment?.trim() ?? '';

    if (!hasStatusChange && !manualComment) {
      throw new BadRequestException('Indique um novo estado ou um comentário.');
    }

    let nextComments = booking.crmComments;
    const now = new Date();

    if (hasStatusChange && params.crmStatus) {
      nextComments = appendCrmComment(
        nextComments,
        buildCrmStatusHistoryLine(params.crmStatus, now),
      );
    }

    if (manualComment) {
      nextComments = appendCrmComment(
        nextComments,
        `[${formatCrmHistoryTimestamp(now)}] ${manualComment}`,
      );
    }

    const updated = await this.prisma.rafaCallBooking.update({
      where: { id: booking.id },
      data: {
        ...(hasStatusChange && params.crmStatus ? { crmStatus: params.crmStatus } : {}),
        crmComments: nextComments,
      },
      select: {
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
        user: {
          select: {
            id: true,
            name: true,
            whatsapp: true,
          },
        },
      },
    });

    return this.serializeCrmItem(updated);
  }

  async recordStatusChange(params: {
    bookingId: string;
    crmStatus: RafaCallCrmStatus;
    at?: Date;
  }) {
    const booking = await this.prisma.rafaCallBooking.findUnique({
      where: { id: params.bookingId },
      select: { id: true, crmStatus: true, crmComments: true },
    });
    if (!booking || booking.crmStatus === params.crmStatus) return;

    const at = params.at ?? new Date();
    await this.prisma.rafaCallBooking.update({
      where: { id: booking.id },
      data: {
        crmStatus: params.crmStatus,
        crmComments: appendCrmComment(
          booking.crmComments,
          buildCrmStatusHistoryLine(params.crmStatus, at),
        ),
      },
    });
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
      whatsappDigits: waDigits(item.user?.whatsapp ?? item.guestWhatsapp ?? ''),
    };
  }
}
