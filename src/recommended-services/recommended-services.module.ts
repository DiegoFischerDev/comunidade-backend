import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RecommendedServicesController } from './recommended-services.controller';
import { RecommendedServicesService } from './recommended-services.service';

@Module({
  imports: [PrismaModule],
  controllers: [RecommendedServicesController],
  providers: [RecommendedServicesService],
})
export class RecommendedServicesModule {}
