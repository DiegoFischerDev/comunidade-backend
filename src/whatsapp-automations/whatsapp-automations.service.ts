import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WhatsappClientAutomationStepType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { toAbsoluteMediaUrl } from '../common/public-media-url';
import { getFrontendBaseUrl } from '../config/frontend-base-url';
import {
  CreateWhatsappClientAutomationDto,
  UpdateWhatsappClientAutomationDto,
  WhatsappClientAutomationInboundDto,
  AutomationStepInputDto,
} from './dto/whatsapp-client-automation.dto';

const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MIN_TRIGGER_LEN = 20;
const ACTIVE_CACHE_TTL_MS = 30_000;

type AutomationWithSteps = Prisma.WhatsappClientAutomationGetPayload<{
  include: { steps: true };
}>;

@Injectable()
export class WhatsappAutomationsService {
  private readonly logger = new Logger(WhatsappAutomationsService.name);
  private activeCache: { at: number; items: AutomationWithSteps[] } | null =
    null;
  private readonly webhookDedup = new Map<string, number>();
  private readonly webhookDedupTtlMs = 10 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wa: WhatsAppService,
  ) {}

  async list() {
    const items = await this.prisma.whatsappClientAutomation.findMany({
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return { items: items.map((a) => this.serialize(a)) };
  }

  async create(dto: CreateWhatsappClientAutomationDto) {
    const name = dto.name.trim();
    const triggerPhrase = this.normalizeTriggerInput(dto.triggerPhrase);
    this.assertSteps(dto.steps);

    const created = await this.prisma.whatsappClientAutomation.create({
      data: {
        name,
        triggerPhrase,
        active: dto.active !== false,
        steps: {
          create: dto.steps.map((s, i) => this.stepCreateData(s, i)),
        },
      },
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
    });
    this.invalidateActiveCache();
    return this.serialize(created);
  }

  async update(id: string, dto: UpdateWhatsappClientAutomationDto) {
    const existing = await this.prisma.whatsappClientAutomation.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Automação não encontrada.');

    if (dto.steps) this.assertSteps(dto.steps);

    const data: Prisma.WhatsappClientAutomationUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.triggerPhrase !== undefined) {
      data.triggerPhrase = this.normalizeTriggerInput(dto.triggerPhrase);
    }
    if (dto.active !== undefined) data.active = dto.active;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.steps) {
        await tx.whatsappClientAutomationStep.deleteMany({
          where: { automationId: id },
        });
        await tx.whatsappClientAutomationStep.createMany({
          data: dto.steps.map((s, i) => ({
            automationId: id,
            ...this.stepCreateData(s, i),
          })),
        });
      }
      return tx.whatsappClientAutomation.update({
        where: { id },
        data,
        include: { steps: { orderBy: { sortOrder: 'asc' } } },
      });
    });

    this.invalidateActiveCache();
    return this.serialize(updated);
  }

  async remove(id: string) {
    const existing = await this.prisma.whatsappClientAutomation.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Automação não encontrada.');
    await this.prisma.whatsappClientAutomation.delete({ where: { id } });
    this.invalidateActiveCache();
    return { ok: true as const };
  }

  /**
   * Inbound DM do cliente (wa-verify, !fromMe).
   * Match: mensagem contém a frase-gatilho. Cooldown 1× / contacto / 24h.
   */
  async handleInbound(
    dto: WhatsappClientAutomationInboundDto,
  ): Promise<{ ok: true; status: string }> {
    if (dto.fromMe === true) {
      return { ok: true, status: 'ignored_from_me' };
    }

    const text = (dto.text || '').trim();
    if (!text) return { ok: true, status: 'ignored_empty' };

    const whatsapp = this.normalizeWhatsapp(dto.senderNumber);
    if (whatsapp.length < 8) {
      return { ok: true, status: 'ignored_invalid_phone' };
    }

    if (!this.claimWebhookDelivery(dto, whatsapp, text)) {
      return { ok: true, status: 'ignored_duplicate_webhook' };
    }

    const active = await this.getActiveAutomationsCached();
    if (!active.length) return { ok: true, status: 'ignored_no_automations' };

    const haystack = this.normalizeForMatch(text);
    const matched = this.pickBestMatch(active, haystack);
    if (!matched) return { ok: true, status: 'ignored_no_match' };

    const since = new Date(Date.now() - COOLDOWN_MS);
    const recent = await this.prisma.whatsappClientAutomationFiring.findFirst({
      where: {
        automationId: matched.id,
        whatsappDigits: whatsapp,
        firedAt: { gte: since },
      },
      select: { id: true },
    });
    if (recent) return { ok: true, status: 'ignored_cooldown' };

    const externalMessageId = dto.externalMessageId?.trim() || null;
    try {
      await this.prisma.whatsappClientAutomationFiring.create({
        data: {
          automationId: matched.id,
          whatsappDigits: whatsapp,
          externalMessageId,
        },
      });
    } catch (e: unknown) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return { ok: true, status: 'ignored_duplicate_firing' };
      }
      throw e;
    }

    const preferredInstance = (dto.instance || '').trim() || undefined;
    try {
      await this.sendSteps(whatsapp, matched.steps, preferredInstance);
    } catch (err: unknown) {
      this.logger.warn(
        `Falha ao enviar automação ${matched.id} para ${whatsapp}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { ok: true, status: 'sent_partial_or_failed' };
    }

    this.logger.log(
      `Automação cliente «${matched.name}» enviada para ${whatsapp}`,
    );
    return { ok: true, status: 'sent' };
  }

  private async sendSteps(
    to: string,
    steps: AutomationWithSteps['steps'],
    preferredInstance?: string,
  ) {
    const ordered = [...steps].sort((a, b) => a.sortOrder - b.sortOrder);
    for (let i = 0; i < ordered.length; i++) {
      const step = ordered[i]!;
      if (step.type === WhatsappClientAutomationStepType.TEXT) {
        const body = (step.textContent || '').trim();
        if (body) {
          await this.wa.sendText(to, body, {
            preferredInstance,
            requireDelivery: true,
          });
        }
      } else if (step.type === WhatsappClientAutomationStepType.AUDIO) {
        const abs = this.resolveStepMediaUrl(step.mediaUrl || '');
        if (!abs) throw new Error('Passo AUDIO sem mediaUrl válida.');
        await this.wa.sendWhatsAppAudio({
          to,
          mediaUrl: abs,
          preferredInstance,
          requireDelivery: true,
        });
      } else if (step.type === WhatsappClientAutomationStepType.IMAGE) {
        const abs = this.resolveStepMediaUrl(step.mediaUrl || '');
        if (!abs) throw new Error('Passo IMAGE sem mediaUrl válida.');
        const mime =
          step.mediaMimeType?.trim() ||
          this.guessImageMime(step.mediaFileName || abs);
        const fileName =
          step.mediaFileName?.trim() ||
          abs.split('/').pop()?.split('?')[0] ||
          'image.jpg';
        await this.wa.sendMedia({
          to,
          caption: (step.textContent || '').trim(),
          mediaUrl: abs,
          mimeType: mime,
          fileName,
          mediaType: 'image',
          preferredInstance,
          requireDelivery: true,
        });
      }

      const delay = Math.max(0, step.delayMsAfter ?? 650);
      if (i < ordered.length - 1 && delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  private resolveStepMediaUrl(stored: string): string {
    const u = stored.trim();
    if (!u) return '';
    if (u.startsWith('https://') || u.startsWith('http://')) return u;
    if (u.startsWith('/brand/')) {
      const front = getFrontendBaseUrl().replace(/\/$/, '');
      return `${front}${u}`;
    }
    return toAbsoluteMediaUrl(u);
  }

  private guessImageMime(nameOrUrl: string): string {
    const lower = nameOrUrl.split('?')[0]!.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
  }

  private pickBestMatch(
    items: AutomationWithSteps[],
    haystack: string,
  ): AutomationWithSteps | null {
    let best: AutomationWithSteps | null = null;
    let bestLen = 0;
    for (const item of items) {
      const needle = this.normalizeForMatch(item.triggerPhrase);
      if (needle.length < MIN_TRIGGER_LEN) continue;
      if (!haystack.includes(needle)) continue;
      if (needle.length > bestLen) {
        best = item;
        bestLen = needle.length;
      }
    }
    return best;
  }

  private async getActiveAutomationsCached(): Promise<AutomationWithSteps[]> {
    const now = Date.now();
    if (this.activeCache && now - this.activeCache.at < ACTIVE_CACHE_TTL_MS) {
      return this.activeCache.items;
    }
    const items = await this.prisma.whatsappClientAutomation.findMany({
      where: { active: true },
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
    });
    this.activeCache = { at: now, items };
    return items;
  }

  private invalidateActiveCache() {
    this.activeCache = null;
  }

  private claimWebhookDelivery(
    dto: WhatsappClientAutomationInboundDto,
    whatsapp: string,
    text: string,
  ): boolean {
    const now = Date.now();
    for (const [key, ts] of this.webhookDedup) {
      if (now - ts > this.webhookDedupTtlMs) this.webhookDedup.delete(key);
    }
    const externalMessageId = dto.externalMessageId?.trim();
    const dedupKey = externalMessageId
      ? `id:${externalMessageId}`
      : `fallback:${(dto.instance || '').trim().toLowerCase()}|${whatsapp}|${text.toLowerCase().slice(0, 200)}`;
    if (this.webhookDedup.has(dedupKey)) return false;
    this.webhookDedup.set(dedupKey, now);
    return true;
  }

  private normalizeTriggerInput(raw: string): string {
    const t = raw.trim().replace(/\s+/g, ' ');
    if (t.length < MIN_TRIGGER_LEN) {
      throw new BadRequestException(
        `A frase-gatilho deve ter pelo menos ${MIN_TRIGGER_LEN} caracteres (evita falsos positivos).`,
      );
    }
    return t;
  }

  private normalizeForMatch(raw: string): string {
    return raw.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private normalizeWhatsapp(raw: string): string {
    const d = String(raw || '').replace(/\D+/g, '');
    if (/^9\d{8}$/.test(d)) return `351${d}`;
    return d;
  }

  private assertSteps(steps: AutomationStepInputDto[]) {
    if (!steps.length) {
      throw new BadRequestException('Indica pelo menos um passo de resposta.');
    }
    for (const [i, s] of steps.entries()) {
      if (!s || typeof s !== 'object') {
        throw new BadRequestException(`Passo ${i + 1}: inválido.`);
      }
      const type = s.type;
      if (type !== 'TEXT' && type !== 'AUDIO' && type !== 'IMAGE') {
        throw new BadRequestException(
          `Passo ${i + 1}: tipo inválido (usa TEXT, AUDIO ou IMAGE).`,
        );
      }
      if (type === 'TEXT') {
        if (!(s.textContent || '').trim()) {
          throw new BadRequestException(`Passo ${i + 1}: texto em falta.`);
        }
      } else if (type === 'AUDIO' || type === 'IMAGE') {
        if (!(s.mediaUrl || '').trim()) {
          throw new BadRequestException(`Passo ${i + 1}: ficheiro/URL em falta.`);
        }
      }
    }
  }

  private stepCreateData(s: AutomationStepInputDto, index: number) {
    const type = s.type;
    const delayMsAfter =
      typeof s.delayMsAfter === 'number' && Number.isFinite(s.delayMsAfter)
        ? Math.max(0, Math.min(30_000, Math.floor(s.delayMsAfter)))
        : 650;

    if (type === 'TEXT') {
      return {
        sortOrder: index,
        type,
        textContent: (s.textContent || '').trim(),
        mediaUrl: null,
        mediaMimeType: null,
        mediaFileName: null,
        delayMsAfter,
      };
    }

    return {
      sortOrder: index,
      type,
      textContent:
        type === 'IMAGE' ? (s.caption || s.textContent || '').trim() || null : null,
      mediaUrl: (s.mediaUrl || '').trim(),
      mediaMimeType: s.mediaMimeType?.trim() || null,
      mediaFileName: s.mediaFileName?.trim() || null,
      delayMsAfter,
    };
  }

  private serialize(a: AutomationWithSteps) {
    return {
      id: a.id,
      name: a.name,
      triggerPhrase: a.triggerPhrase,
      active: a.active,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      steps: a.steps.map((s) => ({
        id: s.id,
        sortOrder: s.sortOrder,
        type: s.type,
        textContent: s.textContent,
        mediaUrl: s.mediaUrl,
        mediaMimeType: s.mediaMimeType,
        mediaFileName: s.mediaFileName,
        delayMsAfter: s.delayMsAfter,
      })),
    };
  }
}
