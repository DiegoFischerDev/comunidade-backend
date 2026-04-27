import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { YoutubeHighlightController } from './youtube-highlight.controller';
import { YoutubeHighlightService } from './youtube-highlight.service';

@Module({
  imports: [PrismaModule],
  controllers: [YoutubeHighlightController],
  providers: [YoutubeHighlightService],
  exports: [YoutubeHighlightService],
})
export class YoutubeHighlightModule {}
