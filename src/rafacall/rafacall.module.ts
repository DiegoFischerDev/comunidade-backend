import { Module, forwardRef } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PartnerModule } from '../partner/partner.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { RafacallService } from './rafacall.service';
import { RafacallController } from './rafacall.controller';
import { RafacallBookingService } from './rafacall-booking.service';
import { RafacallAdminService } from './rafacall-admin.service';
import { AdminRafacallController } from './admin-rafacall.controller';
import { RafacallDayBeforeReminderTask } from './rafacall-day-before-reminder.task';
import { RafacallCrmImmigrationSyncTask } from './rafacall-crm-immigration-sync.task';
import { RafacallCrmService } from './rafacall-crm.service';

@Module({
  imports: [
    PrismaModule,
    PartnerModule,
    WhatsAppModule,
    forwardRef(() => ChannelsModule),
  ],
  controllers: [
    RafacallController,
    AdminRafacallController,
  ],
  providers: [
    RafacallService,
    RafacallBookingService,
    RafacallAdminService,
    RafacallCrmService,
    RafacallDayBeforeReminderTask,
    RafacallCrmImmigrationSyncTask,
  ],
  exports: [RafacallService, RafacallCrmService],
})
export class RafacallModule {}
