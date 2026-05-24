import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { SupportTicketsService } from './support-tickets.service';
import { CreateSupportTicketDto, UpdateSupportTicketDto } from './dto/create-support-ticket.dto';
import { CreateGuestSupportTicketDto } from './dto/create-guest-support-ticket.dto';

@Controller('support/tickets')
export class SupportTicketsController {
  constructor(private readonly tickets: SupportTicketsService) {}

  @Public()
  @Post('guest')
  createGuest(@Body() dto: CreateGuestSupportTicketDto) {
    return this.tickets.createGuestTicket({
      name: dto.name,
      whatsapp: dto.whatsapp,
      message: dto.message,
    });
  }

  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateSupportTicketDto) {
    return this.tickets.createTicket({ userId: user.id, message: dto.message });
  }

  @Get('me')
  listMine(@CurrentUser() user: { id: string }) {
    return this.tickets.listMyTickets({ userId: user.id });
  }

  @Patch('me/:id')
  updateMine(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateSupportTicketDto,
  ) {
    return this.tickets.updateMyTicket({ userId: user.id, id: id.trim(), message: dto.message });
  }

  @Delete('me/:id')
  deleteMine(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.tickets.deleteMyTicket({ userId: user.id, id: id.trim() });
  }
}

