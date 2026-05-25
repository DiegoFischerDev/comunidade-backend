import { Controller, Get } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { LeadsService } from './leads.service';

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
}
