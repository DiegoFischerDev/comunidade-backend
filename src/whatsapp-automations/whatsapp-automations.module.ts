import { Module } from '@nestjs/common';
import { JoanaModule } from '../joana/joana.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RafacallModule } from '../rafacall/rafacall.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { WhatsappAutomationsController } from './whatsapp-automations.controller';
import { WhatsappAutomationsService } from './whatsapp-automations.service';

@Module({
  imports: [PrismaModule, WhatsAppModule, JoanaModule, RafacallModule],
  controllers: [WhatsappAutomationsController],
  providers: [WhatsappAutomationsService],
})
export class WhatsappAutomationsModule {}
