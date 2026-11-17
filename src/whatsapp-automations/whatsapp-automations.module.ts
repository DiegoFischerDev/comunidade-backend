import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RafacallModule } from '../rafacall/rafacall.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { RelocationChatbotService } from './relocation-chatbot.service';
import { WhatsappAutomationsController } from './whatsapp-automations.controller';
import { WhatsappAutomationsService } from './whatsapp-automations.service';

@Module({
  imports: [PrismaModule, WhatsAppModule, RafacallModule],
  controllers: [WhatsappAutomationsController],
  providers: [WhatsappAutomationsService, RelocationChatbotService],
})
export class WhatsappAutomationsModule {}
