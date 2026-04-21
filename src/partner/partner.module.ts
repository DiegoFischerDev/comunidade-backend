import { Module } from '@nestjs/common';
import { PartnerService } from './partner.service';
import { PartnerController } from './partner.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StripeModule } from '../stripe/stripe.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { HouseImageStorageService } from './house-image-storage.service';
import { PartnerHouseCleanupTask } from './partner-house-cleanup.task';

@Module({
  imports: [PrismaModule, StripeModule, WhatsAppModule],
  controllers: [PartnerController],
  providers: [PartnerService, HouseImageStorageService, PartnerHouseCleanupTask],
})
export class PartnerModule {}

