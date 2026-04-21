import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PartnerService } from './partner.service';

@Injectable()
export class PartnerHouseCleanupTask {
  private readonly logger = new Logger(PartnerHouseCleanupTask.name);

  constructor(private readonly partnerService: PartnerService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeStaleUnavailableHouses(): Promise<void> {
    try {
      const { deleted } = await this.partnerService.purgeStaleUnavailableHouses();
      if (deleted > 0) {
        this.logger.log(`Removidos ${deleted} anúncio(s) indisponível(is) antigos (≥2 meses após disponibilidade).`);
      }
    } catch (e) {
      this.logger.error('purgeStaleUnavailableHouses falhou', e);
    }
  }
}
