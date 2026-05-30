import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WhatsappScanMediaKind,
  WhatsappScanMessageStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PartnerService } from '../partner/partner.service';
import { HouseImageStorageService } from '../partner/house-image-storage.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import {
  WhatsappScanOpenAiService,
  type ScanExtractionResult,
} from './whatsapp-scan-openai.service';
import { CreateScanGroupDto } from './dto/create-scan-group.dto';
import { UpdateScanGroupDto } from './dto/update-scan-group.dto';
import { IngestMessageDto } from './dto/ingest-message.dto';

/** Janela (minutos) durante a qual a mídia aguarda o texto do anúncio do mesmo remetente. */
function mediaWindowMinutes(): number {
  const raw = process.env.WHATSAPP_SCAN_MEDIA_WINDOW_MIN?.trim();
  if (raw && /^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    if (n > 0 && n <= 240) return n;
  }
  return 5;
}

/**
 * Tolerância (ms): mídia postada até X segundos DEPOIS do texto do anúncio ainda é anexada.
 * Mídia postada mais tarde que isto é considerada de outro contexto e não entra no imóvel.
 */
function mediaAfterTextGraceMs(): number {
  const raw = process.env.WHATSAPP_SCAN_MEDIA_AFTER_TEXT_GRACE_SEC?.trim();
  if (raw && /^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    if (n >= 0 && n <= 600) return n * 1000;
  }
  return 5000;
}

