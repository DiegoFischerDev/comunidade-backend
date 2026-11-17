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
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';
import { WhatsappAutomationsService } from './whatsapp-automations.service';
import {
  CreateWhatsappClientAutomationDto,
  UpdateWhatsappClientAutomationDto,
  WhatsappClientAutomationInboundDto,
} from './dto/whatsapp-client-automation.dto';

@Controller('whatsapp-automations')
export class WhatsappAutomationsController {
  constructor(private readonly service: WhatsappAutomationsService) {}

  @Get()
  @Roles(Role.ADMIN)
  list() {
    return this.service.list();
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateWhatsappClientAutomationDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWhatsappClientAutomationDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  /**
   * Inbound DM do cliente (wa-verify). Protegido por `COMMUNITY_INTERNAL_SECRET`.
   */
  @Public()
  @Post('inbound')
  inbound(
    @Body() dto: WhatsappClientAutomationInboundDto,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    const expected = (process.env.COMMUNITY_INTERNAL_SECRET || '').trim();
    if (!expected || (internalSecret ?? '').trim() !== expected) {
      throw new ForbiddenException('Segredo interno inválido.');
    }
    return this.service.handleInbound(dto);
  }
}
