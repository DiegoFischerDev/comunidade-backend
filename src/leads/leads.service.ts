import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Módulo interno de leads — substitui a antiga integração externa com `ia-app`.
 *
 * Um lead é capturado pelo questionário público `/financiamento` e atribuído a um parceiro da
 * categoria `financiamento` via round-robin total-time (parceiro com menos leads no total
 * recebe o próximo). Sem máquina de estados; o parceiro vê a lista cronológica em
 * `/dashboard/leads`.
 */
@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria um lead e atribui ao parceiro `financiamento` com menos leads no total.
   * Idempotência: callers podem repetir em caso de erro — o lead duplica-se intencionalmente
   * (não há chave de unicidade por email/whatsapp). É raro o utilizador clicar duas vezes e,
   * quando acontece, o parceiro consegue gerir o ruído manualmente.
   */
  async createForFinancingQuiz(input: {
    name: string;
    whatsapp: string;
    email: string;
    comment: string;
    outcomeKey: string;
  }): Promise<{ lead: { id: string; createdAt: Date }; partnerId: string }> {
    const name = input.name.trim();
    const whatsapp = input.whatsapp.trim();
    const email = input.email.trim();
    if (!name || !whatsapp || !email) {
      throw new BadRequestException('Nome, WhatsApp e email são obrigatórios.');
    }

    const partnerId = await this.pickFinancingPartnerWithFewestLeads();
    if (!partnerId) {
      // Nenhum parceiro configurado como `financiamento` — falha clara para o quiz mostrar
      // um erro razoável; em produção isto não deve acontecer.
      throw new InternalServerErrorException(
        'Nenhum parceiro de financiamento disponível no momento. Tenta novamente em instantes.',
      );
    }

    try {
      const lead = await this.prisma.lead.create({
        data: {
          name,
          whatsapp,
          email,
          comment: input.comment,
          outcomeKey: input.outcomeKey,
          partnerId,
        },
        select: { id: true, createdAt: true },
      });
      return { lead, partnerId };
    } catch (e) {
      this.logger.error(`Falha ao criar lead: ${(e as Error).message}`);
      throw new InternalServerErrorException(
        'Não foi possível registar o lead.',
      );
    }
  }

  /**
   * Round-robin total-time: devolve o `partnerId` de um parceiro `financiamento` com o
   * menor número de leads acumulado. Em caso de empate, escolhe o mais antigo (createdAt
   * ascendente) para manter determinismo.
   *
   * Há uma race condition teórica (dois quizes submetidos no mesmo instante) que pode dar o
   * mesmo parceiro nas duas chamadas. Não vale a pena adicionar advisory lock pelo volume
   * esperado; ficamos com distribuição aproximadamente justa.
   */
  private async pickFinancingPartnerWithFewestLeads(): Promise<string | null> {
    // Lista todos os parceiros `financiamento` com contagem agregada de leads.
    const rows = await this.prisma.partner.findMany({
      where: { categorySlug: 'financiamento' },
      select: {
        id: true,
        createdAt: true,
        _count: { select: { leads: true } },
      },
    });
    if (rows.length === 0) return null;

    // Menor `_count.leads` ganha; desempate pelo `createdAt` mais antigo.
    rows.sort((a, b) => {
      if (a._count.leads !== b._count.leads)
        return a._count.leads - b._count.leads;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    return rows[0].id;
  }

  /** Lista os leads do parceiro autenticado (ordem cronológica reversa). */
  async listForPartner(userId: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { userId },
      select: { id: true, categorySlug: true },
    });
    if (!partner) {
      throw new NotFoundException(
        'Parceiro não encontrado para este utilizador.',
      );
    }

    // Apenas parceiros `financiamento` recebem leads do quiz. Outros tipos veem lista vazia
    // (não há necessidade de 403 — o dashboard simplesmente esconde o link no menu).
    if (partner.categorySlug !== 'financiamento') {
      return { items: [] as LeadListItem[] };
    }

    const rows = await this.prisma.lead.findMany({
      where: { partnerId: partner.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        whatsapp: true,
        email: true,
        comment: true,
        outcomeKey: true,
        docsSentAt: true,
        createdAt: true,
        _count: { select: { submissions: true } },
      },
    });
    const items: LeadListItem[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      whatsapp: r.whatsapp,
      email: r.email,
      comment: r.comment,
      outcomeKey: r.outcomeKey,
      docsSentAt: r.docsSentAt,
      submissionsCount: r._count.submissions,
      createdAt: r.createdAt,
    }));
    return { items };
  }

  /** Atualiza um lead do parceiro autenticado (apenas leads atribuídos a ele). */
  async updateForPartner(
    userId: string,
    leadId: string,
    input: {
      name?: string;
      email?: string;
      whatsapp?: string;
      comment?: string | null;
    },
  ) {
    const partner = await this.prisma.partner.findUnique({
      where: { userId },
      select: { id: true, categorySlug: true },
    });
    if (!partner) {
      throw new NotFoundException(
        'Parceiro não encontrado para este utilizador.',
      );
    }
    if (partner.categorySlug !== 'financiamento') {
      throw new NotFoundException('Lead não encontrado.');
    }

    const existing = await this.prisma.lead.findFirst({
      where: { id: leadId, partnerId: partner.id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Lead não encontrado.');

    const data: Record<string, unknown> = {};
    if (typeof input.name === 'string') data.name = input.name.trim();
    if (typeof input.email === 'string') data.email = input.email.trim();
    if (typeof input.whatsapp === 'string')
      data.whatsapp = input.whatsapp.replace(/\D+/g, '');
    if (typeof input.comment !== 'undefined') data.comment = input.comment;

    if (!Object.keys(data).length) {
      const lead = await this.prisma.lead.findUnique({
        where: { id: leadId },
        select: {
          id: true,
          name: true,
          whatsapp: true,
          email: true,
          comment: true,
          outcomeKey: true,
          docsSentAt: true,
          createdAt: true,
          _count: { select: { submissions: true } },
        },
      });
      if (!lead) throw new NotFoundException('Lead não encontrado.');
      return {
        ...lead,
        submissionsCount: lead._count.submissions,
      };
    }

    const updated = await this.prisma.lead.update({
      where: { id: leadId },
      data,
      select: {
        id: true,
        name: true,
        whatsapp: true,
        email: true,
        comment: true,
        outcomeKey: true,
        docsSentAt: true,
        createdAt: true,
        _count: { select: { submissions: true } },
      },
    });
    return {
      ...updated,
      submissionsCount: updated._count.submissions,
    };
  }

  /** Lista todos os leads para o admin, com o parceiro associado. */
  async listForAdmin() {
    const rows = await this.prisma.lead.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        whatsapp: true,
        email: true,
        comment: true,
        outcomeKey: true,
        docsSentAt: true,
        createdAt: true,
        partner: {
          select: {
            id: true,
            name: true,
            categorySlug: true,
          },
        },
        _count: { select: { submissions: true } },
      },
    });

    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        whatsapp: r.whatsapp,
        email: r.email,
        comment: r.comment,
        outcomeKey: r.outcomeKey,
        docsSentAt: r.docsSentAt,
        submissionsCount: r._count.submissions,
        createdAt: r.createdAt,
        partner: r.partner,
      })),
    };
  }

  /** Atualiza um lead via admin. */
  async updateForAdmin(
    id: string,
    input: {
      name?: string;
      email?: string;
      whatsapp?: string;
      comment?: string | null;
      outcomeKey?: string | null;
      partnerId?: string;
    },
  ) {
    const existing = await this.prisma.lead.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Lead não encontrado.');

    const data: Record<string, unknown> = {};
    if (typeof input.name === 'string') data.name = input.name.trim();
    if (typeof input.email === 'string') data.email = input.email.trim();
    if (typeof input.whatsapp === 'string')
      data.whatsapp = input.whatsapp.replace(/\D+/g, '');
    if (typeof input.comment !== 'undefined') data.comment = input.comment;
    if (typeof input.outcomeKey !== 'undefined') data.outcomeKey = input.outcomeKey;
    if (typeof input.partnerId === 'string') data.partnerId = input.partnerId;

    const updated = await this.prisma.lead.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        whatsapp: true,
        email: true,
        comment: true,
        outcomeKey: true,
        docsSentAt: true,
        createdAt: true,
        partner: { select: { id: true, name: true, categorySlug: true } },
        _count: { select: { submissions: true } },
      },
    });

    return {
      ...updated,
      submissionsCount: updated._count.submissions,
    };
  }

  /** Remove um lead via admin. */
  async deleteForAdmin(id: string) {
    const existing = await this.prisma.lead.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Lead não encontrado.');
    await this.prisma.lead.delete({ where: { id } });
    return { ok: true };
  }
}

export type LeadListItem = {
  id: string;
  name: string;
  whatsapp: string;
  email: string;
  comment: string | null;
  outcomeKey: string | null;
  docsSentAt: Date | null;
  submissionsCount: number;
  createdAt: Date;
};
