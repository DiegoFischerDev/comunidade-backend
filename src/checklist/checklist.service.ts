import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, UserTier } from '@prisma/client';

@Injectable()
export class ChecklistService {
  constructor(private readonly prisma: PrismaService) {}

  async getByUserId(userId: string) {
    const row = await this.prisma.immigrationChecklist.findUnique({
      where: { userId },
      select: { data: true, version: true, updatedAt: true },
    });
    return row ?? { data: {}, version: 1, updatedAt: null };
  }

  async getMine(user: { id: string; tier: UserTier }) {
    const row = await this.prisma.immigrationChecklist.findUnique({
      where: { userId: user.id },
      select: { data: true, version: true, updatedAt: true },
    });
    return row ?? { data: {}, version: 1, updatedAt: null };
  }

  async upsertMine(
    user: { id: string; tier: UserTier },
    input: { data: Prisma.InputJsonValue; version?: number },
  ) {
    const version = typeof input.version === 'number' ? input.version : 1;
    const row = await this.prisma.immigrationChecklist.upsert({
      where: { userId: user.id },
      create: { userId: user.id, data: input.data, version },
      update: { data: input.data, version },
      select: { data: true, version: true, updatedAt: true },
    });
    return row;
  }
}

