import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { FinancingQuizService } from './financing-quiz.service';
import {
  RequestAtendimentoDto,
  SubmitFinancingQuizDto,
} from './dto/submit-financing-quiz.dto';

@Controller('financing-quiz')
export class FinancingQuizController {
  constructor(private readonly service: FinancingQuizService) {}

  /** Classifica as respostas e devolve resultado + exemplo — sem persistir. */
  @Public()
  @Post('submit')
  submit(@Body() dto: SubmitFinancingQuizDto) {
    return this.service.submit({ answers: dto.answers });
  }

  /** Cria lead, atribui gestora e envia email com kit da gestora ao utilizador. */
  @Public()
  @Post('request-atendimento')
  async requestAtendimento(@Body() dto: RequestAtendimentoDto) {
    return this.service.requestAtendimento({
      name: dto.name,
      email: dto.email,
      whatsapp: dto.whatsapp,
      answers: dto.answers,
    });
  }
}
