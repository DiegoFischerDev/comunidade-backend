import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ChatbotEngineKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  type JoanaWelcomeStep,
  normalizeJoanaWelcomeSteps,
  parseStoredWelcomeSteps,
} from '../joana/joana-welcome';
import {
  CHATBOT_DEFAULT_CONTEXTS,
  CHATBOT_DEFAULT_INTROS,
  type ChatbotSlug,
  isChatbotSlug,
} from './chatbot.constants';
import { buildChatbotMenuText, type MenuBot } from './chatbot-menu';

export type ChatbotPublic = {
  id: string;
  slug: ChatbotSlug;
  name: string;
  menuLabel: string;
  menuOrder: number;
  engineKind: ChatbotEngineKind;
  enabled: boolean;
  contextText: string;
  welcomeSteps: JoanaWelcomeStep[];
  introFallback: string | null;
};

@Injectable()
export class ChatbotService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<ChatbotPublic[]> {
    const rows = await this.prisma.chatbot.findMany({
      orderBy: { menuOrder: 'asc' },
    });
    return rows.map((row) => this.serialize(row));
  }

  async listEnabledMenuBots(): Promise<MenuBot[]> {
    const rows = await this.prisma.chatbot.findMany({
      where: { enabled: true },
      orderBy: { menuOrder: 'asc' },
      select: { slug: true, menuOrder: true, menuLabel: true, name: true },
    });
    return rows
      .filter((row) => isChatbotSlug(row.slug))
      .map((row) => ({
        slug: row.slug as ChatbotSlug,
        menuOrder: row.menuOrder,
        menuLabel: row.menuLabel,
        name: row.name,
      }));
  }

  async getMenuPreview(): Promise<{ text: string; bots: MenuBot[] }> {
    const bots = await this.listEnabledMenuBots();
    return { text: buildChatbotMenuText(bots), bots };
  }

  async getBySlug(slug: string): Promise<ChatbotPublic> {
    const row = await this.requireBySlug(slug);
    return this.serialize(row);
  }

  async updateContext(slug: string, contextText: string): Promise<ChatbotPublic> {
    const text = contextText.trim();
    if (text.length < 20) {
      throw new BadRequestException('O contexto está curto demais.');
    }
    const existing = await this.requireBySlug(slug);
    const saved = await this.prisma.chatbot.update({
      where: { id: existing.id },
      data: { contextText: text },
    });
    return this.serialize(saved);
  }

  async updateWelcome(slug: string, rawSteps: unknown): Promise<ChatbotPublic> {
    const steps = normalizeJoanaWelcomeSteps(rawSteps);
    const existing = await this.requireBySlug(slug);
    const saved = await this.prisma.chatbot.update({
      where: { id: existing.id },
      data: { welcomeSteps: steps as unknown as Prisma.InputJsonValue },
    });
    return this.serialize(saved);
  }

  async requireBySlug(slug: string) {
    if (!isChatbotSlug(slug)) {
      throw new NotFoundException('Chatbot não encontrado.');
    }
    const row = await this.prisma.chatbot.findUnique({ where: { slug } });
    if (!row) {
      throw new NotFoundException(`Chatbot «${slug}» não encontrado.`);
    }
    return row;
  }

  defaultContextFor(slug: ChatbotSlug): string {
    return CHATBOT_DEFAULT_CONTEXTS[slug];
  }

  defaultIntroFor(slug: ChatbotSlug): string {
    return CHATBOT_DEFAULT_INTROS[slug];
  }

  private serialize(row: {
    id: string;
    slug: string;
    name: string;
    menuLabel: string;
    menuOrder: number;
    engineKind: ChatbotEngineKind;
    enabled: boolean;
    contextText: string;
    welcomeSteps: Prisma.JsonValue;
    introFallback: string | null;
  }): ChatbotPublic {
    const slug = isChatbotSlug(row.slug) ? row.slug : ('joana' as ChatbotSlug);
    return {
      id: row.id,
      slug,
      name: row.name,
      menuLabel: row.menuLabel,
      menuOrder: row.menuOrder,
      engineKind: row.engineKind,
      enabled: row.enabled,
      contextText: row.contextText?.trim() || this.defaultContextFor(slug),
      welcomeSteps: parseStoredWelcomeSteps(row.welcomeSteps),
      introFallback: row.introFallback?.trim() || this.defaultIntroFor(slug) || null,
    };
  }
}
