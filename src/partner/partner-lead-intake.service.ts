import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { getFrontendBaseUrl } from '../config/frontend-base-url';
import { computePartnerAverageResponseMinutes } from './partner-response-average.util';
import { JwtService } from '@nestjs/jwt';

function normalizeInboundTrigger(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function isPartnerLeadTrigger(text: string): boolean {
  return normalizeInboundTrigger(text).startsWith('ola, gostaria');
}

export function extractPartnerNameFromMessage(raw: string): string | null {
  const t = raw.trim();
  const m1 = /^Olá,?\s*gostaria\s+de\s+atendimento\s+com\s+(.+)$/i.exec(t);
  if (m1) return m1[1].trim();
  const m2 = /Atendimento\s+com\s+(.+?)\s*\.?\s*$/i.exec(t);
  if (m2) return m2[1].trim().replace(/\.\s*$/, '').trim();
  return null;
}

export function extractInterestComment(raw: string, partnerName: string): string {
  const t = raw.trim();
  const svc =
    /gostaria\s+de\s+mais\s+informa[cç][oô]es\s+sobre\s+o\s+servi[cç]o\s+"([^"]+)"/i.exec(
      t,
    );
  if (svc) return `Serviço: ${svc[1].trim()}`;
  const imo =
    /gostaria\s+de\s+mais\s+informa[cç][oô]es\s+sobre\s+o\s+im[oó]vel\s+(.+)/i.exec(
      t,
    );
  if (imo) {
    const rest = imo[1].replace(/\s*Atendimento\s+com\s+.+$/i, '').trim();
    return `Imóvel: ${rest}`;
  }
  return `Pedido de atendimento com ${partnerName}`;
}

export function formatAvgMinutesForMessage(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) {
    return 'breve (ainda sem histórico)';
  }
  if (minutes < 60) {
    return `cerca de ${Math.max(1, Math.round(minutes))} minutos`;
  }
  const h = minutes / 60;
  const rounded = h >= 10 ? Math.round(h) : Math.round(h * 10) / 10;
  const s = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/\.0$/, '');
  return `cerca de ${s} horas`;
}

@Injectable()
export class PartnerLeadIntakeService {
  private readonly logger = new Logger(PartnerLeadIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsApp: WhatsAppService,
    private readonly jwtService: JwtService,
  ) {}

  private leadsPageUrl(): string {
    return `${getFrontendBaseUrl()}/dashboard/leads`;
  }

  private leadConfirmationText(opts: {
    contactFirstName: string | null;
    partnerName: string;
    avgMinutes: number | null;
  }): string {
    const avg = formatAvgMinutesForMessage(opts.avgMinutes);
    const greet = opts.contactFirstName
      ? `Olá ${opts.contactFirstName}, tudo bem?`
      : `Olá, tudo bem?`;
    return `${greet} Registámos o seu pedido de atendimento com ${opts.partnerName}. O tempo médio de resposta em horário comercial (segunda a sexta, das 10h às 18h de Portugal) está em ${avg}. Se o nosso parceiro demorar muito mais do que isso, chama-me aqui que eu resolvo 😊`;
  }

  private partnerNewLeadText(): string {
    return `Recebeu um novo pedido de atendimento em ${this.leadsPageUrl()}`;
  }

  private relocationServiceInfoText(): string {
    return (
      'O serviço de relocation é focado em preparar toda a sua chegada antes mesmo do embarque — desde a busca e validação do imóvel, negociação com senhorios, análise de contratos, até as ligações de serviços essenciais como água, luz, gás e internet.\n\n' +
      'O objetivo é simples: te ajudar a evitar erros, golpes e gastos desnecessários, garantindo que você chegue em Portugal direto ao seu novo lar, com tranquilidade, segurança e planejamento.'
    );
  }

