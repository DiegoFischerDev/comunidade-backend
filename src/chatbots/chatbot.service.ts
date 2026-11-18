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
import {
  DEFAULT_CHATBOT_MENU_TEXT,
  buildChatbotMenuText,
  buildMenuClassifySystemPrompt,
  parseChatbotMenuChoice,
  parseChatbotMenuDigitChoice,
  parseMenuClassifyResponse,
  type MenuBot,
} from './chatbot-menu';

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

  async getMenuText(): Promise<string> {
    const row = await this.prisma.chatbotRouterSettings.findUnique({
      where: { id: 'default' },
    });
    const stored = row?.menuText?.trim();
    if (stored) return stored;
    const bots = await this.listEnabledMenuBots();
    return bots.length > 0 ? buildChatbotMenuText(bots) : DEFAULT_CHATBOT_MENU_TEXT;
  }

  async getMenuPreview(): Promise<{ text: string; bots: MenuBot[] }> {
    const [bots, text] = await Promise.all([
      this.listEnabledMenuBots(),
      this.getMenuText(),
    ]);
    return { text, bots };
  }

  async updateMenuText(menuText: string): Promise<{ text: string; bots: MenuBot[] }> {
    const text = menuText.trim();
    if (text.length < 20) {
      throw new BadRequestException('O texto do menu está curto demais.');
    }
    await this.prisma.chatbotRouterSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', menuText: text },
      update: { menuText: text },
    });
    const bots = await this.listEnabledMenuBots();
    return { text, bots };
  }

  /**
   * Escolha do menu: dígito 1/2/3 sem LLM; texto livre via OpenAI
   * (com fallback de palavras-chave se a API falhar).
   */
  async resolveMenuChoice(
    text: string,
    bots: MenuBot[],
  ): Promise<ChatbotSlug | null> {
    const digit = parseChatbotMenuDigitChoice(text, bots);
    if (digit) return digit;

    try {
      const classified = await this.classifyMenuChoiceWithOpenAi(text, bots);
      if (classified) return classified;
    } catch {
      // fallback abaixo
    }

    return parseChatbotMenuChoice(text, bots);
  }

  private async classifyMenuChoiceWithOpenAi(
    text: string,
    bots: MenuBot[],
  ): Promise<ChatbotSlug | null> {
    const apiKey = (process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY não está configurada.');
    }
    const model = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: buildMenuClassifySystemPrompt(bots) },
            { role: 'user', content: text.trim().slice(0, 2000) },
          ],
        }),
        signal: controller.signal,
      });
      const raw = await res.text();
      if (!res.ok) {
        throw new Error(`OpenAI ${res.status}: ${raw.slice(0, 300)}`);
      }
      const parsed = JSON.parse(raw) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = parsed.choices?.[0]?.message?.content || '';
      return parseMenuClassifyResponse(content, bots);
    } finally {
      clearTimeout(timeout);
    }
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
