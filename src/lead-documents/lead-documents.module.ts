import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LeadDocumentsController } from './lead-documents.controller';
import { LeadDocumentsService } from './lead-documents.service';

@Module({
  imports: [PrismaModule],
  controllers: [LeadDocumentsController],
  providers: [LeadDocumentsService],
})
export class LeadDocumentsModule {}