  private stripHttpProtocol(url: string): string {
    return url.replace(/^https?:\/\//i, '');
  }

  private leadRedirectUrl(leadId: string): string {
    // Link aberto (sem token) e sem protocolo para evitar preview e encurtar.
    const base = this.stripHttpProtocol(getFrontendBaseUrl()).replace(/\/+$/, '');
    return `${base}/lead-redirect?leadId=${encodeURIComponent(leadId)}`;
  }

  private displayFirstName(fullName: string | null | undefined): string | null {
    const n = fullName?.trim();
    if (!n) return null;
    return n.split(/\s+/)[0] ?? n;
  }

  private displayFirstNameFromContactName(contactName: string | null | undefined): string | null {
    return this.displayFirstName(contactName);
  }

  /** Número só com dígitos (consistente com registo/auth). */
  private normalizeWaDigits(value: string): string {
    return value.replace(/\D/g, '');
  }

  /**
   * Resolve utilizador registado ou visitante. Falha se for conta parceiro/admin.
   */
  async resolveLeadContact(digits: string): Promise<{
    userId?: string;
    visitorId?: string;
    displayName: string | null;
  }> {
    if (!digits) {
      throw new BadRequestException('WhatsApp inválido.');
    }

    const user = await this.prisma.user.findUnique({
      where: { whatsapp: digits },
      select: { id: true, role: true, name: true },
    });

    if (user) {
      if (user.role === Role.PARTNER || user.role === Role.ADMIN) {
        throw new BadRequestException(
          'Este número pertence a um parceiro ou administrador.',
        );
      }
      return {
        userId: user.id,
        displayName: this.displayFirstName(user.name),
      };
    }

    const visitor = await this.prisma.visitor.upsert({
      where: { whatsapp: digits },
      create: { whatsapp: digits },
      update: {},
      select: { id: true },
    });
    return { visitorId: visitor.id, displayName: null };
  }

  private async sendConfirmationToLead(
    digits: string,
    contactFirstName: string | null,
    partnerName: string,
    averageResponseMinutes: number | null,
    evolutionInstance?: string,
  ): Promise<void> {
    const text = this.leadConfirmationText({
      contactFirstName,
      partnerName,
      avgMinutes: averageResponseMinutes,
    });
    await this.whatsApp.sendText(digits, text, {
      preferredInstance: evolutionInstance,
    });
  }

  private async sendPartnerNewLeadNotice(
    partnerWhatsappRaw: string,
    evolutionInstance?: string,
  ): Promise<void> {
    const digits = this.normalizeWaDigits(partnerWhatsappRaw);
    if (!digits) return;
    await this.whatsApp.sendText(digits, this.partnerNewLeadText(), {
      preferredInstance: evolutionInstance,
    });
  }

  async createLeadAndNotify(opts: {
    normalizedWhatsappDigits: string;
    partnerId: string;
    interestComment: string;
    contactName?: string;
    evolutionInstance?: string;
    notifyPartnerNewLeadNotice?: boolean;
  }): Promise<{ leadId: string }> {
    const partner = await this.prisma.partner.findUnique({
      where: { id: opts.partnerId },
      select: {
        id: true,
        name: true,
        whatsapp: true,
      },
    });
    if (!partner) {
      throw new NotFoundException('Parceiro não encontrado.');
    }

    const contact = await this.resolveLeadContact(opts.normalizedWhatsappDigits);

    const lead = await this.prisma.lead.create({
      data: {
        partnerId: partner.id,
        contactName: opts.contactName?.trim() ? opts.contactName.trim() : null,
        interestComment: opts.interestComment,
        ...(contact.userId
          ? { userId: contact.userId }
          : { visitorId: contact.visitorId! }),
      } as any,
    });

    const avgStats = await computePartnerAverageResponseMinutes(partner.id, this.prisma);
    await this.sendConfirmationToLead(
      opts.normalizedWhatsappDigits,
      contact.displayName ?? this.displayFirstNameFromContactName(opts.contactName),
      partner.name,
      avgStats.averageMinutes,
      opts.evolutionInstance,
    );
    if (opts.notifyPartnerNewLeadNotice !== false) {
      await this.sendPartnerNewLeadNotice(partner.whatsapp, opts.evolutionInstance);
    }

    return { leadId: lead.id };
  }

  private async pickPartnerForCategoryByPriorityAndCapacity(categorySlug: string): Promise<{
    partnerId: string;
    partnerName: string;
    partnerWhatsapp: string;
  } | null> {
    const partners = (await this.prisma.partner.findMany({
      where: { category: { slug: categorySlug } },
      select: {
        id: true,
        name: true,
        whatsapp: true,
        priority: true,
        maxPendingLeads: true,
        createdAt: true,
      } as any,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] as any,
    })) as any[];
    if (!partners.length) return null;

    const ids = partners.map((p) => p.id);
    const grouped = await this.prisma.lead.groupBy({
      by: ['partnerId'],
      where: { partnerId: { in: ids }, attendedAt: null },
      _count: { _all: true },
    } as any);
    const pendingById = new Map<string, number>();
    for (const g of grouped as any[]) {
      pendingById.set(String(g.partnerId), Number(g._count?._all ?? 0));
    }

    const pendingCount = (pid: string) => pendingById.get(pid) ?? 0;
    const capacityOk = (p: any) => {
      const max = typeof p.maxPendingLeads === 'number' ? p.maxPendingLeads : 0;
      if (max <= 0) return true; // 0 = sem limite
      return pendingCount(p.id) < max;
    };

    const firstEligible = partners.find(capacityOk);
    if (firstEligible) {
      return { partnerId: firstEligible.id, partnerName: firstEligible.name, partnerWhatsapp: firstEligible.whatsapp };
    }

    // Todos cheios: escolhe o que tem menos pendentes; empate por prioridade (já ordenado)
    let best = partners[0]!;
    let bestPending = pendingCount(best.id);
    for (const p of partners.slice(1)) {
      const pc = pendingCount(p.id);
      if (pc < bestPending) {
        best = p;
        bestPending = pc;
      }
    }
    return { partnerId: best.id, partnerName: best.name, partnerWhatsapp: best.whatsapp };
  }

