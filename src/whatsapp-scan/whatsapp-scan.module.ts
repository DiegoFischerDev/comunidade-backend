import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PartnerModule } from '../partner/partner.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ListingOpenAiModule } from '../listing-ai/listing-openai.module';
import { WhatsappScanController } from './whatsapp-scan.controller';
import { WhatsappScanService } from './whatsapp-scan.service';

@Module({
  imports: [PrismaModule, PartnerModule, WhatsAppModule, ListingOpenAiModule],
  controllers: [WhatsappScanController],
  providers: [WhatsappScanService],
})
export class WhatsappScanModule {}
