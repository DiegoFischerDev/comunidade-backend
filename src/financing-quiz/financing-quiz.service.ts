import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { IaAppService } from './ia-app.service';
import { sendGestoraKitEmail } from './financing-quiz-email';
import {
  buildAnswersBreakdown,
  buildQuizSummary,
  classifyAnswers,
  financingPracticalExampleForOutcome,
  outcomeIsEligibleForAtendimento,
  type FinancingQuizAnswers,
} from './financing-quiz.constants';

@Injectable()
export class FinancingQuizService {
  private readonly logger = new Logger(FinancingQuizService.name);

  constructor(private readonly iaApp: IaAppService) {}

  /**
   * Classifica o quiz e devolve outcome + exemplo + resumo + flag de elegibilidade.
   * Não persiste nada nem chama a ia-app — só responde ao frontend para mostrar o resultado.
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
   * Solicita atendimento: cria o lead na ia-app (se ainda não existir), pede a atribuição
   * de gestora, e envia ao lead um email com a foto + dados da gestora + link de upload
   * de documentos. Não devolve os dados sensíveis ao frontend — entrega tudo por email.
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

    const wa = IaAppService.normalizeWhatsapp(input.whatsapp);
    if (wa.length < 8) throw new BadRequestException('WhatsApp inválido.');

    const outcome = classifyAnswers(input.answers);
    const summary = buildQuizSummary(input.answers);
    const breakdown = buildAnswersBreakdown(input.answers);
    const example = financingPracticalExampleForOutcome(outcome.key);

    // Comentário do lead na ia-app — texto completo, legível para gestoras e admins.
    const comentarioLinhas: string[] = [
      'Lead via questionário público da Comunidade Rafa Portugal.',
      `Email do lead: ${email}.`,
      '',
      `Resultado: ${outcome.comment} (${outcome.key}).`,
      `Resumo: ${summary}.`,
      '',
      'Respostas detalhadas:',
      ...breakdown.map((b, i) => `${i + 1}. ${b.question}\n   → ${b.answer}`),
    ];
    const comentario = comentarioLinhas.join('\n');

    // 1) Garante o lead na ia-app (idempotente).
    //    Nota: se o lead já existir, a ia-app NÃO atualiza o comentário (apenas devolve o id
    //    e o upload_url). Por isso, depois disparamos PATCH /comment para forçar o comentário
    //    atual a refletir o último quiz respondido.
    const lead = await this.iaApp.createLead({
      whatsapp: wa,
      nome: name,
      comentario,
    });
    const uploadUrl = String(lead.upload_url ?? '').trim();

    try {
      await this.iaApp.patchLeadComment({ whatsapp: wa, comentario });
    } catch (e) {
      this.logger.warn(
        `patchLeadComment falhou para ${wa}: ${(e as Error).message} — seguimos com o lead criado.`,
      );
    }

    // 2) Pede atribuição de gestora. Se ainda assim devolver `leadNotFound`, falha clara.
    const atendimento = await this.iaApp.requestAtendimento(wa);
    if ('leadNotFound' in atendimento) {
      throw new BadRequestException(
        'Não foi possível atribuir uma gestora. Tenta novamente em instantes.',
      );
    }

    // 3) Envia email ao lead com o kit da gestora + resumo do quiz + resultado + exemplo.
    //    Falha do email não devolve a gestora ao cliente — preferimos avisar o utilizador
    //    para tentar novamente, porque o objetivo deste fluxo é entregar tudo por email.
    try {
      await sendGestoraKitEmail({
        to: email,
        leadName: name,
        gestora: atendimento.gestora,
        uploadUrl,
        outcomeBody: outcome.body,
        example,
        breakdown,
      });
    } catch (e) {
      this.logger.error(
        `Falha ao enviar email da gestora para ${email}: ${(e as Error).message}`,
      );
      throw new BadRequestException(
        'Não conseguimos enviar o email com os dados da gestora. Tenta de novo dentro de instantes — se persistir, escreve-nos pelo WhatsApp do suporte.',
      );
    }

    return { ok: true };
  }
}
