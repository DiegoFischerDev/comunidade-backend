import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { RafacallAdminService } from './rafacall-admin.service';

@Controller('admin/rafacall')
@Roles(Role.ADMIN)
export class AdminRafacallController {
  constructor(private readonly admin: RafacallAdminService) {}

  @Get('today')
  today(@Query('tz') tz?: string) {
    return this.admin.getToday({ tz: tz?.trim() || undefined });
  }
}