  /**
   * Novo flow: "mais sobre o serviço de relocation".
   * - Responde com texto informativo.
   * - Cria lead e atribui parceiro pela regra de prioridade + max pendentes.
   * - Notifica o utilizador com a mensagem padrão.
   * - Notifica o parceiro com lista + links de atendimento (sem login).
   */
  async processRelocationServiceInfoInbound(dto: {
    whatsapp: string;
    message: string;
    contactName?: string;
    evolutionInstance?: string;
    messageId?: string;
  }): Promise<{ ok: boolean; skipped?: string }> {
    const normalizedFrom = this.normalizeWaDigits(dto.whatsapp);
    if (!normalizedFrom) return { ok: true, skipped: 'no-phone' };

    const raw = String(dto.message || '').trim();
    const normalized = normalizeInboundTrigger(raw);
    if (!normalized.includes('mais sobre o servico de relocation')) {
      return { ok: true, skipped: 'not-trigger' };
    }

    // 1) Sempre responde com o texto informativo
    await this.whatsApp.sendText(normalizedFrom, this.relocationServiceInfoText(), {
      preferredInstance: dto.evolutionInstance,
    });

    // 2) Escolhe parceiro
    const picked = await this.pickPartnerForCategoryByPriorityAndCapacity('relocation');
    if (!picked) {
      // Sem parceiros: não cria lead (evita erro); já respondeu com info.
      return { ok: true, skipped: 'no-partners' };
    }

    // 3) Cria lead + notifica user + aviso básico ao parceiro (reuso do fluxo existente)
    const created = await this.createLeadAndNotify({
      normalizedWhatsappDigits: normalizedFrom,
      partnerId: picked.partnerId,
      interestComment: 'Mais sobre o serviço de relocation',
      contactName: dto.contactName,
      evolutionInstance: dto.evolutionInstance,
      notifyPartnerNewLeadNotice: false,
    });

    // 4) Envia lista de leads pendentes ao parceiro (inclui o lead recém criado)
    const pending = (await this.prisma.lead.findMany({
      where: { partnerId: picked.partnerId, attendedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        user: { select: { name: true, whatsapp: true } },
        visitor: { select: { whatsapp: true } },
      },
    })) as any[];

    const partnerDigits = this.normalizeWaDigits(picked.partnerWhatsapp);
    if (partnerDigits) {
      const lines: string[] = [];
      lines.push('Olá, temos esses leads aguardando atendimento 🙂:');
      for (const l of pending) {
        const leadName =
          (typeof l.contactName === 'string' && l.contactName.trim()) ||
          (typeof l.user?.name === 'string' && l.user.name.trim()) ||
          'Cliente WhatsApp';
        const url = this.leadRedirectUrl(String(l.id));
        lines.push(`- ${leadName} — ${url}`);
      }
      await this.whatsApp.sendText(partnerDigits, lines.join('\n'), {
        preferredInstance: dto.evolutionInstance,
      });
    }

    return { ok: true };
  }

