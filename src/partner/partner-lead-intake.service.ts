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

  private displayFirstName(fullName: string | null | undefined): string | null {
    const n = fullName?.trim();
    if (!n) return null;
    return n.split(/\s+/)[0] ?? n;
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
    evolutionInstance?: string;
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
        interestComment: opts.interestComment,
        ...(contact.userId
          ? { userId: contact.userId }
          : { visitorId: contact.visitorId! }),
      },
    });

    const avgStats = await computePartnerAverageResponseMinutes(partner.id, this.prisma);
    await this.sendConfirmationToLead(
      opts.normalizedWhatsappDigits,
      contact.displayName,
      partner.name,
      avgStats.averageMinutes,
      opts.evolutionInstance,
    );
    await this.sendPartnerNewLeadNotice(partner.whatsapp, opts.evolutionInstance);

    return { leadId: lead.id };
  }

  async processInbound(dto: {
    whatsapp: string;
    message: string;
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
