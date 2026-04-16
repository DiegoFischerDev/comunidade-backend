import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { RafacallService } from './rafacall.service';
import { RafacallBookingService } from './rafacall-booking.service';

@Controller('rafacall')
export class RafacallController {
  constructor(
    private readonly rafacallService: RafacallService,
    private readonly bookingService: RafacallBookingService,
  ) {}

  /**
   * URL pública do evento Cal.com. Lida em runtime no backend — permite usar só o .env da VPS
   * (ex.: mesma variável NEXT_PUBLIC_CALCOM_EMBED_URL injetada no serviço backend) sem rebuild do Next.
   */
  @Public()
  @Get('cal-embed-url')
  calEmbedUrl() {
    const url =
      process.env.CALCOM_EMBED_URL?.trim() ||
      process.env.NEXT_PUBLIC_CALCOM_EMBED_URL?.trim() ||
      '';
    return { url: url || null };
  }

  @Get('status')
  async status(@CurrentUser() user: { id: string }) {
    const s = await this.rafacallService.getStatus(user.id);
    if (!s) {
      return { error: 'not_found' };
    }
    return s;
  }

  @Get('booking')
  async booking(@CurrentUser() user: { id: string }) {
    const b = await this.bookingService.getCurrentBooking(user.id);
    return { booking: b || null };
  }

  @Get('availability')
  async availability(
    @CurrentUser() user: { id: string },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('tz') tz?: string,
  ) {
    return this.bookingService.getAvailability({
      userId: user.id,
      from: from ?? '',
      to: to ?? '',
      tz: tz ?? 'Europe/Lisbon',
    });
  }

  @Post('book')
  async book(
    @CurrentUser() user: { id: string },
    @Body() body: { startsAtUtcIso: string; tz: string },
  ) {
    return this.bookingService.book(user.id, body);
  }

  @Post('reschedule')
  async reschedule(
    @CurrentUser() user: { id: string },
    @Body() body: { bookingId: string; newStartsAtUtcIso: string; tz: string },
  ) {
    return this.bookingService.reschedule(user.id, body);
  }

  @Post('cancel')
  async cancel(
    @CurrentUser() user: { id: string },
    @Body() body: { bookingId: string; reason?: string | null },
  ) {
    return this.bookingService.cancel(user.id, body);
  }
}
