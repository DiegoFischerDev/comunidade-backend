import { Module } from '@nestjs/common';
import { InstagramModule } from '../instagram/instagram.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ChannelMessageLogService } from './channel-message-log.service';
import { ConversationOutboundService } from './conversation-outbound.service';
import { CrmChannelChatService } from './crm-channel-chat.service';

@Module({
  imports: [PrismaModule, WhatsAppModule, InstagramModule],
  providers: [
    ChannelMessageLogService,
    ConversationOutboundService,
    CrmChannelChatService,
  ],
  exports: [
    ChannelMessageLogService,
    ConversationOutboundService,
    CrmChannelChatService,
  ],
})
export class ChannelsModule {}
