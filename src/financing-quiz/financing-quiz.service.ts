import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsService } from '../leads/leads.service';
import { getFrontendBaseUrl } from '../config/frontend-base-url';
import {
  sendPartnerKitEmail,
  type PartnerForLeadEmail,
} from './financing-quiz-email';
import {
  buildAnswersBreakdown,
  buildQuizSummary,
  classifyAnswers,
  financingPracticalExampleForOutcome,
  outcomeIsEligibleForAtendimento,
  type FinancingQuizAnswers,
} from './financing-quiz.constants';

/** Normaliza um WhatsApp para apenas dígitos (mantém prefixos internacionais como `351...`). */
function normalizeWhatsapp(input: string): string {
  return String(input ?? '').replace(/\D+/g, '');
}

@Injectable()
export class FinancingQuizService {
  private readonly logger = new Logger(FinancingQuizService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leadsService: LeadsService,
  ) {}

  /**
   * Classifica o quiz e devolve outcome + exemplo + resumo + flag de elegibilidade.
   * Não persiste nada — só responde ao frontend para mostrar o resultado.
   */
  submit(input: { answers: FinancingQuizAnswers }) {
    const outcome = classifyAnswers(input.answers);
    const summary = buildQuizSummary(input.answers);
    const eligible = outcomeIsEligibleForAtendimento(outcome.key);

    return {
      outcome: {
        key: outcome.key,
        body: outcome.body,
      },
      example: financingPracticalExampleForOutcome(outcome.key),
      summary,
      eligibleForAtendimento: eligible,
    };
  }

  /**
   * Solicita atendimento: cria o lead na DB, atribui ao parceiro de `financiamento` com menos
   * leads no total, e envia ao lead um email com os contactos do parceiro + resumo do quiz +
   * resultado + exemplos + respostas detalhadas. Tudo é entregue por email — o frontend
   * recebe apenas `{ ok: true }`.
   */
  async requestAtendimento(input: {
    name: string;
    email: string;
    whatsapp: string;
    answers: FinancingQuizAnswers;
  }): Promise<{ ok: true }> {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Nome é obrigatório.');

    const email = input.email.trim().toLowerCase();
    if (!email) throw new BadRequestException('Email é obrigatório.');

    const wa = normalizeWhatsapp(input.whatsapp);
    if (wa.length < 8) throw new BadRequestException('WhatsApp inválido.');

    const outcome = classifyAnswers(input.answers);
    const summary = buildQuizSummary(input.answers);
    const breakdown = buildAnswersBreakdown(input.answers);
    const example = financingPracticalExampleForOutcome(outcome.key);

    // Comentário guardado no lead — texto completo, legível para o parceiro no dashboard.
    const commentLines: string[] = [
      'Lead via questionário público da Comunidade Rafa Portugal.',
      `Email do lead: ${email}.`,
      '',
      `Resultado: ${outcome.comment} (${outcome.key}).`,
      `Resumo: ${summary}.`,
      '',
      'Respostas detalhadas:',
      ...breakdown.map((b, i) => `${i + 1}. ${b.question}\n   → ${b.answer}`),
    ];
    const comment = commentLines.join('\n');

    // 1) Cria o lead na DB e atribui ao parceiro `financiamento` com menos leads no total.
    const { lead, partnerId } = await this.leadsService.createForFinancingQuiz({
      name,
      whatsapp: wa,
      email,
      comment,
      outcomeKey: outcome.key,
    });

    // URL pública da página de upload de documentos do lead (gate por WhatsApp).
    const uploadUrl = `${getFrontendBaseUrl()}/leads/${lead.id}/documentos`;

    // 2) Carrega os dados do parceiro atribuído para preencher o email do lead.
    const partner = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      select: {
        id: true,
        name: true,
        whatsapp: true,
        logoUrl: true,
        shortDescription: true,
        user: { select: { email: true } },
      },
    });
    if (!partner) {
      // Praticamente impossível (acabámos de criar o lead apontando para este partnerId),
      // mas mantemos a guarda para evitar crashes silenciosos em race conditions.
      throw new InternalServerErrorException(
        'Parceiro atribuído não foi encontrado. Tenta novamente em instantes.',
      );
    }

    const partnerForEmail: PartnerForLeadEmail = {
      name: partner.name,
      whatsapp: partner.whatsapp,
      logoUrl: partner.logoUrl,
      shortDescription: partner.shortDescription,
      email: partner.user?.email ?? null,
    };

    // 3) Envia email ao lead com os contactos do parceiro + resumo do quiz.
    //    Se o email falhar, retornamos um erro 400 com mensagem amigável — o lead já foi
    //    persistido (o parceiro pode contactar manualmente, mesmo sem o email do nosso lado).
    try {
      await sendPartnerKitEmail({
        to: email,
        leadName: name,
        partner: partnerForEmail,
        outcomeBody: outcome.body,
        example,
        breakdown,
        uploadUrl,
      });
    } catch (e) {
      this.logger.error(
        `Falha ao enviar email do parceiro para ${email} (partnerId=${partnerId}): ${(e as Error).message}`,
      );
      throw new BadRequestException(
        'Não conseguimos enviar o email com os dados do parceiro. Tenta de novo dentro de instantes — se persistir, escreve-nos pelo WhatsApp do suporte.',
      );
    }

    return { ok: true };
  }
}
