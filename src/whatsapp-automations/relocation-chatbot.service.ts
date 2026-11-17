import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, WhatsappDailyContactReply } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { RafacallCrmService } from '../rafacall/rafacall-crm.service';
import {
  RELOCATION_FIRST_CONTACT_MESSAGE,
  RELOCATION_YES_MESSAGE,
  cleanDisplayName,
  fallbackLeadName,
  parseRelocationReply,
  relocationChatbotInstance,
  relocationDayKey,
} from './relocation-chatbot.util';

type DailyContactRow = {
  id: string;
  dayKey: string;
  whatsappDigits: string;
  instance: string | null;
  displayName: string | null;
  firstMessageAt: Date;
  greetedAt: Date | null;
  reply: WhatsappDailyContactReply;
  repliedAt: Date | null;
  crmAddedAt: Date | null;
};

@Injectable()
export class RelocationChatbotService {
  private readonly logger = new Logger(RelocationChatbotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wa: WhatsAppService,
    private readonly crm: RafacallCrmService,
  ) {}

  /**
   * Primeiro contacto do dia na instância de atendimento:
   * regista o número, envia bom dia + pergunta, e «1» entra em «Sem data para imigrar».
   */
  async handleDailyContact(input: {
    whatsapp: string;
    text: string;
    instance?: string;
    pushName?: string;
  }): Promise<{ handled: boolean; status: string }> {
    const instance = (input.instance || '').trim();
    const allowed = relocationChatbotInstance();
    if (instance && allowed && instance !== allowed) {
      return { handled: false, status: 'ignored_instance' };
    }

    const dayKey = relocationDayKey();
    const pushName = cleanDisplayName(input.pushName);
    const row = await this.findOrCreate({
      dayKey,
      whatsappDigits: input.whatsapp,
      instance: instance || allowed || null,
      displayName: pushName,
    });
    if (!row) return { handled: false, status: 'ignored_missing_contact' };

    if (!row.greetedAt) {
      return this.sendFirstContactGreeting(row, instance || allowed);
    }

    if (row.reply !== WhatsappDailyContactReply.PENDING) {
      return { handled: false, status: 'ignored_already_answered' };
    }

    const choice = parseRelocationReply(input.text);
    if (!choice) return { handled: false, status: 'ignored_not_choice' };

    if (choice === 'NAO') {
      await this.prisma.whatsappDailyContact.updateMany({
        where: { id: row.id, reply: WhatsappDailyContactReply.PENDING },
        data: {
          reply: WhatsappDailyContactReply.NAO,
          repliedAt: new Date(),
          ...(pushName ? { displayName: pushName } : {}),
        },
      });
      return { handled: true, status: 'declined' };
    }

    return this.acceptRelocation(row, instance || allowed, pushName);
  }

  async listDay(day?: string) {
    const dayKey = (day || '').trim() || relocationDayKey();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
      throw new BadRequestException('Dia inválido.');
    }

    const items = await this.prisma.whatsappDailyContact.findMany({
      where: { dayKey },
      orderBy: { firstMessageAt: 'desc' },
    });

