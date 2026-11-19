import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  ChatbotChannel,
  ChatbotEngineKind,
  Prisma,
  RafaCallCrmStatus,
} from '@prisma/client';
import { ConversationOutboundService } from '../channels/conversation-outbound.service';
import {
  sharedOutboundGuard,
  whatsappPeer,
} from '../channels/outbound-guard';
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
import { enrichWelcomeStepsChannelMedia } from '../uploads/channel-media.util';
import {
  type JoanaWelcomeStep,
  normalizeJoanaWelcomeSteps,
  parseStoredWelcomeSteps,
  welcomeStepsHistorySummary,
} from './joana-welcome';
import {
  JOANA_DECLINE_HANDOFF,
  JOANA_INTRO,
  JOANA_TYPOLOGY_SPEECH,
  applyJoanaProposal,
  composeJoanaReply,
  emptyJoanaProfile,
  formatImmigrationLabel,
  isPlaceholderLeadName,
  missingFieldQuestion,
  shouldOfferSchedulingLink,
  withInferredConfirmation,
  withInferredName,
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
    private readonly outbound: ConversationOutboundService,
    private readonly crm: RafacallCrmService,
    private readonly openai: JoanaOpenAiService,
  ) {}

  async getContext(): Promise<{ contextText: string }> {
    const bot = await this.prisma.chatbot.findUnique({ where: { slug: 'joana' } });
    if (bot?.contextText?.trim()) {
      return { contextText: bot.contextText.trim() };
    }
    const legacy = await this.prisma.joanaSettings.findUnique({
      where: { id: 'default' },
    });
    return { contextText: legacy?.contextText?.trim() || JOANA_DEFAULT_CONTEXT };
  }

  async updateContext(contextText: string): Promise<{ contextText: string }> {
    const text = contextText.trim();
    if (text.length < 20) {
      throw new BadRequestException('O contexto da Joana está curto demais.');
    }
    const bot = await this.prisma.chatbot.findUnique({ where: { slug: 'joana' } });
    if (bot) {
      const saved = await this.prisma.chatbot.update({
        where: { id: bot.id },
        data: { contextText: text },
      });
      return { contextText: saved.contextText };
    }
    const saved = await this.prisma.joanaSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        contextText: text,
        welcomeSteps: [] as unknown as Prisma.InputJsonValue,
      },
      update: { contextText: text },
    });
    return { contextText: saved.contextText };
  }

  async getWelcome(): Promise<{ steps: JoanaWelcomeStep[] }> {
    const bot = await this.prisma.chatbot.findUnique({ where: { slug: 'joana' } });
    if (bot) {
      return { steps: parseStoredWelcomeSteps(bot.welcomeSteps) };
    }
    const row = await this.prisma.joanaSettings.findUnique({
      where: { id: 'default' },
    });
    return { steps: parseStoredWelcomeSteps(row?.welcomeSteps) };
  }

  async updateWelcome(rawSteps: unknown): Promise<{ steps: JoanaWelcomeStep[] }> {
    const normalized = normalizeJoanaWelcomeSteps(rawSteps);
    const steps = await enrichWelcomeStepsChannelMedia(normalized);
    const bot = await this.prisma.chatbot.findUnique({ where: { slug: 'joana' } });
    if (bot) {
      const saved = await this.prisma.chatbot.update({
        where: { id: bot.id },
        data: { welcomeSteps: steps as unknown as Prisma.InputJsonValue },
      });
      return { steps: parseStoredWelcomeSteps(saved.welcomeSteps) };
    }
    const existing = await this.prisma.joanaSettings.findUnique({
      where: { id: 'default' },
    });
    const saved = await this.prisma.joanaSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        contextText: existing?.contextText?.trim() || JOANA_DEFAULT_CONTEXT,
        welcomeSteps: steps as unknown as Prisma.InputJsonValue,
      },
      update: { welcomeSteps: steps as unknown as Prisma.InputJsonValue },
    });
    return { steps: parseStoredWelcomeSteps(saved.welcomeSteps) };
  }

  /** Usado pelo ChatbotRouterService após o menu / no flush multi-bot. */
  async processConversationPublic(id: string): Promise<void> {
    return this.processConversation(id);
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

  /** Guarda a mensagem e deixa o flush dos 15s responder. */
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

    // Eco das próprias respostas (router já faz claim do messageId).
    if (
      sharedOutboundGuard.isAutomatedEcho({
        peer: whatsappPeer(input.whatsapp),
        messageId: item.id.startsWith('local-') ? null : item.id,
        text: item.text,
      })
    ) {
      return { handled: true, status: 'ignored_echo' };
    }

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

    const existing = await this.findWhatsappConversation(input.whatsapp);
    if (!existing) {
      try {
        await this.prisma.joanaConversation.create({
          data: {
            whatsappDigits: input.whatsapp,
            activeChannel: ChatbotChannel.WHATSAPP,
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

    const row = existing ?? (await this.findWhatsappConversation(input.whatsapp));
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
    // Só conversas já atribuídas à Joana. Menu / Bruna / Gabi / etc. são do router.
    const due = await this.prisma.joanaConversation.findMany({
      where: {
        processing: false,
        chatbot: { engineKind: ChatbotEngineKind.JOANA_QUALIFICATION },
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
      if (!row?.whatsappDigits && !row?.instagramUserId) {
        await this.release(id);
        return;
      }

      const contactLabel =
        row.whatsappDigits || `ig:${row.instagramUserId || row.id}`;

      const isIgChannel =
        row.activeChannel === ChatbotChannel.INSTAGRAM &&
        Boolean(row.instagramUserId?.trim());

      // No IG, a ficha/âncora é o IGSID — mesmo que a conversa já tenha WhatsApp.
      if (isIgChannel) {
        if (!(await this.isJoanaActiveOnInstagram(row.instagramUserId!))) {
          await this.dropBecausePaused(id);
          return;
        }
      } else if (row.whatsappDigits) {
        if (!(await this.crm.isJoanaActive(row.whatsappDigits))) {
          await this.dropBecausePaused(id);
          return;
        }
      } else if (row.instagramUserId) {
        if (!(await this.isJoanaActiveOnInstagram(row.instagramUserId))) {
          await this.dropBecausePaused(id);
          return;
        }
      }

      if (row.pendingOutbound) {
        const outbound = row.pendingOutbound;
        await this.outbound.sendText(row, outbound, { requireDelivery: true });
        await this.prisma.joanaConversation.update({
          where: { id },
          data: { pendingOutbound: null, processing: false },
        });
        if (outbound.includes(JOANA_DECLINE_HANDOFF)) {
          if (row.whatsappDigits) {
            await this.crm.setJoanaEnabledForWhatsapp(row.whatsappDigits, false);
          } else if (row.instagramUserId) {
            await this.setJoanaEnabledOnInstagram(row.instagramUserId, false);
          }
        }
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
      const { steps: welcomeSteps } = await this.getWelcome();
      const lookupLead = async () => {
        if (isIgChannel && row.instagramUserId) {
          return this.crm.lookupLeadForJoanaByInstagram(row.instagramUserId);
        }
        if (row.whatsappDigits) {
          return this.crm.lookupLeadForJoana(row.whatsappDigits);
        }
        if (row.instagramUserId) {
          return this.crm.lookupLeadForJoanaByInstagram(row.instagramUserId);
        }
        return { kind: 'none' } as const;
      };

      let lead = await lookupLead();
      // Conversas já na Joana sem ficha RafaCall (ex.: IG antes deste fix).
      if (lead.kind === 'none') {
        await this.ensureRafaCallCardForConversation(row);
        lead = await lookupLead();
      }
      const profile = lead.kind === 'visible' ? profileFromLead(lead) : emptyJoanaProfile();
      const hasScheduledVideoCall =
        lead.kind === 'visible' ? lead.hasScheduledVideoCall : false;

      // 1ª interação = só boas-vindas (ou intro por omissão); OpenAI na mensagem seguinte.
      if (!row.welcomeSent) {
        let welcomeSummary = '';
        try {
          if (welcomeSteps.length > 0) {
            await this.outbound.sendWelcomeSteps(row, welcomeSteps, {
              requireDelivery: true,
            });
            welcomeSummary = welcomeStepsHistorySummary(welcomeSteps);
          } else {
            await this.outbound.sendText(row, JOANA_INTRO, {
              requireDelivery: true,
            });
            welcomeSummary = JOANA_INTRO;
          }
        } catch (err: unknown) {
          this.logger.warn(
            `Joana boas-vindas ${contactLabel}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }

        await this.persistWelcomeOnlyTurn({
          id,
          bufferIds: buffer.map((item) => item.id),
          history,
          userText: combined,
          welcomeSummary: welcomeSummary || '[Boas-vindas enviadas]',
        });
        return;
      }

      const historyForModel = history;

      let reply = '';
      let proposal = {
        interested: null as boolean | null,
        confirmation: null as 'yes' | 'no' | null,
      };
      try {
        const interpreted = await this.openai.interpret({
          context: contextText,
          transcript: historyForModel
            .map((item) => `${item.role}: ${item.text}`)
            .join('\n'),
          profileSummary: describeProfile(profile, lead.kind, {
            hasScheduledVideoCall,
          }),
          pendingQuestion:
            pending?.field === 'immigration' ? pending.question : null,
          combinedText: combined,
        });
        reply = interpreted.reply;
        proposal = interpreted.proposal;
        // Boas-vindas já foram enviadas no 1º turno; não prefixar intro de novo.
      } catch (err: unknown) {
        this.logger.warn(
          `Joana OpenAI ${contactLabel}: ${err instanceof Error ? err.message : String(err)}`,
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
          welcomeSent: true,
          outbound: reply,
          whatsapp: row.whatsappDigits,
          instagramUserId: row.instagramUserId,
          instance: row.instance,
        });
        return;
      }

      // No IG (mesmo com WA na ficha) a pausa segue o CrmLead IG — não o check WA.
      if (isIgChannel) {
        if (!(await this.isJoanaActiveOnInstagram(row.instagramUserId!))) {
          await this.dropBecausePaused(id);
          return;
        }
      } else if (row.whatsappDigits) {
        if (!(await this.crm.isJoanaActive(row.whatsappDigits))) {
          await this.dropBecausePaused(id);
          return;
        }
      } else if (row.instagramUserId) {
        if (!(await this.isJoanaActiveOnInstagram(row.instagramUserId))) {
          await this.dropBecausePaused(id);
          return;
        }
      }

      const proposalWithInferences = withInferredName({
        profile,
        proposal: withInferredConfirmation({
          pending,
          proposal,
          message: combined,
        }),
        message: combined,
      });

      const decision = applyJoanaProposal({
        hasLead: lead.kind === 'visible',
        excluded: lead.kind === 'excluded',
        profile,
        pending,
        proposal: proposalWithInferences,
      });

      let farGuidanceSent = row.farGuidanceSent;
      let schedulingLinkSent = row.schedulingLinkSent;
      let offerSchedulingLink = false;
      const append = [...decision.append];
      let saved =
        decision.createLead || Boolean(decision.nameToSave || decision.crmPatch);

      try {
        const linkAlreadyDelivered = history.some(
          (item) =>
            item.role === 'assistant' &&
            (item.text.includes('/agendar?') || item.text.includes('/agendar')),
        );

        const persisted = await this.persistDecision({
          whatsapp: row.whatsappDigits,
          instagramUserId: row.instagramUserId,
          lead,
          decision,
        });
        if (persisted) {
          const next = row.whatsappDigits
            ? await this.crm.lookupLeadForJoana(row.whatsappDigits)
            : row.instagramUserId
              ? await this.crm.lookupLeadForJoanaByInstagram(row.instagramUserId)
              : ({ kind: 'none' } as const);
          if (next.kind === 'visible') {
            if (next.hasScheduledVideoCall) {
              schedulingLinkSent = true;
              farGuidanceSent = false;
            } else {
              const guidance = this.columnGuidance(
                next.crmStatus,
                row.whatsappDigits,
                next.name,
                next.bookingId,
              );
              if (next.crmStatus === RafaCallCrmStatus.IMIGRACAO_PERTO) {
                farGuidanceSent = false;
                offerSchedulingLink = shouldOfferSchedulingLink({
                  crmStatus: next.crmStatus,
                  hasVisa: next.hasVisa,
                  hasScheduledVideoCall: next.hasScheduledVideoCall,
                  linkAlreadyDelivered,
                  schedulingLinkSent,
                });
                if (offerSchedulingLink && guidance) append.push(guidance);
              } else if (next.crmStatus === RafaCallCrmStatus.IMIGRACAO_LONGE) {
                schedulingLinkSent = false;
                if (next.hasVisa !== false && !farGuidanceSent && guidance) {
                  append.push(guidance);
                  farGuidanceSent = true;
                }
              } else if (next.crmStatus === RafaCallCrmStatus.IMIGRACAO_NULL) {
                farGuidanceSent = false;
                schedulingLinkSent = false;
              }
            }
          }
        }
      } catch (err: unknown) {
        // Falha a gravar no CRM, mas a resposta da conversa (OpenAI) mantém-se.
        this.logger.warn(
          `Joana CRM ${contactLabel}: ${err instanceof Error ? err.message : String(err)}`,
        );
        decision.pending = pending;
        saved = false;
      }

      const composed = composeReply(reply, append, saved);
      if (composed.includes('/agendar')) schedulingLinkSent = true;
      else if (offerSchedulingLink) schedulingLinkSent = false;
      const sent = await this.finishTurn({
        id,
        bufferIds: buffer.map((item) => item.id),
        history,
        userText: combined,
        assistantText: composed,
        pending: decision.pending,
        farGuidanceSent,
        schedulingLinkSent,
        welcomeSent: true,
        outbound: composed,
        whatsapp: row.whatsappDigits,
        instagramUserId: row.instagramUserId,
        instance: row.instance,
      });
      if (decision.disableJoana && sent) {
        if (row.whatsappDigits) {
          await this.crm.setJoanaEnabledForWhatsapp(row.whatsappDigits, false);
        } else if (row.instagramUserId) {
          await this.setJoanaEnabledOnInstagram(row.instagramUserId, false);
        }
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Joana ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.release(id);
    }
  }

  private columnGuidance(
    status: RafaCallCrmStatus,
    whatsapp: string | null,
    name: string | null,
    bookingId: string | null,
  ): string | null {
    if (status === RafaCallCrmStatus.IMIGRACAO_PERTO) {
      let link = '';
      try {
        const base = getFrontendBaseUrl().replace(/\/$/, '');
        const params = new URLSearchParams();
        // Âncora do cartão CRM — evita duplicar ao agendar (IG sem WA na URL).
        if (bookingId?.trim()) params.set('booking', bookingId.trim());
        if (whatsapp?.trim()) params.set('whatsapp', whatsapp.trim());
        if (name && !isPlaceholderLeadName(name)) params.set('name', name);
        const qs = params.toString();
        link = qs ? `${base}/agendar?${qs}` : `${base}/agendar`;
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

  private async isJoanaActiveOnInstagram(
    instagramUserId: string,
  ): Promise<boolean> {
    const bot = await this.prisma.chatbot.findUnique({
      where: { slug: 'joana' },
      select: { id: true },
    });
    if (!bot) return true;
    const lead = await this.prisma.crmLead.findFirst({
      where: {
        chatbotId: bot.id,
        instagramUserId,
        crmExcludedAt: null,
      },
      select: { botEnabled: true },
    });
    if (!lead) return true;
    return lead.botEnabled;
  }

  private async setJoanaEnabledOnInstagram(
    instagramUserId: string,
    enabled: boolean,
  ): Promise<void> {
    const bot = await this.prisma.chatbot.findUnique({
      where: { slug: 'joana' },
      select: { id: true },
    });
    if (!bot) return;
    await this.prisma.crmLead.updateMany({
      where: {
        chatbotId: bot.id,
        instagramUserId,
        crmExcludedAt: null,
      },
      data: { botEnabled: enabled },
    });
    await this.prisma.joanaConversation.updateMany({
      where: { instagramUserId },
      data: { paused: !enabled },
    });
  }

  private async persistDecision(input: {
    whatsapp: string | null;
    instagramUserId?: string | null;
    lead:
      | Awaited<ReturnType<RafacallCrmService['lookupLeadForJoana']>>
      | Awaited<ReturnType<RafacallCrmService['lookupLeadForJoanaByInstagram']>>;
    decision: ReturnType<typeof applyJoanaProposal>;
  }): Promise<boolean> {
    const { decision } = input;
    if (input.lead.kind === 'excluded') return false;
    if (!decision.createLead && !decision.nameToSave && !decision.crmPatch) {
      return true;
    }

    let bookingId = input.lead.kind === 'visible' ? input.lead.bookingId : null;

    let createdNow = false;
    if (decision.createLead && !bookingId) {
      // Nome da ficha: só o que a pessoa disse, ou «Lead XXX». O nick do WhatsApp
      // não entra — senão a qualificação trata «Mozi» como nome já preenchido.
      const name =
        decision.nameToSave ||
        (input.whatsapp
          ? fallbackLeadName(input.whatsapp)
          : `Lead IG ${(input.instagramUserId || '').slice(-4) || 'novo'}`);
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
        if (input.instagramUserId) {
          await this.linkJoanaCrmLeadToBooking(
            input.instagramUserId,
            created.id,
            decision.nameToSave,
          );
        }
      } catch (err: unknown) {
        if (!isCrmMessage(err, 'Este cliente já está no CRM.')) throw err;
        if (!input.whatsapp) return false;
        const again = await this.crm.lookupLeadForJoana(input.whatsapp);
        if (again.kind !== 'visible') return false;
        bookingId = again.bookingId;
      }
    }

    if (!bookingId) return false;
    if (!createdNow && decision.nameToSave) {
      if (input.whatsapp) {
        await this.crm.renameLeadForJoana(input.whatsapp, decision.nameToSave);
      } else {
        await this.prisma.rafaCallBooking.update({
          where: { id: bookingId },
          data: { guestName: decision.nameToSave },
        });
      }
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

  private async linkJoanaCrmLeadToBooking(
    instagramUserId: string,
    bookingId: string,
    displayName?: string | null,
  ): Promise<void> {
    const ig = instagramUserId.trim();
    if (!ig) return;
    const bot = await this.prisma.chatbot.findUnique({
      where: { slug: 'joana' },
      select: { id: true },
    });
    if (!bot) return;

    const linked = await this.prisma.crmLead.updateMany({
      where: {
        chatbotId: bot.id,
        instagramUserId: ig,
        crmExcludedAt: null,
      },
      data: { rafaCallBookingId: bookingId },
    });
    if (linked.count > 0) return;

    // Sem CrmLead activo (ex.: IGSID preso em excluído) — libertar e criar lock.
    await this.prisma.crmLead.updateMany({
      where: {
        chatbotId: bot.id,
        instagramUserId: ig,
        crmExcludedAt: { not: null },
      },
      data: { instagramUserId: null },
    });

    const firstColumn = await this.prisma.crmColumn.findFirst({
      where: { chatbotId: bot.id },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    if (!firstColumn) return;

    const guestName =
      (displayName && displayName.trim().length >= 2
        ? displayName.trim().slice(0, 80)
        : null) || `Lead IG ${ig.slice(-4)}`;

    try {
      await this.prisma.crmLead.create({
        data: {
          chatbotId: bot.id,
          columnId: firstColumn.id,
          instagramUserId: ig,
          rafaCallBookingId: bookingId,
          guestName,
          botEnabled: true,
        },
      });
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        await this.prisma.crmLead.updateMany({
          where: {
            chatbotId: bot.id,
            instagramUserId: ig,
            crmExcludedAt: null,
          },
          data: { rafaCallBookingId: bookingId },
        });
        return;
      }
      throw err;
    }
  }

  private async ensureRafaCallCardForConversation(row: {
    whatsappDigits: string | null;
    instagramUserId: string | null;
    displayName: string | null;
  }): Promise<void> {
    const name =
      (row.displayName && row.displayName.trim().length >= 2
        ? row.displayName.trim().slice(0, 80)
        : null) ||
      (row.whatsappDigits
        ? fallbackLeadName(row.whatsappDigits)
        : `Lead IG ${(row.instagramUserId || '').slice(-4) || 'novo'}`);
    try {
      const created = await this.crm.createCrmClient({
        name,
        whatsapp: row.whatsappDigits,
      });
      if (row.instagramUserId) {
        await this.linkJoanaCrmLeadToBooking(
          row.instagramUserId,
          created.id,
          row.displayName,
        );
      }
    } catch (err: unknown) {
      if (!isCrmMessage(err, 'Este cliente já está no CRM.')) {
        this.logger.warn(
          `Joana ensure CRM: ${err instanceof Error ? err.message : String(err)}`,
        );
      } else if (row.instagramUserId && row.whatsappDigits) {
        const again = await this.crm.lookupLeadForJoana(row.whatsappDigits);
        if (again.kind === 'visible') {
          await this.linkJoanaCrmLeadToBooking(
            row.instagramUserId,
            again.bookingId,
            row.displayName,
          );
        }
      }
    }
  }

  /** Persiste o turno de boas-vindas sem enviar outra mensagem nem chamar a OpenAI. */
  private async persistWelcomeOnlyTurn(input: {
    id: string;
    bufferIds: string[];
    history: HistoryItem[];
    userText: string;
    welcomeSummary: string;
  }): Promise<void> {
    const turn: HistoryItem[] = [
      { role: 'user', text: input.userText },
      { role: 'assistant', text: input.welcomeSummary },
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
          welcomeSent: true,
          processing: false,
          pendingOutbound: null,
          history: history as unknown as Prisma.InputJsonValue,
          buffer: remaining as unknown as Prisma.InputJsonValue,
        },
      });
      if (saved.count === 1) return;
    }
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
    welcomeSent: boolean;
    outbound: string;
    whatsapp: string | null;
    instagramUserId?: string | null;
    instance: string | null;
  }): Promise<boolean> {
    const conv = await this.prisma.joanaConversation.findUnique({
      where: { id: input.id },
    });
    const isIgChannel =
      conv?.activeChannel === ChatbotChannel.INSTAGRAM &&
      Boolean(conv.instagramUserId?.trim() || input.instagramUserId?.trim());
    const igsid =
      (conv?.instagramUserId || input.instagramUserId || '').trim() || null;

    // IG com WhatsApp na ficha: não usar isJoanaActive(WA) — isso pausava a DM.
    if (isIgChannel && igsid) {
      if (!(await this.isJoanaActiveOnInstagram(igsid))) {
        await this.dropBecausePaused(input.id);
        return false;
      }
    } else if (input.whatsapp) {
      if (!(await this.crm.isJoanaActive(input.whatsapp))) {
        await this.dropBecausePaused(input.id);
        return false;
      }
    } else if (igsid) {
      if (!(await this.isJoanaActiveOnInstagram(igsid))) {
        await this.dropBecausePaused(input.id);
        return false;
      }
    }

    const contactLabel =
      input.whatsapp || (igsid ? `ig:${igsid}` : input.id);

    let outboundSaved: string | null = null;
    let sent = false;
    try {
      if (conv) {
        await this.outbound.sendText(conv, input.outbound, {
          requireDelivery: true,
        });
      } else if (input.whatsapp) {
        await this.wa.sendText(input.whatsapp, input.outbound, {
          preferredInstance: input.instance || undefined,
          requireDelivery: true,
        });
      } else {
        throw new Error('Sem canal de envio para a Joana');
      }
      sent = true;
    } catch (err: unknown) {
      this.logger.warn(
        `Joana envio ${contactLabel}: ${err instanceof Error ? err.message : String(err)}`,
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
      welcomeSent: input.welcomeSent,
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
      if (!current) return sent;
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
      if (saved.count === 1) return sent;
    }

    const latest = await this.prisma.joanaConversation.findUnique({
      where: { id: input.id },
    });
    if (!latest) return sent;
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
    return sent;
  }

  private async release(id: string) {
    await this.prisma.joanaConversation.update({
      where: { id },
      data: { processing: false },
    });
  }

  private async findWhatsappConversation(whatsapp: string) {
    return (
      (await this.prisma.joanaConversation.findFirst({
        where: {
          whatsappDigits: whatsapp,
          activeChannel: ChatbotChannel.WHATSAPP,
        },
        orderBy: { updatedAt: 'desc' },
      })) ??
      this.prisma.joanaConversation.findFirst({
        where: { whatsappDigits: whatsapp },
        orderBy: { updatedAt: 'desc' },
      })
    );
  }

  private async appendBuffer(input: {
    whatsapp: string;
    instance: string | null;
    displayName: string | null;
    item: BufferItem;
  }) {
    const existing = await this.findWhatsappConversation(input.whatsapp);
    if (!existing) {
      try {
        await this.prisma.joanaConversation.create({
          data: {
            whatsappDigits: input.whatsapp,
            activeChannel: ChatbotChannel.WHATSAPP,
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

    const row = existing ?? (await this.findWhatsappConversation(input.whatsapp));
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
    crmPropertyTypology?: JoanaTypology[];
    crmDesiredRent?: number | null;
    crmHasPet?: boolean | null;
    crmHasVisa?: boolean | null;
  } = {};
  if ('immigration' in patch) data.crmExpectedImmigrationAt = patch.immigration ?? null;
  if ('cities' in patch) data.crmPreferredCity = patch.cities ?? null;
  if ('typology' in patch) data.crmPropertyTypology = patch.typology ?? [];
  if ('desiredRent' in patch) data.crmDesiredRent = patch.desiredRent ?? null;
  if ('hasPet' in patch) data.crmHasPet = patch.hasPet ?? null;
  if ('hasVisa' in patch) data.crmHasVisa = patch.hasVisa ?? null;
  return data;
}

function profileFromLead(lead: {
  name: string | null;
  immigration: string | null;
  cities: string | null;
  typology: JoanaTypology[] | JoanaTypology | null;
  desiredRent: number | null;
  hasVisa: boolean | null;
  hasPet: boolean | null;
}): JoanaProfile {
  const typology = Array.isArray(lead.typology)
    ? lead.typology
    : lead.typology
      ? [lead.typology]
      : [];
  return {
    name: lead.name,
    immigration: lead.immigration,
    cities: lead.cities,
    typology,
    desiredRent: lead.desiredRent,
    hasVisa: lead.hasVisa,
    hasPet: lead.hasPet,
  };
}

function describeProfile(
  profile: JoanaProfile,
  kind: 'visible' | 'excluded' | 'none',
  opts?: { hasScheduledVideoCall?: boolean },
): string {
  if (kind === 'excluded') {
    return 'Este número foi retirado do CRM. Não recolhas dados novos nem prometas repor a ficha.';
  }
  if (kind === 'none') {
    return 'Ainda não há ficha no CRM. Se esta mensagem não for um sim claro ao serviço, explica o relocation em frases curtas (sem dizer o teu nome) e pergunta se tem interesse, sem recolher dados. Se for um sim, podes guardar o que ela disse agora. Se for um não claro ao serviço, interested é false: reação curta sem pergunta; o sistema faz o handoff à Rafa.';
  }
  const typology =
    profile.typology.length > 0
      ? profile.typology
          .map((item) => `${item} (${JOANA_TYPOLOGY_SPEECH[item]})`)
          .join(' ou ')
      : 'ainda não temos';
  const nextQuestion = missingFieldQuestion(profile);
  const nameLabel =
    profile.name && !isPlaceholderLeadName(profile.name)
      ? profile.name
      : 'ainda não temos';
  return [
    `Nome: ${nameLabel}`,
    `Data de imigração: ${profile.immigration ? formatImmigrationLabel(profile.immigration) : 'ainda não temos'}`,
    `Visto: ${profile.hasVisa === null ? 'ainda não sabemos' : profile.hasVisa ? 'sim' : 'não'}`,
    `Cidades: ${profile.cities || 'ainda não temos'}`,
    `Tipologia: ${typology}`,
    `Valor do aluguel pretendido: ${
      profile.desiredRent == null ? 'ainda não temos' : `€${profile.desiredRent}`
    }`,
    `Pet: ${profile.hasPet === null ? 'ainda não sabemos' : profile.hasPet ? 'sim' : 'não'}`,
    `Videochamada: ${
      opts?.hasScheduledVideoCall
        ? 'já agendada — não ofereças nem peças para agendar de novo'
        : 'ainda não agendada'
    }`,
    nextQuestion
      ? `Próximo a perguntar (só isto; não repitas dados já preenchidos): ${nextQuestion}`
      : 'Não falta nenhum dado de qualificação. Não faças pergunta de qualificação.',
  ].join('\n');
}

function composeReply(reply: string, append: string[], saved = false): string {
  return composeJoanaReply(
    reply,
    append,
    JOANA_INTRO,
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
