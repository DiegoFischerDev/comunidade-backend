import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WhatsappScanMessageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PartnerService } from '../partner/partner.service';
import {
  WhatsappScanOpenAiService,
  type ScanExtractionResult,
} from './whatsapp-scan-openai.service';
import { CreateScanGroupDto } from './dto/create-scan-group.dto';
import { UpdateScanGroupDto } from './dto/update-scan-group.dto';
import { IngestMessageDto } from './dto/ingest-message.dto';

function digitsOnly(value: string): string {
  return String(value ?? '').replace(/\D+/g, '');
}

/**
 * Pré-filtro barato (sem IA) para poupar tokens: só vale a pena chamar a OpenAI se a mensagem
 * tiver pelo menos um indício de anúncio de imóvel. Mensagens curtas ou sem qualquer sinal
 * (saudações, agradecimentos, conversa) são descartadas sem custo.
 * Conservador de propósito: na dúvida, deixa passar para a IA decidir.
 */
function looksLikePropertyListing(text: string): boolean {
  const t = (text ?? '').trim();
  if (t.length < 20) return false;

  const hasPrice = /(€|\beur\b|\beuros?\b)/i.test(t) || /\d[\d.\s]{2,}/.test(t);
  const hasTypology = /\bt[0-5]\b/i.test(t);
  const hasKeyword =
    /(arrend|renda|aluga|aluguer|vende|venda|à\s*venda|im[oó]ve|apartament|vivend|morad|quarto|estúdio|estudio|duplex|casa de banho|mobilad|condom|fra[cç][aã]o|propriedade)/i.test(
      t,
    );

  // Precisa de uma palavra-chave de imóvel E (preço OU tipologia).
  return hasKeyword && (hasPrice || hasTypology);
}

@Injectable()
export class WhatsappScanService {
  private readonly logger = new Logger(WhatsappScanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly partnerService: PartnerService,
    private readonly openai: WhatsappScanOpenAiService,
  ) {}

  // ===== CRUD admin =====

