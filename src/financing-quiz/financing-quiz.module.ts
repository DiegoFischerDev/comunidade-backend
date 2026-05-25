import { Module } from '@nestjs/common';
import { FinancingQuizController } from './financing-quiz.controller';
import { FinancingQuizService } from './financing-quiz.service';
import { IaAppService } from './ia-app.service';

@Module({
  controllers: [FinancingQuizController],
  providers: [FinancingQuizService, IaAppService],
})
export class FinancingQuizModule {}
