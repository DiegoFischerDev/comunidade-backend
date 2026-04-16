import { BadRequestException, Injectable } from '@nestjs/common';
import { SupportTicketStatus } from '@prisma/client';
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
        status: SupportTicketStatus.REGISTERED,
        message: msg,
      },
      select: {
        id: true,
        status: true,
        message: true,
        adminReply: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      id: created.id,
      status: created.status,
      message: created.message,
      adminReply: created.adminReply,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
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
        status: true,
        message: true,
        adminReply: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, name: true, whatsapp: true } },
      },
    });

    return {
      items: items.map((t) => ({
        id: t.id,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        status: t.status,
        message: t.message,
        adminReply: t.adminReply,
        user: {
          id: t.user.id,
          name: t.user.name,
          whatsapp: t.user.whatsapp,
        },
      })),
    };
  }

  async listMyTickets(params: { userId: string }) {
    const items = await this.prisma.supportTicket.findMany({
      where: { userId: params.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        message: true,
        adminReply: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return {
      items: items.map((t) => ({
        id: t.id,
        status: t.status,
        message: t.message,
        adminReply: t.adminReply,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    };
  }

  async updateMyTicket(params: { userId: string; id: string; message: string }) {
    const id = params.id.trim();
    const msg = (params.message || '').trim();
    if (!id) throw new BadRequestException('id é obrigatório.');
    if (!msg) throw new BadRequestException('Mensagem é obrigatória.');
    if (msg.length > 4000) throw new BadRequestException('Mensagem muito longa (máx 4000).');

    const current = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true },
    });
    if (!current || current.userId !== params.userId) {
      throw new BadRequestException('Ticket não encontrado.');
    }
    if (current.status === SupportTicketStatus.DONE) {
      throw new BadRequestException('Não é possível editar um ticket concluído.');
    }

    const updated = await this.prisma.supportTicket.update({
      where: { id },
      data: { message: msg },
      select: {
        id: true,
        status: true,
        message: true,
        adminReply: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return {
      id: updated.id,
      status: updated.status,
      message: updated.message,
      adminReply: updated.adminReply,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async deleteMyTicket(params: { userId: string; id: string }) {
    const id = (params.id || '').trim();
    if (!id) throw new BadRequestException('id é obrigatório.');
    const current = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true },
    });
    if (!current || current.userId !== params.userId) {
      throw new BadRequestException('Ticket não encontrado.');
    }
    if (current.status === SupportTicketStatus.DONE) {
      throw new BadRequestException('Não é possível excluir um ticket concluído.');
    }
    await this.prisma.supportTicket.delete({ where: { id } });
    return { ok: true };
  }

  async adminUpdateTicket(params: { id: string; status?: SupportTicketStatus; adminReply?: string | null }) {
    const id = (params.id || '').trim();
    if (!id) throw new BadRequestException('id é obrigatório.');
    const updated = await this.prisma.supportTicket.update({
      where: { id },
      data: {
        ...(params.status ? { status: params.status } : {}),
        ...(typeof params.adminReply !== 'undefined' ? { adminReply: params.adminReply } : {}),
      },
      select: {
        id: true,
        status: true,
        message: true,
        adminReply: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return {
      id: updated.id,
      status: updated.status,
      message: updated.message,
      adminReply: updated.adminReply,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async deleteTicket(params: { id: string }) {
    const id = (params.id || '').trim();
    if (!id) throw new BadRequestException('id é obrigatório.');
    await this.prisma.supportTicket.delete({ where: { id } });
    return { ok: true };
  }
}

