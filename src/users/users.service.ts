import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role, UserTier } from '@prisma/client';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserTierDto } from './dto/update-user-tier.dto';
import { UpdateUserRafacallDto } from './dto/update-user-rafacall.dto';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

const adminUserSelect = {
  id: true,
  name: true,
  email: true,
  whatsapp: true,
  instagram: true,
  profileImageUrl: true,
  role: true,
  tier: true,
  membershipExpiresAt: true,
  rafaCallSchedulingUnlocked: true,
  rafaCallSlotStartsAt: true,
  rafaCallSlotEndsAt: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  private partnershipTermsText(params: { partnerName: string; today: string }) {
    return `Termos de Parceria

Comunidade Rafa Pelo Mundo

Pelo presente instrumento, de um lado Rafaela dos Santos Silva, responsável pela plataforma Comunidade Rafa Pelo Mundo, e de outro lado ${params.partnerName}, estabelecem entre si uma parceria de caráter comercial e de marketing por comissão, mediante as condições abaixo:

1. Objeto da Parceria

A presente parceria tem como objetivo a indicação de leads (potenciais clientes) ao PARCEIRO por meio da plataforma Comunidade Rafa Pelo Mundo, com base em serviços previamente cadastrados.

2. Início e Vigência

A parceria tem início na data ${params.today} e vigorará por prazo indeterminado, podendo ser encerrada a qualquer momento por qualquer uma das partes, sem necessidade de justificativa prévia.

Parágrafo único: O encerramento da parceria não isenta o PARCEIRO do pagamento de comissões referentes a leads encaminhados anteriormente à data de encerramento.

3. Obrigações do Parceiro

O PARCEIRO compromete-se a:

✅ Atender os leads enviados com qualidade, clareza e profissionalismo.

⏱️ Responder às solicitações recebidas no prazo máximo de 24 horas.

💶 Praticar os valores previamente cadastrados na plataforma.

🧾 Oferecer aos leads exclusivamente os serviços cadastrados e aprovados na plataforma.

📝 Manter atualizadas as informações sobre seus serviços e empresa.

💳 Realizar corretamente o pagamento das comissões acordadas.

🔒 Garantir a confidencialidade e proteção dos dados dos leads recebidos.

4. Motivos para Encerramento da Parceria

A parceria poderá ser encerrada imediatamente, a critério da Comunidade Rafa Pelo Mundo, nos seguintes casos:

🚫 Não atendimento ou demora recorrente no retorno aos leads enviados.

💸 Cobrança de valores divergentes dos informados na plataforma.

📦 Oferta ou venda de serviços não cadastrados na plataforma.

🔁 Indicação de outros profissionais que não façam parte da comunidade ou não estejam cadastrados.

⭐ Recebimento de feedbacks negativos frequentes relacionados ao atendimento ou à qualidade do serviço.

🧮 Omissão de vendas realizadas a partir de leads enviados ou não pagamento das comissões devidas.

📤 Vazamento ou compartilhamento de dados dos leads com terceiros, sem autorização.

⚖️ Descumprimento de obrigações legais no decorrer da prestação dos serviços.

5. Comissão

Os valores e condições de comissão serão previamente acordados entre as partes e deverão ser respeitados integralmente pelo PARCEIRO.

6. Limitação de Responsabilidade

A Comunidade Rafa Pelo Mundo e Rafaela dos Santos Silva limitam-se à indicação de serviços e profissionais, não sendo responsáveis por qualquer conduta, falha na prestação de serviço, descumprimento contratual ou irregularidade legal por parte do PARCEIRO.

Toda a responsabilidade pela execução dos serviços contratados pelos leads é exclusiva do PARCEIRO.

7. Disposições Gerais

Esta parceria não estabelece vínculo empregatício, societário ou de exclusividade entre as partes, tratando-se de uma relação comercial independente.

E, por estarem de acordo, as partes aceitam os termos acima.

Se está de acordo com os termos, escreva CONCORDO.`;
  }

  /**
   * Métricas para o painel admin. Total de inscrições = soma de `MembershipPayment.amountCreditedEur`
   * (histórico à data de cada pagamento; mudar `STRIPE_AMOUNT_EUR_CENTS` no env não altera o passado).
   * `membershipPriceEurUsed` é só o preço anual EUR atual (referência na UI).
   */
  async getAdminStats() {
    const eurCentsRaw = process.env.STRIPE_AMOUNT_EUR_CENTS;
    const eurCents = eurCentsRaw ? parseInt(eurCentsRaw, 10) : 2300;
    const membershipPriceEurUsed =
      Number.isFinite(eurCents) && eurCents > 0 ? eurCents / 100 : 23;

    const [
      totalUsers,
      partners,
      visitors,
      members,
      subscriptionsCount,
      paySum,
      membershipPaymentsCount,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: Role.PARTNER } }),
      this.prisma.user.count({ where: { tier: UserTier.VISITOR } }),
      this.prisma.user.count({ where: { tier: UserTier.MEMBER } }),
      this.prisma.subscription.count(),
      this.prisma.membershipPayment.aggregate({
        _sum: { amountCreditedEur: true },
      }),
      this.prisma.membershipPayment.count(),
    ]);

    const rawSum = paySum._sum.amountCreditedEur;
    const totalMembershipRevenueEur =
      rawSum != null
        ? Math.round(Number(rawSum) * 100) / 100
        : 0;

    return {
      totalUsers,
      partners,
      visitors,
      members,
      totalMembershipRevenueEur,
      subscriptionsCount,
      membershipPaymentsCount,
      membershipPriceEurUsed,
    };
  }

  findAll() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: adminUserSelect,
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Usuário não encontrado.');
    }
    if (dto.email !== undefined) {
      const normalized = dto.email.toLowerCase().trim();
      const other = await this.prisma.user.findFirst({
        where: {
          email: normalized,
          id: { not: id },
        },
      });
      if (other) {
        throw new ConflictException('Este e-mail já está em uso por outro usuário.');
      }
    }
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.email !== undefined && {
          email: dto.email.toLowerCase().trim(),
        }),
        ...(dto.whatsapp !== undefined && { whatsapp: dto.whatsapp }),
      },
      select: adminUserSelect,
    });
  }

  async updateTier(id: string, dto: UpdateUserTierDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
    return this.prisma.user.update({
      where: { id },
      data: {
        tier: dto.tier as UserTier,
        membershipExpiresAt:
          dto.tier === 'MEMBER' ? oneYearFromNow : null,
      },
      select: adminUserSelect,
    });
  }

  async updateRafacall(id: string, dto: UpdateUserRafacallDto) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Usuário não encontrado.');
    }
    const data: {
      rafaCallSchedulingUnlocked?: boolean;
      rafaCallSlotStartsAt?: Date | null;
      rafaCallSlotEndsAt?: Date | null;
    } = {};
    if (dto.rafaCallSchedulingUnlocked !== undefined) {
      data.rafaCallSchedulingUnlocked = dto.rafaCallSchedulingUnlocked;
    }
    if (dto.rafaCallSlotEndsAt !== undefined) {
      data.rafaCallSlotEndsAt =
        dto.rafaCallSlotEndsAt === null
          ? null
          : new Date(dto.rafaCallSlotEndsAt);
      data.rafaCallSlotStartsAt = null;
    }
    if (Object.keys(data).length === 0) {
      return this.prisma.user.findUniqueOrThrow({
        where: { id },
        select: adminUserSelect,
      });
    }
    return this.prisma.user.update({
      where: { id },
      data,
      select: adminUserSelect,
    });
  }

  async updateRole(id: string, role: Role) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, whatsapp: true, role: true },
    });
    if (!existing) {
      throw new NotFoundException('Usuário não encontrado.');
    }
    const shouldSendPartnerTerms =
      existing.role !== Role.PARTNER && role === Role.PARTNER;

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: { role },
        select: adminUserSelect,
      });

      if (role === Role.PARTNER) {
        // Garante que todo usuário com role=PARTNER tenha um registro em Partner.
        await tx.partner.upsert({
          where: { userId: existing.id },
          create: {
            userId: existing.id,
            name: existing.name,
            whatsapp: existing.whatsapp,
          },
          update: {
            // Mantém os dados básicos sincronizados.
            name: existing.name,
            whatsapp: existing.whatsapp,
          },
        });
      } else {
        // Ao tirar o papel de PARTNER, removemos o registro da tabela de parceiros.
        await tx.partner.deleteMany({ where: { userId: existing.id } });
      }

      return updated;
    });

    if (shouldSendPartnerTerms) {
      const today = new Date().toLocaleDateString('pt-BR');
      const partnerName = (existing.name || '').trim() || 'PARCEIRO';
      const text = this.partnershipTermsText({ partnerName, today });
      void this.whatsapp.sendText(existing.whatsapp, text);
    }

    return updated;
  }

  async remove(id: string) {
    try {
      await this.prisma.user.delete({
        where: { id },
      });
    } catch (error) {
      throw new NotFoundException('Usuário não encontrado.');
    }
  }
}

