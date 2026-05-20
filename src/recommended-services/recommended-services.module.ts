import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PartnerModule } from '../partner/partner.module';
import { RecommendedServicesController } from './recommended-services.controller';
import { RecommendedServicesService } from './recommended-services.service';

@Module({
  imports: [PrismaModule, PartnerModule],
  controllers: [RecommendedServicesController],
  providers: [RecommendedServicesService],
})
export class RecommendedServicesModule {}
