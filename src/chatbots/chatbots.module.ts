import { Module, forwardRef } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { InstagramModule } from '../instagram/instagram.module';
import { JoanaModule } from '../joana/joana.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RafacallModule } from '../rafacall/rafacall.module';
import { RagModule } from '../rag/rag.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AdminChatbotCrmController } from './admin-chatbot-crm.controller';
import { ChatbotCrmService } from './chatbot-crm.service';
import { ChatbotFlushTask } from './chatbot-flush.task';
import { ChatbotRouterService } from './chatbot-router.service';
import { ChatbotService } from './chatbot.service';
import { ChatbotsController } from './chatbots.controller';
import { GenericContextEngine } from './generic-context.engine';

@Module({
  imports: [
    PrismaModule,
    WhatsAppModule,
    RagModule,
    forwardRef(() => ChannelsModule),
    JoanaModule,
    forwardRef(() => RafacallModule),
    forwardRef(() => InstagramModule),
  ],
  controllers: [ChatbotsController, AdminChatbotCrmController],
  providers: [
    ChatbotService,
    ChatbotCrmService,
    ChatbotRouterService,
    GenericContextEngine,
    ChatbotFlushTask,
  ],
  exports: [ChatbotRouterService, ChatbotService, ChatbotCrmService],
})
export class ChatbotsModule {}
