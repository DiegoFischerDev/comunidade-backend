import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RafacallBookingService } from './rafacall-booking.service';

const LISBON_TZ = 'Europe/Lisbon';

@Injectable()
export class RafacallDayBeforeReminderTask {
  private readonly logger = new Logger(RafacallDayBeforeReminderTask.name);

  constructor(private readonly bookingService: RafacallBookingService) {}

  /** ~22:00 em Lisboa — lembrete WhatsApp para agendamentos do dia seguinte (fuso do cliente). */
  @Cron('0 22 * * *', { timeZone: LISBON_TZ })
  async sendDayBeforeReminders(): Promise<void> {
    if (process.env.RAFA_CALL_DAY_BEFORE_REMINDER_ENABLED === '0') return;

    try {
      const result = await this.bookingService.sendDueDayBeforeReminders();
      if (result.sent > 0 || result.failed > 0) {
        this.logger.log(
          `Lembretes véspera: ${result.sent} enviado(s), ${result.failed} falha(s), ${result.skipped} ignorado(s).`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Erro no cron de lembretes RafaCall: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
