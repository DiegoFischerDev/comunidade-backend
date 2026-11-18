import { Module } from '@nestjs/common';
import { InstagramModule } from '../instagram/instagram.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ConversationOutboundService } from './conversation-outbound.service';

@Module({
  imports: [WhatsAppModule, InstagramModule],
  providers: [ConversationOutboundService],
  exports: [ConversationOutboundService],
})
export class ChannelsModule {}
