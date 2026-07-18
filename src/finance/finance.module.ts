import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminFinanceController } from './admin-finance.controller';
import { FinanceService } from './finance.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdminFinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
