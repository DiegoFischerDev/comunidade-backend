import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ChecklistService } from './checklist.service';
import { UpdateChecklistDto } from './dto/update-checklist.dto';
import { UserTier } from '@prisma/client';

@UseGuards(JwtAuthGuard)
@Controller('checklist')
export class ChecklistController {
  constructor(private readonly service: ChecklistService) {}

  @Get('me')
  async me(@CurrentUser() user: { id: string; tier: UserTier }) {
    return this.service.getMine(user);
  }

  @Put('me')
  async updateMe(
    @CurrentUser() user: { id: string; tier: UserTier },
    @Body() dto: UpdateChecklistDto,
  ) {
    return this.service.upsertMine(user, { data: dto.data, version: dto.version });
  }
}

