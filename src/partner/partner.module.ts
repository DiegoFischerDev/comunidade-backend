import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { PartnerService } from './partner.service';
import { PartnerController } from './partner.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StripeModule } from '../stripe/stripe.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { HouseImageStorageService } from './house-image-storage.service';
import { PartnerAdvertisingService } from './partner-advertising.service';
import { PartnerHousePublicationExpiryTask } from './partner-house-publication-expiry.task';
import { PartnerContactLinksService } from './partner-contact-links.service';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    forwardRef(() => StripeModule),
    WhatsAppModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-in-production',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [PartnerController],
  providers: [
    PartnerService,
    HouseImageStorageService,
    PartnerAdvertisingService,
    PartnerHousePublicationExpiryTask,
    PartnerContactLinksService,
  ],
  exports: [
    PartnerService,
    HouseImageStorageService,
    PartnerAdvertisingService,
    PartnerContactLinksService,
  ],
})
export class PartnerModule {}