/** messageTimestamp (segundos Unix) → Date; fallback para agora se ausente/inválido. */
function postedAtFromTimestamp(messageTimestamp?: number): Date {
  if (
    typeof messageTimestamp === 'number' &&
    Number.isFinite(messageTimestamp) &&
    messageTimestamp > 0
  ) {
    return new Date(messageTimestamp * 1000);
  }
  return new Date();
}

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
    private readonly houseImages: HouseImageStorageService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  /**
   * Serializa as anexações de mídia (read-modify-write em `imageUrls`) nesta instância, para
   * evitar "lost updates" quando várias imagens chegam quase em simultâneo (requisições paralelas).
   */
  private attachChain: Promise<void> = Promise.resolve();

  private runSerialized<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.attachChain.then(fn, fn);
    this.attachChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

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
   * Processa uma mensagem recebida de um grupo monitorizado.
   *
   * Texto: classifica via OpenAI e, se for anúncio, cria imóvel rascunho — anexando a mídia
   * que tenha chegado antes (imagens/vídeo do mesmo remetente, dentro da janela).
   *
   * Mídia (imagem/vídeo, com base64 do Webhook Base64): carrega o ficheiro e guarda-o como
   * pendente; se a legenda for um anúncio, cria já o imóvel e anexa a mídia.
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

    const kind = dto.kind ?? 'text';
    const isMedia = kind === 'image' || kind === 'video';
    const senderNumber = digitsOnly(dto.senderNumber);
    const externalMessageId = dto.externalMessageId?.trim() || null;
    const postedAt = postedAtFromTimestamp(dto.messageTimestamp);

    // Mídia processável se traz o base64 (Webhook Base64) ou se podemos buscá-lo na Evolution
    // (precisa do id da mensagem; a instância é opcional, mas ajuda a acertar de 1.ª).
    const hasBase64 = !!dto.base64?.length;
    const handleAsMedia = isMedia && (hasBase64 || !!externalMessageId);

    // Mensagem sem texto e sem mídia processável: nada a fazer.
    if (!handleAsMedia && !text) {
      return { ok: true, status: 'ignored_empty' };
    }

    // Filtro de números (vazio = todos). Antes de gravar/baixar qualquer coisa.
    if (
      group.monitoredNumbers.length > 0 &&
      !group.monitoredNumbers.includes(senderNumber)
    ) {
      return { ok: true, status: 'ignored_sender' };
    }

    // Dedup "claim-first": grava já o log (status `received`). A unique constraint em
    // `externalMessageId` garante que apenas a 1.ª entrega prossegue (Evolution reentrega).
    const rawText = text || (handleAsMedia ? `[${kind}]` : '');
    const claim = await this.claimMessage({
      groupId: group.id,
      senderNumber,
      externalMessageId,
      rawText,
      postedAt,
      // Sem id, só deduplicamos por conteúdo quando é texto (mídia partilharia o placeholder).
      contentDedup: !handleAsMedia,
    });
    if (claim.duplicate) return { ok: true, status: 'ignored_duplicate' };
    const recordId = claim.id;

    if (handleAsMedia) {
      return this.handleMedia({
        recordId,
        group,
        senderNumber,
        externalMessageId,
        postedAt,
        kind,
        base64: dto.base64 ?? '',
        mimeType: dto.mimeType ?? '',
        fileName: dto.fileName ?? '',
        instance: dto.instance ?? '',
        caption: text,
      });
    }

    return this.handleListingText({
      recordId,
      group,
      senderNumber,
      text,
      postedAt,
    });
  }

  /** Grava o log da mensagem (claim-first); devolve `duplicate` quando já existia. */
  private async claimMessage(input: {
    groupId: string;
    senderNumber: string;
    externalMessageId: string | null;
    rawText: string;
    postedAt: Date;
    contentDedup: boolean;
  }): Promise<{ id: string; duplicate: boolean }> {
    const rawText = input.rawText.slice(0, 8000);
    if (input.externalMessageId) {
      try {
        const created = await this.prisma.whatsappScanMessage.create({
          data: {
            groupId: input.groupId,
            senderNumber: input.senderNumber,
            externalMessageId: input.externalMessageId,
            rawText,
            postedAt: input.postedAt,
            status: WhatsappScanMessageStatus.received,
          },
          select: { id: true },
        });
        return { id: created.id, duplicate: false };
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          return { id: '', duplicate: true };
        }
        throw e;
      }
    }

    if (input.contentDedup && rawText) {
      const recent = await this.prisma.whatsappScanMessage.findFirst({
        where: {
          groupId: input.groupId,
          senderNumber: input.senderNumber,
          rawText,
          createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (recent) return { id: '', duplicate: true };
    }

    const created = await this.prisma.whatsappScanMessage.create({
      data: {
        groupId: input.groupId,
        senderNumber: input.senderNumber,
        rawText,
        postedAt: input.postedAt,
        status: WhatsappScanMessageStatus.received,
      },
      select: { id: true },
    });
    return { id: created.id, duplicate: false };
  }

  /** Texto do anúncio: classifica, cria imóvel e anexa a mídia pendente do mesmo remetente. */
  private async handleListingText(input: {
    recordId: string;
    group: { id: string; partnerId: string };
    senderNumber: string;
    text: string;
    postedAt: Date;
  }): Promise<{ ok: true; status: string }> {
    const { recordId, group, senderNumber, text, postedAt } = input;

    // Pré-filtro barato (sem IA) para poupar tokens. Desligável com WHATSAPP_SCAN_PREFILTER=0.
    const prefilterEnabled = process.env.WHATSAPP_SCAN_PREFILTER !== '0';
    if (prefilterEnabled && !looksLikePropertyListing(text)) {
      await this.updateRecord(recordId, {
        status: WhatsappScanMessageStatus.ignored_not_listing,
      });
      return { ok: true, status: 'ignored_prefilter' };
    }

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

    try {
      const house = await this.createHouseFromExtraction(
        group.partnerId,
        extraction,
      );
      // Marca o imóvel como criado ANTES de anexar, para que mídia concorrente (imagens ainda
      // a ser processadas noutras requisições) o encontre e se anexe (findRecentCreatedHouseId).
      await this.updateRecord(recordId, {
        status: WhatsappScanMessageStatus.created,
        parsedJson: extraction as unknown as Prisma.InputJsonValue,
        createdHouseId: house.id,
      });
      await this.attachPendingMediaToHouse(
        group.id,
        senderNumber,
        house.id,
        postedAt,
      );
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

  /** Mídia: carrega o ficheiro, guarda como pendente e, se a legenda for anúncio, cria já o imóvel. */
  private async handleMedia(input: {
    recordId: string;
    group: { id: string; partnerId: string };
    senderNumber: string;
    externalMessageId: string | null;
    kind: 'image' | 'video';
    base64: string;
    mimeType: string;
    fileName: string;
    instance: string;
    caption: string;
    postedAt: Date;
  }): Promise<{ ok: true; status: string }> {
    const { recordId, group, senderNumber, kind, caption, postedAt } = input;

    // Obtém os bytes: do webhook (Webhook Base64) ou, em fallback, da Evolution.
    let base64 = input.base64;
    let mimeType = input.mimeType;
    let fileName = input.fileName;
    if (!base64 && input.externalMessageId) {
      const fetched = await this.whatsapp.getMediaBase64(
        input.instance,
        input.externalMessageId,
        { convertToMp4: kind === 'video' },
      );
      if (fetched) {
        base64 = fetched.base64;
        mimeType = mimeType || fetched.mimetype;
        fileName = fileName || fetched.fileName;
      }
    }
    if (!base64) {
      this.logger.warn(
        `Mídia sem bytes (${kind}); Webhook Base64 desligado e getBase64 falhou (msg ${
          input.externalMessageId ?? '—'
        }).`,
      );
      await this.updateRecord(recordId, {
        status: WhatsappScanMessageStatus.error,
        error: 'Mídia sem bytes (Webhook Base64 desligado / getBase64 falhou).',
      });
      return { ok: true, status: 'error_media_no_bytes' };
    }

    // Carrega o ficheiro (imagem → WebP; vídeo → original) e sobe para R2/disco.
    let storedUrl: string;
    try {
      const buf = Buffer.from(base64, 'base64');
      if (!buf.length) throw new Error('Mídia vazia.');
      storedUrl =
        kind === 'image'
          ? (await this.houseImages.processHouseImageBuffer(buf)).publicUrl
          : (
              await this.houseImages.storeHouseVideoBuffer(
                buf,
                mimeType,
                fileName,
              )
            ).publicUrl;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Falha ao guardar mídia do scan (${kind}): ${msg}`);
      await this.updateRecord(recordId, {
        status: WhatsappScanMessageStatus.error,
        error: msg.slice(0, 1000),
      });
      return { ok: true, status: 'error_media' };
    }

    // Regista a mídia pendente (dedup por externalMessageId).
    try {
      await this.prisma.whatsappScanPendingMedia.create({
        data: {
          groupId: group.id,
          senderNumber,
          kind:
            kind === 'image'
              ? WhatsappScanMediaKind.IMAGE
              : WhatsappScanMediaKind.VIDEO,
          storedUrl,
          externalMessageId: input.externalMessageId,
          messageId: recordId,
          postedAt,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Reentrega: já temos esta mídia pendente; apaga o ficheiro recém-carregado (evita órfão).
        await this.houseImages.deleteStoredUrl(storedUrl);
        return { ok: true, status: 'ignored_duplicate' };
      }
      throw e;
    }

    // Se a legenda for um anúncio, cria já o imóvel e anexa a mídia pendente (incluindo esta).
    const prefilterEnabled = process.env.WHATSAPP_SCAN_PREFILTER !== '0';
    if (caption && (!prefilterEnabled || looksLikePropertyListing(caption))) {
      let extraction: ScanExtractionResult | null = null;
      try {
        extraction = await this.openai.extractListing(caption);
      } catch (e) {
        this.logger.warn(
          `OpenAI falhou na legenda da mídia; mídia fica pendente: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
      if (extraction?.isListing && extraction.house) {
        try {
          const house = await this.createHouseFromExtraction(
            group.partnerId,
            extraction,
          );
          await this.updateRecord(recordId, {
            status: WhatsappScanMessageStatus.created,
            parsedJson: extraction as unknown as Prisma.InputJsonValue,
            createdHouseId: house.id,
          });
          await this.attachPendingMediaToHouse(
            group.id,
            senderNumber,
            house.id,
            postedAt,
          );
          return { ok: true, status: 'created' };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.logger.error(`Falha ao criar imóvel via legenda: ${msg}`);
          // Mantém a mídia pendente para um eventual texto do anúncio.
        }
      }
    }

    // Corrida com o texto: como cada mensagem chega numa requisição separada e o processamento
    // da imagem é mais lento (download + WebP + upload), o texto pode criar o imóvel primeiro.
    // Se já existe um imóvel criado há pouco para este remetente, anexamo-nos a ele.
    const recentHouse = await this.findRecentCreatedHouse(
      group.id,
      senderNumber,
    );
    // Só anexamos a um imóvel já criado se esta mídia foi postada até X segundos DEPOIS do texto
    // (mídia postada antes do texto também entra). Mídia muito mais tardia fica pendente.
    if (recentHouse) {
      const cutoff =
        recentHouse.listingPostedAt.getTime() + mediaAfterTextGraceMs();
      if (postedAt.getTime() <= cutoff) {
        await this.attachPendingMediaToHouse(
          group.id,
          senderNumber,
          recentHouse.houseId,
          recentHouse.listingPostedAt,
        );
        await this.updateRecord(recordId, {
          status: WhatsappScanMessageStatus.media_attached,
          createdHouseId: recentHouse.houseId,
        });
        return { ok: true, status: 'media_attached' };
      }
    }

    await this.updateRecord(recordId, {
      status: WhatsappScanMessageStatus.media_stored,
    });
    return { ok: true, status: 'media_stored' };
  }

  /** Imóvel criado há pouco (dentro da janela) a partir do mesmo grupo + remetente, se existir. */
  private async findRecentCreatedHouse(
    groupId: string,
    senderNumber: string,
  ): Promise<{ houseId: string; listingPostedAt: Date } | null> {
    const since = new Date(Date.now() - mediaWindowMinutes() * 60 * 1000);
    const recent = await this.prisma.whatsappScanMessage.findFirst({
      where: {
        groupId,
        senderNumber,
        status: WhatsappScanMessageStatus.created,
        createdHouseId: { not: null },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdHouseId: true, postedAt: true, createdAt: true },
    });
    if (!recent?.createdHouseId) return null;
    return {
      houseId: recent.createdHouseId,
      listingPostedAt: recent.postedAt ?? recent.createdAt,
    };
  }

  private createHouseFromExtraction(
    partnerId: string,
    extraction: ScanExtractionResult,
  ) {
    const house = extraction.house!;
    return this.partnerService.createDraftHouseFromScan({
      partnerId,
      title: house.title,
      description: house.description,
      businessType: house.businessType,
      typology: house.typology,
      city: house.city,
      availableFrom: house.availableFrom,
      priceEur: house.priceEur,
      relocationFeeEur: house.relocationFeeEur,
      caucoesCount: house.caucoesCount,
      rendasEntradaCount: house.rendasEntradaCount,
      furnished: house.furnished,
    });
  }

  /**
   * Anexa a mídia pendente (do mesmo grupo + remetente, dentro da janela) ao imóvel criado e
   * marca-a como consumida (mesmo a que excede o limite de 6 imagens, para não reaparecer noutro
   * anúncio seguinte).
   */
  private attachPendingMediaToHouse(
    groupId: string,
    senderNumber: string,
    houseId: string,
    listingPostedAt: Date,
  ): Promise<void> {
    return this.runSerialized(() =>
      this.attachPendingMediaToHouseInner(
        groupId,
        senderNumber,
        houseId,
        listingPostedAt,
      ),
    );
  }

  private async attachPendingMediaToHouseInner(
    groupId: string,
    senderNumber: string,
    houseId: string,
    listingPostedAt: Date,
  ): Promise<void> {
    const since = new Date(Date.now() - mediaWindowMinutes() * 60 * 1000);
    const candidates = await this.prisma.whatsappScanPendingMedia.findMany({
      where: {
        groupId,
        senderNumber,
        consumedByHouseId: null,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Só entram mídia postada ANTES do texto ou até X segundos DEPOIS dele. Mídia mais tardia
    // fica pendente (pode pertencer a um anúncio seguinte).
    const cutoff = listingPostedAt.getTime() + mediaAfterTextGraceMs();
    const pendings = candidates.filter((p) => {
      const posted = (p.postedAt ?? p.createdAt).getTime();
      return posted <= cutoff;
    });
    if (pendings.length === 0) return;

    const imageUrls = pendings
      .filter((p) => p.kind === WhatsappScanMediaKind.IMAGE)
      .map((p) => p.storedUrl);
    const videoUrl =
      pendings.find((p) => p.kind === WhatsappScanMediaKind.VIDEO)?.storedUrl ??
      null;

    try {
      await this.partnerService.attachScanMediaToHouse({
        houseId,
        imageUrls,
        videoUrl,
      });
    } catch (e) {
      this.logger.warn(
        `Não foi possível anexar mídia ao imóvel ${houseId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return;
    }

    const pendingIds = pendings.map((p) => p.id);
    const messageIds = pendings
      .map((p) => p.messageId)
      .filter((id): id is string => !!id);
    await this.prisma.whatsappScanPendingMedia.updateMany({
      where: { id: { in: pendingIds } },
      data: { consumedByHouseId: houseId },
    });
    if (messageIds.length > 0) {
      await this.prisma.whatsappScanMessage.updateMany({
        where: {
          id: { in: messageIds },
          status: WhatsappScanMessageStatus.media_stored,
        },
        data: {
          status: WhatsappScanMessageStatus.media_attached,
          createdHouseId: houseId,
        },
      });
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
