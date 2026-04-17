import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ChecklistService } from './checklist.service';
import { UpdateChecklistDto } from './dto/update-checklist.dto';
import { Role, UserTier } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';

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

  @Get('admin/:userId')
  @Roles(Role.ADMIN)
  async adminGetByUserId(@Param('userId') userId: string) {
    const row = await this.service.getByUserId(userId);
    const data =
      row.data && typeof row.data === 'object' && !Array.isArray(row.data)
        ? (row.data as Record<string, unknown>)
        : {};
    const meta =
      data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta)
        ? (data.meta as Record<string, unknown>)
        : {};
    return {
      updatedAt: row.updatedAt,
      version: row.version,
      meta,
    };
  }
}

