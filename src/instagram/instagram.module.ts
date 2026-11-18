import { Module, forwardRef } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { InstagramController } from './instagram.controller';
import { InstagramService } from './instagram.service';

@Module({
  imports: [forwardRef(() => ChatbotsModule)],
  controllers: [InstagramController],
  providers: [InstagramService],
  exports: [InstagramService],
})
export class InstagramModule {}
