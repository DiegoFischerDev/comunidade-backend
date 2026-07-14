import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RafacallCrmService } from './rafacall-crm.service';

const LISBON_TZ = 'Europe/Lisbon';

@Injectable()
export class RafacallCrmImmigrationSyncTask {
  private readonly logger = new Logger(RafacallCrmImmigrationSyncTask.name);

  constructor(private readonly crm: RafacallCrmService) {}

  /** ~06:00 em Lisboa — promove leads «longe» → «perto» quando faltam menos de 90 dias. */
  @Cron('0 6 * * *', { timeZone: LISBON_TZ })
  async syncImmigrationColumns(): Promise<void> {
    if (process.env.RAFA_CALL_CRM_IMMIGRATION_SYNC_ENABLED === '0') return;

    try {
      const result = await this.crm.syncImmigrationProximityStatuses();
      if (result.promoted > 0) {
        this.logger.log(
          `CRM imigração: ${result.promoted} lead(s) movido(s) para «Data para imigrar perto».`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Erro no cron de sincronização CRM imigração: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
