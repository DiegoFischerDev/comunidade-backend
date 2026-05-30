import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PartnerModule } from '../partner/partner.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { WhatsappScanController } from './whatsapp-scan.controller';
import { WhatsappScanService } from './whatsapp-scan.service';
import { WhatsappScanOpenAiService } from './whatsapp-scan-openai.service';

@Module({
  imports: [PrismaModule, PartnerModule, WhatsAppModule],
  controllers: [WhatsappScanController],
  providers: [WhatsappScanService, WhatsappScanOpenAiService],
})
export class WhatsappScanModule {}
