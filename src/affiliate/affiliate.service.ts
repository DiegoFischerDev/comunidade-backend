import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AffiliateCommissionCurrency, CashbackPayoutMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { join } from 'path';
import { unlink } from 'fs/promises';

@Injectable()
export class AffiliateService {
  constructor(private readonly prisma: PrismaService) {}

  /** Totais de comissão em painéis de afiliado consideram apenas montantes em EUR. */
  private sumEurCommissionTotals(
    commissions: { status: string; currency: string; amount: number }[],
  ): { pending: number; paid: number } {
    const pending = commissions
      .filter(
        (c) =>
          c.status === 'PENDING' && c.currency === AffiliateCommissionCurrency.EUR,
      )
      .reduce((acc, c) => acc + c.amount, 0);
    const paid = commissions
      .filter(
        (c) => c.status === 'PAID' && c.currency === AffiliateCommissionCurrency.EUR,
      )
      .reduce((acc, c) => acc + c.amount, 0);
    return { pending, paid };
  }

  private normalizeInstagram(value: string): string {
    const clean = value.trim().replace(/\s+/g, '');
    if (!clean) return '';
    return clean.startsWith('@') ? clean : `@${clean}`;
  }

  private normalizeAffiliateCode(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  }

  private async deleteUploadFileIfLocal(url?: string | null) {
    if (!url) return;
    let pathname = url;
    if (pathname.startsWith('http://') || pathname.startsWith('https://')) {
      try {
        pathname = new URL(pathname).pathname;
      } catch {
        return;
      }
    }
    if (!pathname.startsWith('/uploads/')) return;
    const filename = pathname.replace('/uploads/', '');
    if (!filename) return;
    try {
      await unlink(join(process.cwd(), 'uploads', filename));
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        // ignora para não quebrar fluxo
      }
    }
  }

  private async generateUniqueAffiliateCode(baseHandle: string): Promise<string> {
    const base = this.normalizeAffiliateCode(baseHandle.replace('@', '')) || 'afiliado';
    const firstTry = base.slice(0, 24);
    const exists = await this.prisma.affiliateProfile.findUnique({
      where: { affiliateCode: firstTry },
      select: { id: true },
    });
    if (!exists) return firstTry;

    for (let i = 0; i < 20; i += 1) {
      const candidate = `${firstTry}-${Math.random().toString(36).slice(2, 6)}`;
      const found = await this.prisma.affiliateProfile.findUnique({
        where: { affiliateCode: candidate },
        select: { id: true },
      });
      if (!found) return candidate;
    }
    throw new BadRequestException(
      'Não foi possível gerar um código de afiliado único. Tente novamente.',
    );
  }

  private validatePayoutData(
    method: CashbackPayoutMethod,
    mbwayNumber?: string,
    mbwayName?: string,
    pixKey?: string,
    pixName?: string,
  ) {
    if (method === 'MBWAY') {
      const number = (mbwayNumber ?? '').replace(/\s+/g, '').trim();
      const name = (mbwayName ?? '').trim();
      if (!number || !name) {
        throw new BadRequestException(
          'Para MB Way, informe número e nome do titular.',
        );
      }
      return {
        mbwayNumber: number,
        mbwayName: name,
        pixKey: null,
        pixName: null,
      };
    }
    const key = (pixKey ?? '').trim();
    const name = (pixName ?? '').trim();
    if (!key || !name) {
      throw new BadRequestException('Para PIX, informe chave e nome do titular.');
    }
    return {
      mbwayNumber: null,
      mbwayName: null,
      pixKey: key,
      pixName: name,
    };
  }

  async enroll(params: {
    userId: string;
    instagramHandle: string;
    termsAccepted: boolean;
    payoutMethod: CashbackPayoutMethod;
    mbwayNumber?: string;
    mbwayName?: string;
    pixKey?: string;
    pixName?: string;
  }) {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: { id: true, tier: true, role: true },
    });
    if (!user) throw new NotFoundException('Utilizador não encontrado.');
    if (!(user.tier === 'MEMBER' || user.role === 'PARTNER' || user.role === 'ADMIN')) {
      throw new ForbiddenException(
        'Apenas membros, parceiros ou admins podem tornar-se afiliados.',
      );
    }
    if (!params.termsAccepted) {
      throw new BadRequestException('É necessário aceitar os termos de afiliação.');
    }
    const instagram = this.normalizeInstagram(params.instagramHandle);
    if (!instagram) {
      throw new BadRequestException('Instagram é obrigatório.');
    }
    const payout = this.validatePayoutData(
      params.payoutMethod,
      params.mbwayNumber,
      params.mbwayName,
      params.pixKey,
      params.pixName,
    );

    const existing = await this.prisma.affiliateProfile.findUnique({
      where: { userId: params.userId },
      select: { id: true, affiliateCode: true },
    });
    if (existing) {
      throw new ConflictException('Este utilizador já é afiliado.');
    }

    const affiliateCode = await this.generateUniqueAffiliateCode(instagram);
    const created = await this.prisma.affiliateProfile.create({
      data: {
        userId: params.userId,
        instagramHandle: instagram,
        affiliateCode,
        payoutMethod: params.payoutMethod,
        termsAcceptedAt: new Date(),
        ...payout,
      },
      select: {
        id: true,
        instagramHandle: true,
        affiliateCode: true,
        payoutMethod: true,
        mbwayNumber: true,
        mbwayName: true,
        pixKey: true,
        pixName: true,
        createdAt: true,
      },
    });

    return created;
  }

  async me(userId: string) {
    const affiliate = await this.prisma.affiliateProfile.findUnique({
      where: { userId },
      include: {
        commissions: true,
      },
    });
    if (!affiliate) return null;
    const totals = this.sumEurCommissionTotals(affiliate.commissions);
    return {
      ...affiliate,
      totals,
    };
  }

  async updatePayout(params: {
    userId: string;
    payoutMethod: CashbackPayoutMethod;
    mbwayNumber?: string;
    mbwayName?: string;
    pixKey?: string;
    pixName?: string;
  }) {
    const affiliate = await this.prisma.affiliateProfile.findUnique({
      where: { userId: params.userId },
      select: { id: true },
    });
    if (!affiliate) {
      throw new BadRequestException(
        'Ative primeiro o programa de afiliados para guardar dados de pagamento.',
      );
    }
    const payout = this.validatePayoutData(
      params.payoutMethod,
      params.mbwayNumber,
      params.mbwayName,
      params.pixKey,
      params.pixName,
    );
    return this.prisma.affiliateProfile.update({
      where: { id: affiliate.id },
      data: {
        payoutMethod: params.payoutMethod,
        ...payout,
      },
      select: {
        id: true,
        payoutMethod: true,
        mbwayNumber: true,
        mbwayName: true,
        pixKey: true,
        pixName: true,
      },
    });
  }

  async myReferrals(userId: string) {
    const affiliate = await this.prisma.affiliateProfile.findUnique({
      where: { userId },
      select: { id: true, affiliateCode: true },
    });
    if (!affiliate) {
      return { affiliateCode: '', referrals: [] };
    }
    const users = await this.prisma.user.findMany({
      where: { referredByAffiliateId: affiliate.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        instagram: true,
        tier: true,
        role: true,
        createdAt: true,
        affiliateCommissionsFromReferrals: {
          select: { amount: true, currency: true },
          take: 1,
        },
      },
    });
    return {
      affiliateCode: affiliate.affiliateCode,
      referrals: users.map((u) => {
        const row = u.affiliateCommissionsFromReferrals[0];
        return {
          id: u.id,
          name: u.name,
          instagram: u.instagram,
          tier: u.tier,
          role: u.role,
          createdAt: u.createdAt,
          commission:
            row != null
              ? { amount: row.amount, currency: row.currency }
              : null,
        };
      }),
    };
  }

  async myCommissions(userId: string) {
    const affiliate = await this.prisma.affiliateProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!affiliate) {
      return { commissions: [], totals: { pending: 0, paid: 0 } };
    }
    const commissions = await this.prisma.affiliateCommission.findMany({
      where: { affiliateId: affiliate.id },
      orderBy: { createdAt: 'desc' },
      include: {
        referredUser: {
          select: { id: true, name: true, email: true, tier: true },
        },
      },
    });
    const totals = this.sumEurCommissionTotals(commissions);
    return { commissions, totals };
  }

  async adminList() {
    const affiliates = await this.prisma.affiliateProfile.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            tier: true,
            instagram: true,
          },
        },
        referredUsers: {
          select: { id: true, tier: true, role: true },
        },
        commissions: true,
      },
    });
    return affiliates.map((a) => {
      const totals = this.sumEurCommissionTotals(a.commissions);
      return {
        ...a,
        referralsByTier: {
          visitor: a.referredUsers.filter((u) => u.tier === 'VISITOR').length,
          member: a.referredUsers.filter((u) => u.tier === 'MEMBER').length,
          partner: a.referredUsers.filter((u) => u.role === 'PARTNER').length,
          admin: a.referredUsers.filter((u) => u.role === 'ADMIN').length,
        },
        totals,
      };
    });
  }

  async adminPaidCommissionsHistory(affiliateId: string) {
    const affiliate = await this.prisma.affiliateProfile.findUnique({
      where: { id: affiliateId },
      select: { id: true },
    });
    if (!affiliate) {
      throw new NotFoundException('Afiliado não encontrado.');
    }
    return this.prisma.affiliateCommission.findMany({
      where: { affiliateId, status: 'PAID' },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        amount: true,
        currency: true,
        paidAt: true,
        createdAt: true,
        paymentProofUrl: true,
      },
    });
  }

  async adminPayCommissions(params: {
    affiliateId: string;
    file: any;
    commissionIds?: string[];
  }) {
    if (!params.file) {
      throw new BadRequestException('Comprovante é obrigatório.');
    }
    const affiliate = await this.prisma.affiliateProfile.findUnique({
      where: { id: params.affiliateId },
      select: { id: true },
    });
    if (!affiliate) throw new NotFoundException('Afiliado não encontrado.');
    const whereIds = params.commissionIds?.length
      ? { in: params.commissionIds }
      : undefined;
    const pending = await this.prisma.affiliateCommission.findMany({
      where: {
        affiliateId: affiliate.id,
        status: 'PENDING',
        ...(whereIds ? { id: whereIds } : {}),
      },
    });
    if (!pending.length) {
      throw new BadRequestException('Nenhuma comissão pendente para pagar.');
    }
    const oldUrls = pending.map((c) => c.paymentProofUrl).filter(Boolean);
    const url = `/uploads/${params.file.filename}`;
    await this.prisma.affiliateCommission.updateMany({
      where: {
        affiliateId: affiliate.id,
        status: 'PENDING',
        id: { in: pending.map((c) => c.id) },
      },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        paymentProofUrl: url,
      },
    });
    for (const oldUrl of oldUrls) {
      if (oldUrl && oldUrl !== url) {
        await this.deleteUploadFileIfLocal(oldUrl);
      }
    }
    return { paidCount: pending.length, paymentProofUrl: url };
  }
}

