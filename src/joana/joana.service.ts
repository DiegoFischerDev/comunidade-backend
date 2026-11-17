import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, RafaCallCrmStatus } from '@prisma/client';
import { getFrontendBaseUrl } from '../config/frontend-base-url';
import { PrismaService } from '../prisma/prisma.service';
import { RafacallCrmService } from '../rafacall/rafacall-crm.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { JOANA_AUDIO_UNHEARD } from './joana-audio';
import {
  JOANA_DEFAULT_CONTEXT,
  joanaDebounceMs,
  joanaWhatsappInstance,
} from './joana-context';
import { JoanaOpenAiService } from './joana-openai.service';
import {
  JOANA_TYPOLOGY_SPEECH,
  applyJoanaProposal,
  composeJoanaReply,
  emptyJoanaProfile,
  ensureJoanaIntro,
  formatImmigrationLabel,
  type JoanaCrmPatch,
  type JoanaProfile,
  type JoanaTypology,
  type PendingConfirmation,
} from './joana-turn';

type BufferItem = { id: string; text: string; at: string };
type HistoryItem = { role: 'user' | 'assistant'; text: string };

const HISTORY_LIMIT = 16;
const STALE_LOCK_MS = 2 * 60 * 1000;

@Injectable()
export class JoanaService {
  private readonly logger = new Logger(JoanaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wa: WhatsAppService,
    private readonly crm: RafacallCrmService,
    private readonly openai: JoanaOpenAiService,
  ) {}

  async getContext(): Promise<{ contextText: string }> {
    const row = await this.prisma.joanaSettings.findUnique({
      where: { id: 'default' },
    });
    return { contextText: row?.contextText?.trim() || JOANA_DEFAULT_CONTEXT };
  }

