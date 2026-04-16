import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post } from '@nestjs/common';
import { UserTier } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupportTicketsService } from './support-tickets.service';
import { CreateSupportTicketDto, UpdateSupportTicketDto } from './dto/create-support-ticket.dto';
import { PrismaService } from '../prisma/prisma.service';

@Controller('support/tickets')
export class SupportTicketsController {
  constructor(
    private readonly tickets: SupportTicketsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateSupportTicketDto) {
    return this.prisma.user
      .findUnique({ where: { id: user.id }, select: { tier: true } })
      .then((u) => {
        if (!u || u.tier !== UserTier.MEMBER) {
          throw new ForbiddenException('Apenas membros podem enviar mensagens por aqui.');
        }
        return this.tickets.createTicket({ userId: user.id, message: dto.message });
      });
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

