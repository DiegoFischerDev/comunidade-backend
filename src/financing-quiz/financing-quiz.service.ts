import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { IaAppService } from './ia-app.service';
import {
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
   * Submete o quiz: classifica, regista o lead na ia-app e atualiza o comentário com
   * o resumo + outcome. Devolve outcome + exemplo + se está elegível para pedir atendimento.
   */
  async submit(input: { name: string; whatsapp: string; answers: FinancingQuizAnswers }) {
    const wa = IaAppService.normalizeWhatsapp(input.whatsapp);
    if (wa.length < 8) {
      throw new BadRequestException('WhatsApp inválido.');
    }
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Nome é obrigatório.');

    const outcome = classifyAnswers(input.answers);
    const summary = buildQuizSummary(input.answers);
    const eligible = outcomeIsEligibleForAtendimento(outcome.key);

    const baseComment =
      'Lead via questionário público da comunidade.\n' +
      `Resumo: ${summary}.\n` +
      `Classificação: ${outcome.comment} (${outcome.key}).`;

    let uploadUrl = '';
    try {
      const lead = await this.iaApp.createLead({
        whatsapp: wa,
        nome: name,
        comentario: baseComment,
      });
      uploadUrl = String(lead.upload_url || '');
    } catch (e) {
      this.logger.warn(`createLead falhou para ${wa}: ${(e as Error).message}`);
      // Não bloqueamos o utilizador — devolvemos o resultado mesmo assim.
    }

    return {
      outcome: {
        key: outcome.key,
        body: outcome.body,
      },
      example: financingPracticalExampleForOutcome(outcome.key),
      summary,
      eligibleForAtendimento: eligible,
      uploadUrl,
    };
  }

  /**
   * Solicita atendimento (atribuição de gestora) na ia-app. Se o lead ainda não existir lá
   * (404), cria-o primeiro com o nome fornecido e tenta de novo.
   */
  async requestAtendimento(input: { whatsapp: string; name?: string }) {
    const wa = IaAppService.normalizeWhatsapp(input.whatsapp);
    if (wa.length < 8) {
      throw new BadRequestException('WhatsApp inválido.');
    }

    let result = await this.iaApp.requestAtendimento(wa);
    if ('leadNotFound' in result) {
      await this.iaApp.createLead({
        whatsapp: wa,
        nome: input.name?.trim() || 'Cliente Comunidade',
      });
      result = await this.iaApp.requestAtendimento(wa);
      if ('leadNotFound' in result) {
        throw new BadRequestException(
          'Não foi possível atribuir uma gestora. Tenta novamente em instantes.',
        );
      }
    }

    const gestora = (result as { gestora?: unknown }).gestora;
    const gestoraName = IaAppService.extractGestoraName(gestora);
    const gestoraWhatsapp = IaAppService.extractGestoraWhatsapp(gestora);
    return {
      gestoraName: gestoraName ?? null,
      gestoraWhatsapp: gestoraWhatsapp || null,
    };
  }
}
