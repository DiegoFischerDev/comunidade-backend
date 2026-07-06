import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { PartnerService } from './partner.service';
import { PartnerController } from './partner.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StripeModule } from '../stripe/stripe.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { HouseImageStorageService } from './house-image-storage.service';
import { PartnerHousePublicationExpiryTask } from './partner-house-publication-expiry.task';
import { PartnerContactLinksService } from './partner-contact-links.service';
import { ListingOpenAiModule } from '../listing-ai/listing-openai.module';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    StripeModule,
    WhatsAppModule,
    ListingOpenAiModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-in-production',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [PartnerController],
  providers: [
    PartnerService,
    HouseImageStorageService,
    PartnerHousePublicationExpiryTask,
    PartnerContactLinksService,
  ],
  exports: [
    PartnerService,
    HouseImageStorageService,
    PartnerContactLinksService,
  ],
})
export class PartnerModule {}
