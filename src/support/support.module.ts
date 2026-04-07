import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SupportTicketsController } from './support-tickets.controller';
import { AdminSupportTicketsController } from './admin-support-tickets.controller';
import { SupportTicketsService } from './support-tickets.service';

@Module({
  imports: [PrismaModule],
  controllers: [SupportTicketsController, AdminSupportTicketsController],
  providers: [SupportTicketsService],
})
export class SupportModule {}

