import { Module } from '@nestjs/common';
import { ListingOpenAiModule } from '../listing-ai/listing-openai.module';
import { PartnerModule } from '../partner/partner.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { JobOffersController } from './job-offers.controller';
import { JobOfferExpiryTask } from './job-offer-expiry.task';
import { JobOfferWhatsappService } from './job-offer-whatsapp.service';
import { JobOffersService } from './job-offers.service';

@Module({
  imports: [PrismaModule, ListingOpenAiModule, WhatsAppModule, PartnerModule],
  controllers: [JobOffersController],
  providers: [JobOffersService, JobOfferExpiryTask, JobOfferWhatsappService],
})
export class JobOffersModule {}
