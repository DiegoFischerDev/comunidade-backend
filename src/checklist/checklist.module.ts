import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChecklistController } from './checklist.controller';
import { ChecklistService } from './checklist.service';

@Module({
  imports: [PrismaModule],
  controllers: [ChecklistController],
  providers: [ChecklistService],
})
export class ChecklistModule {}

