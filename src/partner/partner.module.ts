import { Module } from '@nestjs/common';
import { PartnerService } from './partner.service';
import { PartnerController } from './partner.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StripeModule } from '../stripe/stripe.module';

@Module({
  imports: [PrismaModule, StripeModule],
  controllers: [PartnerController],
  providers: [PartnerService],
})
export class PartnerModule {}