    return {
      dayKey,
      items: items.map((item) => ({
        id: item.id,
        whatsappDigits: item.whatsappDigits,
        displayName: item.displayName,
        instance: item.instance,
        firstMessageAt: item.firstMessageAt.toISOString(),
        greetedAt: item.greetedAt?.toISOString() ?? null,
        reply: item.reply,
        repliedAt: item.repliedAt?.toISOString() ?? null,
        crmAddedAt: item.crmAddedAt?.toISOString() ?? null,
      })),
    };
  }

  private async sendFirstContactGreeting(
    row: DailyContactRow,
    preferredInstance: string,
  ): Promise<{ handled: boolean; status: string }> {
    const claimed = await this.prisma.whatsappDailyContact.updateMany({
      where: { id: row.id, greetedAt: null },
      data: { greetedAt: new Date() },
    });
    if (claimed.count !== 1) {
      return { handled: true, status: 'ignored_greeting_race' };
    }

    try {
      await this.wa.sendText(row.whatsappDigits, RELOCATION_FIRST_CONTACT_MESSAGE, {
        preferredInstance: preferredInstance || undefined,
        requireDelivery: true,
      });
    } catch (err: unknown) {
      await this.prisma.whatsappDailyContact.update({
        where: { id: row.id },
        data: { greetedAt: null },
      });
      this.logger.warn(
        `Falha ao saudar ${row.whatsappDigits}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { handled: true, status: 'greeting_failed' };
    }

    this.logger.log(`Primeiro contacto do dia saudado: ${row.whatsappDigits}`);
    return { handled: true, status: 'greeted' };
  }

  private async acceptRelocation(
    row: DailyContactRow,
    preferredInstance: string,
    pushName: string | null,
  ): Promise<{ handled: boolean; status: string }> {
    const claimed = await this.prisma.whatsappDailyContact.updateMany({
      where: { id: row.id, reply: WhatsappDailyContactReply.PENDING },
      data: {
        reply: WhatsappDailyContactReply.SIM,
        repliedAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      return { handled: true, status: 'ignored_reply_race' };
    }

    try {
      const name = await this.resolveLeadName(
        row.whatsappDigits,
        pushName || row.displayName,
        preferredInstance,
      );
      let status = 'added_to_crm';
      try {
        await this.crm.createCrmClient({
          name,
          whatsapp: row.whatsappDigits,
        });
      } catch (err: unknown) {
        if (!this.isAlreadyInCrm(err)) throw err;
        status = 'already_in_crm';
      }

      await this.prisma.whatsappDailyContact.update({
        where: { id: row.id },
        data: {
          displayName: name,
          crmAddedAt: new Date(),
        },
      });

      try {
        await this.wa.sendText(row.whatsappDigits, RELOCATION_YES_MESSAGE, {
          preferredInstance: preferredInstance || undefined,
          requireDelivery: true,
        });
      } catch (err: unknown) {
        this.logger.warn(
          `Lead ${row.whatsappDigits} no CRM, mas a confirmação falhou: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      this.logger.log(`Relocation «1» de ${row.whatsappDigits}: ${status}`);
      return { handled: true, status };
    } catch (err: unknown) {
      await this.prisma.whatsappDailyContact.update({
        where: { id: row.id },
        data: {
          reply: WhatsappDailyContactReply.PENDING,
          repliedAt: null,
        },
      });
      this.logger.warn(
        `Falha ao adicionar ${row.whatsappDigits} ao CRM: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { handled: true, status: 'crm_failed' };
    }
  }

  private async resolveLeadName(
    whatsapp: string,
    known: string | null,
    instance: string,
  ): Promise<string> {
    const stored = cleanDisplayName(known);
    if (stored) return stored;
    try {
      const fromWa = cleanDisplayName(
        await this.wa.getContactDisplayName(whatsapp, instance || undefined),
      );
      if (fromWa) return fromWa;
    } catch {
      // nome de recurso; o fallback numérico chega para o CRM
    }
    return fallbackLeadName(whatsapp);
  }

  private async findOrCreate(data: {
    dayKey: string;
    whatsappDigits: string;
    instance: string | null;
    displayName: string | null;
  }): Promise<DailyContactRow | null> {
    const existing = await this.prisma.whatsappDailyContact.findUnique({
      where: {
        dayKey_whatsappDigits: {
          dayKey: data.dayKey,
          whatsappDigits: data.whatsappDigits,
        },
      },
    });
    if (existing) {
      if (data.displayName && !existing.displayName) {
        return this.prisma.whatsappDailyContact.update({
          where: { id: existing.id },
          data: { displayName: data.displayName },
        });
      }
      return existing;
    }

    try {
      return await this.prisma.whatsappDailyContact.create({ data });
    } catch (err: unknown) {
      if (
        !(err instanceof Prisma.PrismaClientKnownRequestError) ||
        err.code !== 'P2002'
      ) {
        throw err;
      }
      return this.prisma.whatsappDailyContact.findUnique({
        where: {
          dayKey_whatsappDigits: {
            dayKey: data.dayKey,
            whatsappDigits: data.whatsappDigits,
          },
        },
      });
    }
  }

  private isAlreadyInCrm(err: unknown): boolean {
    if (!(err instanceof BadRequestException)) return false;
    const response = err.getResponse();
    const message =
      typeof response === 'string'
        ? response
        : (response as { message?: unknown }).message;
    const text = Array.isArray(message)
      ? message.join(' ')
      : String(message ?? '');
    return text.toLowerCase().includes('já está no crm');
  }
}
