import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PartnerHousePublicationExpiryTask {
  private readonly logger = new Logger(PartnerHousePublicationExpiryTask.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async expirePublishedHouses(): Promise<void> {
    const now = new Date();
    const result = await this.prisma.partnerHouse.updateMany({
      where: {
        publicationStatus: 'PUBLISHED',
        publishedUntil: { lt: now },
      },
      data: { publicationStatus: 'HIDDEN' },
    });
    if (result.count > 0) {
      this.logger.log(
        `${result.count} imóvel(is) passaram de publicado para oculto (publicação expirada).`,
      );
    }
  }
}
