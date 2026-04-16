import { Body, Controller, Delete, Get, Param, Patch, Query } from '@nestjs/common';
import { Role, SupportTicketStatus } from '@prisma/client';
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

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { status?: SupportTicketStatus; adminReply?: string | null },
  ) {
    return this.tickets.adminUpdateTicket({
      id: id.trim(),
      status: body?.status,
      adminReply: body?.adminReply,
    });
  }
}

