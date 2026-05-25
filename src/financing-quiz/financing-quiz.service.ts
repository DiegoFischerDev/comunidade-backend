import { BadRequestException, Injectable } from '@nestjs/common';
import { LeadsService } from '../leads/leads.service';
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
  constructor(private readonly leadsService: LeadsService) {}

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
   * Solicita atendimento: cria o lead na DB e atribui ao parceiro de `financiamento` com
   * menos leads no total. Não envia email — o frontend redireciona o lead diretamente para
   * a página de upload de documentos, onde verá os contactos do parceiro.
   *
   * Devolve o `whatsapp` normalizado para o frontend conseguir pré-popular o gate da página
   * de upload sem o utilizador ter de digitar o número outra vez.
   */
  async requestAtendimento(input: {
    name: string;
    email: string;
    whatsapp: string;
    answers: FinancingQuizAnswers;
  }): Promise<{ ok: true; whatsapp: string }> {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Nome é obrigatório.');

    const email = input.email.trim().toLowerCase();
    if (!email) throw new BadRequestException('Email é obrigatório.');

    const wa = normalizeWhatsapp(input.whatsapp);
    if (wa.length < 8) throw new BadRequestException('WhatsApp inválido.');

    const outcome = classifyAnswers(input.answers);
    const summary = buildQuizSummary(input.answers);
    const breakdown = buildAnswersBreakdown(input.answers);

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

    // Cria o lead na DB e atribui ao parceiro `financiamento` com menos leads no total.
    await this.leadsService.createForFinancingQuiz({
      name,
      whatsapp: wa,
      email,
      comment,
      outcomeKey: outcome.key,
    });

    return { ok: true, whatsapp: wa };
  }
}
