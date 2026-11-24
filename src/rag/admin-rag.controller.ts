import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { CreateRagQaDto, UpdateRagQaDto } from './dto/rag-qa.dto';
import { RagQaService } from './rag-qa.service';

@Controller('admin/rag/qa')
@Roles(Role.ADMIN)
export class AdminRagController {
  constructor(private readonly ragQa: RagQaService) {}

  @Get()
  list() {
    return this.ragQa.list();
  }

  @Post()
  create(@Body() dto: CreateRagQaDto) {
    return this.ragQa.create({
      question: dto.question,
      answer: dto.answer,
      isActive: dto.isActive,
      showInFaq: dto.showInFaq,
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRagQaDto) {
    return this.ragQa.update(id.trim(), {
      question: dto.question,
      answer: dto.answer,
      isActive: dto.isActive,
      showInFaq: dto.showInFaq,
    });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.ragQa.remove(id.trim());
  }
}
