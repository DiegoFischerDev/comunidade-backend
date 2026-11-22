import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { memoryStorage } from 'multer';
import { Roles } from '../auth/roles.decorator';
import { SendChannelMessageDto } from '../channels/dto/send-channel-message.dto';
import { CrmChannelChatService } from '../channels/crm-channel-chat.service';
import { CRM_CLIENT_DOCUMENT_MAX_BYTES } from '../rafacall/rafacall-crm.constants';
import { ChatbotCrmService } from './chatbot-crm.service';
import {
  CreateCrmColumnDto,
  CreateCrmLeadDto,
  ReorderCrmColumnsDto,
  UpdateCrmColumnDto,
  UpdateCrmLeadDto,
} from './dto/chatbot-crm.dto';

@Controller('admin/crm')
export class AdminChatbotCrmController {
  constructor(
    private readonly crm: ChatbotCrmService,
    private readonly chat: CrmChannelChatService,
  ) {}

  @Get('counts')
  @Roles(Role.ADMIN)
  pipelineCounts() {
    return this.crm.pipelineCounts();
  }

  @Get(':slug')
  @Roles(Role.ADMIN)
  board(@Param('slug') slug: string) {
    return this.crm.listBoard(slug);
  }

  @Get(':slug/columns')
  @Roles(Role.ADMIN)
  columns(@Param('slug') slug: string) {
    return this.crm.listColumns(slug);
  }

  @Post(':slug/columns')
  @Roles(Role.ADMIN)
  createColumn(@Param('slug') slug: string, @Body() dto: CreateCrmColumnDto) {
    return this.crm.createColumn(slug, dto);
  }

  @Patch(':slug/columns/reorder')
  @Roles(Role.ADMIN)
  reorderColumns(@Param('slug') slug: string, @Body() dto: ReorderCrmColumnsDto) {
    return this.crm.reorderColumns(slug, dto.columnIds);
  }

  @Patch(':slug/columns/:columnId')
  @Roles(Role.ADMIN)
  updateColumn(
    @Param('slug') slug: string,
    @Param('columnId') columnId: string,
    @Body() dto: UpdateCrmColumnDto,
  ) {
    return this.crm.updateColumn(slug, columnId, dto);
  }

  @Post(':slug/leads')
  @Roles(Role.ADMIN)
  createLead(@Param('slug') slug: string, @Body() dto: CreateCrmLeadDto) {
    return this.crm.createLead(slug, dto);
  }

  @Get(':slug/leads/:leadId/messages')
  @Roles(Role.ADMIN)
  leadMessages(
    @Param('slug') slug: string,
    @Param('leadId') leadId: string,
    @Query('channel') channel: string,
    @Query('after') after?: string,
  ) {
    return this.chat.listForLead(slug, leadId, channel, after);
  }

  @Post(':slug/leads/:leadId/messages')
  @Roles(Role.ADMIN)
  sendLeadMessage(
    @Param('slug') slug: string,
    @Param('leadId') leadId: string,
    @Body() dto: SendChannelMessageDto,
  ) {
    return this.chat.sendForLead(slug, leadId, dto);
  }

  @Post(':slug/leads/:leadId/summary')
  @Roles(Role.ADMIN)
  generateLeadSummary(@Param('slug') slug: string, @Param('leadId') leadId: string) {
    return this.crm.generateRequestSummary(slug, leadId);
  }

  @Patch(':slug/leads/:leadId')
  @Roles(Role.ADMIN)
  updateLead(
    @Param('slug') slug: string,
    @Param('leadId') leadId: string,
    @Body() dto: UpdateCrmLeadDto,
  ) {
    return this.crm.updateLead(slug, leadId, dto);
  }

  @Delete(':slug/leads/:leadId')
  @Roles(Role.ADMIN)
  deleteLead(@Param('slug') slug: string, @Param('leadId') leadId: string) {
    return this.crm.deleteLead(slug, leadId);
  }

  @Post(':slug/leads/:leadId/documents')
  @Roles(Role.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: CRM_CLIENT_DOCUMENT_MAX_BYTES },
      storage: memoryStorage(),
    }),
  )
  uploadLeadDocument(
    @Param('slug') slug: string,
    @Param('leadId') leadId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.crm.uploadLeadDocument(slug, leadId, file);
  }

  @Delete(':slug/leads/:leadId/documents/:documentId')
  @Roles(Role.ADMIN)
  deleteLeadDocument(
    @Param('slug') slug: string,
    @Param('leadId') leadId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.crm.deleteLeadDocument(slug, leadId, documentId);
  }
}
