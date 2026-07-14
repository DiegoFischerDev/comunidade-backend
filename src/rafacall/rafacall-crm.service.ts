import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  RafaCallBookingOrigin,
  RafaCallBookingStatus,
  RafaCallCrmStatus,
} from '@prisma/client';
import {
  RAFA_CALL_CRM_STATUS_LABELS,
  RAFA_CALL_CRM_STATUS_ORDER,
  appendCrmComment,
  buildCrmStatusHistoryLine,
  formatCrmImmigrationDateKey,
  formatCrmImmigrationForApi,
  parseCrmImmigrationInput,
  resolveStatusAfterImmigrationUpdate,
  sortCrmItemsByImmigrationDate,
} from './rafacall-crm.constants';

function waDigits(value: string): string {
  return value.replace(/\D/g, '');
}

const BOOKING_CRM_SELECT = {
  id: true,
  status: true,
  crmStatus: true,
  crmComments: true,
  crmExpectedImmigrationAt: true,
  crmImmigrationImmediate: true,
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
  crmExpectedImmigrationAt: Date | null;
  crmImmigrationImmediate: boolean;
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
    await this.syncImmigrationProximityStatuses();

    const items = await this.prisma.rafaCallBooking.findMany({
      where: this.visibleCrmBookingWhere(),
      orderBy: { startsAt: 'desc' },
      select: BOOKING_CRM_SELECT,
    });

    const uniqueItems = this.buildUniqueCrmItems(items);

    const columns = RAFA_CALL_CRM_STATUS_ORDER.map((status) => ({
      status,
      label: RAFA_CALL_CRM_STATUS_LABELS[status],
      items: sortCrmItemsByImmigrationDate(
        uniqueItems.filter((item) => item.crmStatus === status),
      ).map((item) => this.serializeCrmItem(item)),
    }));

    return { columns };
  }

  /** Alinha colunas de imigração com a data prevista (90 dias, imediato, sem data). */
  async syncImmigrationProximityStatuses(): Promise<{ promoted: number }> {
    const items = await this.prisma.rafaCallBooking.findMany({
      where: this.visibleCrmBookingWhere(),
      select: BOOKING_CRM_SELECT,
    });

    const uniqueItems = this.buildUniqueCrmItems(items);
    const now = new Date();
    let promoted = 0;

    for (const item of uniqueItems) {
      const expectedStatus = resolveStatusAfterImmigrationUpdate({
        currentStatus: item.crmStatus,
        expectedImmigrationAt: item.crmExpectedImmigrationAt,
        immigrationImmediate: item.crmImmigrationImmediate,
        at: now,
      });
      if (expectedStatus === item.crmStatus) continue;

      await this.recordStatusChange({
        bookingId: item.id,
        crmStatus: expectedStatus,
        at: now,
      });
      promoted += 1;
    }

    return { promoted };
  }

  async createCrmClient(params: {
    name: string;
    whatsapp: string;
    crmExpectedImmigrationAt?: string | null;
  }) {
    const name = params.name.trim();
    if (!name || name.length < 2) {
      throw new BadRequestException('Indica o nome do cliente.');
    }

    const whatsapp = waDigits(params.whatsapp);
    if (whatsapp.length < 8) {
      throw new BadRequestException(
        'WhatsApp inválido. Inclui o indicativo do país (ex.: 351…).',
      );
    }

    let immigrationDate: Date | null = null;
    let immigrationImmediate = false;
    if (params.crmExpectedImmigrationAt !== undefined) {
      try {
        const parsed = parseCrmImmigrationInput(params.crmExpectedImmigrationAt);
        immigrationDate = parsed.date;
        immigrationImmediate = parsed.immediate;
      } catch {
        throw new BadRequestException('Data prevista para imigração inválida.');
      }
    }

    const visibleSiblings = await this.findActiveBookingsByWhatsapp(whatsapp);
    if (visibleSiblings.length > 0) {
      throw new BadRequestException('Este cliente já está no CRM.');
    }

    const now = new Date();
    const initialStatus = resolveStatusAfterImmigrationUpdate({
      currentStatus: RafaCallCrmStatus.ENVIOU_MENSAGEM,
      expectedImmigrationAt: immigrationDate,
      immigrationImmediate,
      at: now,
    });
    const initialComments = appendCrmComment(
      null,
      buildCrmStatusHistoryLine(initialStatus, {
        at: now,
        expectedImmigrationAt: immigrationDate,
        immigrationImmediate,
      }),
    );

    const excludedBooking = await this.prisma.rafaCallBooking.findFirst({
      where: {
        status: {
          in: [RafaCallBookingStatus.SCHEDULED, RafaCallBookingStatus.COMPLETED],
        },
        crmExcludedAt: { not: null },
        OR: [{ guestWhatsapp: whatsapp }, { user: { whatsapp } }],
      },
      select: BOOKING_CRM_SELECT,
      orderBy: { updatedAt: 'desc' },
    });

    if (excludedBooking) {
      const restored = await this.prisma.rafaCallBooking.update({
        where: { id: excludedBooking.id },
        data: {
          crmExcludedAt: null,
          ...(excludedBooking.user ? {} : { guestName: name }),
          crmStatus: initialStatus,
          crmComments: initialComments,
          crmExpectedImmigrationAt: immigrationDate,
          crmImmigrationImmediate: immigrationImmediate,
        },
        select: BOOKING_CRM_SELECT,
      });

      return this.serializeCrmItem(restored);
    }

    const startsAt = new Date(now.getTime() - 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 40 * 60 * 1000);
    const timezone = 'Europe/Lisbon';

    const created = await this.prisma.rafaCallBooking.create({
      data: {
        userId: null,
        guestName: name,
        guestWhatsapp: whatsapp,
        clientDeviceId: null,
        status: RafaCallBookingStatus.COMPLETED,
        origin: RafaCallBookingOrigin.PUBLIC_FREE,
        startsAt,
        endsAt,
        timezone,
        crmStatus: initialStatus,
        crmComments: initialComments,
        crmExpectedImmigrationAt: immigrationDate,
        crmImmigrationImmediate: immigrationImmediate,
        crmExcludedAt: null,
      },
      select: BOOKING_CRM_SELECT,
    });

    return this.serializeCrmItem(created);
  }

  async updateCrm(params: {
    bookingId: string;
    crmStatus?: RafaCallCrmStatus;
    crmComments?: string;
    crmExpectedImmigrationAt?: string | null;
  }) {
    const booking = await this.prisma.rafaCallBooking.findFirst({
      where: {
        id: params.bookingId,
        ...this.visibleCrmBookingWhere(),
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
    const hasImmigrationDateUpdate = params.crmExpectedImmigrationAt !== undefined;

    const normalizedComments = hasCommentsUpdate
      ? params.crmComments?.trim() || null
      : crmSource.crmComments?.trim() || null;
    const currentComments = crmSource.crmComments?.trim() || null;

    let nextImmigrationDate = crmSource.crmExpectedImmigrationAt;
    let nextImmigrationImmediate = crmSource.crmImmigrationImmediate;
    if (hasImmigrationDateUpdate) {
      try {
        const parsed = parseCrmImmigrationInput(params.crmExpectedImmigrationAt);
        nextImmigrationDate = parsed.date;
        nextImmigrationImmediate = parsed.immediate;
      } catch {
        throw new BadRequestException('Data prevista para imigração inválida.');
      }
    }
    const currentImmigrationApi = formatCrmImmigrationForApi(
      crmSource.crmExpectedImmigrationAt,
      crmSource.crmImmigrationImmediate,
    );
    const nextImmigrationApi = formatCrmImmigrationForApi(
      nextImmigrationDate,
      nextImmigrationImmediate,
    );
    const immigrationChanged =
      hasImmigrationDateUpdate && nextImmigrationApi !== currentImmigrationApi;

    if (!hasStatusChange && !hasCommentsUpdate && !hasImmigrationDateUpdate) {
      throw new BadRequestException('Indique um novo estado, comentários ou data.');
    }

    if (
      !hasStatusChange &&
      hasCommentsUpdate &&
      !hasImmigrationDateUpdate &&
      normalizedComments === currentComments
    ) {
      throw new BadRequestException('Nenhuma alteração para guardar.');
    }

    if (
      !hasStatusChange &&
      !hasCommentsUpdate &&
      hasImmigrationDateUpdate &&
      !immigrationChanged
    ) {
      throw new BadRequestException('Nenhuma alteração para guardar.');
    }

    if (
      !hasStatusChange &&
      hasCommentsUpdate &&
      hasImmigrationDateUpdate &&
      normalizedComments === currentComments &&
      !immigrationChanged
    ) {
      throw new BadRequestException('Nenhuma alteração para guardar.');
    }

    let nextComments = hasCommentsUpdate ? normalizedComments : crmSource.crmComments;
    const now = new Date();
    let nextStatus = crmSource.crmStatus;

    if (hasStatusChange && params.crmStatus) {
      nextStatus = params.crmStatus;
      nextComments = appendCrmComment(
        nextComments,
        buildCrmStatusHistoryLine(params.crmStatus, {
          at: now,
          bookingStartsAt: displayBooking.startsAt,
          bookingTimezone: displayBooking.timezone,
          expectedImmigrationAt: nextImmigrationDate,
          immigrationImmediate: nextImmigrationImmediate,
        }),
      );
    } else if (immigrationChanged) {
      const autoStatus = resolveStatusAfterImmigrationUpdate({
        currentStatus: crmSource.crmStatus,
        expectedImmigrationAt: nextImmigrationDate,
        immigrationImmediate: nextImmigrationImmediate,
        at: now,
      });
      if (autoStatus !== crmSource.crmStatus) {
        nextStatus = autoStatus;
        nextComments = appendCrmComment(
          nextComments,
          buildCrmStatusHistoryLine(autoStatus, {
            at: now,
            bookingStartsAt: displayBooking.startsAt,
            bookingTimezone: displayBooking.timezone,
            expectedImmigrationAt: nextImmigrationDate,
            immigrationImmediate: nextImmigrationImmediate,
          }),
        );
      }
    }

    await this.syncCrmToWhatsappGroup(whatsapp, {
      crmStatus: nextStatus,
      crmComments: nextComments,
      crmExpectedImmigrationAt: nextImmigrationDate,
      crmImmigrationImmediate: nextImmigrationImmediate,
    });

    const merged = this.mergeDisplayAndCrm(displayBooking, {
      ...crmSource,
      crmStatus: nextStatus,
      crmComments: nextComments,
      crmExpectedImmigrationAt: nextImmigrationDate,
      crmImmigrationImmediate: nextImmigrationImmediate,
    });

    return this.serializeCrmItem(merged);
  }

  async removeFromCrm(params: { bookingId: string }) {
    const booking = await this.prisma.rafaCallBooking.findFirst({
      where: {
        id: params.bookingId,
        ...this.visibleCrmBookingWhere(),
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

    const excludedAt = new Date();
    await this.prisma.rafaCallBooking.updateMany({
      where: {
        status: {
          in: [RafaCallBookingStatus.SCHEDULED, RafaCallBookingStatus.COMPLETED],
        },
        OR: [
          { guestWhatsapp: whatsapp },
          { user: { whatsapp } },
        ],
      },
      data: { crmExcludedAt: excludedAt },
    });

    return { ok: true as const };
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

    const displayBooking = this.pickDisplayBooking(siblings);
    const at = params.at ?? new Date();
    const nextComments = appendCrmComment(
      crmSource.crmComments,
      buildCrmStatusHistoryLine(params.crmStatus, {
        at,
        bookingStartsAt: displayBooking.startsAt,
        bookingTimezone: displayBooking.timezone,
        expectedImmigrationAt: crmSource.crmExpectedImmigrationAt,
        immigrationImmediate: crmSource.crmImmigrationImmediate,
      }),
    );

    await this.syncCrmToWhatsappGroup(whatsapp, {
      crmStatus: params.crmStatus,
      crmComments: nextComments,
      crmExpectedImmigrationAt: crmSource.crmExpectedImmigrationAt,
      crmImmigrationImmediate: crmSource.crmImmigrationImmediate,
    });
  }

  /** Herda CRM de agendamentos anteriores do mesmo WhatsApp (cliente recorrente). */
  async resolveCrmFieldsForWhatsapp(whatsappDigits: string): Promise<{
    crmStatus: RafaCallCrmStatus;
    crmComments: string | null;
    crmExpectedImmigrationAt: Date | null;
    crmImmigrationImmediate: boolean;
  }> {
    const digits = waDigits(whatsappDigits);
    if (!digits) {
      return {
        crmStatus: RafaCallCrmStatus.VIDEO_CHAMADA_AGENDADA,
        crmComments: null,
        crmExpectedImmigrationAt: null,
        crmImmigrationImmediate: false,
      };
    }

    const siblings = await this.findBookingsByWhatsappForInherit(digits);
    if (siblings.length === 0) {
      return {
        crmStatus: RafaCallCrmStatus.VIDEO_CHAMADA_AGENDADA,
        crmComments: null,
        crmExpectedImmigrationAt: null,
        crmImmigrationImmediate: false,
      };
    }

    const crmSource = this.pickCrmSource(siblings);
    return {
      crmStatus: this.normalizeInheritedCrmStatusOnSchedule(crmSource.crmStatus),
      crmComments: crmSource.crmComments,
      crmExpectedImmigrationAt: crmSource.crmExpectedImmigrationAt,
      crmImmigrationImmediate: crmSource.crmImmigrationImmediate,
    };
  }

  /** Ao agendar, o CRM deve refletir «Vídeo chamada agendada» — nunca herdar «Realizou». */
  async onScheduledBookingCreated(bookingId: string) {
    const booking = await this.prisma.rafaCallBooking.findUnique({
      where: { id: bookingId },
      select: BOOKING_CRM_SELECT,
    });
    if (!booking) return;

    const whatsapp = this.extractWhatsappDigits(booking);
    if (!whatsapp) return;

    const siblings = await this.findActiveBookingsByWhatsapp(whatsapp);
    const crmSource = this.pickCrmSource(siblings);

    const shouldPromoteToVideo: RafaCallCrmStatus[] = [
      RafaCallCrmStatus.ENVIOU_MENSAGEM,
      RafaCallCrmStatus.IMIGRACAO_LONGE,
      RafaCallCrmStatus.IMIGRACAO_PERTO,
      RafaCallCrmStatus.REALIZOU_VIDEO_CHAMADA,
    ];

    if (!shouldPromoteToVideo.includes(crmSource.crmStatus)) return;

    await this.recordStatusChange({
      bookingId,
      crmStatus: RafaCallCrmStatus.VIDEO_CHAMADA_AGENDADA,
    });
  }

  /**
   * Ao apagar um registo COMPLETED da agenda, mantém o lead no CRM se este booking
   * for o único visível para o WhatsApp.
   */
  async ensureCrmLeadAfterBookingRemoval(bookingId: string) {
    const booking = await this.prisma.rafaCallBooking.findUnique({
      where: { id: bookingId },
      select: {
        ...BOOKING_CRM_SELECT,
        userId: true,
        crmExcludedAt: true,
      },
    });
    if (!booking || booking.crmExcludedAt) return;

    const whatsapp = this.extractWhatsappDigits(booking);
    if (!whatsapp) return;

    const siblings = await this.findActiveBookingsByWhatsapp(whatsapp);
    const hasOtherVisibleBooking = siblings.some((s) => s.id !== bookingId);
    if (hasOtherVisibleBooking) return;

    const now = new Date();
    const startsAt = new Date(now.getTime() - 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 40 * 60 * 1000);

    await this.prisma.rafaCallBooking.create({
      data: {
        userId: booking.userId,
        guestName: booking.guestName,
        guestWhatsapp: booking.guestWhatsapp,
        clientDeviceId: null,
        status: RafaCallBookingStatus.COMPLETED,
        origin: booking.origin as RafaCallBookingOrigin,
        startsAt,
        endsAt,
        timezone: 'Europe/Lisbon',
        crmStatus: booking.crmStatus,
        crmComments: booking.crmComments,
        crmExpectedImmigrationAt: booking.crmExpectedImmigrationAt,
        crmImmigrationImmediate: booking.crmImmigrationImmediate,
        crmExcludedAt: null,
      },
    });
  }

  /**
   * Ao cancelar um agendamento SCHEDULED, o lead permanece no CRM em «Sem data para imigar».
   * Devolve se o booking pode ser apagado ou se foi convertido em placeholder COMPLETED.
   */
  async handleScheduledBookingCanceled(
    bookingId: string,
  ): Promise<'delete' | 'retain_as_placeholder'> {
    const booking = await this.prisma.rafaCallBooking.findUnique({
      where: { id: bookingId },
      select: BOOKING_CRM_SELECT,
    });
    if (!booking || booking.status !== RafaCallBookingStatus.SCHEDULED) {
      return 'delete';
    }

    const whatsapp = this.extractWhatsappDigits(booking);
    if (!whatsapp) {
      return 'delete';
    }

    const siblings = await this.findActiveBookingsByWhatsapp(whatsapp);
    const hasOtherVisibleBooking = siblings.some((s) => s.id !== bookingId);

    await this.recordStatusChange({
      bookingId,
      crmStatus: RafaCallCrmStatus.ENVIOU_MENSAGEM,
    });

    if (hasOtherVisibleBooking) {
      return 'delete';
    }

    await this.convertScheduledBookingToCrmPlaceholder(bookingId);
    return 'retain_as_placeholder';
  }

  private async convertScheduledBookingToCrmPlaceholder(bookingId: string) {
    const now = new Date();
    const startsAt = new Date(now.getTime() - 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 40 * 60 * 1000);

    await this.prisma.rafaCallBooking.update({
      where: { id: bookingId },
      data: {
        status: RafaCallBookingStatus.COMPLETED,
        startsAt,
        endsAt,
        timezone: 'Europe/Lisbon',
      },
    });
  }

  private normalizeInheritedCrmStatusOnSchedule(
    status: RafaCallCrmStatus,
  ): RafaCallCrmStatus {
    if (status === RafaCallCrmStatus.REALIZOU_VIDEO_CHAMADA) {
      return RafaCallCrmStatus.VIDEO_CHAMADA_AGENDADA;
    }
    return status;
  }

  crmFieldsFromBooking(booking: {
    crmStatus: RafaCallCrmStatus;
    crmComments: string | null;
    crmExpectedImmigrationAt: Date | null;
    crmImmigrationImmediate: boolean;
  }) {
    return {
      crmStatus: booking.crmStatus,
      crmComments: booking.crmComments,
      crmExpectedImmigrationAt: booking.crmExpectedImmigrationAt,
      crmImmigrationImmediate: booking.crmImmigrationImmediate,
    };
  }

  private visibleCrmBookingWhere() {
    return {
      status: {
        in: [RafaCallBookingStatus.SCHEDULED, RafaCallBookingStatus.COMPLETED],
      },
      crmExcludedAt: null,
    };
  }

  private async findActiveBookingsByWhatsapp(
    whatsappDigits: string,
  ): Promise<BookingCrmRow[]> {
    if (!whatsappDigits) return [];

    return this.prisma.rafaCallBooking.findMany({
      where: {
        ...this.visibleCrmBookingWhere(),
        OR: [
          { guestWhatsapp: whatsappDigits },
          { user: { whatsapp: whatsappDigits } },
        ],
      },
      select: BOOKING_CRM_SELECT,
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async findBookingsByWhatsappForInherit(
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
    data: {
      crmStatus: RafaCallCrmStatus;
      crmComments: string | null;
      crmExpectedImmigrationAt: Date | null;
      crmImmigrationImmediate: boolean;
    },
  ) {
    await this.prisma.rafaCallBooking.updateMany({
      where: {
        ...this.visibleCrmBookingWhere(),
        OR: [
          { guestWhatsapp: whatsappDigits },
          { user: { whatsapp: whatsappDigits } },
        ],
      },
      data: {
        crmStatus: data.crmStatus,
        crmComments: data.crmComments,
        crmExpectedImmigrationAt: data.crmExpectedImmigrationAt,
        crmImmigrationImmediate: data.crmImmigrationImmediate,
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
    crmSource: Pick<
      BookingCrmRow,
      | 'crmStatus'
      | 'crmComments'
      | 'crmExpectedImmigrationAt'
      | 'crmImmigrationImmediate'
    >,
  ): BookingCrmRow {
    return {
      ...displayBooking,
      crmStatus: crmSource.crmStatus,
      crmComments: crmSource.crmComments,
      crmExpectedImmigrationAt: crmSource.crmExpectedImmigrationAt,
      crmImmigrationImmediate: crmSource.crmImmigrationImmediate,
    };
  }

  private extractWhatsappDigits(item: {
    guestWhatsapp: string | null;
    user: { whatsapp: string | null } | null;
  }): string {
    return waDigits(item.user?.whatsapp ?? item.guestWhatsapp ?? '');
  }

  /** Placeholders COMPLETED (lead manual ou pós-cancelamento) não representam chamada real. */
  private hasDisplayableVideoCall(item: {
    status: RafaCallBookingStatus;
    crmStatus: RafaCallCrmStatus;
  }): boolean {
    if (item.status === RafaCallBookingStatus.SCHEDULED) return true;
    if (item.status === RafaCallBookingStatus.CANCELLED) return true;

    const postCallStatuses: RafaCallCrmStatus[] = [
      RafaCallCrmStatus.REALIZOU_VIDEO_CHAMADA,
      RafaCallCrmStatus.AGUARDANDO_ASSINATURA,
      RafaCallCrmStatus.CONTRATO_ASSINADO,
    ];

    return (
      item.status === RafaCallBookingStatus.COMPLETED &&
      postCallStatuses.includes(item.crmStatus)
    );
  }

  private serializeCrmItem(item: {
    id: string;
    status: RafaCallBookingStatus;
    crmStatus: RafaCallCrmStatus;
    crmComments: string | null;
    crmExpectedImmigrationAt: Date | null;
    crmImmigrationImmediate: boolean;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    origin: string;
    guestName: string | null;
    guestWhatsapp: string | null;
    user: { id: string; name: string | null; whatsapp: string | null } | null;
  }) {
    const whatsappDigits = this.extractWhatsappDigits(item);
    const hasVideoCall = this.hasDisplayableVideoCall(item);
    return {
      id: item.id,
      bookingStatus: item.status,
      hasVideoCall,
      crmStatus: item.crmStatus,
      crmComments: item.crmComments,
      crmExpectedImmigrationAt: formatCrmImmigrationForApi(
        item.crmExpectedImmigrationAt,
        item.crmImmigrationImmediate,
      ),
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
