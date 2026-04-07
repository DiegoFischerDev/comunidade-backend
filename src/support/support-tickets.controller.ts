import { Body, Controller, ForbiddenException, Post } from '@nestjs/common';
import { UserTier } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupportTicketsService } from './support-tickets.service';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
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
}

