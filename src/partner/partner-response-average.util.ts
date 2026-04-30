import { PrismaClient, Prisma } from '@prisma/client';

/** Últimos N atendimentos usados na média de tempo até primeiro contacto. */
export const PARTNER_RESPONSE_AVG_SAMPLE_LIMIT = 10;

type DbLike = Pick<PrismaClient, 'lead'> | Prisma.TransactionClient;

/**
 * Média dos minutos entre `createdAt` e `attendedAt` nos últimos N leads já contactados
 * (por data de `attendedAt`, mais recentes primeiro).
 */
export async function computePartnerAverageResponseMinutes(
  partnerId: string,
  db: DbLike,
): Promise<{ averageMinutes: number | null; sampleCount: number }> {
  const rows = await db.lead.findMany({
    where: { partnerId, attendedAt: { not: null } },
    orderBy: { attendedAt: 'desc' },
    take: PARTNER_RESPONSE_AVG_SAMPLE_LIMIT,
    select: { createdAt: true, attendedAt: true },
  });
  if (rows.length === 0) {
    return { averageMinutes: null, sampleCount: 0 };
  }
  let sum = 0;
  for (const r of rows) {
    const attendedAt = r.attendedAt!;
    const mins = Math.max(0, (attendedAt.getTime() - r.createdAt.getTime()) / 60000);
    sum += mins;
  }
  return {
    averageMinutes: sum / rows.length,
    sampleCount: rows.length,
  };
}
