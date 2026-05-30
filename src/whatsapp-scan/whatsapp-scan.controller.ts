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
import { CurrentUser } from '../auth/current-user.decorator';
import { WhatsappScanService } from './whatsapp-scan.service';
import { CreateScanGroupDto } from './dto/create-scan-group.dto';
import { UpdateScanGroupDto } from './dto/update-scan-group.dto';
import { PartnerUpdateScanGroupDto } from './dto/partner-update-scan-group.dto';
import { PartnerSetScanAutomationDto } from './dto/partner-set-scan-automation.dto';
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

  @Get('contact-display-name')
  @Roles(Role.ADMIN)
  contactDisplayName(@Query('number') number: string) {
    return this.service.fetchContactDisplayName(number ?? '');
  }

  // ===== Parceiro relocation =====

  @Get('me/groups')
  @Roles(Role.PARTNER)
  listMyGroups(@CurrentUser() user: { id: string }) {
    return this.service.listGroupsForPartnerUser(user.id);
  }

  @Get('me/contact-display-name')
  @Roles(Role.PARTNER)
  myContactDisplayName(@Query('number') number: string) {
    return this.service.fetchContactDisplayName(number ?? '');
  }

  @Patch('me/groups/:id')
  @Roles(Role.PARTNER)
  updateMyGroup(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: PartnerUpdateScanGroupDto,
  ) {
    return this.service.updateGroupForPartnerUser(user.id, id, dto);
  }

  @Patch('me/automation')
  @Roles(Role.PARTNER)
  setMyAutomation(
    @CurrentUser() user: { id: string },
    @Body() dto: PartnerSetScanAutomationDto,
  ) {
    return this.service.setAutomationForPartnerUser(user.id, dto.active);
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
