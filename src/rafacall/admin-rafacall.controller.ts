import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { RafacallAdminService } from './rafacall-admin.service';
import { RafacallBookingService } from './rafacall-booking.service';
import { AdminCreateRafacallBlockDto } from './dto/admin-rafacall-blocks.dto';
import { AdminCreateRafacallBookingDto } from './dto/admin-create-rafacall-booking.dto';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('admin/rafacall')
@Roles(Role.ADMIN)
export class AdminRafacallController {
  constructor(
    private readonly admin: RafacallAdminService,
    private readonly booking: RafacallBookingService,
  ) {}

  @Get('schedule')
  schedule(@Query('tz') tz?: string) {
    return this.admin.getSchedule({ tz: tz?.trim() || undefined });
  }

  @Get('blocks')
  blocks(@Query('from') from?: string, @Query('to') to?: string) {
    return this.admin.listBlocks({
      fromUtcIso: from?.trim() || '',
      toUtcIso: to?.trim() || '',
    });
  }

  @Post('blocks')
  createBlock(
    @CurrentUser() user: { id: string },
    @Body() dto: AdminCreateRafacallBlockDto,
  ) {
    return this.admin.createBlock({
      adminUserId: user.id,
      startsAtUtcIso: dto.startsAtUtcIso,
      endsAtUtcIso: dto.endsAtUtcIso,
      reason: dto.reason,
    });
  }

  @Delete('blocks/:id')
  deleteBlock(@Param('id') id: string) {
    return this.admin.deleteBlock({ id: id.trim() });
  }

  @Post('bookings')
  createBooking(@Body() dto: AdminCreateRafacallBookingDto) {
    return this.booking.adminCreateBooking({
      name: dto.name,
      whatsapp: dto.whatsapp,
      startsAtUtcIso: dto.startsAtUtcIso,
      tz: dto.tz,
    });
  }

  @Post('bookings/:id/cancel')
  cancelBooking(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: { reason?: string | null },
  ) {
    return this.admin.cancelBooking({
      bookingId: id.trim(),
      adminUserId: user.id,
      reason: body?.reason,
    });
  }

  @Post('bookings/:id/reschedule')
  rescheduleBooking(
    @Param('id') id: string,
    @Body() body: { newStartsAtUtcIso: string; tz: string },
  ) {
    return this.booking.adminRescheduleBooking(id.trim(), body);
  }

  @Post('bookings/:id/complete')
  completeBooking(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.admin.completeBooking({
      bookingId: id.trim(),
      adminUserId: user.id,
    });
  }
}

