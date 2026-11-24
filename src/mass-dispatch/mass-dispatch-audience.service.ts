import { Injectable } from '@nestjs/common';
import {
  ChatbotChannel,
  MassCampaignSourceType,
  Prisma,
  RafaCallBookingStatus,
  RafaCallCrmPropertyTypology,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MASS_DISPATCH_BOT_SLUGS,
  type MassDispatchBotSlug,
  type MassDispatchFiltersDto,
} from './dto/mass-dispatch.dto';

export type MassAudienceItem = {
  botSlug: MassDispatchBotSlug;
  sourceType: MassCampaignSourceType;
  sourceId: string;
  conversationId: string;
  channel: ChatbotChannel;
  whatsappDigits: string | null;
  instagramUserId: string | null;
  displayName: string | null;
  hasVisa: boolean | null;
  propertyTypology: RafaCallCrmPropertyTypology[];
  preferredCity: string | null;
  expectedImmigrationAt: string | null;
  immigrationImmediate: boolean;
};

type ConversationPeer = {
  id: string;
  activeChannel: ChatbotChannel;
  whatsappDigits: string | null;
  instagramUserId: string | null;
  displayName: string | null;
  updatedAt: Date;
};

@Injectable()
export class MassDispatchAudienceService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveAudience(
    filters: MassDispatchFiltersDto,
  ): Promise<MassAudienceItem[]> {
    const bots = this.normalizeBots(filters.bots);
    const includeJoana = bots.includes('joana');
    const genericSlugs = bots.filter((b) => b !== 'joana');

    const items: MassAudienceItem[] = [];
    if (includeJoana) {
      items.push(...(await this.resolveJoana(filters)));
    }
    if (genericSlugs.length > 0) {
      items.push(...(await this.resolveGenericLeads(genericSlugs, filters)));
    }

    return this.dedupeByConversation(items);
  }

  private normalizeBots(
    bots?: MassDispatchBotSlug[],
  ): MassDispatchBotSlug[] {
    // `undefined` / omitido → todos; `[]` explícito → nenhum.
    if (bots === undefined) return [...MASS_DISPATCH_BOT_SLUGS];
    return [...new Set(bots)];
  }

  private qualificationWhere(
    filters: MassDispatchFiltersDto,
  ): Prisma.RafaCallBookingWhereInput {
    const where: Prisma.RafaCallBookingWhereInput = {};

    if (typeof filters.hasVisa === 'boolean') {
      where.crmHasVisa = filters.hasVisa;
    }

    if (filters.typologies && filters.typologies.length > 0) {
      where.crmPropertyTypology = {
        hasSome: filters.typologies as RafaCallCrmPropertyTypology[],
      };
    }

    const city = (filters.preferredCityContains || '').trim();
    if (city) {
      where.crmPreferredCity = {
        contains: city,
        mode: 'insensitive',
      };
    }

    const immigration = this.immigrationWhere(filters);
    if (immigration) {
      Object.assign(where, immigration);
    }

    return where;
  }

  private leadQualificationWhere(
    filters: MassDispatchFiltersDto,
  ): Prisma.CrmLeadWhereInput {
    const where: Prisma.CrmLeadWhereInput = {};

    if (typeof filters.hasVisa === 'boolean') {
      where.crmHasVisa = filters.hasVisa;
    }

    if (filters.typologies && filters.typologies.length > 0) {
      where.crmPropertyTypology = {
        hasSome: filters.typologies as RafaCallCrmPropertyTypology[],
      };
    }

    const city = (filters.preferredCityContains || '').trim();
    if (city) {
      where.crmPreferredCity = {
        contains: city,
        mode: 'insensitive',
      };
    }

    const immigration = this.immigrationWhere(filters);
    if (immigration) {
      Object.assign(where, immigration);
    }

    return where;
  }

  private immigrationWhere(
    filters: MassDispatchFiltersDto,
  ): Prisma.RafaCallBookingWhereInput | null {
    const from = this.parseCivilDate(filters.immigrationFrom);
    const to = this.parseCivilDate(filters.immigrationTo);
    const wantImmediate = filters.immigrationImmediate === true;
    const hasRange = Boolean(from || to);

    if (!wantImmediate && !hasRange) return null;

    const dateClause: Prisma.DateTimeNullableFilter = {};
    if (from) dateClause.gte = from;
    if (to) dateClause.lte = to;

    if (wantImmediate && hasRange) {
      return {
        OR: [
          { crmImmigrationImmediate: true },
          { crmExpectedImmigrationAt: dateClause },
        ],
      };
    }
    if (wantImmediate) {
      return { crmImmigrationImmediate: true };
    }
    return { crmExpectedImmigrationAt: dateClause };
  }

  private parseCivilDate(raw?: string): Date | null {
    const iso = (raw || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    return new Date(`${iso}T12:00:00.000Z`);
  }

  private async resolveJoana(
    filters: MassDispatchFiltersDto,
  ): Promise<MassAudienceItem[]> {
    const bookings = await this.prisma.rafaCallBooking.findMany({
      where: {
        status: {
          in: [RafaCallBookingStatus.SCHEDULED, RafaCallBookingStatus.COMPLETED],
        },
        crmExcludedAt: null,
        ...this.qualificationWhere(filters),
      },
      select: {
        id: true,
        guestName: true,
        guestWhatsapp: true,
        crmHasVisa: true,
        crmPropertyTypology: true,
        crmPreferredCity: true,
        crmExpectedImmigrationAt: true,
        crmImmigrationImmediate: true,
        user: { select: { name: true, whatsapp: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (bookings.length === 0) return [];

    const bookingIds = bookings.map((b) => b.id);
    const linkedLeads = await this.prisma.crmLead.findMany({
      where: {
        rafaCallBookingId: { in: bookingIds },
        crmExcludedAt: null,
      },
      select: {
        rafaCallBookingId: true,
        whatsappDigits: true,
        instagramUserId: true,
        guestName: true,
      },
    });
    const leadByBooking = new Map(
      linkedLeads
        .filter((l) => l.rafaCallBookingId)
        .map((l) => [l.rafaCallBookingId!, l]),
    );

    const identities = bookings.map((booking) => {
      const linked = leadByBooking.get(booking.id);
      const whatsapp =
        (booking.guestWhatsapp || '').replace(/\D/g, '') ||
        (booking.user?.whatsapp || '').replace(/\D/g, '') ||
        (linked?.whatsappDigits || '').replace(/\D/g, '') ||
        null;
      const ig = (linked?.instagramUserId || '').trim() || null;
      return { booking, linked, whatsapp, ig };
    });

    const conversationByKey = await this.loadConversations(
      identities.map((i) => ({ whatsapp: i.whatsapp, ig: i.ig })),
    );

    const items: MassAudienceItem[] = [];
    for (const row of identities) {
      const peer = this.pickConversation(conversationByKey, row.whatsapp, row.ig);
      if (!peer) continue;

      items.push({
        botSlug: 'joana',
        sourceType: MassCampaignSourceType.BOOKING,
        sourceId: row.booking.id,
        conversationId: peer.id,
        channel: peer.activeChannel,
        whatsappDigits: peer.whatsappDigits,
        instagramUserId: peer.instagramUserId,
        displayName:
          row.booking.guestName?.trim() ||
          row.booking.user?.name?.trim() ||
          row.linked?.guestName?.trim() ||
          peer.displayName ||
          null,
        hasVisa: row.booking.crmHasVisa,
        propertyTypology: row.booking.crmPropertyTypology,
        preferredCity: row.booking.crmPreferredCity,
        expectedImmigrationAt: row.booking.crmExpectedImmigrationAt
          ? row.booking.crmExpectedImmigrationAt.toISOString().slice(0, 10)
          : null,
        immigrationImmediate: row.booking.crmImmigrationImmediate,
      });
    }
    return items;
  }

  private async resolveGenericLeads(
    slugs: MassDispatchBotSlug[],
    filters: MassDispatchFiltersDto,
  ): Promise<MassAudienceItem[]> {
    const bots = await this.prisma.chatbot.findMany({
      where: { slug: { in: slugs }, enabled: true },
      select: { id: true, slug: true },
    });
    if (bots.length === 0) return [];

    const leads = await this.prisma.crmLead.findMany({
      where: {
        chatbotId: { in: bots.map((b) => b.id) },
        crmExcludedAt: null,
        rafaCallBookingId: null,
        ...this.leadQualificationWhere(filters),
      },
      select: {
        id: true,
        guestName: true,
        whatsappDigits: true,
        instagramUserId: true,
        crmHasVisa: true,
        crmPropertyTypology: true,
        crmPreferredCity: true,
        crmExpectedImmigrationAt: true,
        crmImmigrationImmediate: true,
        chatbot: { select: { slug: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const identities = leads
      .filter((lead) => slugs.includes(lead.chatbot.slug as MassDispatchBotSlug))
      .map((lead) => ({
        lead,
        whatsapp: (lead.whatsappDigits || '').replace(/\D/g, '') || null,
        ig: (lead.instagramUserId || '').trim() || null,
      }));

    const conversationByKey = await this.loadConversations(
      identities.map((i) => ({ whatsapp: i.whatsapp, ig: i.ig })),
    );

    const items: MassAudienceItem[] = [];
    for (const row of identities) {
      const peer = this.pickConversation(conversationByKey, row.whatsapp, row.ig);
      if (!peer) continue;

      items.push({
        botSlug: row.lead.chatbot.slug as MassDispatchBotSlug,
        sourceType: MassCampaignSourceType.CRM_LEAD,
        sourceId: row.lead.id,
        conversationId: peer.id,
        channel: peer.activeChannel,
        whatsappDigits: peer.whatsappDigits,
        instagramUserId: peer.instagramUserId,
        displayName: row.lead.guestName?.trim() || peer.displayName || null,
        hasVisa: row.lead.crmHasVisa,
        propertyTypology: row.lead.crmPropertyTypology,
        preferredCity: row.lead.crmPreferredCity,
        expectedImmigrationAt: row.lead.crmExpectedImmigrationAt
          ? row.lead.crmExpectedImmigrationAt.toISOString().slice(0, 10)
          : null,
        immigrationImmediate: row.lead.crmImmigrationImmediate,
      });
    }
    return items;
  }

  private async loadConversations(
    identities: Array<{ whatsapp: string | null; ig: string | null }>,
  ): Promise<Map<string, ConversationPeer[]>> {
    const whatsapps = [
      ...new Set(
        identities
          .map((i) => i.whatsapp)
          .filter((w): w is string => Boolean(w && w.length >= 8)),
      ),
    ];
    const igs = [
      ...new Set(
        identities
          .map((i) => i.ig)
          .filter((ig): ig is string => Boolean(ig)),
      ),
    ];

    const map = new Map<string, ConversationPeer[]>();
    if (whatsapps.length === 0 && igs.length === 0) return map;

    const or: Prisma.JoanaConversationWhereInput[] = [];
    if (whatsapps.length > 0) or.push({ whatsappDigits: { in: whatsapps } });
    if (igs.length > 0) or.push({ instagramUserId: { in: igs } });

    const rows = await this.prisma.joanaConversation.findMany({
      where: { OR: or },
      select: {
        id: true,
        activeChannel: true,
        whatsappDigits: true,
        instagramUserId: true,
        displayName: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    for (const row of rows) {
      const digits = (row.whatsappDigits || '').replace(/\D/g, '');
      if (digits.length >= 8) {
        const key = `wa:${digits}`;
        const list = map.get(key) ?? [];
        list.push(row);
        map.set(key, list);
      }
      const ig = (row.instagramUserId || '').trim();
      if (ig) {
        const key = `ig:${ig}`;
        const list = map.get(key) ?? [];
        list.push(row);
        map.set(key, list);
      }
    }
    return map;
  }

  private pickConversation(
    map: Map<string, ConversationPeer[]>,
    whatsapp: string | null,
    ig: string | null,
  ): ConversationPeer | null {
    const candidates: ConversationPeer[] = [];
    if (whatsapp && whatsapp.length >= 8) {
      candidates.push(...(map.get(`wa:${whatsapp}`) ?? []));
    }
    if (ig) {
      candidates.push(...(map.get(`ig:${ig}`) ?? []));
    }
    if (candidates.length === 0) return null;

    const unique = new Map<string, ConversationPeer>();
    for (const c of candidates) unique.set(c.id, c);
    const sorted = [...unique.values()].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    );

    for (const row of sorted) {
      if (this.isValidPeer(row)) return row;
    }
    return null;
  }

  private isValidPeer(row: ConversationPeer): boolean {
    if (row.activeChannel === ChatbotChannel.INSTAGRAM) {
      return Boolean((row.instagramUserId || '').trim());
    }
    if (row.activeChannel === ChatbotChannel.WHATSAPP) {
      return (row.whatsappDigits || '').replace(/\D/g, '').length >= 8;
    }
    return false;
  }

  private dedupeByConversation(items: MassAudienceItem[]): MassAudienceItem[] {
    const seen = new Set<string>();
    const out: MassAudienceItem[] = [];
    for (const item of items) {
      if (seen.has(item.conversationId)) continue;
      seen.add(item.conversationId);
      out.push(item);
    }
    return out;
  }
}
