import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HouseImageStorageService } from '../partner/house-image-storage.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
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
  CRM_CLIENT_DOCUMENT_MAX_BYTES,
  CRM_CLIENT_DOCUMENT_MAX_COUNT,
  CRM_PAYMENT_DEFAULT_TITLE,
  buildCrmPlaceholderSlotTimes,
  formatCrmImmigrationDateKey,
  formatCrmImmigrationForApi,
  isCrmLeadPlaceholderBooking,
  isCrmPlaceholderSlotTimes,
  isJoanaOffCrmStatus,
  parseCrmImmigrationDateInput,
  parseCrmImmigrationInput,
  normalizeCrmPropertyTypologies,
  resolveStatusAfterImmigrationUpdate,
  sameCrmPropertyTypologies,
  sortCrmItemsByImmigrationDate,
} from './rafacall-crm.constants';
import { sanitizeCrmDocumentFileName } from '../common/crm-document-file';

function waDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function normalizeIgUsername(raw: string | null | undefined): string | null {
  const handle = (raw || '').trim().replace(/^@+/, '');
  if (handle.length < 2) return null;
  return handle.slice(0, 119);
}

function normalizeDesiredRent(value: number | null): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 100_000) {
    throw new BadRequestException('Valor do aluguel pretendido inválido.');
  }
  return value;
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
  crmHasVisa: true,
  crmDesiredRent: true,
  crmJoanaEnabled: true,
  crmProfileImageUrl: true,
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
  crmPropertyTypology: RafaCallCrmPropertyTypology[];
  crmPreferredCity: string | null;
  crmHasPet: boolean | null;
  crmHasVisa: boolean | null;
  crmDesiredRent: number | null;
  crmJoanaEnabled: boolean;
  crmProfileImageUrl: string | null;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  origin: string;
  guestName: string | null;
  guestWhatsapp: string | null;
  updatedAt: Date;
  user: { id: string; name: string | null; whatsapp: string | null } | null;
};

const CRM_AVATAR_FETCH_MAX_BYTES = 2 * 1024 * 1024;
const CRM_AVATAR_BOARD_BACKFILL_LIMIT = 8;

type SerializedCrmDocument = {
  id: string;
  fileName: string;
  fileUrl: string;
  sizeBytes: number;
  createdAt: string;
};

function sanitizeCrmPdfFileName(originalName: string): string {
  return sanitizeCrmDocumentFileName(originalName, '.pdf');
}

