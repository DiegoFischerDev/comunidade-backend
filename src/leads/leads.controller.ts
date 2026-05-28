import { Body, Controller, Delete, Get, Param, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { LeadsService } from './leads.service';
import { UpdateLeadAdminDto } from './dto/update-lead-admin.dto';
import { UpdateLeadPartnerDto } from './dto/update-lead-partner.dto';
import { UpdateNextContactDto } from './dto/update-next-contact.dto';

/**
 * Endpoints para parceiros gerirem os leads que lhes foram atribuídos. O quiz público não fala
 * com este controller — usa o `LeadsService` diretamente via `FinancingQuizService`.
 */
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  /** Lista os leads do parceiro autenticado (ordem cronológica reversa). */
  @Get('me')
  @Roles(Role.PARTNER)
  async listMine(@CurrentUser() user: { id: string }) {
    return this.leadsService.listForPartner(user.id);
  }

  /** Agenda: lista apenas leads com nextContactAt (parceiro). */
  @Get('me/next-contact')
  @Roles(Role.PARTNER)
  async listNextContactMine(@CurrentUser() user: { id: string }) {
    return this.leadsService.listNextContactForPartner(user.id);
  }

  /** Edita um lead do parceiro autenticado. */
  @Patch('me/:id')
  @Roles(Role.PARTNER)
  async updateMine(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateLeadPartnerDto,
  ) {
    return this.leadsService.updateForPartner(user.id, id, dto);
  }

  /** Define/remove nextContactAt (parceiro). */
  @Patch('me/:id/next-contact')
  @Roles(Role.PARTNER)
  async setNextContactMine(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateNextContactDto,
  ) {
    return this.leadsService.setNextContactForPartner(user.id, id, dto.nextContactAt);
  }

  /** Lista todos os leads (admin). */
  @Get('admin')
  @Roles(Role.ADMIN)
  async listAllAdmin() {
    return this.leadsService.listForAdmin();
  }

  /** Edita um lead (admin). */
  @Patch('admin/:id')
  @Roles(Role.ADMIN)
  async updateAdmin(
    @Param('id') id: string,
    @Body() dto: UpdateLeadAdminDto,
  ) {
    return this.leadsService.updateForAdmin(id, dto);
  }

  /** Remove um lead (admin). */
  @Delete('admin/:id')
  @Roles(Role.ADMIN)
  async deleteAdmin(@Param('id') id: string) {
    return this.leadsService.deleteForAdmin(id);
  }
}
