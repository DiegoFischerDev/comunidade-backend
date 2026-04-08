import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SupportTicketsService {
  constructor(private readonly prisma: PrismaService) {}

  async createTicket(params: { userId: string; message: string }) {
    const msg = (params.message || '').trim();
    if (!msg) throw new BadRequestException('Mensagem é obrigatória.');
    if (msg.length > 4000) throw new BadRequestException('Mensagem muito longa (máx 4000).');

    const created = await this.prisma.supportTicket.create({
      data: {
        userId: params.userId,
        message: msg,
      },
      select: {
        id: true,
        message: true,
        createdAt: true,
      },
    });

    return {
      id: created.id,
      message: created.message,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async listTickets(params?: { take?: number }) {
    const takeRaw = params?.take ?? 200;
    const take = Math.min(Math.max(Number(takeRaw) || 200, 1), 500);

    const items = await this.prisma.supportTicket.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        message: true,
        createdAt: true,
        user: { select: { id: true, name: true, whatsapp: true } },
      },
    });

    return {
      items: items.map((t) => ({
        id: t.id,
        createdAt: t.createdAt.toISOString(),
        message: t.message,
        user: {
          id: t.user.id,
          name: t.user.name,
          whatsapp: t.user.whatsapp,
        },
      })),
    };
  }

  async deleteTicket(params: { id: string }) {
    const id = (params.id || '').trim();
    if (!id) throw new BadRequestException('id é obrigatório.');
    await this.prisma.supportTicket.delete({ where: { id } });
    return { ok: true };
  }
}

