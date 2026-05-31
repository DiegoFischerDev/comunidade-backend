import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { JOB_OFFER_RETENTION_DAYS } from './job-offer-expiry.constants';

function publishedBeforeRetentionCutoff(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

@Injectable()
export class JobOfferExpiryTask {
  private readonly logger = new Logger(JobOfferExpiryTask.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Remove ofertas publicadas há mais de 7 dias (`publishedAt`). */
  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpiredJobOffers(): Promise<void> {
    const cutoff = publishedBeforeRetentionCutoff(JOB_OFFER_RETENTION_DAYS);
    const result = await this.prisma.jobOffer.deleteMany({
      where: { publishedAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      this.logger.log(
        `${result.count} oferta(s) de trabalho removida(s) (publicadas há mais de ${JOB_OFFER_RETENTION_DAYS} dias).`,
      );
    }
  }
}
