import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RafacallService } from './rafacall.service';
import { RafacallController } from './rafacall.controller';
import { CalendlyWebhookController } from './calendly-webhook.controller';
import { CalendlyAdminScheduleService } from './calendly-admin-schedule.service';
import { AdminCalendlyController } from './admin-calendly.controller';

@Module({
  imports: [PrismaModule],
  controllers: [
    RafacallController,
    CalendlyWebhookController,
    AdminCalendlyController,
  ],
  providers: [RafacallService, CalendlyAdminScheduleService],
  exports: [RafacallService],
})
export class RafacallModule {}
