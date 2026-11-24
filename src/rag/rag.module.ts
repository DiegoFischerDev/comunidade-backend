import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminRagController } from './admin-rag.controller';
import { PublicRagController } from './public-rag.controller';
import { RagEmbeddingService } from './rag-embedding.service';
import { RagQaService } from './rag-qa.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdminRagController, PublicRagController],
  providers: [RagEmbeddingService, RagQaService],
  exports: [RagQaService],
})
export class RagModule {}
