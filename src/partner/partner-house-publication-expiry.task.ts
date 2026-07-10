import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { HouseImageStorageService } from './house-image-storage.service';
import {
  HOUSE_HIDDEN_TO_TRASH_DAYS,
  HOUSE_TRASH_TO_DELETE_DAYS,
} from './house-publication.constants';

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

@Injectable()
export class PartnerHousePublicationExpiryTask {
  private readonly logger = new Logger(PartnerHousePublicationExpiryTask.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly houseImages: HouseImageStorageService,
  ) {}

  /** Oculto há ≥ N dias → move automaticamente para a lixeira. */
  @Cron(CronExpression.EVERY_HOUR)
  async trashStaleHiddenHouses(): Promise<void> {
    const now = new Date();

    // Backfill: imóveis ocultos sem `hiddenAt` (legado/criação) ganham a contagem a partir de agora,
    // evitando ir para a lixeira de imediato no primeiro arranque desta regra.
    await this.prisma.partnerHouse.updateMany({
      where: { publicationStatus: 'HIDDEN', hiddenAt: null },
      data: { hiddenAt: now },
    });

    const result = await this.prisma.partnerHouse.updateMany({
      where: {
        publicationStatus: 'HIDDEN',
        hiddenAt: { lt: daysAgo(HOUSE_HIDDEN_TO_TRASH_DAYS) },
      },
      data: {
        publicationStatus: 'TRASH',
        trashedAt: now,
        hiddenAt: null,
        publishedUntil: null,
      },
    });
    if (result.count > 0) {
      this.logger.log(
        `${result.count} imóvel(is) movido(s) para a lixeira (ocultos há ≥ ${HOUSE_HIDDEN_TO_TRASH_DAYS} dias).`,
      );
    }
  }

  /** Na lixeira há ≥ N dias → exclui o imóvel e remove a mídia do servidor. */
  @Cron(CronExpression.EVERY_HOUR)
  async purgeStaleTrashedHouses(): Promise<void> {
    const houses = await this.prisma.partnerHouse.findMany({
      where: {
        publicationStatus: 'TRASH',
        trashedAt: { lt: daysAgo(HOUSE_TRASH_TO_DELETE_DAYS) },
      },
      select: {
        id: true,
        imageUrls: true,
        videoUrl: true,
        videoPosterUrl: true,
      },
      take: 200,
    });
    if (houses.length === 0) return;

    let deleted = 0;
    for (const house of houses) {
      try {
        for (const url of house.imageUrls ?? []) {
          await this.houseImages.deleteStoredUrl(url);
        }
        await this.houseImages.deleteStoredUrl(house.videoUrl ?? null);
        await this.houseImages.deleteStoredUrl(house.videoPosterUrl ?? null);
        await this.prisma.partnerHouse.delete({ where: { id: house.id } });
        deleted += 1;
      } catch (e) {
        this.logger.warn(
          `Falha ao excluir imóvel ${house.id} da lixeira: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
    if (deleted > 0) {
      this.logger.log(
        `${deleted} imóvel(is) excluído(s) da lixeira (≥ ${HOUSE_TRASH_TO_DELETE_DAYS} dias) com remoção de mídia.`,
      );
    }
  }
}