  async updateContext(contextText: string): Promise<{ contextText: string }> {
    const text = contextText.trim();
    if (text.length < 20) {
      throw new BadRequestException('O contexto da Joana está curto demais.');
    }
    const saved = await this.prisma.joanaSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', contextText: text },
      update: { contextText: text },
    });
    return { contextText: saved.contextText };
  }

  /**
   * Nota de voz: descarrega na Evolution, transcreve e entra no debounce como texto.
   * Se não der para ouvir, responde já e não grava nada.
   */
  async acceptVoiceNote(input: {
    whatsapp: string;
    instance: string;
    pushName?: string;
    externalMessageId?: string;
    mediaMessage?: Record<string, unknown>;
  }): Promise<{ handled: true; status: string }> {
    if (!(await this.crm.isJoanaActive(input.whatsapp))) {
      return { handled: true, status: 'paused' };
    }

    const messageId = (input.externalMessageId || '').trim();
    if (!messageId) {
      await this.replyUnheard(input.whatsapp, input.instance, 'mensagem sem id');
      return { handled: true, status: 'audio_unheard' };
    }

    try {
      const media = await this.wa.getMediaBase64(input.instance, messageId, {
        convertToMp4: false,
        message: input.mediaMessage,
      });
      if (!media?.base64) {
        await this.replyUnheard(input.whatsapp, input.instance, 'Evolution sem bytes');
        return { handled: true, status: 'audio_unheard' };
      }
      const transcript = await this.openai.transcribeAudio({
        base64: media.base64,
        mimeType: media.mimetype,
        fileName: media.fileName,
      });
      if (!transcript) {
        await this.replyUnheard(input.whatsapp, input.instance, 'transcrição vazia');
        return { handled: true, status: 'audio_unheard' };
      }
      const buffered = await this.bufferInbound({
        whatsapp: input.whatsapp,
        text: transcript,
        instance: input.instance,
        pushName: input.pushName,
        externalMessageId: messageId,
      });
      return { handled: true, status: buffered.status };
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.replyUnheard(input.whatsapp, input.instance, reason);
      return { handled: true, status: 'audio_unheard' };
    }
  }

  /** Guarda a mensagem e deixa o flush dos 30s responder. */
  async bufferInbound(input: {
    whatsapp: string;
    text: string;
    instance?: string;
    pushName?: string;
    externalMessageId?: string;
  }): Promise<{ handled: boolean; status: string }> {
    const instance = (input.instance || '').trim();
    const allowed = joanaWhatsappInstance();
    if (!instance || instance !== allowed) {
      return { handled: false, status: 'ignored_instance' };
    }

    const item: BufferItem = {
      id: (input.externalMessageId || '').trim() || `local-${Date.now()}`,
      text: input.text.trim(),
      at: new Date().toISOString(),
    };
    if (!item.text) return { handled: true, status: 'ignored_empty' };

    if (!(await this.crm.isJoanaActive(input.whatsapp))) {
      return { handled: true, status: 'paused' };
    }

    await this.appendBuffer({
      whatsapp: input.whatsapp,
      instance: instance || allowed || null,
      displayName: cleanName(input.pushName),
      item,
    });
    return { handled: true, status: 'buffered' };
  }

  private async dropBecausePaused(id: string): Promise<void> {
    await this.prisma.joanaConversation.update({
      where: { id },
      data: {
        buffer: [] as unknown as Prisma.InputJsonValue,
        pendingOutbound: null,
        processing: false,
        paused: true,
      },
    });
  }

  private async replyUnheard(whatsapp: string, instance: string, reason: string) {
    this.logger.warn(`Joana áudio ${whatsapp}: ${reason}`);
    try {
      await this.wa.sendText(whatsapp, JOANA_AUDIO_UNHEARD, {
        preferredInstance: instance,
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Joana áudio resposta ${whatsapp}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Guarda a mensagem do gatilho e o texto do fluxo, sem pedir resposta à Joana.
   * O fluxo próprio é quem responde nessa mensagem.
   */
  async noteScriptedExchange(input: {
    whatsapp: string;
    instance: string;
    pushName?: string;
    userText: string;
    assistantText: string;
  }): Promise<void> {
    const userText = input.userText.trim();
    if (!userText) return;
    const assistantText = input.assistantText.trim().slice(0, 4000);
    const turn: HistoryItem[] = [{ role: 'user', text: userText }];
    if (assistantText) turn.push({ role: 'assistant', text: assistantText });

    const existing = await this.prisma.joanaConversation.findUnique({
      where: { whatsappDigits: input.whatsapp },
    });
    if (!existing) {
      try {
        await this.prisma.joanaConversation.create({
          data: {
            whatsappDigits: input.whatsapp,
            instance: input.instance,
            displayName: cleanName(input.pushName),
            buffer: [] as unknown as Prisma.InputJsonValue,
            history: turn as unknown as Prisma.InputJsonValue,
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

    const row =
      existing ??
      (await this.prisma.joanaConversation.findUnique({
        where: { whatsappDigits: input.whatsapp },
      }));
    if (!row) return;

    for (let attempt = 0; attempt < 3; attempt++) {
      const current =
        attempt === 0
          ? row
          : await this.prisma.joanaConversation.findUnique({ where: { id: row.id } });
      if (!current) return;
      const history = appendHistoryTurn(readHistory(current.history), turn);
      const saved = await this.prisma.joanaConversation.updateMany({
        where: { id: current.id, updatedAt: current.updatedAt },
        data: {
          history: history as unknown as Prisma.InputJsonValue,
          instance: input.instance || current.instance,
          displayName: current.displayName || cleanName(input.pushName),
        },
      });
      if (saved.count === 1) return;
    }
  }

  async flushDue(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
    await this.prisma.joanaConversation.updateMany({
      where: {
        processing: true,
        processingStartedAt: { lt: staleBefore },
      },
      data: { processing: false },
    });

    const dueBefore = new Date(Date.now() - joanaDebounceMs());
    const due = await this.prisma.joanaConversation.findMany({
      where: {
        processing: false,
        OR: [
          { pendingOutbound: { not: null } },
          { lastInboundAt: { lte: dueBefore } },
        ],
      },
      take: 20,
      orderBy: { lastInboundAt: 'asc' },
    });

    for (const row of due) {
      const buffer = readBuffer(row.buffer);
      if (!row.pendingOutbound && buffer.length === 0) continue;
      if (!row.pendingOutbound && row.lastInboundAt && row.lastInboundAt > dueBefore) {
        continue;
      }
      await this.processConversation(row.id);
    }
  }

  private async processConversation(id: string): Promise<void> {
    const claimed = await this.prisma.joanaConversation.updateMany({
      where: { id, processing: false },
      data: { processing: true, processingStartedAt: new Date() },
    });
    if (claimed.count !== 1) return;

    try {
      const row = await this.prisma.joanaConversation.findUnique({ where: { id } });
      if (!row) return;

      if (!(await this.crm.isJoanaActive(row.whatsappDigits))) {
        await this.dropBecausePaused(id);
        return;
      }

      if (row.pendingOutbound) {
        await this.wa.sendText(row.whatsappDigits, row.pendingOutbound, {
          preferredInstance: row.instance || undefined,
          requireDelivery: true,
        });
        await this.prisma.joanaConversation.update({
          where: { id },
          data: { pendingOutbound: null, processing: false },
        });
        return;
      }

      const buffer = readBuffer(row.buffer);
      if (buffer.length === 0) {
        await this.release(id);
        return;
      }

      const combined = buffer.map((item) => item.text).join('\n');
      const history = readHistory(row.history);
      const pending = readPending(row.pendingConfirmation);
      const { contextText } = await this.getContext();
      const lead = await this.crm.lookupLeadForJoana(row.whatsappDigits);
      const profile = lead.kind === 'visible' ? profileFromLead(lead) : emptyJoanaProfile();

      let reply = '';
      let proposal = {
        interested: null as boolean | null,
        confirmation: null as 'yes' | 'no' | null,
      };
      try {
        const interpreted = await this.openai.interpret({
          context: contextText,
          transcript: history.map((item) => `${item.role}: ${item.text}`).join('\n'),
          profileSummary: describeProfile(profile, lead.kind),
          pendingQuestion: pending?.question ?? null,
          combinedText: combined,
        });
        reply = interpreted.reply;
        proposal = interpreted.proposal;
        const needsIntro =
          lead.kind === 'none' &&
          proposal.interested !== false &&
          !history.some((item) => item.role === 'assistant' && /joana/i.test(item.text));
        reply = ensureJoanaIntro(reply, needsIntro);
      } catch (err: unknown) {
        this.logger.warn(
          `Joana OpenAI ${row.whatsappDigits}: ${err instanceof Error ? err.message : String(err)}`,
        );
        reply = 'Tive um problema para responder agora. Pode escrever de novo daqui a pouco?';
        await this.finishTurn({
          id,
          bufferIds: buffer.map((item) => item.id),
          history,
          userText: combined,
          assistantText: reply,
          pending,
          farGuidanceSent: row.farGuidanceSent,
          schedulingLinkSent: row.schedulingLinkSent,
          outbound: reply,
          whatsapp: row.whatsappDigits,
          instance: row.instance,
        });
        return;
      }

      if (!(await this.crm.isJoanaActive(row.whatsappDigits))) {
        await this.dropBecausePaused(id);
        return;
      }

      const decision = applyJoanaProposal({
        hasLead: lead.kind === 'visible',
        excluded: lead.kind === 'excluded',
        profile,
        pending,
        proposal,
      });

      let farGuidanceSent = row.farGuidanceSent;
      let schedulingLinkSent = row.schedulingLinkSent;
      let offerSchedulingLink = false;
      const append = [...decision.append];
      let saved =
        decision.createLead || Boolean(decision.nameToSave || decision.crmPatch);

      try {
        const persisted = await this.persistDecision({
          whatsapp: row.whatsappDigits,
          pushName: row.displayName,
          lead,
          decision,
        });
        const linkAlreadyDelivered = history.some(
          (item) => item.role === 'assistant' && item.text.includes('/agendar?'),
        );
        if (persisted) {
          const next = await this.crm.lookupLeadForJoana(row.whatsappDigits);
          if (next.kind === 'visible') {
            const guidance = this.columnGuidance(next.crmStatus, row.whatsappDigits, next.name);
            if (next.crmStatus === RafaCallCrmStatus.IMIGRACAO_PERTO) {
              farGuidanceSent = false;
              offerSchedulingLink = next.hasVisa === true && !linkAlreadyDelivered;
              if (offerSchedulingLink && guidance) append.push(guidance);
            } else if (next.crmStatus === RafaCallCrmStatus.IMIGRACAO_LONGE) {
              schedulingLinkSent = false;
              if (next.hasVisa !== false && !farGuidanceSent && guidance) {
                append.push(guidance);
                farGuidanceSent = true;
              }
            } else if (
              next.crmStatus === RafaCallCrmStatus.IMIGRACAO_NULL
            ) {
              farGuidanceSent = false;
              schedulingLinkSent = false;
            }
          }
        }
      } catch (err: unknown) {
        this.logger.warn(
          `Joana CRM ${row.whatsappDigits}: ${err instanceof Error ? err.message : String(err)}`,
        );
        append.splice(0, append.length, 'Tive um problema agora. Pode repetir daqui a pouco?');
        decision.pending = pending;
        saved = false;
      }

      const assistantText = composeReply(reply, append, saved);
      if (assistantText.includes('/agendar?')) schedulingLinkSent = true;
      else if (offerSchedulingLink) schedulingLinkSent = false;
      await this.finishTurn({
        id,
        bufferIds: buffer.map((item) => item.id),
        history,
        userText: combined,
        assistantText,
        pending: decision.pending,
        farGuidanceSent,
        schedulingLinkSent,
        outbound: assistantText,
        whatsapp: row.whatsappDigits,
        instance: row.instance,
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Joana ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.release(id);
    }
  }

  private columnGuidance(
    status: RafaCallCrmStatus,
    whatsapp: string,
    name: string | null,
  ): string | null {
    if (status === RafaCallCrmStatus.IMIGRACAO_PERTO) {
      let link = '';
      try {
        const base = getFrontendBaseUrl().replace(/\/$/, '');
        const params = new URLSearchParams();
        params.set('whatsapp', whatsapp);
        if (name && !/^lead\s+\d+$/i.test(name)) params.set('name', name);
        link = `${base}/agendar?${params.toString()}`;
      } catch (err: unknown) {
        this.logger.warn(
          `Joana sem link de agenda: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
      return `Posso te passar o link para agendar a videochamada com a Rafa. São 20 a 30 minutos, então vale ter as dúvidas anotadas: ${link}`;
    }
    if (status === RafaCallCrmStatus.IMIGRACAO_LONGE) {
      return 'Como sua viagem ainda está a dois meses ou mais, a Rafa ainda não consegue te acompanhar na busca do imóvel agora. Quando faltarem menos de dois meses, é a hora certa de agendar a videochamada e começar a procura. Até lá, prepare o passaporte, o visto e compre a passagem. Quando estiver mais perto, me chama de novo que eu te mando o link para agendar.';
    }
    return null;
  }

  private async persistDecision(input: {
    whatsapp: string;
    pushName: string | null;
    lead: Awaited<ReturnType<RafacallCrmService['lookupLeadForJoana']>>;
    decision: ReturnType<typeof applyJoanaProposal>;
  }): Promise<boolean> {
    const { decision } = input;
    if (input.lead.kind === 'excluded') return false;
    if (!decision.createLead && !decision.nameToSave && !decision.crmPatch) return true;

    let bookingId = input.lead.kind === 'visible' ? input.lead.bookingId : null;

    let createdNow = false;
    if (decision.createLead && !bookingId) {
      const name =
        decision.nameToSave ||
        input.pushName ||
        fallbackLeadName(input.whatsapp);
      try {
        const created = await this.crm.createCrmClient({
          name,
          whatsapp: input.whatsapp,
          crmExpectedImmigrationAt: decision.crmPatch?.immigration,
          crmPropertyTypology: decision.crmPatch?.typology ?? undefined,
          crmPreferredCity: decision.crmPatch?.cities ?? undefined,
          crmDesiredRent: decision.crmPatch?.desiredRent,
        });
        bookingId = created.id;
        createdNow = true;
      } catch (err: unknown) {
        if (!isCrmMessage(err, 'Este cliente já está no CRM.')) throw err;
        const again = await this.crm.lookupLeadForJoana(input.whatsapp);
        if (again.kind !== 'visible') return false;
        bookingId = again.bookingId;
      }
    }

    if (!bookingId) return false;
    if (!createdNow && decision.nameToSave) {
      await this.crm.renameLeadForJoana(input.whatsapp, decision.nameToSave);
    }
    if (decision.crmPatch) {
      const patch = createdNow
        ? {
            ...('hasPet' in decision.crmPatch
              ? { crmHasPet: decision.crmPatch.hasPet ?? null }
              : {}),
            ...('hasVisa' in decision.crmPatch
              ? { crmHasVisa: decision.crmPatch.hasVisa ?? null }
              : {}),
          }
        : patchToUpdate(decision.crmPatch);
      if (patch && Object.keys(patch).length > 0) {
        try {
          await this.crm.updateCrm({ bookingId, ...patch });
        } catch (err: unknown) {
          if (!isCrmMessage(err, 'Nenhuma alteração para guardar.')) throw err;
        }
      }
    }
    return true;
  }

  private async finishTurn(input: {
    id: string;
    bufferIds: string[];
    history: HistoryItem[];
    userText: string;
    assistantText: string;
    pending: PendingConfirmation | null;
    farGuidanceSent: boolean;
    schedulingLinkSent: boolean;
    outbound: string;
    whatsapp: string;
    instance: string | null;
  }) {
    if (!(await this.crm.isJoanaActive(input.whatsapp))) {
      await this.dropBecausePaused(input.id);
      return;
    }

    let outboundSaved: string | null = null;
    try {
      await this.wa.sendText(input.whatsapp, input.outbound, {
        preferredInstance: input.instance || undefined,
        requireDelivery: true,
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Joana envio ${input.whatsapp}: ${err instanceof Error ? err.message : String(err)}`,
      );
      outboundSaved = input.outbound;
    }

    const data = {
      pendingConfirmation: input.pending
        ? (input.pending as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      pendingOutbound: outboundSaved,
      farGuidanceSent: input.farGuidanceSent,
      schedulingLinkSent: input.schedulingLinkSent,
      processing: false,
    };
    const turn: HistoryItem[] = [
      { role: 'user', text: input.userText },
      { role: 'assistant', text: input.assistantText },
    ];

    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.prisma.joanaConversation.findUnique({
        where: { id: input.id },
      });
      if (!current) return;
      const remaining = readBuffer(current.buffer).filter(
        (item) => !input.bufferIds.includes(item.id),
      );
      const history = appendHistoryTurn(
        historyBase(readHistory(current.history), input.history),
        turn,
      );
      const saved = await this.prisma.joanaConversation.updateMany({
        where: { id: input.id, updatedAt: current.updatedAt },
        data: {
          ...data,
          history: history as unknown as Prisma.InputJsonValue,
          buffer: remaining as unknown as Prisma.InputJsonValue,
        },
      });
      if (saved.count === 1) return;
    }

    const latest = await this.prisma.joanaConversation.findUnique({
      where: { id: input.id },
    });
    if (!latest) return;
    const remaining = readBuffer(latest.buffer).filter(
      (item) => !input.bufferIds.includes(item.id),
    );
    await this.prisma.joanaConversation.update({
      where: { id: input.id },
      data: {
        ...data,
        history: appendHistoryTurn(
          historyBase(readHistory(latest.history), input.history),
          turn,
        ) as unknown as Prisma.InputJsonValue,
        buffer: remaining as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async release(id: string) {
    await this.prisma.joanaConversation.update({
      where: { id },
      data: { processing: false },
    });
  }

  private async appendBuffer(input: {
    whatsapp: string;
    instance: string | null;
    displayName: string | null;
    item: BufferItem;
  }) {
    const existing = await this.prisma.joanaConversation.findUnique({
      where: { whatsappDigits: input.whatsapp },
    });
    if (!existing) {
      try {
        await this.prisma.joanaConversation.create({
          data: {
            whatsappDigits: input.whatsapp,
            instance: input.instance,
            displayName: input.displayName,
            buffer: [input.item] as unknown as Prisma.InputJsonValue,
            history: [] as unknown as Prisma.InputJsonValue,
            lastInboundAt: new Date(),
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

    const row =
      existing ??
      (await this.prisma.joanaConversation.findUnique({
        where: { whatsappDigits: input.whatsapp },
      }));
    if (!row) return;

    for (let attempt = 0; attempt < 3; attempt++) {
      const current =
        attempt === 0
          ? row
          : await this.prisma.joanaConversation.findUnique({ where: { id: row.id } });
      if (!current) return;
      const buffer = readBuffer(current.buffer);
      if (buffer.some((item) => item.id === input.item.id)) return;
      buffer.push(input.item);
      const saved = await this.prisma.joanaConversation.updateMany({
        where: { id: current.id, updatedAt: current.updatedAt },
        data: {
          buffer: buffer as unknown as Prisma.InputJsonValue,
          lastInboundAt: new Date(),
          instance: input.instance || current.instance,
          displayName: current.displayName || input.displayName,
        },
      });
      if (saved.count === 1) return;
    }
  }
}

function isCrmMessage(err: unknown, text: string): boolean {
  return err instanceof BadRequestException && err.message === text;
}

function patchToUpdate(patch: JoanaCrmPatch) {
  const data: {
    crmExpectedImmigrationAt?: string | null;
    crmPreferredCity?: string | null;
    crmPropertyTypology?: JoanaTypology | null;
    crmDesiredRent?: number | null;
    crmHasPet?: boolean | null;
    crmHasVisa?: boolean | null;
  } = {};
  if ('immigration' in patch) data.crmExpectedImmigrationAt = patch.immigration ?? null;
  if ('cities' in patch) data.crmPreferredCity = patch.cities ?? null;
  if ('typology' in patch) data.crmPropertyTypology = patch.typology ?? null;
  if ('desiredRent' in patch) data.crmDesiredRent = patch.desiredRent ?? null;
  if ('hasPet' in patch) data.crmHasPet = patch.hasPet ?? null;
  if ('hasVisa' in patch) data.crmHasVisa = patch.hasVisa ?? null;
  return data;
}

function profileFromLead(lead: {
  name: string | null;
  immigration: string | null;
  cities: string | null;
  typology: JoanaTypology | null;
  desiredRent: number | null;
  hasVisa: boolean | null;
  hasPet: boolean | null;
}): JoanaProfile {
  return {
    name: lead.name,
    immigration: lead.immigration,
    cities: lead.cities,
    typology: lead.typology,
    desiredRent: lead.desiredRent,
    hasVisa: lead.hasVisa,
    hasPet: lead.hasPet,
  };
}

function describeProfile(
  profile: JoanaProfile,
  kind: 'visible' | 'excluded' | 'none',
): string {
  if (kind === 'excluded') {
    return 'Este número foi retirado do CRM. Não recolhas dados novos nem prometas repor a ficha.';
  }
  if (kind === 'none') {
    return 'Ainda não há ficha no CRM. Se esta mensagem não for um sim claro ao serviço, apresenta-te, explica o relocation e pergunta se tem interesse, sem recolher dados. Se for um sim, podes guardar o que ela disse agora.';
  }
  const typology = profile.typology
    ? `${profile.typology} (${JOANA_TYPOLOGY_SPEECH[profile.typology]})`
    : 'ainda não temos';
  return [
    `Nome: ${profile.name || 'ainda não temos'}`,
    `Data de imigração: ${profile.immigration ? formatImmigrationLabel(profile.immigration) : 'ainda não temos'}`,
    `Visto: ${profile.hasVisa === null ? 'ainda não sabemos' : profile.hasVisa ? 'sim' : 'não'}`,
    `Cidades: ${profile.cities || 'ainda não temos'}`,
    `Tipologia: ${typology}`,
    `Valor do aluguel pretendido: ${
      profile.desiredRent == null ? 'ainda não temos' : `€${profile.desiredRent}`
    }`,
    `Pet: ${profile.hasPet === null ? 'ainda não sabemos' : profile.hasPet ? 'sim' : 'não'}`,
  ].join('\n');
}

function composeReply(reply: string, append: string[], saved = false): string {
  return composeJoanaReply(
    reply,
    append,
    'Oi, eu sou a Joana, atendente virtual da Rafa. A Rafa ajuda na busca do imóvel em Portugal, nas visitas por videochamada e na negociação com os proprietários.',
    saved,
  );
}

function cleanName(raw: string | null | undefined): string | null {
  const cleaned = (raw || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (cleaned.length < 2 || /^\d+$/.test(cleaned)) return null;
  return cleaned;
}

function fallbackLeadName(digits: string): string {
  const tail = digits.replace(/\D/g, '').slice(-4) || 'WA';
  return `Lead ${tail}`;
}

function readBuffer(value: unknown): BufferItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as { id?: unknown; text?: unknown; at?: unknown };
    if (typeof row.text !== 'string' || !row.text.trim()) return [];
    return [
      {
        id: typeof row.id === 'string' && row.id ? row.id : `local-${row.at ?? ''}`,
        text: row.text.trim(),
        at: typeof row.at === 'string' ? row.at : new Date().toISOString(),
      },
    ];
  });
}

function appendHistoryTurn(history: HistoryItem[], turn: HistoryItem[]): HistoryItem[] {
  if (turn.length === 0) return history.slice(-HISTORY_LIMIT);
  const tail = history.slice(-turn.length);
  const same =
    tail.length === turn.length &&
    tail.every(
      (item, index) => item.role === turn[index]?.role && item.text === turn[index]?.text,
    );
  if (same) return history.slice(-HISTORY_LIMIT);
  return [...history, ...turn].slice(-HISTORY_LIMIT);
}

function historyBase(stored: HistoryItem[], snapshot: HistoryItem[]): HistoryItem[] {
  return stored.length >= snapshot.length ? stored : snapshot;
}

function readHistory(value: unknown): HistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as { role?: unknown; text?: unknown };
    if ((row.role !== 'user' && row.role !== 'assistant') || typeof row.text !== 'string') {
      return [];
    }
    return [{ role: row.role, text: row.text }];
  });
}

function readPending(value: unknown): PendingConfirmation | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { field?: unknown; value?: unknown; question?: unknown };
  const fields = ['name', 'immigration', 'visa', 'cities', 'typology', 'rent', 'pet'];
  if (typeof row.field !== 'string' || !fields.includes(row.field)) return null;
  if (typeof row.value !== 'string' || typeof row.question !== 'string') return null;
  return {
    field: row.field as PendingConfirmation['field'],
    value: row.value,
    question: row.question,
  };
}