  async processInbound(dto: {
    whatsapp: string;
    message: string;
    contactName?: string;
    evolutionInstance?: string;
    messageId?: string;
  }): Promise<{ ok: boolean; skipped?: string }> {
    const normalizedFrom = this.normalizeWaDigits(dto.whatsapp);
    if (!normalizedFrom) {
      return { ok: true, skipped: 'no-phone' };
    }

    const rawMsg = dto.message.trim();
    if (!rawMsg || !isPartnerLeadTrigger(rawMsg)) {
      return { ok: true, skipped: 'not-trigger' };
    }

    const partnerName = extractPartnerNameFromMessage(rawMsg);
    if (!partnerName) {
      this.logger.warn(
        `partner-lead-intake: sem nome de parceiro: ${rawMsg.slice(0, 120)}`,
      );
      return { ok: true, skipped: 'no-partner-name' };
    }

    if (dto.messageId) {
      try {
        await this.prisma.processedPartnerLeadMessage.create({
          data: { id: dto.messageId },
        });
      } catch (e: unknown) {
        const code = (e as { code?: string })?.code;
        if (code === 'P2002') {
          return { ok: true, skipped: 'duplicate-msg' };
        }
        throw e;
      }
    }

    const partner = await this.prisma.partner.findFirst({
      where: { name: { equals: partnerName, mode: 'insensitive' } },
      select: { id: true, name: true, whatsapp: true },
    });

    if (!partner) {
      this.logger.warn(`partner-lead-intake: parceiro desconhecido "${partnerName}"`);
      return { ok: true, skipped: 'unknown-partner' };
    }

    const interestComment = extractInterestComment(rawMsg, partner.name);

    try {
      await this.createLeadAndNotify({
        normalizedWhatsappDigits: normalizedFrom,
        partnerId: partner.id,
        interestComment,
        contactName: dto.contactName,
        evolutionInstance: dto.evolutionInstance,
      });
    } catch (err: unknown) {
      if (err instanceof BadRequestException) {
        this.logger.warn(
          `partner-lead-intake: ${err.message} (from=${normalizedFrom})`,
        );
        return { ok: true, skipped: 'invalid-contact' };
      }
      throw err;
    }

    return { ok: true };
  }

  async adminManualLead(
    partnerId: string,
    whatsappRaw: string,
    interestComment?: string,
  ): Promise<{ leadId: string }> {
    const digits = this.normalizeWaDigits(whatsappRaw);
    if (!digits) {
      throw new BadRequestException('WhatsApp inválido.');
    }
    const partner = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      select: { id: true },
    });
    if (!partner) {
      throw new NotFoundException('Parceiro não encontrado.');
    }

    const comment =
      interestComment?.trim() || 'Pedido registado manualmente pela equipa.';

    return this.createLeadAndNotify({
      normalizedWhatsappDigits: digits,
      partnerId,
      interestComment: comment,
    });
  }
}
