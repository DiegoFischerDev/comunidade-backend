import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RafacallModule } from '../rafacall/rafacall.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { JoanaController } from './joana.controller';
import { JoanaFlushTask } from './joana-flush.task';
import { JoanaOpenAiService } from './joana-openai.service';
import { JoanaService } from './joana.service';

@Module({
  imports: [PrismaModule, WhatsAppModule, RafacallModule],
  controllers: [JoanaController],
  providers: [JoanaService, JoanaOpenAiService, JoanaFlushTask],
  exports: [JoanaService],
})
export class JoanaModule {}
