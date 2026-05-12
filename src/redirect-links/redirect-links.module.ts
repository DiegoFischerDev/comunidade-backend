import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PartnerModule } from '../partner/partner.module';
import { RedirectLinksController } from './redirect-links.controller';
import { RedirectLinksService } from './redirect-links.service';

@Module({
  imports: [PrismaModule, PartnerModule],
  controllers: [RedirectLinksController],
  providers: [RedirectLinksService],
  exports: [RedirectLinksService],
})
export class RedirectLinksModule {}
