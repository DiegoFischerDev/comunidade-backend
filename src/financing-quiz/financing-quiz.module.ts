import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LeadsModule } from '../leads/leads.module';
import { FinancingQuizController } from './financing-quiz.controller';
import { FinancingQuizService } from './financing-quiz.service';

@Module({
  imports: [PrismaModule, LeadsModule],
  controllers: [FinancingQuizController],
  providers: [FinancingQuizService],
})
export class FinancingQuizModule {}
