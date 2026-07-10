import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { RafacallService } from './rafacall.service';
import { RafacallBookingService } from './rafacall-booking.service';
import { RafacallWhatsappTriggerDto } from './dto/whatsapp-trigger.dto';

@Controller('rafacall')
export class RafacallController {
  constructor(
    private readonly rafacallService: RafacallService,
    private readonly bookingService: RafacallBookingService,
    private readonly prisma: PrismaService,
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

  // ===== Endpoints públicos para agendamento gratuito =====

  @Public()
  @Get('public/state')
  async publicState(
    @Query('whatsapp') whatsapp?: string,
    @Query('deviceId') deviceId?: string,
  ) {
    if (!whatsapp?.trim()) throw new BadRequestException('WhatsApp é obrigatório.');
    return this.bookingService.getPublicState({
      whatsapp,
      deviceId: deviceId ?? null,
    });
  }

  @Public()
  @Post('public/book')
  async publicBook(
    @Body()
    body: {
      name: string;
      whatsapp: string;
      deviceId: string;
      startsAtUtcIso: string;
      tz: string;
    },
  ) {
    return this.bookingService.bookPublic(body);
  }

  /**
   * Gatilho interno (receiver wa-verify): admin envia «link para agendar chamada» numa DM
   * (fromMe) → backend responde ao cliente com link /agendar pré-preenchido.
   */
  @Public()
  @Post('whatsapp/trigger')
  async whatsappBookingLinkTrigger(
    @Body() body: RafacallWhatsappTriggerDto,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    const expected = (process.env.COMMUNITY_INTERNAL_SECRET || '').trim();
    if (!expected || (internalSecret ?? '').trim() !== expected) {
      throw new ForbiddenException('Segredo interno inválido.');
    }
    return this.bookingService.handleWhatsappBookingLinkTrigger(body);
  }

  // ===== Endpoints públicos para o fluxo guest =====

  /** Verifica um unlock pago e devolve nome/whatsapp para o frontend pré-preencher o picker. */
  @Public()
  @Get('guest/unlock/:id')
  async getGuestUnlock(@Param('id') id: string) {
    const unlock = await this.prisma.rafaCallGuestUnlock.findUnique({
      where: { id: id.trim() },
    });
    if (!unlock) throw new BadRequestException('Pagamento não encontrado.');
    return {
      id: unlock.id,
      name: unlock.name,
      whatsapp: unlock.whatsapp,
      paid: Boolean(unlock.paidAt),
      consumed: Boolean(unlock.consumedAt),
      expired: unlock.expiresAt < new Date(),
      consumedBookingId: unlock.consumedBookingId ?? null,
    };
  }

  /** Availability pública (sem auth) — usada no fluxo guest após pagamento. */
  @Public()
  @Get('guest/availability')
  async guestAvailability(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('tz') tz?: string,
    @Query('excludeBookingId') excludeBookingId?: string,
  ) {
    return this.bookingService.getAvailability({
      from: from ?? '',
      to: to ?? '',
      tz: tz ?? 'Europe/Lisbon',
      excludeBookingId: excludeBookingId?.trim() || null,
    });
  }

  /** Cria um booking a partir de um unlock pago. */
  @Public()
  @Post('guest/book')
  async guestBook(
    @Body() body: { unlockId: string; startsAtUtcIso: string; tz: string },
  ) {
    return this.bookingService.bookGuest(body);
  }

  /** Devolve dados do booking depois de confirmar o WhatsApp do dono. */
  @Public()
  @Get('guest/booking/:id')
  async guestBooking(
    @Param('id') id: string,
    @Query('whatsapp') whatsapp?: string,
  ) {
    if (!whatsapp) throw new BadRequestException('WhatsApp é obrigatório.');
    return this.bookingService.getGuestBooking(id, whatsapp);
  }

  @Public()
  @Post('guest/reschedule')
  async guestReschedule(
    @Body()
    body: {
      bookingId: string;
      whatsapp?: string;
      deviceId?: string;
      newStartsAtUtcIso: string;
      tz: string;
    },
  ) {
    if (!body.deviceId?.trim() && !body.whatsapp?.trim()) {
      throw new BadRequestException('WhatsApp ou identificador de dispositivo é obrigatório.');
    }
    return this.bookingService.rescheduleGuest(body);
  }

  @Public()
  @Post('guest/cancel')
  async guestCancel(
    @Body()
    body: {
      bookingId: string;
      whatsapp?: string;
      deviceId?: string;
      reason?: string | null;
    },
  ) {
    if (!body.deviceId?.trim() && !body.whatsapp?.trim()) {
      throw new BadRequestException('WhatsApp ou identificador de dispositivo é obrigatório.');
    }
    return this.bookingService.cancelGuest(body);
  }
}
