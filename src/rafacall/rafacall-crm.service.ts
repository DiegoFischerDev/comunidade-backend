import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  FinanceEntryKind,
  Prisma,
  RafaCallBookingOrigin,
  RafaCallBookingStatus,
  RafaCallCrmPropertyTypology,
  RafaCallCrmStatus,
} from '@prisma/client';
import {
  RAFA_CALL_CRM_STATUS_LABELS,
  RAFA_CALL_CRM_STATUS_ORDER,
  CRM_PAYMENT_DEFAULT_TITLE,
  buildCrmPlaceholderSlotTimes,
  formatCrmImmigrationDateKey,
  formatCrmImmigrationForApi,
  isCrmLeadPlaceholderBooking,
  parseCrmImmigrationDateInput,
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
  crmPropertyTypology: true,
  crmPreferredCity: true,
  crmHasPet: true,
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
  crmPropertyTypology: RafaCallCrmPropertyTypology | null;
  crmPreferredCity: string | null;
  crmHasPet: boolean | null;
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
    const paymentsByWhatsapp = await this.loadPaymentsByWhatsapp(
      uniqueItems.map((item) => this.extractWhatsappDigits(item)),
    );

    const columns = RAFA_CALL_CRM_STATUS_ORDER.map((status) => ({
      status,
      label: RAFA_CALL_CRM_STATUS_LABELS[status],
      items: sortCrmItemsByImmigrationDate(
        uniqueItems.filter((item) => item.crmStatus === status),
      ).map((item) =>
        this.serializeCrmItem(
          item,
          paymentsByWhatsapp.get(this.extractWhatsappDigits(item)) ?? [],
        ),
      ),
    }));

    return { columns };
  }

  async lookupCrmClientByWhatsapp(whatsapp: string): Promise<{
    inCrm: boolean;
    name: string | null;
  }> {
    const digits = waDigits(whatsapp);
    if (digits.length < 8) {
      return { inCrm: false, name: null };
    }

    const siblings = await this.findActiveBookingsByWhatsapp(digits);
    if (siblings.length === 0) {
      return { inCrm: false, name: null };
    }

    const [item] = this.buildUniqueCrmItems(siblings);
    if (!item) {
      return { inCrm: false, name: null };
    }

    const name = item.user?.name?.trim() || item.guestName?.trim() || null;
    return { inCrm: true, name };
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
    crmPropertyTypology?: RafaCallCrmPropertyTypology | null;
    crmPreferredCity?: string | null;
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

    const preferredCity = params.crmPreferredCity?.trim() || null;
    const propertyTypology = params.crmPropertyTypology ?? null;

    const visibleSiblings = await this.findActiveBookingsByWhatsapp(whatsapp);
    if (visibleSiblings.length > 0) {
      throw new BadRequestException('Este cliente já está no CRM.');
    }

    const now = new Date();
    const initialStatus = resolveStatusAfterImmigrationUpdate({
      currentStatus: RafaCallCrmStatus.IMIGRACAO_NULL,
      expectedImmigrationAt: immigrationDate,
      immigrationImmediate,
      at: now,
    });

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
          crmComments: null,
          crmExpectedImmigrationAt: immigrationDate,
          crmImmigrationImmediate: immigrationImmediate,
          crmPropertyTypology: propertyTypology,
          crmPreferredCity: preferredCity,
          crmHasPet: null,
        },
        select: BOOKING_CRM_SELECT,
      });

      return this.serializeCrmItemWithPayments(restored);
    }

    const { startsAt, endsAt, timezone } = buildCrmPlaceholderSlotTimes(now);

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
        crmComments: null,
        crmExpectedImmigrationAt: immigrationDate,
        crmImmigrationImmediate: immigrationImmediate,
        crmPropertyTypology: propertyTypology,
        crmPreferredCity: preferredCity,
        crmHasPet: null,
        crmExcludedAt: null,
      },
      select: BOOKING_CRM_SELECT,
    });

    return this.serializeCrmItemWithPayments(created);
  }

  async updateCrm(params: {
    bookingId: string;
    crmStatus?: RafaCallCrmStatus;
    crmComments?: string;
    crmExpectedImmigrationAt?: string | null;
    videoCallStartsAtUtcIso?: string | null;
    videoCallTimezone?: string;
    crmPropertyTypology?: RafaCallCrmPropertyTypology | null;
    crmPreferredCity?: string | null;
    crmHasPet?: boolean | null;
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
    const hasVideoCallUpdate = params.videoCallStartsAtUtcIso !== undefined;
    const hasPreferencesUpdate =
      params.crmPropertyTypology !== undefined ||
      params.crmPreferredCity !== undefined ||
      params.crmHasPet !== undefined;

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

    const currentVideoCallKey = this.buildVideoCallScheduleKey(displayBooking);
    const nextVideoCallKey = hasVideoCallUpdate
      ? this.buildVideoCallScheduleKeyFromInput(
          params.videoCallStartsAtUtcIso,
          params.videoCallTimezone?.trim() ||
            displayBooking.timezone ||
            'Europe/Lisbon',
        )
      : currentVideoCallKey;
    const videoCallChanged =
      hasVideoCallUpdate && nextVideoCallKey !== currentVideoCallKey;

    let nextPropertyTypology = crmSource.crmPropertyTypology;
    let nextPreferredCity = crmSource.crmPreferredCity?.trim() || null;
    let nextHasPet = crmSource.crmHasPet;
    if (params.crmPropertyTypology !== undefined) {
      nextPropertyTypology = params.crmPropertyTypology;
    }
    if (params.crmPreferredCity !== undefined) {
      nextPreferredCity = params.crmPreferredCity?.trim() || null;
    }
    if (params.crmHasPet !== undefined) {
      nextHasPet = params.crmHasPet;
    }
    const preferencesChanged =
      hasPreferencesUpdate &&
      (nextPropertyTypology !== crmSource.crmPropertyTypology ||
        nextPreferredCity !== (crmSource.crmPreferredCity?.trim() || null) ||
        nextHasPet !== crmSource.crmHasPet);

    const hasAnyFieldUpdate =
      hasStatusChange ||
      hasCommentsUpdate ||
      hasImmigrationDateUpdate ||
      hasVideoCallUpdate ||
      hasPreferencesUpdate;

    if (!hasAnyFieldUpdate) {
      throw new BadRequestException('Indique um novo estado, comentários ou data.');
    }

    const hasEffectiveChange =
      hasStatusChange ||
      (hasCommentsUpdate && normalizedComments !== currentComments) ||
      immigrationChanged ||
      videoCallChanged ||
      preferencesChanged;

    if (!hasEffectiveChange) {
      throw new BadRequestException('Nenhuma alteração para guardar.');
    }

    let nextComments = hasCommentsUpdate ? normalizedComments : crmSource.crmComments;
    const now = new Date();
    let nextStatus = crmSource.crmStatus;
    let nextDisplayBooking = displayBooking;

    if (videoCallChanged) {
      const videoResult = await this.applyCrmVideoCallSchedule({
        bookingId: displayBooking.id,
        crmSource,
        startsAtUtcIso: params.videoCallStartsAtUtcIso ?? null,
        timezone:
          params.videoCallTimezone?.trim() ||
          displayBooking.timezone ||
          'Europe/Lisbon',
        at: now,
      });
      nextDisplayBooking = videoResult.displayBooking;
      if (videoResult.nextStatus) {
        nextStatus = videoResult.nextStatus;
      }
    }

    if (hasStatusChange && params.crmStatus) {
      nextStatus = params.crmStatus;
    } else if (immigrationChanged) {
      const autoStatus = resolveStatusAfterImmigrationUpdate({
        currentStatus: crmSource.crmStatus,
        expectedImmigrationAt: nextImmigrationDate,
        immigrationImmediate: nextImmigrationImmediate,
        at: now,
      });
      if (autoStatus !== crmSource.crmStatus) {
        nextStatus = autoStatus;
      }
    }

    await this.syncCrmToWhatsappGroup(whatsapp, {
      crmStatus: nextStatus,
      crmComments: nextComments,
      crmExpectedImmigrationAt: nextImmigrationDate,
      crmImmigrationImmediate: nextImmigrationImmediate,
      crmPropertyTypology: nextPropertyTypology,
      crmPreferredCity: nextPreferredCity,
      crmHasPet: nextHasPet,
    });

    const merged = this.mergeDisplayAndCrm(nextDisplayBooking, {
      ...crmSource,
      crmStatus: nextStatus,
      crmComments: nextComments,
      crmExpectedImmigrationAt: nextImmigrationDate,
      crmImmigrationImmediate: nextImmigrationImmediate,
      crmPropertyTypology: nextPropertyTypology,
      crmPreferredCity: nextPreferredCity,
      crmHasPet: nextHasPet,
    });

    return this.serializeCrmItemWithPayments(merged);
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

    const siblings = await this.prisma.rafaCallBooking.findMany({
      where: {
        status: {
          in: [RafaCallBookingStatus.SCHEDULED, RafaCallBookingStatus.COMPLETED],
        },
        OR: [{ guestWhatsapp: whatsapp }, { user: { whatsapp } }],
      },
      select: {
        id: true,
        status: true,
        crmStatus: true,
        startsAt: true,
        endsAt: true,
        userId: true,
      },
    });

    const scheduledIds = siblings
      .filter((item) => item.status === RafaCallBookingStatus.SCHEDULED)
      .map((item) => item.id);
    const placeholderIds = siblings
      .filter((item) => isCrmLeadPlaceholderBooking(item))
      .map((item) => item.id);
    const userIdsToClear = [
      ...new Set(
        siblings
          .filter((item) => item.status === RafaCallBookingStatus.SCHEDULED && item.userId)
          .map((item) => item.userId as string),
      ),
    ];

    const deleteIds = [...new Set([...scheduledIds, ...placeholderIds])];
    if (deleteIds.length > 0) {
      await this.prisma.rafaCallBooking.deleteMany({
        where: { id: { in: deleteIds } },
      });
    }

    for (const userId of userIdsToClear) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { rafaCallSlotStartsAt: null, rafaCallSlotEndsAt: null },
      });
    }

    const excludedAt = new Date();
    await this.prisma.rafaCallBooking.updateMany({
      where: {
        status: RafaCallBookingStatus.COMPLETED,
        crmExcludedAt: null,
        OR: [{ guestWhatsapp: whatsapp }, { user: { whatsapp } }],
      },
      data: { crmExcludedAt: excludedAt },
    });

    // Mantém lançamentos financeiros (aparecem no dashboard Financeiro).
    return { ok: true as const };
  }

  async createCrmPayment(params: {
    bookingId: string;
    paidAt: string;
    amount: number;
    receiptImageUrl?: string | null;
    comment?: string | null;
  }) {
    const whatsapp = await this.requireCrmWhatsapp(params.bookingId);
    const paidAt = this.parsePaymentPaidAt(params.paidAt);
    const amount = this.parsePaymentAmount(params.amount);
    const receiptImageUrl = params.receiptImageUrl?.trim() || null;
    const comment = params.comment?.trim() || null;

    const created = await this.prisma.rafaCallCrmPayment.create({
      data: {
        kind: FinanceEntryKind.INCOME,
        title: CRM_PAYMENT_DEFAULT_TITLE,
        whatsappDigits: whatsapp,
        paidAt,
        amount,
        receiptImageUrl,
        comment,
      },
    });

    return this.serializePayment(created);
  }

  async updateCrmPayment(params: {
    bookingId: string;
    paymentId: string;
    paidAt?: string;
    amount?: number;
    receiptImageUrl?: string | null;
    comment?: string | null;
  }) {
    const whatsapp = await this.requireCrmWhatsapp(params.bookingId);
    const existing = await this.prisma.rafaCallCrmPayment.findFirst({
      where: {
        id: params.paymentId,
        whatsappDigits: whatsapp,
        kind: FinanceEntryKind.INCOME,
      },
    });
    if (!existing) {
      throw new BadRequestException('Pagamento não encontrado.');
    }

    const data: Prisma.RafaCallCrmPaymentUpdateInput = {};
    if (params.paidAt !== undefined) {
      data.paidAt = this.parsePaymentPaidAt(params.paidAt);
    }
    if (params.amount !== undefined) {
      data.amount = this.parsePaymentAmount(params.amount);
    }
    if (params.receiptImageUrl !== undefined) {
      data.receiptImageUrl = params.receiptImageUrl?.trim() || null;
    }
    if (params.comment !== undefined) {
      data.comment = params.comment?.trim() || null;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nenhuma alteração para guardar.');
    }

    const updated = await this.prisma.rafaCallCrmPayment.update({
      where: { id: existing.id },
      data,
    });

    return this.serializePayment(updated);
  }

  async deleteCrmPayment(params: { bookingId: string; paymentId: string }) {
    const whatsapp = await this.requireCrmWhatsapp(params.bookingId);
    const existing = await this.prisma.rafaCallCrmPayment.findFirst({
      where: {
        id: params.paymentId,
        whatsappDigits: whatsapp,
        kind: FinanceEntryKind.INCOME,
      },
      select: { id: true },
    });
    if (!existing) {
      throw new BadRequestException('Pagamento não encontrado.');
    }

    await this.prisma.rafaCallCrmPayment.delete({ where: { id: existing.id } });
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

    await this.syncCrmToWhatsappGroup(whatsapp, {
      crmStatus: params.crmStatus,
      crmComments: crmSource.crmComments,
      crmExpectedImmigrationAt: crmSource.crmExpectedImmigrationAt,
      crmImmigrationImmediate: crmSource.crmImmigrationImmediate,
      crmPropertyTypology: crmSource.crmPropertyTypology,
      crmPreferredCity: crmSource.crmPreferredCity,
      crmHasPet: crmSource.crmHasPet,
    });
  }

  /** Herda CRM de agendamentos anteriores do mesmo WhatsApp (cliente recorrente). */
  async resolveCrmFieldsForWhatsapp(whatsappDigits: string): Promise<{
    crmStatus: RafaCallCrmStatus;
    crmComments: string | null;
    crmExpectedImmigrationAt: Date | null;
    crmImmigrationImmediate: boolean;
    crmPropertyTypology: RafaCallCrmPropertyTypology | null;
    crmPreferredCity: string | null;
    crmHasPet: boolean | null;
  }> {
    const digits = waDigits(whatsappDigits);
    if (!digits) {
      return {
        crmStatus: RafaCallCrmStatus.VIDEO_CHAMADA_AGENDADA,
        crmComments: null,
        crmExpectedImmigrationAt: null,
        crmImmigrationImmediate: false,
        crmPropertyTypology: null,
        crmPreferredCity: null,
        crmHasPet: null,
      };
    }

    const siblings = await this.findBookingsByWhatsappForInherit(digits);
    if (siblings.length === 0) {
      return {
        crmStatus: RafaCallCrmStatus.VIDEO_CHAMADA_AGENDADA,
        crmComments: null,
        crmExpectedImmigrationAt: null,
        crmImmigrationImmediate: false,
        crmPropertyTypology: null,
        crmPreferredCity: null,
        crmHasPet: null,
      };
    }

    const crmSource = this.pickCrmSource(siblings);
    return {
      crmStatus: this.normalizeInheritedCrmStatusOnSchedule(crmSource.crmStatus),
      crmComments: crmSource.crmComments,
      crmExpectedImmigrationAt: crmSource.crmExpectedImmigrationAt,
      crmImmigrationImmediate: crmSource.crmImmigrationImmediate,
      crmPropertyTypology: crmSource.crmPropertyTypology,
      crmPreferredCity: crmSource.crmPreferredCity,
      crmHasPet: crmSource.crmHasPet,
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
      RafaCallCrmStatus.IMIGRACAO_NULL,
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
    const { startsAt, endsAt, timezone } = buildCrmPlaceholderSlotTimes(now);

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
        timezone,
        crmStatus: booking.crmStatus,
        crmComments: booking.crmComments,
        crmExpectedImmigrationAt: booking.crmExpectedImmigrationAt,
        crmImmigrationImmediate: booking.crmImmigrationImmediate,
        crmPropertyTypology: booking.crmPropertyTypology,
        crmPreferredCity: booking.crmPreferredCity,
        crmHasPet: booking.crmHasPet,
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
      crmStatus: RafaCallCrmStatus.IMIGRACAO_NULL,
    });

    if (hasOtherVisibleBooking) {
      return 'delete';
    }

    await this.convertScheduledBookingToCrmPlaceholder(bookingId);
    return 'retain_as_placeholder';
  }

  private async convertScheduledBookingToCrmPlaceholder(bookingId: string) {
    const { startsAt, endsAt, timezone } = buildCrmPlaceholderSlotTimes();

    await this.prisma.rafaCallBooking.update({
      where: { id: bookingId },
      data: {
        status: RafaCallBookingStatus.COMPLETED,
        startsAt,
        endsAt,
        timezone,
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

  private get slotDurationMinutes(): number {
    const value = Number(process.env.RAFA_CALL_DURATION_MINUTES ?? 15);
    return Number.isFinite(value) && value > 0 ? value : 15;
  }

  private get slotBufferMinutes(): number {
    const value = Number(process.env.RAFA_CALL_BUFFER_MINUTES ?? 10);
    return Number.isFinite(value) && value >= 0 ? value : 10;
  }

  private buildVideoCallScheduleKey(item: {
    status: RafaCallBookingStatus;
    crmStatus: RafaCallCrmStatus;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
  }): string | null {
    if (isCrmLeadPlaceholderBooking(item)) return null;
    if (item.status === RafaCallBookingStatus.SCHEDULED) {
      return `${item.startsAt.toISOString()}|${item.timezone}`;
    }
    if (item.status === RafaCallBookingStatus.COMPLETED) {
      return `${item.startsAt.toISOString()}|${item.timezone}|completed`;
    }
    return null;
  }

  private buildVideoCallScheduleKeyFromInput(
    startsAtUtcIso: string | null | undefined,
    timezone: string,
  ): string | null {
    if (!startsAtUtcIso) return null;
    const startsAt = new Date(startsAtUtcIso);
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('Data de vídeo chamada inválida.');
    }
    return `${startsAt.toISOString()}|${timezone}`;
  }

  private async assertScheduleSlotAvailable(
    startsAt: Date,
    excludeBookingId?: string,
  ): Promise<Date> {
    const duration = this.slotDurationMinutes;
    const endsAt = new Date(startsAt.getTime() + duration * 60000);
    const buffer = this.slotBufferMinutes;

    const candidates = await this.prisma.rafaCallBooking.findMany({
      where: {
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
        status: RafaCallBookingStatus.SCHEDULED,
        startsAt: { lt: new Date(endsAt.getTime() + buffer * 60000) },
        endsAt: { gt: new Date(startsAt.getTime() - duration * 60000) },
      },
      select: { id: true, startsAt: true, endsAt: true },
      take: 20,
    });

    const newEndGap = new Date(endsAt.getTime() + buffer * 60000);
    if (
      candidates.some((candidate) => {
        const candidateEndGap = new Date(
          candidate.endsAt.getTime() + buffer * 60000,
        );
        return startsAt < candidateEndGap && newEndGap > candidate.startsAt;
      })
    ) {
      throw new BadRequestException('Este horário já não está disponível.');
    }

    return endsAt;
  }

  private async applyCrmVideoCallSchedule(params: {
    bookingId: string;
    crmSource: BookingCrmRow;
    startsAtUtcIso: string | null;
    timezone: string;
    at: Date;
  }): Promise<{
    displayBooking: BookingCrmRow;
    nextStatus?: RafaCallCrmStatus;
  }> {
    const booking = await this.prisma.rafaCallBooking.findUnique({
      where: { id: params.bookingId },
      select: BOOKING_CRM_SELECT,
    });
    if (!booking) {
      throw new BadRequestException('Cliente não encontrado no CRM.');
    }

    if (params.startsAtUtcIso === null) {
      if (booking.status !== RafaCallBookingStatus.SCHEDULED) {
        throw new BadRequestException(
          'Este cliente não tem vídeo chamada agendada para remover.',
        );
      }

      const nextStatus = resolveStatusAfterImmigrationUpdate({
        currentStatus: RafaCallCrmStatus.IMIGRACAO_NULL,
        expectedImmigrationAt: params.crmSource.crmExpectedImmigrationAt,
        immigrationImmediate: params.crmSource.crmImmigrationImmediate,
        at: params.at,
      });
      const { startsAt, endsAt, timezone } = buildCrmPlaceholderSlotTimes(params.at);

      const updated = await this.prisma.rafaCallBooking.update({
        where: { id: booking.id },
        data: {
          status: RafaCallBookingStatus.COMPLETED,
          startsAt,
          endsAt,
          timezone,
          crmStatus: nextStatus,
        },
        select: BOOKING_CRM_SELECT,
      });

      return {
        displayBooking: updated,
        nextStatus,
      };
    }

    const startsAt = new Date(params.startsAtUtcIso);
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('Data de vídeo chamada inválida.');
    }

    if (
      booking.status === RafaCallBookingStatus.COMPLETED &&
      !isCrmLeadPlaceholderBooking(booking)
    ) {
      throw new BadRequestException(
        'A vídeo chamada já foi realizada e não pode ser reagendada aqui.',
      );
    }

    const timezone = params.timezone.trim() || booking.timezone || 'Europe/Lisbon';
    const isPastCall = startsAt.getTime() <= params.at.getTime();

    let endsAt: Date;
    let nextBookingStatus: RafaCallBookingStatus;
    if (isPastCall) {
      // Documentar chamada já realizada — não ocupa slot na agenda futura.
      const duration = this.slotDurationMinutes;
      endsAt = new Date(startsAt.getTime() + duration * 60000);
      nextBookingStatus = RafaCallBookingStatus.COMPLETED;
    } else {
      endsAt = await this.assertScheduleSlotAvailable(startsAt, booking.id);
      nextBookingStatus = RafaCallBookingStatus.SCHEDULED;
    }

    const updated = await this.prisma.rafaCallBooking.update({
      where: { id: booking.id },
      data: {
        status: nextBookingStatus,
        startsAt,
        endsAt,
        timezone,
      },
      select: BOOKING_CRM_SELECT,
    });

    const shouldPromoteToVideo: RafaCallCrmStatus[] = [
      RafaCallCrmStatus.IMIGRACAO_NULL,
      RafaCallCrmStatus.IMIGRACAO_LONGE,
      RafaCallCrmStatus.IMIGRACAO_PERTO,
      RafaCallCrmStatus.REALIZOU_VIDEO_CHAMADA,
    ];

    let nextStatus: RafaCallCrmStatus | undefined;
    if (isPastCall) {
      // Manter / promover para «Realizou» quando se documenta data/hora real no passado.
      if (
        params.crmSource.crmStatus === RafaCallCrmStatus.IMIGRACAO_NULL ||
        params.crmSource.crmStatus === RafaCallCrmStatus.IMIGRACAO_LONGE ||
        params.crmSource.crmStatus === RafaCallCrmStatus.IMIGRACAO_PERTO ||
        params.crmSource.crmStatus === RafaCallCrmStatus.VIDEO_CHAMADA_AGENDADA
      ) {
        nextStatus = RafaCallCrmStatus.REALIZOU_VIDEO_CHAMADA;
        await this.prisma.rafaCallBooking.update({
          where: { id: booking.id },
          data: { crmStatus: nextStatus },
        });
        updated.crmStatus = nextStatus;
      }
    } else if (shouldPromoteToVideo.includes(params.crmSource.crmStatus)) {
      nextStatus = RafaCallCrmStatus.VIDEO_CHAMADA_AGENDADA;
      await this.prisma.rafaCallBooking.update({
        where: { id: booking.id },
        data: { crmStatus: nextStatus },
      });
      updated.crmStatus = nextStatus;
    }

    return {
      displayBooking: updated,
      nextStatus,
    };
  }

  crmFieldsFromBooking(booking: {
    crmStatus: RafaCallCrmStatus;
    crmComments: string | null;
    crmExpectedImmigrationAt: Date | null;
    crmImmigrationImmediate: boolean;
    crmPropertyTypology: RafaCallCrmPropertyTypology | null;
    crmPreferredCity: string | null;
    crmHasPet: boolean | null;
  }) {
    return {
      crmStatus: booking.crmStatus,
      crmComments: booking.crmComments,
      crmExpectedImmigrationAt: booking.crmExpectedImmigrationAt,
      crmImmigrationImmediate: booking.crmImmigrationImmediate,
      crmPropertyTypology: booking.crmPropertyTypology,
      crmPreferredCity: booking.crmPreferredCity,
      crmHasPet: booking.crmHasPet,
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
      crmPropertyTypology: RafaCallCrmPropertyTypology | null;
      crmPreferredCity: string | null;
      crmHasPet: boolean | null;
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
        crmPropertyTypology: data.crmPropertyTypology,
        crmPreferredCity: data.crmPreferredCity,
        crmHasPet: data.crmHasPet,
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
      | 'crmPropertyTypology'
      | 'crmPreferredCity'
      | 'crmHasPet'
    >,
  ): BookingCrmRow {
    return {
      ...displayBooking,
      crmStatus: crmSource.crmStatus,
      crmComments: crmSource.crmComments,
      crmExpectedImmigrationAt: crmSource.crmExpectedImmigrationAt,
      crmImmigrationImmediate: crmSource.crmImmigrationImmediate,
      crmPropertyTypology: crmSource.crmPropertyTypology,
      crmPreferredCity: crmSource.crmPreferredCity,
      crmHasPet: crmSource.crmHasPet,
    };
  }

  private async serializeCrmItemWithPayments(item: BookingCrmRow) {
    const whatsappDigits = this.extractWhatsappDigits(item);
    const payments =
      (await this.loadPaymentsByWhatsapp([whatsappDigits])).get(whatsappDigits) ??
      [];
    return this.serializeCrmItem(item, payments);
  }

  private async loadPaymentsByWhatsapp(
    whatsappDigitsList: string[],
  ): Promise<Map<string, ReturnType<RafacallCrmService['serializePayment']>[]>> {
    const digits = [...new Set(whatsappDigitsList.map((d) => waDigits(d)).filter(Boolean))];
    const map = new Map<string, ReturnType<RafacallCrmService['serializePayment']>[]>();
    if (digits.length === 0) return map;

    const rows = await this.prisma.rafaCallCrmPayment.findMany({
      where: {
        kind: FinanceEntryKind.INCOME,
        whatsappDigits: { in: digits },
      },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
    });

    for (const row of rows) {
      const key = row.whatsappDigits?.trim();
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(this.serializePayment(row));
      map.set(key, list);
    }
    return map;
  }

  private async requireCrmWhatsapp(bookingId: string): Promise<string> {
    const booking = await this.prisma.rafaCallBooking.findFirst({
      where: {
        id: bookingId,
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
    return whatsapp;
  }

  private parsePaymentPaidAt(value: string): Date {
    try {
      const date = parseCrmImmigrationDateInput(value.trim());
      if (!date) throw new Error('INVALID');
      return date;
    } catch {
      throw new BadRequestException('Data do pagamento inválida.');
    }
  }

  private parsePaymentAmount(value: number): Prisma.Decimal {
    if (!Number.isFinite(value) || value < 0.01) {
      throw new BadRequestException('Valor do pagamento inválido.');
    }
    return new Prisma.Decimal(value.toFixed(2));
  }

  private serializePayment(row: {
    id: string;
    title: string;
    paidAt: Date;
    amount: Prisma.Decimal;
    receiptImageUrl: string | null;
    comment: string | null;
  }) {
    return {
      id: row.id,
      title: row.title,
      paidAt: formatCrmImmigrationDateKey(row.paidAt) ?? row.paidAt.toISOString().slice(0, 10),
      amount: Number(row.amount),
      receiptImageUrl: row.receiptImageUrl,
      comment: row.comment,
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
    startsAt: Date;
    endsAt: Date;
  }): boolean {
    if (item.status === RafaCallBookingStatus.SCHEDULED) return true;
    if (item.status === RafaCallBookingStatus.CANCELLED) return true;
    return (
      item.status === RafaCallBookingStatus.COMPLETED &&
      !isCrmLeadPlaceholderBooking(item)
    );
  }

  private serializeCrmItem(
    item: {
      id: string;
      status: RafaCallBookingStatus;
      crmStatus: RafaCallCrmStatus;
      crmComments: string | null;
      crmExpectedImmigrationAt: Date | null;
      crmImmigrationImmediate: boolean;
      crmPropertyTypology: RafaCallCrmPropertyTypology | null;
      crmPreferredCity: string | null;
      crmHasPet: boolean | null;
      startsAt: Date;
      endsAt: Date;
      timezone: string;
      origin: string;
      guestName: string | null;
      guestWhatsapp: string | null;
      user: { id: string; name: string | null; whatsapp: string | null } | null;
    },
    payments: ReturnType<RafacallCrmService['serializePayment']>[] = [],
  ) {
    const whatsappDigits = this.extractWhatsappDigits(item);
    const hasVideoCall = this.hasDisplayableVideoCall(item);
    const paymentsTotal = Math.round(
      payments.reduce((sum, payment) => sum + payment.amount, 0) * 100,
    ) / 100;
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
      crmPropertyTypology: item.crmPropertyTypology,
      crmPreferredCity: item.crmPreferredCity,
      crmHasPet: item.crmHasPet,
      payments,
      paymentsTotal,
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
