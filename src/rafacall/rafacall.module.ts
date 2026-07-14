import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { RafacallService } from './rafacall.service';
import { RafacallController } from './rafacall.controller';
import { RafacallBookingService } from './rafacall-booking.service';
import { RafacallAdminService } from './rafacall-admin.service';
import { AdminRafacallController } from './admin-rafacall.controller';
import { RafacallDayBeforeReminderTask } from './rafacall-day-before-reminder.task';

@Module({
  imports: [PrismaModule, WhatsAppModule],
  controllers: [
    RafacallController,
    AdminRafacallController,
  ],
  providers: [
    RafacallService,
    RafacallBookingService,
    RafacallAdminService,
    RafacallDayBeforeReminderTask,
  ],
  exports: [RafacallService],
})
export class RafacallModule {}