@Injectable()
export class RafacallCrmService {
  private readonly logger = new Logger(RafacallCrmService.name);
  private readonly profileSyncInFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: HouseImageStorageService,
    private readonly wa: WhatsAppService,
  ) {}

  async listCrmBoard() {
    await this.syncImmigrationProximityStatuses();

    const items = await this.prisma.rafaCallBooking.findMany({
      where: this.visibleCrmBookingWhere(),
      orderBy: { startsAt: 'desc' },
      select: BOOKING_CRM_SELECT,
    });

    const uniqueItems = this.buildUniqueCrmItems(items);
    this.scheduleMissingProfileImageBackfill(uniqueItems);
    const whatsappDigits = uniqueItems
      .map((item) => this.extractWhatsappDigits(item))
      .filter((digits) => digits.length >= 8);
    const [paymentsByWhatsapp, documentsByWhatsapp, igByBooking] =
      await Promise.all([
        this.loadPaymentsByWhatsapp(whatsappDigits),
        this.loadDocumentsByWhatsapp(whatsappDigits),
        this.loadInstagramLinksByBookingIds(uniqueItems.map((item) => item.id)),
      ]);

    const columns = RAFA_CALL_CRM_STATUS_ORDER.map((status) => ({
      status,
      label: RAFA_CALL_CRM_STATUS_LABELS[status],
      items: sortCrmItemsByImmigrationDate(
        uniqueItems.filter((item) => item.crmStatus === status),
      ).map((item) => {
        const digits = this.extractWhatsappDigits(item);
        const ig = igByBooking.get(item.id);
        return this.serializeCrmItem(
          item,
          digits ? paymentsByWhatsapp.get(digits) ?? [] : [],
          digits ? documentsByWhatsapp.get(digits) ?? [] : [],
          ig,
        );
      }),
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

  /** Alinha colunas de imigração com a data prevista (60 dias, imediato, sem data). */
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
    /** Opcional no IG: a ficha nasce sem número e o WhatsApp entra no /agendar. */
    whatsapp?: string | null;
    crmExpectedImmigrationAt?: string | null;
    crmPropertyTypology?: RafaCallCrmPropertyTypology[] | null;
    crmPreferredCity?: string | null;
    crmDesiredRent?: number | null;
  }) {
    const name = params.name.trim();
    if (!name || name.length < 2) {
      throw new BadRequestException('Indica o nome do cliente.');
    }

    const whatsappRaw = (params.whatsapp || '').trim();
    const whatsapp = whatsappRaw ? waDigits(whatsappRaw) : '';
    if (whatsappRaw && whatsapp.length < 8) {
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
    const propertyTypology = normalizeCrmPropertyTypologies(
      params.crmPropertyTypology,
    );
    const desiredRent =
      params.crmDesiredRent === undefined
        ? null
        : normalizeDesiredRent(params.crmDesiredRent);
    const crmJoanaEnabled = whatsapp
      ? !(await this.isJoanaConversationPaused(whatsapp))
      : true;

    if (whatsapp) {
      const visibleSiblings = await this.findActiveBookingsByWhatsapp(whatsapp);
      if (visibleSiblings.length > 0) {
        throw new BadRequestException('Este cliente já está no CRM.');
      }
    }

    const now = new Date();
    const initialStatus = resolveStatusAfterImmigrationUpdate({
      currentStatus: RafaCallCrmStatus.IMIGRACAO_NULL,
      expectedImmigrationAt: immigrationDate,
      immigrationImmediate,
      at: now,
    });

    if (whatsapp) {
      const excludedBooking = await this.prisma.rafaCallBooking.findFirst({
        where: {
          status: {
            in: [
              RafaCallBookingStatus.SCHEDULED,
              RafaCallBookingStatus.COMPLETED,
            ],
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
            crmHasVisa: null,
            crmDesiredRent: desiredRent,
            crmJoanaEnabled,
          },
          select: BOOKING_CRM_SELECT,
        });

        const withAvatar = await this.ensureCrmProfileImage(whatsapp, {
          existingUrl: restored.crmProfileImageUrl,
        });
        return this.serializeCrmItemWithPayments({
          ...restored,
          crmProfileImageUrl: withAvatar ?? restored.crmProfileImageUrl,
        });
      }
    }

    const { startsAt, endsAt, timezone } = buildCrmPlaceholderSlotTimes(now);

    const created = await this.prisma.rafaCallBooking.create({
      data: {
        userId: null,
        guestName: name,
        guestWhatsapp: whatsapp || null,
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
        crmHasVisa: null,
        crmDesiredRent: desiredRent,
        crmJoanaEnabled,
        crmExcludedAt: null,
      },
      select: BOOKING_CRM_SELECT,
    });

    const withAvatar = whatsapp
      ? await this.ensureCrmProfileImage(whatsapp)
      : null;
    return this.serializeCrmItemWithPayments({
      ...created,
      crmProfileImageUrl: withAvatar ?? created.crmProfileImageUrl,
    });
  }

  /** Ficha visível da Joana, lead excluído do kanban, ou número ainda sem ficha. */
  async lookupLeadForJoana(whatsappRaw: string) {
    const whatsapp = waDigits(whatsappRaw);
    const visible = await this.findActiveBookingsByWhatsapp(whatsapp);
    if (visible.length > 0) {
      return this.toJoanaVisibleLead(visible);
    }

    const excluded = await this.prisma.rafaCallBooking.findFirst({
      where: {
        crmExcludedAt: { not: null },
        status: {
          in: [RafaCallBookingStatus.SCHEDULED, RafaCallBookingStatus.COMPLETED],
        },
        OR: [{ guestWhatsapp: whatsapp }, { user: { whatsapp } }],
      },
      select: { id: true },
    });
    if (excluded) return { kind: 'excluded' as const };
    return { kind: 'none' as const };
  }

  /** Lead Joana ancorado no IGSID (CrmLead → RafaCallBooking), sem WhatsApp. */
  async lookupLeadForJoanaByInstagram(instagramUserIdRaw: string) {
    const ig = instagramUserIdRaw.trim();
    if (!ig) return { kind: 'none' as const };

    const bot = await this.prisma.chatbot.findUnique({
      where: { slug: 'joana' },
      select: { id: true },
    });
    if (!bot) return { kind: 'none' as const };

    const crmLead = await this.prisma.crmLead.findFirst({
      where: {
        chatbotId: bot.id,
        instagramUserId: ig,
        crmExcludedAt: null,
      },
      select: { rafaCallBookingId: true },
    });
    if (!crmLead?.rafaCallBookingId) return { kind: 'none' as const };

    const booking = await this.prisma.rafaCallBooking.findFirst({
      where: { id: crmLead.rafaCallBookingId, crmExcludedAt: null },
      select: BOOKING_CRM_SELECT,
    });
    if (!booking) return { kind: 'none' as const };
    return this.toJoanaVisibleLead([booking]);
  }

  private toJoanaVisibleLead(visible: BookingCrmRow[]) {
    const source = this.pickCrmSource(visible);
    const hasScheduledVideoCall =
      source.crmStatus === RafaCallCrmStatus.VIDEO_CHAMADA_AGENDADA ||
      source.crmStatus === RafaCallCrmStatus.REALIZOU_VIDEO_CHAMADA ||
      source.crmStatus === RafaCallCrmStatus.AGUARDANDO_ASSINATURA ||
      source.crmStatus === RafaCallCrmStatus.CONTRATO_ASSINADO ||
      visible.some(
        (item) =>
          item.status === RafaCallBookingStatus.SCHEDULED &&
          !isCrmPlaceholderSlotTimes(item),
      );
    return {
      kind: 'visible' as const,
      bookingId: source.id,
      name: source.user?.name?.trim() || source.guestName?.trim() || null,
      crmStatus: source.crmStatus,
      hasScheduledVideoCall,
      immigration: formatCrmImmigrationForApi(
        source.crmExpectedImmigrationAt,
        source.crmImmigrationImmediate,
      ),
      cities: source.crmPreferredCity?.trim() || null,
      typology: source.crmPropertyTypology,
      desiredRent: source.crmDesiredRent,
      hasPet: source.crmHasPet,
      hasVisa: source.crmHasVisa,
    };
  }

  async renameLeadForJoana(whatsappRaw: string, name: string) {
    const whatsapp = waDigits(whatsappRaw);
    const siblings = await this.findActiveBookingsByWhatsapp(whatsapp);
    const userId = siblings.find((item) => item.user?.id)?.user?.id;
    if (userId) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { name },
      });
    }
    const guestIds = siblings.filter((item) => !item.user).map((item) => item.id);
    if (guestIds.length > 0) {
      await this.prisma.rafaCallBooking.updateMany({
        where: { id: { in: guestIds } },
        data: { guestName: name },
      });
    }
  }

  async updateCrm(params: {
    bookingId: string;
    crmStatus?: RafaCallCrmStatus;
    crmComments?: string;
    crmExpectedImmigrationAt?: string | null;
    videoCallStartsAtUtcIso?: string | null;
    videoCallTimezone?: string;
    crmPropertyTypology?: RafaCallCrmPropertyTypology[] | null;
    crmPreferredCity?: string | null;
    crmHasPet?: boolean | null;
    crmHasVisa?: boolean | null;
    crmDesiredRent?: number | null;
    crmJoanaEnabled?: boolean;
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
    // Lead IG pode existir sem WhatsApp até /agendar — actualiza só este booking.
    const siblings = whatsapp
      ? await this.findActiveBookingsByWhatsapp(whatsapp)
      : [booking];
    if (siblings.length === 0) {
      throw new BadRequestException('Cliente não encontrado no CRM.');
    }
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
      params.crmHasPet !== undefined ||
      params.crmHasVisa !== undefined ||
      params.crmDesiredRent !== undefined;
    const hasJoanaUpdate = params.crmJoanaEnabled !== undefined;

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
    let nextHasVisa = crmSource.crmHasVisa;
    let nextDesiredRent = crmSource.crmDesiredRent;
    if (params.crmPropertyTypology !== undefined) {
      nextPropertyTypology = normalizeCrmPropertyTypologies(
        params.crmPropertyTypology,
      );
    }
    if (params.crmPreferredCity !== undefined) {
      nextPreferredCity = params.crmPreferredCity?.trim() || null;
    }
    if (params.crmHasPet !== undefined) {
      nextHasPet = params.crmHasPet;
    }
    if (params.crmHasVisa !== undefined) {
      nextHasVisa = params.crmHasVisa;
    }
    if (params.crmDesiredRent !== undefined) {
      nextDesiredRent = normalizeDesiredRent(params.crmDesiredRent);
    }
    const preferencesChanged =
      hasPreferencesUpdate &&
      (!sameCrmPropertyTypologies(
        nextPropertyTypology,
        crmSource.crmPropertyTypology,
      ) ||
        nextPreferredCity !== (crmSource.crmPreferredCity?.trim() || null) ||
        nextHasPet !== crmSource.crmHasPet ||
        nextHasVisa !== crmSource.crmHasVisa ||
        nextDesiredRent !== crmSource.crmDesiredRent);
    const joanaRequestedChange =
      hasJoanaUpdate && params.crmJoanaEnabled !== crmSource.crmJoanaEnabled;

    const hasAnyFieldUpdate =
      hasStatusChange ||
      hasCommentsUpdate ||
      hasImmigrationDateUpdate ||
      hasVideoCallUpdate ||
      hasPreferencesUpdate ||
      hasJoanaUpdate;

    if (!hasAnyFieldUpdate) {
      throw new BadRequestException('Indique um novo estado, comentários ou data.');
    }

    const hasEffectiveChange =
      hasStatusChange ||
      (hasCommentsUpdate && normalizedComments !== currentComments) ||
      immigrationChanged ||
      videoCallChanged ||
      preferencesChanged ||
      joanaRequestedChange;

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

    let nextJoanaEnabled = crmSource.crmJoanaEnabled;
    if (
      params.crmJoanaEnabled === undefined &&
      nextStatus !== crmSource.crmStatus &&
      isJoanaOffCrmStatus(nextStatus)
    ) {
      nextJoanaEnabled = false;
    }
    if (params.crmJoanaEnabled !== undefined) {
      nextJoanaEnabled = params.crmJoanaEnabled;
    }
    const joanaChanged = nextJoanaEnabled !== crmSource.crmJoanaEnabled;
    const enteredJoanaOffColumn =
      nextJoanaEnabled === false &&
      nextStatus !== crmSource.crmStatus &&
      isJoanaOffCrmStatus(nextStatus);

    const crmPatch = {
      crmStatus: nextStatus,
      crmComments: nextComments,
      crmExpectedImmigrationAt: nextImmigrationDate,
      crmImmigrationImmediate: nextImmigrationImmediate,
      crmPropertyTypology: nextPropertyTypology,
      crmPreferredCity: nextPreferredCity,
      crmHasPet: nextHasPet,
      crmHasVisa: nextHasVisa,
      crmDesiredRent: nextDesiredRent,
      crmJoanaEnabled: nextJoanaEnabled,
    };

    if (whatsapp) {
      await this.syncCrmToWhatsappGroup(whatsapp, crmPatch);
      if (joanaChanged || enteredJoanaOffColumn) {
        await this.applyJoanaEnabled(whatsapp, nextJoanaEnabled);
      }
    } else {
      await this.prisma.rafaCallBooking.update({
        where: { id: booking.id },
        data: crmPatch,
      });
      if (joanaChanged || enteredJoanaOffColumn) {
        await this.applyJoanaEnabledByBookingId(booking.id, nextJoanaEnabled);
      }
    }

    const merged = this.mergeDisplayAndCrm(nextDisplayBooking, {
      ...crmSource,
      ...crmPatch,
      updatedAt: new Date(),
    });

    return this.serializeCrmItemWithPayments(merged);
  }

  async removeFromCrm(params: { bookingId: string }) {
    const booking = await this.prisma.rafaCallBooking.findFirst({
      where: {
        id: params.bookingId,
        ...this.visibleCrmBookingWhere(),
      },
      select: {
        ...BOOKING_CRM_SELECT,
        userId: true,
      },
    });

    if (!booking) {
      throw new BadRequestException('Cliente não encontrado no CRM.');
    }

    const whatsapp = this.extractWhatsappDigits(booking);
    const excludedAt = new Date();

    // Lead IG (ou sem número): remove/exclui pelo ID do booking, não pelo WhatsApp.
    if (!whatsapp) {
      await this.excludeCrmLeadsLinkedToBooking(booking.id, excludedAt);

      if (
        booking.status === RafaCallBookingStatus.SCHEDULED ||
        isCrmLeadPlaceholderBooking(booking)
      ) {
        if (booking.status === RafaCallBookingStatus.SCHEDULED && booking.userId) {
          await this.prisma.user.update({
            where: { id: booking.userId },
            data: { rafaCallSlotStartsAt: null, rafaCallSlotEndsAt: null },
          });
        }
        await this.prisma.rafaCallBooking.delete({ where: { id: booking.id } });
      } else {
        await this.prisma.rafaCallBooking.update({
          where: { id: booking.id },
          data: { crmExcludedAt: excludedAt },
        });
      }

      return { ok: true as const };
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
    for (const id of deleteIds) {
      await this.excludeCrmLeadsLinkedToBooking(id, excludedAt);
    }
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

    const remaining = await this.prisma.rafaCallBooking.findMany({
      where: {
        status: RafaCallBookingStatus.COMPLETED,
        crmExcludedAt: null,
        OR: [{ guestWhatsapp: whatsapp }, { user: { whatsapp } }],
      },
      select: { id: true },
    });
    for (const row of remaining) {
      await this.excludeCrmLeadsLinkedToBooking(row.id, excludedAt);
    }
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

  async uploadCrmDocument(params: {
    bookingId: string;
    file: Express.Multer.File | undefined;
  }): Promise<SerializedCrmDocument> {
    const whatsapp = await this.requireCrmWhatsapp(params.bookingId);
    return this.uploadCrmDocumentByWhatsapp({
      whatsappDigits: whatsapp,
      file: params.file,
    });
  }

  /** Upload manual de PDF por WhatsApp (CRM Joana / Bruna / Gabi / Outros). */
  async uploadCrmDocumentByWhatsapp(params: {
    whatsappDigits: string;
    file: Express.Multer.File | undefined;
  }): Promise<SerializedCrmDocument> {
    const whatsapp = waDigits(params.whatsappDigits);
    if (whatsapp.length < 8) {
      throw new BadRequestException('WhatsApp inválido.');
    }
    const file = params.file;
    if (!file?.buffer?.length) {
      throw new BadRequestException('Seleciona um PDF.');
    }
    if (file.size > CRM_CLIENT_DOCUMENT_MAX_BYTES) {
      throw new PayloadTooLargeException('Cada PDF pode ter no máximo 15 MB.');
    }

    const existingCount = await this.prisma.rafaCallCrmDocument.count({
      where: { whatsappDigits: whatsapp },
    });
    if (existingCount >= CRM_CLIENT_DOCUMENT_MAX_COUNT) {
      throw new BadRequestException(
        'Este cliente já tem 20 PDFs. Remove um para anexar outro.',
      );
    }

    let publicUrl: string;
    try {
      ({ publicUrl } = await this.storage.storeCrmClientPdf(file));
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'empty_crm_pdf' || code === 'invalid_crm_pdf') {
        throw new BadRequestException('Este ficheiro não é um PDF válido.');
      }
      throw error;
    }

    try {
      const created = await this.prisma.rafaCallCrmDocument.create({
        data: {
          whatsappDigits: whatsapp,
          fileName: sanitizeCrmPdfFileName(file.originalname || ''),
          fileUrl: publicUrl,
          sizeBytes: file.size,
        },
      });
      return this.serializeDocument(created);
    } catch (error) {
      await this.storage.deleteStoredUrl(publicUrl);
      throw error;
    }
  }

  async deleteCrmDocument(params: { bookingId: string; documentId: string }) {
    const whatsapp = await this.requireCrmWhatsapp(params.bookingId);
    return this.deleteCrmDocumentByWhatsapp({
      whatsappDigits: whatsapp,
      documentId: params.documentId,
    });
  }

  async deleteCrmDocumentByWhatsapp(params: {
    whatsappDigits: string;
    documentId: string;
  }) {
    const whatsapp = waDigits(params.whatsappDigits);
    const existing = await this.prisma.rafaCallCrmDocument.findFirst({
      where: { id: params.documentId, whatsappDigits: whatsapp },
      select: { id: true, fileUrl: true },
    });
    if (!existing) {
      throw new BadRequestException('Documento não encontrado.');
    }

    await this.prisma.rafaCallCrmDocument.delete({ where: { id: existing.id } });
    await this.storage.deleteStoredUrl(existing.fileUrl);
    return { ok: true as const };
  }

  /** Documentos do CRM partilhados por WhatsApp (todos os kanbans). */
  async listDocumentsByWhatsapp(
    whatsappDigitsList: string[],
  ): Promise<Map<string, SerializedCrmDocument[]>> {
    return this.loadDocumentsByWhatsapp(whatsappDigitsList);
  }

  /**
   * Anexa ficheiro recebido por WhatsApp (imagem/documento) ao cliente CRM.
   * Chave = WhatsApp; não exige booking — aparece quando a ficha existir no kanban.
   */
  async attachWhatsappInboundFile(params: {
    whatsappDigits: string;
    buffer: Buffer;
    mimeType?: string;
    fileName?: string;
  }): Promise<{ ok: true; status: string; document?: SerializedCrmDocument }> {
    const whatsapp = waDigits(params.whatsappDigits);
    if (whatsapp.length < 8) {
      return { ok: true, status: 'ignored_invalid_phone' };
    }
    if (!params.buffer?.length) {
      return { ok: true, status: 'ignored_empty_file' };
    }
    if (params.buffer.length > CRM_CLIENT_DOCUMENT_MAX_BYTES) {
      return { ok: true, status: 'ignored_too_large' };
    }

    const existingCount = await this.prisma.rafaCallCrmDocument.count({
      where: { whatsappDigits: whatsapp },
    });
    if (existingCount >= CRM_CLIENT_DOCUMENT_MAX_COUNT) {
      return { ok: true, status: 'ignored_limit' };
    }

    let stored: { publicUrl: string; fileName: string; sizeBytes: number };
    try {
      stored = await this.storage.storeCrmClientFile({
        buffer: params.buffer,
        mimeType: params.mimeType,
        fileName: params.fileName,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'empty_crm_file' || code === 'invalid_crm_file') {
        return { ok: true, status: 'ignored_invalid_file' };
      }
      throw error;
    }

    try {
      const created = await this.prisma.rafaCallCrmDocument.create({
        data: {
          whatsappDigits: whatsapp,
          fileName: stored.fileName,
          fileUrl: stored.publicUrl,
          sizeBytes: stored.sizeBytes,
        },
      });
      return {
        ok: true,
        status: 'attached',
        document: this.serializeDocument(created),
      };
    } catch (error) {
      await this.storage.deleteStoredUrl(stored.publicUrl);
      throw error;
    }
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

    const disableJoana = isJoanaOffCrmStatus(params.crmStatus);
    await this.syncCrmToWhatsappGroup(whatsapp, {
      crmStatus: params.crmStatus,
      crmComments: crmSource.crmComments,
      crmExpectedImmigrationAt: crmSource.crmExpectedImmigrationAt,
      crmImmigrationImmediate: crmSource.crmImmigrationImmediate,
      crmPropertyTypology: crmSource.crmPropertyTypology,
      crmPreferredCity: crmSource.crmPreferredCity,
      crmHasPet: crmSource.crmHasPet,
      crmHasVisa: crmSource.crmHasVisa,
      crmDesiredRent: crmSource.crmDesiredRent,
      ...(disableJoana ? { crmJoanaEnabled: false } : {}),
    });
    if (disableJoana) {
      await this.applyJoanaEnabled(whatsapp, false);
    }
  }

  /** Herda CRM de agendamentos anteriores do mesmo WhatsApp (cliente recorrente). */
  async resolveCrmFieldsForWhatsapp(whatsappDigits: string): Promise<{
    crmStatus: RafaCallCrmStatus;
    crmComments: string | null;
    crmExpectedImmigrationAt: Date | null;
    crmImmigrationImmediate: boolean;
    crmPropertyTypology: RafaCallCrmPropertyTypology[];
    crmPreferredCity: string | null;
    crmHasPet: boolean | null;
    crmHasVisa: boolean | null;
    crmDesiredRent: number | null;
    crmJoanaEnabled: boolean;
    crmProfileImageUrl: string | null;
  }> {
    const digits = waDigits(whatsappDigits);
    const paused = digits ? await this.isJoanaConversationPaused(digits) : false;
    if (!digits) {
      return {
        crmStatus: RafaCallCrmStatus.VIDEO_CHAMADA_AGENDADA,
        crmComments: null,
        crmExpectedImmigrationAt: null,
        crmImmigrationImmediate: false,
        crmPropertyTypology: [],
        crmPreferredCity: null,
        crmHasPet: null,
        crmHasVisa: null,
        crmDesiredRent: null,
        crmJoanaEnabled: true,
        crmProfileImageUrl: null,
      };
    }

    const siblings = await this.findBookingsByWhatsappForInherit(digits);
    if (siblings.length === 0) {
      return {
        crmStatus: RafaCallCrmStatus.VIDEO_CHAMADA_AGENDADA,
        crmComments: null,
        crmExpectedImmigrationAt: null,
        crmImmigrationImmediate: false,
        crmPropertyTypology: [],
        crmPreferredCity: null,
        crmHasPet: null,
        crmHasVisa: null,
        crmDesiredRent: null,
        crmJoanaEnabled: !paused,
        crmProfileImageUrl: null,
      };
    }

    const crmSource = this.pickCrmSource(siblings);
    const profileFromGroup =
      siblings.map((row) => row.crmProfileImageUrl?.trim() || null).find(Boolean) ||
      null;
    return {
      crmStatus: this.normalizeInheritedCrmStatusOnSchedule(crmSource.crmStatus),
      crmComments: crmSource.crmComments,
      crmExpectedImmigrationAt: crmSource.crmExpectedImmigrationAt,
      crmImmigrationImmediate: crmSource.crmImmigrationImmediate,
      crmPropertyTypology: crmSource.crmPropertyTypology,
      crmPreferredCity: crmSource.crmPreferredCity,
      crmHasPet: crmSource.crmHasPet,
      crmHasVisa: crmSource.crmHasVisa,
      crmDesiredRent: crmSource.crmDesiredRent,
      crmJoanaEnabled: crmSource.crmJoanaEnabled && !paused,
      crmProfileImageUrl: profileFromGroup,
    };
  }

  /**
   * Após /agendar com ?booking=: grava o WhatsApp no cartão e no CrmLead IG ligado.
   */
  async attachWhatsappToCrmBooking(params: {
    bookingId: string;
    whatsapp: string;
    name?: string | null;
  }) {
    const digits = waDigits(params.whatsapp);
    if (!digits) return;

    const name = params.name?.trim() || null;
    await this.prisma.crmLead.updateMany({
      where: { rafaCallBookingId: params.bookingId },
      data: {
        whatsappDigits: digits,
        ...(name && name.length >= 2 ? { guestName: name } : {}),
      },
    });
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

    void this.ensureCrmProfileImage(whatsapp, {
      existingUrl: crmSource.crmProfileImageUrl,
    });

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
        crmHasVisa: booking.crmHasVisa,
        crmDesiredRent: booking.crmDesiredRent,
        crmJoanaEnabled: booking.crmJoanaEnabled,
        crmProfileImageUrl: booking.crmProfileImageUrl,
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
    crmPropertyTypology: RafaCallCrmPropertyTypology[];
    crmPreferredCity: string | null;
    crmHasPet: boolean | null;
    crmHasVisa: boolean | null;
    crmDesiredRent: number | null;
    crmJoanaEnabled: boolean;
  }) {
    return {
      crmStatus: booking.crmStatus,
      crmComments: booking.crmComments,
      crmExpectedImmigrationAt: booking.crmExpectedImmigrationAt,
      crmImmigrationImmediate: booking.crmImmigrationImmediate,
      crmPropertyTypology: booking.crmPropertyTypology,
      crmPreferredCity: booking.crmPreferredCity,
      crmHasPet: booking.crmHasPet,
      crmHasVisa: booking.crmHasVisa,
      crmDesiredRent: booking.crmDesiredRent,
      crmJoanaEnabled: booking.crmJoanaEnabled,
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
      crmPropertyTypology: RafaCallCrmPropertyTypology[];
      crmPreferredCity: string | null;
      crmHasPet: boolean | null;
      crmHasVisa: boolean | null;
      crmDesiredRent: number | null;
      crmJoanaEnabled?: boolean;
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
        crmHasVisa: data.crmHasVisa,
        crmDesiredRent: data.crmDesiredRent,
        ...(data.crmJoanaEnabled !== undefined
          ? { crmJoanaEnabled: data.crmJoanaEnabled }
          : {}),
      },
    });
  }

  /** A Joana responde se a ficha visível está On e a conversa não está em pausa. */
  async isJoanaActive(whatsappRaw: string): Promise<boolean> {
    const whatsapp = waDigits(whatsappRaw);
    if (!whatsapp) return false;

    const visible = await this.findActiveBookingsByWhatsapp(whatsapp);
    if (visible.length > 0 && !this.pickCrmSource(visible).crmJoanaEnabled) {
      return false;
    }
    return !(await this.isJoanaConversationPaused(whatsapp));
  }

  /** Off ou On para este WhatsApp, mesmo sem ficha no kanban. */
  async setJoanaEnabledForWhatsapp(whatsappRaw: string, enabled: boolean): Promise<void> {
    const whatsapp = waDigits(whatsappRaw);
    if (!whatsapp) return;
    await this.applyJoanaEnabled(whatsapp, enabled);
  }

  /**
   * Mensagem manual do admin no WhatsApp: move leads activos em NOVO
   * (Bruna / Bianca / Gabi / Outros) para EM_ATENDIMENTO. Joana não usa CrmLead.
   */
  async promoteGenericCrmNovoToEmAtendimento(whatsappRaw: string): Promise<number> {
    const whatsapp = waDigits(whatsappRaw);
    if (!whatsapp) return 0;

    const leads = await this.prisma.crmLead.findMany({
      where: {
        whatsappDigits: whatsapp,
        crmExcludedAt: null,
        chatbot: { slug: { in: ['bruna', 'bianca', 'gabi', 'outros'] } },
        column: { slug: 'NOVO' },
      },
      select: { id: true, chatbotId: true },
    });
    if (!leads.length) return 0;

    let moved = 0;
    for (const lead of leads) {
      const target = await this.prisma.crmColumn.findFirst({
        where: { chatbotId: lead.chatbotId, slug: 'EM_ATENDIMENTO' },
        select: { id: true },
      });
      if (!target) continue;
      await this.prisma.crmLead.update({
        where: { id: lead.id },
        data: { columnId: target.id },
      });
      moved += 1;
    }
    return moved;
  }

  private async isJoanaConversationPaused(whatsapp: string): Promise<boolean> {
    const row = await this.prisma.joanaConversation.findFirst({
      where: { whatsappDigits: whatsapp },
      select: { paused: true },
      orderBy: { updatedAt: 'desc' },
    });
    return row?.paused === true;
  }

  private async applyJoanaEnabled(whatsapp: string, enabled: boolean): Promise<void> {
    await this.prisma.rafaCallBooking.updateMany({
      where: {
        OR: [{ guestWhatsapp: whatsapp }, { user: { whatsapp } }],
      },
      data: { crmJoanaEnabled: enabled },
    });

    // Multi-bot: o mesmo interruptor cobre CrmLead (Bruna/Gabi) e a conversa partilhada.
    await this.prisma.crmLead.updateMany({
      where: { whatsappDigits: whatsapp, crmExcludedAt: null },
      data: { botEnabled: enabled },
    });

    if (enabled) {
      await this.prisma.joanaConversation.updateMany({
        where: { whatsappDigits: whatsapp },
        data: { paused: false },
      });
      return;
    }

    const existing = await this.prisma.joanaConversation.findFirst({
      where: { whatsappDigits: whatsapp },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!existing) {
      try {
        await this.prisma.joanaConversation.create({
          data: {
            whatsappDigits: whatsapp,
            paused: true,
            buffer: [] as Prisma.InputJsonValue,
          },
        });
        return;
      } catch (err: unknown) {
        if (
          !(err instanceof Prisma.PrismaClientKnownRequestError) ||
          err.code !== 'P2002'
        ) {
          throw err;
        }
      }
    }

    await this.prisma.joanaConversation.updateMany({
      where: { whatsappDigits: whatsapp },
      data: {
        paused: true,
        buffer: [] as Prisma.InputJsonValue,
        pendingOutbound: null,
        processing: false,
      },
    });
  }

  /** Pausa/liga Joana em lead IG (sem WhatsApp) via booking → CrmLead → conversa. */
  private async applyJoanaEnabledByBookingId(
    bookingId: string,
    enabled: boolean,
  ): Promise<void> {
    await this.prisma.rafaCallBooking.update({
      where: { id: bookingId },
      data: { crmJoanaEnabled: enabled },
    });

    const leads = await this.prisma.crmLead.findMany({
      where: { rafaCallBookingId: bookingId, crmExcludedAt: null },
      select: { id: true, instagramUserId: true },
    });
    if (leads.length === 0) return;

    await this.prisma.crmLead.updateMany({
      where: { id: { in: leads.map((l) => l.id) } },
      data: { botEnabled: enabled },
    });

    const igIds = leads
      .map((l) => l.instagramUserId)
      .filter((id): id is string => Boolean(id));
    if (igIds.length === 0) return;

    await this.prisma.joanaConversation.updateMany({
      where: { instagramUserId: { in: igIds } },
      data: enabled
        ? { paused: false }
        : {
            paused: true,
            buffer: [] as Prisma.InputJsonValue,
            pendingOutbound: null,
            processing: false,
          },
    });
  }

  private buildUniqueCrmItems(items: BookingCrmRow[]): BookingCrmRow[] {
    const groups = new Map<string, BookingCrmRow[]>();

    for (const item of items) {
      const digits = this.extractWhatsappDigits(item);
      // Sem WhatsApp (ex.: lead IG): cada booking é um cartão próprio.
      const key = digits || `id:${item.id}`;
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }

    return Array.from(groups.values()).map((group) => {
      const displayBooking = this.pickDisplayBooking(group);
      const crmSource = this.pickCrmSource(group);
      const merged = this.mergeDisplayAndCrm(displayBooking, crmSource);
      const profileFromGroup =
        group.map((row) => row.crmProfileImageUrl?.trim() || null).find(Boolean) ||
        null;
      return {
        ...merged,
        crmProfileImageUrl: merged.crmProfileImageUrl || profileFromGroup,
      };
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
      | 'crmHasVisa'
      | 'crmDesiredRent'
      | 'crmJoanaEnabled'
      | 'crmProfileImageUrl'
      | 'updatedAt'
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
      crmHasVisa: crmSource.crmHasVisa,
      crmDesiredRent: crmSource.crmDesiredRent,
      crmJoanaEnabled: crmSource.crmJoanaEnabled,
      crmProfileImageUrl:
        crmSource.crmProfileImageUrl?.trim() ||
        displayBooking.crmProfileImageUrl ||
        null,
      updatedAt: crmSource.updatedAt,
    };
  }

  /**
   * Best-effort IG: URL Graph (`profile_pic`) → download → WebP em storage →
   * `crmProfileImageUrl` no CrmLead (IGSID) e no RafaCallBooking ligado.
   */
  async ensureCrmProfileImageFromInstagram(
    instagramUserIdRaw: string,
    opts?: {
      remoteUrl?: string | null;
      existingUrl?: string | null;
      force?: boolean;
    },
  ): Promise<string | null> {
    const ig = instagramUserIdRaw.trim();
    if (!ig) return null;

    const existing = opts?.existingUrl?.trim() || null;
    if (existing && !opts?.force) {
      await this.applyCrmProfileImageByInstagram(ig, existing);
      return existing;
    }

    const lockKey = `ig:${ig}`;
    if (this.profileSyncInFlight.has(lockKey)) return existing;
    this.profileSyncInFlight.add(lockKey);

    try {
      if (!opts?.force) {
        const fromLead = await this.prisma.crmLead.findFirst({
          where: {
            instagramUserId: ig,
            crmProfileImageUrl: { not: null },
          },
          select: { crmProfileImageUrl: true, rafaCallBookingId: true },
          orderBy: { updatedAt: 'desc' },
        });
        const cached = fromLead?.crmProfileImageUrl?.trim() || null;
        if (cached) {
          await this.applyCrmProfileImageByInstagram(ig, cached);
          return cached;
        }
        if (fromLead?.rafaCallBookingId) {
          const fromBooking = await this.prisma.rafaCallBooking.findUnique({
            where: { id: fromLead.rafaCallBookingId },
            select: { crmProfileImageUrl: true },
          });
          const bookingUrl = fromBooking?.crmProfileImageUrl?.trim() || null;
          if (bookingUrl) {
            await this.applyCrmProfileImageByInstagram(ig, bookingUrl);
            return bookingUrl;
          }
        }
      }

      const remoteUrl = opts?.remoteUrl?.trim() || null;
      if (!remoteUrl || !/^https?:\/\//i.test(remoteUrl)) return existing;

      const buf = await this.downloadRemoteImage(remoteUrl);
      if (!buf) return existing;

      const { publicUrl } = await this.storage.processCrmAvatarBuffer(buf);
      await this.applyCrmProfileImageByInstagram(ig, publicUrl);
      if (existing && existing !== publicUrl) {
        void this.storage.deleteStoredUrl(existing);
      }
      return publicUrl;
    } catch (e) {
      this.logger.warn(
        `ensureCrmProfileImageFromInstagram(${ig}): ${
          e instanceof Error ? e.message : e
        }`,
      );
      return existing;
    } finally {
      this.profileSyncInFlight.delete(lockKey);
    }
  }

  /**
   * Best-effort: Evolution → download → WebP em R2/`uploads/crm/avatars/` →
   * `crmProfileImageUrl` em todos os bookings do WhatsApp.
   */
  async ensureCrmProfileImage(
    whatsappRaw: string,
    opts?: { existingUrl?: string | null; force?: boolean },
  ): Promise<string | null> {
    const whatsapp = waDigits(whatsappRaw);
    if (!whatsapp) return null;

    const existing = opts?.existingUrl?.trim() || null;
    if (existing && !opts?.force) return existing;

    if (this.profileSyncInFlight.has(whatsapp)) return existing;
    this.profileSyncInFlight.add(whatsapp);

    try {
      if (!opts?.force) {
        const [fromBooking, fromLead] = await Promise.all([
          this.prisma.rafaCallBooking.findFirst({
            where: {
              crmProfileImageUrl: { not: null },
              OR: [{ guestWhatsapp: whatsapp }, { user: { whatsapp } }],
            },
            select: { crmProfileImageUrl: true },
            orderBy: { updatedAt: 'desc' },
          }),
          this.prisma.crmLead.findFirst({
            where: {
              whatsappDigits: whatsapp,
              crmProfileImageUrl: { not: null },
            },
            select: { crmProfileImageUrl: true },
            orderBy: { updatedAt: 'desc' },
          }),
        ]);
        const cached =
          fromBooking?.crmProfileImageUrl?.trim() ||
          fromLead?.crmProfileImageUrl?.trim() ||
          null;
        if (cached) {
          await this.applyCrmProfileImageUrl(whatsapp, cached);
          return cached;
        }
      }

      const remoteUrl = await this.wa.getContactProfilePictureUrl(whatsapp);
      if (!remoteUrl) return existing;

      const buf = await this.downloadRemoteImage(remoteUrl);
      if (!buf) return existing;

      const { publicUrl } = await this.storage.processCrmAvatarBuffer(buf);
      await this.applyCrmProfileImageUrl(whatsapp, publicUrl);
      if (existing && existing !== publicUrl) {
        void this.storage.deleteStoredUrl(existing);
      }
      return publicUrl;
    } catch (e) {
      this.logger.warn(
        `ensureCrmProfileImage(${whatsapp}): ${e instanceof Error ? e.message : e}`,
      );
      return existing;
    } finally {
      this.profileSyncInFlight.delete(whatsapp);
    }
  }

  private scheduleMissingProfileImageBackfill(items: BookingCrmRow[]): void {
    const missing = items
      .map((item) => ({
        digits: this.extractWhatsappDigits(item),
        url: item.crmProfileImageUrl?.trim() || null,
      }))
      .filter((row) => row.digits && !row.url)
      .slice(0, CRM_AVATAR_BOARD_BACKFILL_LIMIT);

    for (const row of missing) {
      void this.ensureCrmProfileImage(row.digits);
    }

    // Sync avatar IG já guardado no CrmLead → booking (sem Graph API aqui —
    // evita ciclo Nest Rafacall ↔ Instagram). Fetch novo fica no webhook/CRM bots.
    const missingWithoutWa = items
      .filter(
        (item) =>
          !this.extractWhatsappDigits(item) && !item.crmProfileImageUrl?.trim(),
      )
      .slice(0, CRM_AVATAR_BOARD_BACKFILL_LIMIT);
    if (missingWithoutWa.length > 0) {
      void this.syncInstagramAvatarsFromCrmLeads(
        missingWithoutWa.map((item) => item.id),
      );
    }
  }

  private async syncInstagramAvatarsFromCrmLeads(
    bookingIds: string[],
  ): Promise<void> {
    if (bookingIds.length === 0) return;
    const leads = await this.prisma.crmLead.findMany({
      where: {
        rafaCallBookingId: { in: bookingIds },
        instagramUserId: { not: null },
        crmProfileImageUrl: { not: null },
      },
      select: {
        instagramUserId: true,
        crmProfileImageUrl: true,
      },
    });
    for (const lead of leads) {
      const ig = lead.instagramUserId?.trim();
      const url = lead.crmProfileImageUrl?.trim();
      if (!ig || !url) continue;
      try {
        await this.ensureCrmProfileImageFromInstagram(ig, { existingUrl: url });
      } catch (e) {
        this.logger.warn(
          `sync IG avatar ${ig}: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
  }

  private async applyCrmProfileImageUrl(
    whatsappDigits: string,
    url: string,
  ): Promise<void> {
    await Promise.all([
      this.prisma.rafaCallBooking.updateMany({
        where: {
          OR: [
            { guestWhatsapp: whatsappDigits },
            { user: { whatsapp: whatsappDigits } },
          ],
        },
        data: { crmProfileImageUrl: url },
      }),
      this.prisma.crmLead.updateMany({
        where: { whatsappDigits },
        data: { crmProfileImageUrl: url },
      }),
    ]);
  }

  private async applyCrmProfileImageByInstagram(
    instagramUserId: string,
    url: string,
  ): Promise<void> {
    const leads = await this.prisma.crmLead.findMany({
      where: { instagramUserId },
      select: { rafaCallBookingId: true },
    });
    const bookingIds = [
      ...new Set(
        leads
          .map((lead) => lead.rafaCallBookingId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    await Promise.all([
      this.prisma.crmLead.updateMany({
        where: { instagramUserId },
        data: { crmProfileImageUrl: url },
      }),
      bookingIds.length > 0
        ? this.prisma.rafaCallBooking.updateMany({
            where: { id: { in: bookingIds } },
            data: { crmProfileImageUrl: url },
          })
        : Promise.resolve(),
    ]);
  }

  private async downloadRemoteImage(url: string): Promise<Buffer | null> {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return null;
      const contentType = (res.headers.get('content-type') || '')
        .split(';')[0]
        ?.trim()
        .toLowerCase();
      if (
        contentType &&
        !contentType.startsWith('image/') &&
        contentType !== 'application/octet-stream'
      ) {
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > CRM_AVATAR_FETCH_MAX_BYTES) return null;
      return buf;
    } catch {
      return null;
    }
  }

  private async serializeCrmItemWithPayments(item: BookingCrmRow) {
    const whatsappDigits = this.extractWhatsappDigits(item);
    const [paymentsMap, documentsMap, igByBooking] = await Promise.all([
      this.loadPaymentsByWhatsapp([whatsappDigits]),
      this.loadDocumentsByWhatsapp([whatsappDigits]),
      this.loadInstagramLinksByBookingIds([item.id]),
    ]);
    return this.serializeCrmItem(
      item,
      paymentsMap.get(whatsappDigits) ?? [],
      documentsMap.get(whatsappDigits) ?? [],
      igByBooking.get(item.id),
    );
  }

  private async loadInstagramLinksByBookingIds(
    bookingIds: string[],
  ): Promise<
    Map<
      string,
      { instagramUsername: string | null; instagramProfileUrl: string | null }
    >
  > {
    const ids = [...new Set(bookingIds.filter(Boolean))];
    const map = new Map<
      string,
      { instagramUsername: string | null; instagramProfileUrl: string | null }
    >();
    if (ids.length === 0) return map;

    const leads = await this.prisma.crmLead.findMany({
      where: { rafaCallBookingId: { in: ids } },
      select: {
        rafaCallBookingId: true,
        instagramHandle: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    for (const lead of leads) {
      const bookingId = lead.rafaCallBookingId;
      if (!bookingId || map.has(bookingId)) continue;
      const username = normalizeIgUsername(lead.instagramHandle);
      map.set(bookingId, {
        instagramUsername: username ? `@${username}` : null,
        instagramProfileUrl: username
          ? `https://instagram.com/${username}`
          : null,
      });
    }
    return map;
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

  private async loadDocumentsByWhatsapp(
    whatsappDigitsList: string[],
  ): Promise<Map<string, SerializedCrmDocument[]>> {
    const digits = [...new Set(whatsappDigitsList.map((d) => waDigits(d)).filter(Boolean))];
    const map = new Map<string, SerializedCrmDocument[]>();
    if (digits.length === 0) return map;

    const rows = await this.prisma.rafaCallCrmDocument.findMany({
      where: { whatsappDigits: { in: digits } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    for (const row of rows) {
      const key = row.whatsappDigits.trim();
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(this.serializeDocument(row));
      map.set(key, list);
    }
    return map;
  }

  private serializeDocument(row: {
    id: string;
    fileName: string;
    fileUrl: string;
    sizeBytes: number;
    createdAt: Date;
  }): SerializedCrmDocument {
    return {
      id: row.id,
      fileName: row.fileName,
      fileUrl: row.fileUrl,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async excludeCrmLeadsLinkedToBooking(
    bookingId: string,
    excludedAt: Date,
  ): Promise<void> {
    const leads = await this.prisma.crmLead.findMany({
      where: { rafaCallBookingId: bookingId, crmExcludedAt: null },
      select: { id: true, instagramUserId: true, whatsappDigits: true },
    });
    if (leads.length === 0) return;

    await this.prisma.crmLead.updateMany({
      where: { id: { in: leads.map((l) => l.id) } },
      data: { crmExcludedAt: excludedAt, botEnabled: false, rafaCallBookingId: null },
    });

    const igIds = leads
      .map((l) => l.instagramUserId)
      .filter((id): id is string => Boolean(id));
    if (igIds.length > 0) {
      await this.prisma.joanaConversation.updateMany({
        where: { instagramUserId: { in: igIds } },
        data: {
          chatbotId: null,
          menuSent: false,
          welcomeSent: false,
          paused: false,
          buffer: [] as Prisma.InputJsonValue,
          pendingOutbound: null,
        },
      });
    }
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
      throw new BadRequestException(
        'Este lead ainda não tem WhatsApp — pagamentos e documentos ficam associados ao número.',
      );
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
      crmPropertyTypology: RafaCallCrmPropertyTypology[];
      crmPreferredCity: string | null;
      crmHasPet: boolean | null;
      crmHasVisa: boolean | null;
      crmDesiredRent: number | null;
      crmJoanaEnabled: boolean;
      crmProfileImageUrl?: string | null;
      startsAt: Date;
      endsAt: Date;
      timezone: string;
      origin: string;
      guestName: string | null;
      guestWhatsapp: string | null;
      updatedAt: Date;
      user: { id: string; name: string | null; whatsapp: string | null } | null;
    },
    payments: ReturnType<RafacallCrmService['serializePayment']>[] = [],
    documents: SerializedCrmDocument[] = [],
    ig?: {
      instagramUsername: string | null;
      instagramProfileUrl: string | null;
    } | null,
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
      crmHasVisa: item.crmHasVisa,
      crmDesiredRent: item.crmDesiredRent,
      crmJoanaEnabled: item.crmJoanaEnabled,
      crmProfileImageUrl: item.crmProfileImageUrl?.trim() || null,
      payments,
      paymentsTotal,
      documents,
      startsAt: item.startsAt.toISOString(),
      endsAt: item.endsAt.toISOString(),
      bookingTimezone: item.timezone,
      bookingOrigin: item.origin,
      userId: item.user?.id ?? null,
      userName: item.user?.name ?? item.guestName ?? null,
      whatsappDigits,
      instagramUsername: ig?.instagramUsername ?? null,
      instagramProfileUrl: ig?.instagramProfileUrl ?? null,
      updatedAt: item.updatedAt.toISOString(),
    };
  }
}
