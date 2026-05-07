import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Param,
  Post,
  Query,
  UnauthorizedException,
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
    const rawToken = String(token || '').trim();
    if (!rawToken) throw new UnauthorizedException();

    let payload: any;
    try {
      payload = this.jwtService.verify(rawToken);
    } catch {
      throw new UnauthorizedException();
    }
    if (!payload || payload.typ !== 'lead-redirect') {
      throw new UnauthorizedException();
    }
    if (String(payload.leadId || '') !== leadId) {
      throw new UnauthorizedException();
    }

    const partnerId = String(payload.partnerId || '');
    if (!partnerId) throw new UnauthorizedException();

    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, partnerId },
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
        const avgStats = await computePartnerAverageResponseMinutes(partnerId, tx);
        await tx.partner.update({
          where: { id: partnerId },
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

