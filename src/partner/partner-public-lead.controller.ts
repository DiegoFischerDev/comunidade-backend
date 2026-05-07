import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { computePartnerAverageResponseMinutes } from './partner-response-average.util';

@Controller('partners/public')
export class PartnerPublicLeadController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  @Public()
  @Post('leads/:leadId/start-attendance')
  async startAttendance(
    @Param('leadId') leadId: string,
    @Query('token') token?: string,
  ): Promise<{ waMeUrl: string }> {
    // Link público (sem login). Token é opcional para manter compatibilidade
    // com links antigos — quando vier, validamos; quando não vier, ignoramos.
    const rawToken = String(token || '').trim();
    if (rawToken) {
      let payload: any;
      try {
        payload = this.jwtService.verify(rawToken);
      } catch {
        payload = null;
      }
      if (!payload || payload.typ !== 'lead-redirect') {
        throw new BadRequestException('Token inválido.');
      }
      if (String(payload.leadId || '') !== leadId) {
        throw new BadRequestException('Token inválido.');
      }
    }

    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId },
      include: {
        user: { select: { whatsapp: true } },
        visitor: { select: { whatsapp: true } },
        partner: { select: { id: true, name: true } },
      },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado.');

    const waRaw = lead.user?.whatsapp ?? lead.visitor?.whatsapp ?? '';
    const digits = waRaw.replace(/\D/g, '');
    if (!digits) throw new BadRequestException('Este contacto não tem WhatsApp registado.');

    const now = new Date();
    if (!lead.attendedAt) {
      await this.prisma.$transaction(async (tx) => {
        await tx.lead.update({
          where: { id: lead.id },
          data: { attendedAt: now },
        });
        const avgStats = await computePartnerAverageResponseMinutes(lead.partnerId, tx);
        await tx.partner.update({
          where: { id: lead.partnerId },
          data: {
            averageResponseMinutes: avgStats.averageMinutes,
            leadResponseSampleCount: avgStats.sampleCount,
          },
        });
      });
    }

    const partnerName = lead.partner?.name?.trim() || 'parceiro da Rafa';
    const text = `Olá, somos a ${partnerName} parceiro da Rafa, como podemos ajudar?`;
    const waMeUrl = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
    return { waMeUrl };
  }
}

