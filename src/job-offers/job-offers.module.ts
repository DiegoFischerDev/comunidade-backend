import { Module } from '@nestjs/common';
import { ListingOpenAiModule } from '../listing-ai/listing-openai.module';
import { PrismaModule } from '../prisma/prisma.module';
import { JobOffersController } from './job-offers.controller';
import { JobOfferExpiryTask } from './job-offer-expiry.task';
import { JobOffersService } from './job-offers.service';

@Module({
  imports: [PrismaModule, ListingOpenAiModule],
  controllers: [JobOffersController],
  providers: [JobOffersService, JobOfferExpiryTask],
})
export class JobOffersModule {}
