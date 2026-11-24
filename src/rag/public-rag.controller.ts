import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { RagQaService } from './rag-qa.service';

@Controller('rag')
export class PublicRagController {
  constructor(private readonly ragQa: RagQaService) {}

  @Public()
  @Get('faq')
  listFaq() {
    return this.ragQa.listFaq();
  }
}
