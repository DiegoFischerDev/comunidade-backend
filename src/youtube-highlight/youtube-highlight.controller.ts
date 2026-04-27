import { Body, Controller, Get, Put } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { YoutubeHighlightService } from './youtube-highlight.service';

@Controller('youtube-highlights')
export class YoutubeHighlightController {
  constructor(
    private readonly youtubeHighlightService: YoutubeHighlightService,
  ) {}

  @Public()
  @Get()
  list() {
    return this.youtubeHighlightService.listPublic();
  }

  @Put('admin')
  @Roles(Role.ADMIN)
  update(@Body() body: unknown) {
    return this.youtubeHighlightService.updateAll(body);
  }
}
