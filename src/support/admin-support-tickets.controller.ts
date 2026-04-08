import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { SupportTicketsService } from './support-tickets.service';

@Controller('admin/support/tickets')
@Roles(Role.ADMIN)
export class AdminSupportTicketsController {
  constructor(private readonly tickets: SupportTicketsService) {}

  @Get()
  list(@Query('take') take?: string) {
    return this.tickets.listTickets({ take: take ? Number(take) : undefined });
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.tickets.deleteTicket({ id: id.trim() });
  }
}

