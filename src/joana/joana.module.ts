import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RafacallModule } from '../rafacall/rafacall.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { JoanaController } from './joana.controller';
import { JoanaOpenAiService } from './joana-openai.service';
import { JoanaService } from './joana.service';

@Module({
  imports: [PrismaModule, WhatsAppModule, RafacallModule],
  controllers: [JoanaController],
  // Flush multi-bot vive em ChatbotsModule (ChatbotFlushTask).
  providers: [JoanaService, JoanaOpenAiService],
  exports: [JoanaService, JoanaOpenAiService],
})
export class JoanaModule {}