  async listGroups() {
    const rows = await this.prisma.whatsappScanGroup.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        partner: { select: { id: true, name: true, categorySlug: true } },
        _count: { select: { messages: true } },
      },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        partnerId: r.partnerId,
        partner: r.partner,
        groupJid: r.groupJid,
        monitoredNumbers: r.monitoredNumbers,
        active: r.active,
        messagesCount: r._count.messages,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };
  }

  private async assertRelocationPartner(partnerId: string) {
    const partner = await this.prisma.partner.findFirst({
      where: { id: partnerId, categorySlug: 'relocation' },
      select: { id: true },
    });
    if (!partner) {
      throw new BadRequestException(
        'Parceiro não encontrado ou não pertence à categoria Relocation.',
      );
    }
  }

  async createGroup(dto: CreateScanGroupDto) {
    await this.assertRelocationPartner(dto.partnerId);
    const groupJid = dto.groupJid.trim();
    const monitoredNumbers = (dto.monitoredNumbers ?? [])
      .map(digitsOnly)
      .filter((n) => n.length > 0);

    const existing = await this.prisma.whatsappScanGroup.findUnique({
      where: { groupJid },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException(
        'Já existe um grupo monitorizado com este JID.',
      );
    }

    return this.prisma.whatsappScanGroup.create({
      data: {
        partnerId: dto.partnerId,
        groupJid,
        monitoredNumbers,
        active: dto.active ?? true,
      },
    });
  }

  async updateGroup(id: string, dto: UpdateScanGroupDto) {
    const existing = await this.prisma.whatsappScanGroup.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Grupo não encontrado.');

    const data: Prisma.WhatsappScanGroupUpdateInput = {};
    if (typeof dto.partnerId === 'string') {
      await this.assertRelocationPartner(dto.partnerId);
      data.partner = { connect: { id: dto.partnerId } };
    }
    if (typeof dto.groupJid === 'string') {
      const groupJid = dto.groupJid.trim();
      const dupe = await this.prisma.whatsappScanGroup.findFirst({
        where: { groupJid, id: { not: id } },
        select: { id: true },
      });
      if (dupe) {
        throw new BadRequestException(
          'Já existe um grupo monitorizado com este JID.',
        );
      }
      data.groupJid = groupJid;
    }
    if (Array.isArray(dto.monitoredNumbers)) {
      data.monitoredNumbers = dto.monitoredNumbers
        .map(digitsOnly)
        .filter((n) => n.length > 0);
    }
    if (typeof dto.active === 'boolean') {
      data.active = dto.active;
    }

    return this.prisma.whatsappScanGroup.update({ where: { id }, data });
  }

  async deleteGroup(id: string) {
    const existing = await this.prisma.whatsappScanGroup.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Grupo não encontrado.');
    await this.prisma.whatsappScanGroup.delete({ where: { id } });
    return { ok: true as const };
  }

  /** Histórico de mensagens processadas (logs), opcionalmente filtrado por grupo. */
  async listMessages(groupId?: string, limit = 100) {
    const rows = await this.prisma.whatsappScanMessage.findMany({
      where: groupId ? { groupId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, Math.max(1, limit)),
      include: {
        group: {
          select: {
            id: true,
            groupJid: true,
            partner: { select: { id: true, name: true } },
          },
        },
      },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        groupId: r.groupId,
        group: r.group,
        senderNumber: r.senderNumber,
        rawText: r.rawText,
        status: r.status,
        createdHouseId: r.createdHouseId,
        error: r.error,
        createdAt: r.createdAt,
      })),
    };
  }

  // ===== Ingest (receiver) =====

  /**
   * Processa uma mensagem recebida de um grupo monitorizado:
   * 1) verifica se o grupo está a ser monitorizado (ativo);
   * 2) verifica o filtro de números;
   * 3) deduplica por externalMessageId;
   * 4) chama a OpenAI para classificar/extrair;
   * 5) cria imóvel rascunho se for um anúncio.
   *
   * Devolve sempre um resultado (não lança), para o receiver responder 200 e a Evolution não
   * reentregar em loop.
   */
  async ingest(dto: IngestMessageDto): Promise<{ ok: true; status: string }> {
    const text = (dto.text ?? '').trim();
    const groupJid = (dto.groupJid ?? '').trim();
    if (!groupJid) return { ok: true, status: 'ignored_no_group' };

    const group = await this.prisma.whatsappScanGroup.findFirst({
      where: { groupJid, active: true },
      select: { id: true, partnerId: true, monitoredNumbers: true },
    });
    if (!group) return { ok: true, status: 'ignored_group_not_monitored' };

    if (!text) {
      return { ok: true, status: 'ignored_empty' };
    }

    const senderNumber = digitsOnly(dto.senderNumber);
    const externalMessageId = dto.externalMessageId?.trim() || null;

    // Dedup "claim-first": gravamos já o registo (status `received`). Como o Evolution costuma
    // entregar a mesma mensagem várias vezes (webhook global + por instância, e reentregas),
    // a unique constraint em `externalMessageId` garante que apenas a 1.ª entrega prossegue.
    // Sem id, deduplicamos por conteúdo recente (mesmo grupo + remetente + texto nos últimos 5 min).
    let recordId: string;
    if (externalMessageId) {
      try {
        const created = await this.prisma.whatsappScanMessage.create({
          data: {
            groupId: group.id,
            senderNumber,
            externalMessageId,
            rawText: text.slice(0, 8000),
            status: WhatsappScanMessageStatus.received,
          },
          select: { id: true },
        });
        recordId = created.id;
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          return { ok: true, status: 'ignored_duplicate' };
        }
        throw e;
      }
    } else {
      const recent = await this.prisma.whatsappScanMessage.findFirst({
        where: {
          groupId: group.id,
          senderNumber,
          rawText: text.slice(0, 8000),
          createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (recent) return { ok: true, status: 'ignored_duplicate' };
      const created = await this.prisma.whatsappScanMessage.create({
        data: {
          groupId: group.id,
          senderNumber,
          rawText: text.slice(0, 8000),
          status: WhatsappScanMessageStatus.received,
        },
        select: { id: true },
      });
      recordId = created.id;
    }

    // Filtro de números (vazio = todos).
    if (
      group.monitoredNumbers.length > 0 &&
      !group.monitoredNumbers.includes(senderNumber)
    ) {
      await this.updateRecord(recordId, {
        status: WhatsappScanMessageStatus.ignored_sender,
      });
      return { ok: true, status: 'ignored_sender' };
    }

    // Pré-filtro barato (sem IA) para poupar tokens: descarta mensagens que não têm qualquer
    // indício de anúncio de imóvel. Desligável com WHATSAPP_SCAN_PREFILTER=0.
    const prefilterEnabled = process.env.WHATSAPP_SCAN_PREFILTER !== '0';
    if (prefilterEnabled && !looksLikePropertyListing(text)) {
      await this.updateRecord(recordId, {
        status: WhatsappScanMessageStatus.ignored_not_listing,
      });
      return { ok: true, status: 'ignored_prefilter' };
    }

    // Classificação + extração via OpenAI.
    let extraction: ScanExtractionResult;
    try {
      extraction = await this.openai.extractListing(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Falha OpenAI no scan: ${msg}`);
      await this.updateRecord(recordId, {
        status: WhatsappScanMessageStatus.error,
        error: msg.slice(0, 1000),
      });
      return { ok: true, status: 'error_openai' };
    }

    if (!extraction.isListing || !extraction.house) {
      await this.updateRecord(recordId, {
        status: WhatsappScanMessageStatus.ignored_not_listing,
        parsedJson: extraction as unknown as Prisma.InputJsonValue,
      });
      return { ok: true, status: 'ignored_not_listing' };
    }

    // Cria imóvel rascunho atribuído ao parceiro do grupo.
    try {
      const house = await this.partnerService.createDraftHouseFromScan({
        partnerId: group.partnerId,
        title: extraction.house.title,
        description: extraction.house.description,
        businessType: extraction.house.businessType,
        typology: extraction.house.typology,
        city: extraction.house.city,
        availableFrom: extraction.house.availableFrom,
        priceEur: extraction.house.priceEur,
        relocationFeeEur: extraction.house.relocationFeeEur,
        caucoesCount: extraction.house.caucoesCount,
        rendasEntradaCount: extraction.house.rendasEntradaCount,
        furnished: extraction.house.furnished,
      });
      await this.updateRecord(recordId, {
        status: WhatsappScanMessageStatus.created,
        parsedJson: extraction as unknown as Prisma.InputJsonValue,
        createdHouseId: house.id,
      });
      return { ok: true, status: 'created' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Falha ao criar imóvel via scan: ${msg}`);
      await this.updateRecord(recordId, {
        status: WhatsappScanMessageStatus.error,
        parsedJson: extraction as unknown as Prisma.InputJsonValue,
        error: msg.slice(0, 1000),
      });
      return { ok: true, status: 'error_create' };
    }
  }

  /** Atualiza o registo da mensagem com o resultado do processamento; nunca lança (best-effort). */
  private async updateRecord(
    id: string,
    data: {
      status: WhatsappScanMessageStatus;
      parsedJson?: Prisma.InputJsonValue;
      createdHouseId?: string;
      error?: string;
    },
  ) {
    try {
      await this.prisma.whatsappScanMessage.update({
        where: { id },
        data: {
          status: data.status,
          parsedJson: data.parsedJson,
          createdHouseId: data.createdHouseId,
          error: data.error,
        },
      });
    } catch (e) {
      this.logger.warn(
        `Não foi possível atualizar log do scan: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
