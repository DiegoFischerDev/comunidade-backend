import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { WhatsappScanService } from './whatsapp-scan.service';
import { CreateScanGroupDto } from './dto/create-scan-group.dto';
import { UpdateScanGroupDto } from './dto/update-scan-group.dto';
import { IngestMessageDto } from './dto/ingest-message.dto';

@Controller('whatsapp-scan')
export class WhatsappScanController {
  constructor(private readonly service: WhatsappScanService) {}

  // ===== Admin =====

  @Get('groups')
  @Roles(Role.ADMIN)
  listGroups() {
    return this.service.listGroups();
  }

  @Post('groups')
  @Roles(Role.ADMIN)
  createGroup(@Body() dto: CreateScanGroupDto) {
    return this.service.createGroup(dto);
  }

  @Patch('groups/:id')
  @Roles(Role.ADMIN)
  updateGroup(@Param('id') id: string, @Body() dto: UpdateScanGroupDto) {
    return this.service.updateGroup(id, dto);
  }

  @Delete('groups/:id')
  @Roles(Role.ADMIN)
  deleteGroup(@Param('id') id: string) {
    return this.service.deleteGroup(id);
  }

  @Get('messages')
  @Roles(Role.ADMIN)
  listMessages(@Query('groupId') groupId?: string) {
    return this.service.listMessages(groupId);
  }

  /** Busca o nome (subject) do grupo na Evolution a partir do JID. */
  @Get('group-subject')
  @Roles(Role.ADMIN)
  groupSubject(@Query('groupJid') groupJid: string) {
    return this.service.fetchGroupSubject(groupJid ?? '');
  }

  // ===== Ingest interno (chamado pelo receiver whatsapp-evolution-verify) =====

  /**
   * Endpoint público protegido por segredo partilhado (`COMMUNITY_INTERNAL_SECRET`). Recebe uma
   * mensagem de grupo do WhatsApp e processa-a (classificação IA + criação de imóvel rascunho).
   */
  @Public()
  @Post('ingest')
  ingest(
    @Body() dto: IngestMessageDto,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    const expected = (process.env.COMMUNITY_INTERNAL_SECRET || '').trim();
    if (!expected || (internalSecret ?? '').trim() !== expected) {
      throw new ForbiddenException('Segredo interno inválido.');
    }
    return this.service.ingest(dto);
  }
}
