import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { WhatsappAutomationsController } from './whatsapp-automations.controller';
import { WhatsappAutomationsService } from './whatsapp-automations.service';

@Module({
  imports: [PrismaModule, WhatsAppModule],
  controllers: [WhatsappAutomationsController],
  providers: [WhatsappAutomationsService],
})
export class WhatsappAutomationsModule {}
