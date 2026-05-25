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

  @Public()
  @Post('submit')
  async submit(@Body() dto: SubmitFinancingQuizDto) {
    return this.service.submit({
      name: dto.name,
      whatsapp: dto.whatsapp,
      answers: dto.answers,
    });
  }

  @Public()
  @Post('request-atendimento')
  async requestAtendimento(@Body() dto: RequestAtendimentoDto) {
    return this.service.requestAtendimento({ whatsapp: dto.whatsapp });
  }
}
