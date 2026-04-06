import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { CalendlyAdminScheduleService } from './calendly-admin-schedule.service';

@Controller('admin/calendly')
@Roles(Role.ADMIN)
export class AdminCalendlyController {
  constructor(private readonly schedule: CalendlyAdminScheduleService) {}

  /** Agendamentos Calendly com início no dia civil atual (timezone configurável). */
  @Get('today')
  today(@Query('tz') tz?: string) {
    return this.schedule.getTodaySchedule(tz?.trim() || undefined);
  }
}
