import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_CARDS: Array<{
  position: number;
  title: string;
  videoUrl: string;
  thumbnailUrl: string;
}> = [
  {
    position: 1,
    title:
      '🏡 Ep 8 | VALEU A PENA? Valor e financiamento da nossa casa numa vila no interior de Portugal 🇵🇹',
    videoUrl:
      'https://www.youtube.com/watch?v=nSuXTX0z9Vk&list=PLE6qyBhvOLI0C0Ardu5fY3z8JK3kv-OKI&index=8',
    thumbnailUrl: '/youtube_1.png',
  },
  {
    position: 2,
    title:
      '🏡 Ep 13 | Tiramos as maiores dúvidas sobre crédito habitação em Portugal 🇵🇹',
    videoUrl:
      'https://www.youtube.com/watch?v=v04RVqeT9aQ&list=PLE6qyBhvOLI0C0Ardu5fY3z8JK3kv-OKI&index=12',
    thumbnailUrl: '/youtube_2.png',
  },
  {
    position: 3,
    title:
      '🏡 Ep 6 | Primeiros dias na nossa casa na aldeia em Portugal 🇵🇹',
    videoUrl:
      'https://www.youtube.com/watch?v=Z4Dv3M2ZLOQ&list=PLE6qyBhvOLI0C0Ardu5fY3z8JK3kv-OKI',
    thumbnailUrl: '/youtube_3.png',
  },
];

export type YoutubeHighlightCardPublic = {
  position: number;
  title: string;
  videoUrl: string;
  thumbnailUrl: string;
};

@Injectable()
export class YoutubeHighlightService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureSeeded(): Promise<void> {
    const n = await this.prisma.youtubeHighlightCard.count();
    if (n >= 3) return;
    for (const c of DEFAULT_CARDS) {
      await this.prisma.youtubeHighlightCard.upsert({
        where: { position: c.position },
        create: {
          position: c.position,
          title: c.title,
          videoUrl: c.videoUrl,
          thumbnailUrl: c.thumbnailUrl,
        },
        update: {},
      });
    }
  }

  async listPublic(): Promise<{ cards: YoutubeHighlightCardPublic[] }> {
    await this.ensureSeeded();
    const rows = await this.prisma.youtubeHighlightCard.findMany({
      orderBy: { position: 'asc' },
    });
    if (rows.length < 3) {
      throw new NotFoundException('Configuração de destaques YouTube incompleta.');
    }
    return {
      cards: rows.map((r) => ({
        position: r.position,
        title: r.title,
        videoUrl: r.videoUrl,
        thumbnailUrl: r.thumbnailUrl,
      })),
    };
  }

  private parseCards(
    raw: unknown,
  ): Array<{
    position: number;
    title: string;
    videoUrl: string;
    thumbnailUrl: string;
  }> {
    if (raw === null || typeof raw !== 'object' || !('cards' in raw)) {
      throw new BadRequestException('Indica o campo "cards" com 3 itens.');
    }
    const { cards } = raw as { cards: unknown };
    if (!Array.isArray(cards) || cards.length !== 3) {
      throw new BadRequestException('São necessários exatamente 3 cards.');
    }
    const positions = new Set<number>();
    const out: Array<{
      position: number;
      title: string;
      videoUrl: string;
      thumbnailUrl: string;
    }> = [];
    for (const item of cards) {
      if (item === null || typeof item !== 'object') {
        throw new BadRequestException('Cada card deve ser um objeto.');
      }
      const o = item as Record<string, unknown>;
      const pos = o.position;
      if (typeof pos !== 'number' || !Number.isInteger(pos) || pos < 1 || pos > 3) {
        throw new BadRequestException('Cada card tem de ter position 1, 2 ou 3.');
      }
      if (positions.has(pos)) {
        throw new BadRequestException('Cada posição (1, 2, 3) deve aparecer uma vez.');
      }
      positions.add(pos);
      for (const key of ['title', 'videoUrl', 'thumbnailUrl'] as const) {
        if (typeof o[key] !== 'string') {
          throw new BadRequestException(
            `O card ${pos} deve ter "${key}" em texto.`,
          );
        }
      }
      const title = (o.title as string).trim();
      const videoUrl = (o.videoUrl as string).trim();
      const thumbnailUrl = (o.thumbnailUrl as string).trim();
      if (title.length === 0 || title.length > 500) {
        throw new BadRequestException(
          'O título de cada card é obrigatório (máx. 500 caracteres).',
        );
      }
      if (videoUrl.length === 0 || videoUrl.length > 2048) {
        throw new BadRequestException(
          'O URL do vídeo é obrigatório (máx. 2048 caracteres).',
        );
      }
      if (thumbnailUrl.length === 0 || thumbnailUrl.length > 2048) {
        throw new BadRequestException(
          'A miniatura (URL) é obrigatória (máx. 2048 caracteres).',
        );
      }
      out.push({ position: pos, title, videoUrl, thumbnailUrl });
    }
    if (positions.size !== 3) {
      throw new BadRequestException('Indica as posições 1, 2 e 3, cada uma uma vez.');
    }
    return out.sort((a, b) => a.position - b.position);
  }

  async updateAll(body: unknown): Promise<{ ok: true; cards: YoutubeHighlightCardPublic[] }> {
    const cards = this.parseCards(body);
    await this.ensureSeeded();
    await this.prisma.$transaction(
      cards.map((c) =>
        this.prisma.youtubeHighlightCard.update({
          where: { position: c.position },
          data: {
            title: c.title,
            videoUrl: c.videoUrl,
            thumbnailUrl: c.thumbnailUrl,
          },
        }),
      ),
    );
    const { cards: updated } = await this.listPublic();
    return { ok: true, cards: updated };
  }
}
