import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PartnerService } from './partner.service';
import { PartnerController } from './partner.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StripeModule } from '../stripe/stripe.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { HouseImageStorageService } from './house-image-storage.service';
import { PartnerHouseCleanupTask } from './partner-house-cleanup.task';
import { PartnerLeadIntakeService } from './partner-lead-intake.service';
import { PartnerLeadInternalController } from './partner-lead-internal.controller';

@Module({
  imports: [
    PrismaModule,
    StripeModule,
    WhatsAppModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-in-production',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [PartnerController, PartnerLeadInternalController],
  providers: [
    PartnerService,
    PartnerLeadIntakeService,
    HouseImageStorageService,
    PartnerHouseCleanupTask,
  ],
})
export class PartnerModule {}

